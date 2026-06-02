import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { RawData, WebSocket } from "ws";
import type { TerminalClientMessage, TerminalServerMessage } from "@remux/protocol";
import type { MetadataStore } from "./metadata.js";
import type { TmuxService } from "./tmux.js";

export class TerminalBridge {
  private process: ChildProcessWithoutNullStreams | null = null;
  private lineBuffer = "";
  private messageQueue: Promise<void> = Promise.resolve();
  private readonly outputSanitizer = new TerminalOutputSanitizer();
  private clientCols: number | null = null;
  private clientRows: number | null = null;
  private paneId: string;
  private sessionId: string;

  constructor(
    private readonly socket: WebSocket,
    private readonly tmux: TmuxService,
    private readonly metadata: MetadataStore,
    initialTarget: { paneId: string; sessionId: string }
  ) {
    this.paneId = initialTarget.paneId;
    this.sessionId = initialTarget.sessionId;
  }

  async start(): Promise<void> {
    this.socket.on("message", (data) => {
      this.messageQueue = this.messageQueue.then(() => this.handleMessage(data)).catch((error) => {
        this.send({
          type: "error",
          code: "terminal_command_failed",
          message: error instanceof Error ? error.message : "Terminal command failed"
        });
      });
    });
    this.socket.on("close", () => this.dispose());
    this.socket.on("error", () => this.dispose());

    await this.sendSnapshot();
    this.spawnControlClient();
    this.metadata.updatePreferences({ lastPaneId: this.paneId });
  }

  dispose(): void {
    if (this.process && !this.process.killed) {
      this.writeControlCommand("detach-client");
      this.process.kill();
    }
    this.process = null;
  }

  private async handleMessage(raw: RawData): Promise<void> {
    let message: TerminalClientMessage;
    try {
      message = JSON.parse(rawDataToString(raw)) as TerminalClientMessage;
    } catch {
      this.send({ type: "error", code: "invalid_message", message: "Terminal message must be JSON" });
      return;
    }

    try {
      if (process.env.REMUX_DEBUG_TERMINAL === "1" && message.type === "input") {
        console.log(`[remux terminal input] ${JSON.stringify(message.data)}`);
      }

      if (message.type === "input") {
        await this.tmux.sendTerminalInput(this.paneId, message.data);
      } else if (message.type === "resize") {
        const cols = clampInteger(message.cols, 20, 500);
        const rows = clampInteger(message.rows, 5, 200);
        if (cols === this.clientCols && rows === this.clientRows) {
          return;
        }
        this.clientCols = cols;
        this.clientRows = rows;
        await this.tmux.resizePane(this.paneId, { cols, rows });
        this.writeControlCommand(`refresh-client -C ${cols}x${rows}`);
        await this.sendSnapshot();
      } else if (message.type === "focus") {
        const target = await this.tmux.findPane(message.paneId);
        this.paneId = message.paneId;
        this.metadata.updatePreferences({ lastPaneId: this.paneId });

        if (target.sessionId !== this.sessionId) {
          this.sessionId = target.sessionId;
          this.dispose();
          this.spawnControlClient();
        } else {
          this.writeControlCommand(`refresh-client -A ${this.paneId}:on`);
        }

        await this.sendSnapshot();
      } else if (message.type === "ping") {
        this.send({ type: "pong", id: message.id });
      }
    } catch (error) {
      this.send({
        type: "error",
        code: "terminal_command_failed",
        message: error instanceof Error ? error.message : "Terminal command failed"
      });
    }
  }

  private spawnControlClient(): void {
    this.outputSanitizer.reset();
    this.process = spawn("tmux", [...this.tmux.socketArgs(), "-C", "attach-session", "-t", this.sessionId], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.process.stdout.setEncoding("utf8");
    this.process.stderr.setEncoding("utf8");
    this.process.stdout.on("data", (chunk: string) => this.handleControlOutput(chunk));
    this.process.stderr.on("data", (chunk: string) => {
      const message = chunk.trim();
      if (message) {
        this.send({ type: "error", code: "tmux_control_stderr", message });
      }
    });
    this.process.on("exit", () => {
      this.process = null;
    });

    this.writeControlCommand(`refresh-client -A ${this.paneId}:on`);
  }

  private async sendSnapshot(): Promise<void> {
    const [data, size] = await Promise.all([this.tmux.capturePane(this.paneId), this.tmux.paneSize(this.paneId)]);
    this.send({
      type: "snapshot",
      paneId: this.paneId,
      data: formatSnapshotForTerminal(data, size.cursorX, size.cursorY),
      cols: size.cols,
      rows: size.rows
    });
  }

  private handleControlOutput(chunk: string): void {
    this.lineBuffer += chunk;

    let newlineIndex = this.lineBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.lineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
      this.handleControlLine(line);
      newlineIndex = this.lineBuffer.indexOf("\n");
    }
  }

  private handleControlLine(line: string): void {
    if (line.startsWith("%output ")) {
      const [, paneId, value = ""] = line.match(/^%output\s+(\S+)\s?(.*)$/) ?? [];
      if (paneId === this.paneId) {
        this.sendOutput(paneId, value);
      }
      return;
    }

    if (line.startsWith("%extended-output ")) {
      const parsed = parseExtendedOutput(line);
      if (parsed?.paneId === this.paneId) {
        this.sendOutput(parsed.paneId, parsed.value);
      }
      return;
    }

    if (isTreeChangeNotification(line)) {
      this.send({ type: "treeChanged" });
      return;
    }

    if (line.startsWith("%exit")) {
      this.send({ type: "error", code: "tmux_control_exit", message: line });
    }
  }

  private writeControlCommand(command: string): void {
    this.process?.stdin.write(`${command}\n`);
  }

  private sendOutput(paneId: string, encodedValue: string): void {
    const data = this.outputSanitizer.sanitize(decodeTmuxOutput(encodedValue));
    if (data.length > 0) {
      this.send({ type: "output", paneId, data });
    }
  }

  private send(message: TerminalServerMessage): void {
    if (this.socket.readyState === this.socket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}

export class TerminalOutputSanitizer {
  private inStringControl = false;
  private pendingEscapeInString = false;
  private pendingEscapeOutside = false;

  reset(): void {
    this.inStringControl = false;
    this.pendingEscapeInString = false;
    this.pendingEscapeOutside = false;
  }

  sanitize(value: string): string {
    let sanitized = "";

    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];

      if (this.inStringControl) {
        index = this.consumeStringControl(value, index);
        continue;
      }

      if (this.pendingEscapeOutside) {
        this.pendingEscapeOutside = false;
        if (isStringControlStarter(char)) {
          this.inStringControl = true;
          continue;
        }

        sanitized += "\u001b";
      }

      if (char === "\u001b") {
        const next = value[index + 1];
        if (next === undefined) {
          this.pendingEscapeOutside = true;
          continue;
        }

        if (isStringControlStarter(next)) {
          this.inStringControl = true;
          index += 1;
          continue;
        }
      } else if (isC1StringControlStarter(char)) {
        this.inStringControl = true;
        continue;
      }

      sanitized += char;
    }

    return sanitized;
  }

  private consumeStringControl(value: string, index: number): number {
    const char = value[index];

    if (this.pendingEscapeInString) {
      this.pendingEscapeInString = false;
      if (char === "\\") {
        this.inStringControl = false;
        return index;
      }
    }

    if (char === "\u0007" || char === "\u009c") {
      this.inStringControl = false;
      return index;
    }

    if (char === "\u001b") {
      const next = value[index + 1];
      if (next === undefined) {
        this.pendingEscapeInString = true;
        return index;
      }

      if (next === "\\") {
        this.inStringControl = false;
        return index + 1;
      }
    }

    return index;
  }
}

export function stripTerminalStringControls(value: string): string {
  return new TerminalOutputSanitizer().sanitize(value);
}

export function formatSnapshotForTerminal(value: string, cursorX: number, cursorY: number): string {
  const sanitized = stripTerminalStringControls(value).replace(/\r?\n$/, "");
  if (!Number.isInteger(cursorX) || !Number.isInteger(cursorY) || cursorX < 0 || cursorY < 0) {
    return sanitized;
  }

  return `${sanitized}\u001b[${cursorY + 1};${cursorX + 1}H`;
}

export function decodeTmuxOutput(value: string): string {
  let decoded = "";

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\\" && /^[0-7]{3}$/.test(value.slice(index + 1, index + 4))) {
      decoded += String.fromCharCode(Number.parseInt(value.slice(index + 1, index + 4), 8));
      index += 3;
    } else if (char === "\\" && value[index + 1] === "\\") {
      decoded += "\\";
      index += 1;
    } else {
      decoded += char;
    }
  }

  return decoded;
}

function rawDataToString(raw: RawData): string {
  if (typeof raw === "string") {
    return raw;
  }

  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }

  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8");
  }

  return raw.toString("utf8");
}

function parseExtendedOutput(line: string): { paneId: string; value: string } | null {
  const match = line.match(/^%extended-output\s+(\S+)\s+.*?\s:\s?(.*)$/);
  if (!match) {
    return null;
  }

  return { paneId: match[1], value: match[2] ?? "" };
}

function isStringControlStarter(char: string | undefined): boolean {
  return char === "]" || char === "P" || char === "^" || char === "_" || char === "X" || char === "k";
}

function isC1StringControlStarter(char: string): boolean {
  return char === "\u0090" || char === "\u0098" || char === "\u009d" || char === "\u009e" || char === "\u009f";
}

function isTreeChangeNotification(line: string): boolean {
  return (
    line.startsWith("%sessions-changed") ||
    line.startsWith("%session-renamed") ||
    line.startsWith("%session-window-changed") ||
    line.startsWith("%window-add") ||
    line.startsWith("%window-close") ||
    line.startsWith("%window-renamed") ||
    line.startsWith("%layout-change") ||
    line.startsWith("%window-pane-changed")
  );
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isInteger(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}
