import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  TmuxAgentKind,
  TmuxPane,
  TmuxPaneStatus,
  TmuxSession,
  TmuxTree,
  TmuxWindow
} from "@telemux/protocol";
import { badRequest, notFound } from "./errors.js";

const execFileAsync = promisify(execFile);
const FIELD_SEPARATOR = "\u001f";
const STATUS_CAPTURE_LINES = 12;
const DEFAULT_PANE_STATUS: TmuxPaneStatus = { kind: "idle", agent: null, label: "Idle" };
const AGENT_COMMANDS = new Set(["claude", "claude-code", "codex", "pi", "pi-agent"]);
const SHELL_COMMANDS = new Set(["ash", "bash", "dash", "elvish", "fish", "ksh", "nu", "pwsh", "sh", "tcsh", "xonsh", "zsh"]);
const CONTROL_INPUT_KEYS = new Map<string, string>([
  ["\u0003", "C-c"],
  ["\u0004", "C-d"],
  ["\u0008", "BSpace"],
  ["\u0009", "Tab"],
  ["\u001a", "C-z"],
  ["\u001b", "Escape"],
  ["\u007f", "BSpace"]
]);
const ESCAPE_INPUT_KEYS: Array<{ sequence: string; key: string }> = [
  { sequence: "\u001b[1;5A", key: "C-Up" },
  { sequence: "\u001b[1;5B", key: "C-Down" },
  { sequence: "\u001b[1;5C", key: "C-Right" },
  { sequence: "\u001b[1;5D", key: "C-Left" },
  { sequence: "\u001b[3~", key: "Delete" },
  { sequence: "\u001b[5~", key: "PageUp" },
  { sequence: "\u001b[6~", key: "PageDown" },
  { sequence: "\u001b[H", key: "Home" },
  { sequence: "\u001b[F", key: "End" },
  { sequence: "\u001b[A", key: "Up" },
  { sequence: "\u001b[B", key: "Down" },
  { sequence: "\u001b[C", key: "Right" },
  { sequence: "\u001b[D", key: "Left" }
];

interface TmuxCommandOptions {
  allowNoServer?: boolean;
}

interface PaneTarget {
  sessionId: string;
  windowId: string;
  pane: TmuxPane;
}

export class TmuxService {
  constructor(private readonly socketName: string | null) {}

  async version(): Promise<string | null> {
    try {
      return (await this.raw(["-V"])).trim();
    } catch {
      return null;
    }
  }

  async tree(activePaneId: string | null = null): Promise<TmuxTree> {
    const [sessions, windows, panes] = await Promise.all([
      this.listSessions(),
      this.listWindows(),
      this.listPanes()
    ]);

    const sessionsById = new Map<string, TmuxSession>();
    for (const session of sessions) {
      sessionsById.set(session.id, session);
    }

    const windowsById = new Map<string, { sessionId: string; window: TmuxWindow }>();
    for (const item of windows) {
      const session = sessionsById.get(item.sessionId);
      if (!session) {
        continue;
      }
      session.windows.push(item.window);
      windowsById.set(item.window.id, item);
    }

    for (const item of panes) {
      const window = windowsById.get(item.windowId)?.window;
      if (window) {
        window.panes.push(item.pane);
      }
    }

    await this.annotatePaneStatuses(panes.map((item) => item.pane));

    for (const session of sessionsById.values()) {
      session.windows.sort((left, right) => left.index - right.index);
      for (const window of session.windows) {
        window.panes.sort((left, right) => left.index - right.index);
        window.displayName = windowDisplayNameFromCurrentPath(
          (window.panes.find((pane) => pane.active) ?? window.panes[0])?.currentPath ?? "",
          window.name
        );
      }
    }

    return {
      sessions: [...sessionsById.values()].sort((left, right) => left.name.localeCompare(right.name)),
      activePaneId,
      updatedAt: new Date().toISOString()
    };
  }

  async createSession(name?: string): Promise<string | null> {
    const args = ["new-session", "-d", "-P", "-F", "#{pane_id}"];
    if (name) {
      args.push("-s", name);
    }
    return this.readCreatedPaneId(await this.run(args));
  }

  async renameSession(sessionId: string, name: string): Promise<void> {
    assertName(name);
    await this.run(["rename-session", "-t", sessionId, name]);
  }

  async killSession(sessionId: string): Promise<void> {
    await this.run(["kill-session", "-t", sessionId]);
  }

  async createWindow(sessionId: string, name?: string): Promise<string | null> {
    const args = ["new-window", "-d", "-P", "-F", "#{pane_id}", "-t", sessionId];
    if (name) {
      args.push("-n", name);
    }
    return this.readCreatedPaneId(await this.run(args));
  }

  async renameWindow(windowId: string, name: string): Promise<void> {
    assertName(name);
    await this.run(["rename-window", "-t", windowId, name]);
  }

  async killWindow(windowId: string): Promise<void> {
    await this.run(["kill-window", "-t", windowId]);
  }

  async splitPane(paneId: string, direction: "horizontal" | "vertical"): Promise<void> {
    await this.run(["split-window", "-d", direction === "horizontal" ? "-h" : "-v", "-t", paneId]);
  }

  async resizePane(
    paneId: string,
    options: { direction?: "left" | "right" | "up" | "down"; amount?: number; cols?: number; rows?: number }
  ): Promise<void> {
    if (options.cols || options.rows) {
      const args = ["resize-window", "-t", paneId];
      if (options.cols) {
        args.push("-x", String(assertPositiveInteger(options.cols, "cols")));
      }
      if (options.rows) {
        args.push("-y", String(assertPositiveInteger(options.rows, "rows")));
      }
      await this.run(args);
      return;
    }

    const direction = options.direction ?? "right";
    const flag = { left: "-L", right: "-R", up: "-U", down: "-D" }[direction];
    const amount = assertPositiveInteger(options.amount ?? 5, "amount");
    await this.run(["resize-pane", "-t", paneId, flag, String(amount)]);
  }

  async killPane(paneId: string): Promise<void> {
    await this.run(["kill-pane", "-t", paneId]);
  }

  async sendTerminalInput(paneId: string, data: string): Promise<void> {
    if (data.length === 0) {
      return;
    }

    for (const args of terminalInputToSendKeysArgs(paneId, data)) {
      await this.run(args);
    }
  }

  async capturePane(paneId: string, historyLines = 0): Promise<string> {
    const args = ["capture-pane", "-e", "-p"];
    if (historyLines > 0) {
      args.push("-S", `-${historyLines}`);
    }
    args.push("-t", paneId);
    return this.run(args);
  }

  async paneSize(paneId: string): Promise<{ cols: number; rows: number; cursorX: number; cursorY: number }> {
    const output = await this.run([
      "display-message",
      "-p",
      "-t",
      paneId,
      "#{pane_width}\t#{pane_height}\t#{cursor_x}\t#{cursor_y}"
    ]);
    const [cols, rows, cursorX, cursorY] = output.trim().split("\t").map(Number);
    return {
      cols: Number.isFinite(cols) ? cols : 80,
      rows: Number.isFinite(rows) ? rows : 24,
      cursorX: Number.isFinite(cursorX) ? cursorX : 0,
      cursorY: Number.isFinite(cursorY) ? cursorY : 0
    };
  }

  async findPane(paneId: string): Promise<PaneTarget> {
    const tree = await this.tree(paneId);
    for (const session of tree.sessions) {
      for (const window of session.windows) {
        const pane = window.panes.find((item) => item.id === paneId);
        if (pane) {
          return { sessionId: session.id, windowId: window.id, pane };
        }
      }
    }

    throw notFound(`Pane ${paneId} was not found`, "pane_not_found");
  }

  socketArgs(): string[] {
    return this.socketName ? ["-L", this.socketName] : [];
  }

  private async listSessions(): Promise<TmuxSession[]> {
    const output = await this.run(
      [
        "list-sessions",
        "-F",
        [
          "#{session_id}",
          "#{session_name}",
          "#{session_attached}",
          "#{session_created}",
          "#{session_windows}"
        ].join(FIELD_SEPARATOR)
      ],
      { allowNoServer: true }
    );

    return parseRows(output).map((fields) => ({
      id: fields[0] ?? "",
      name: fields[1] ?? "",
      attached: Number(fields[2] ?? 0),
      createdAt: Number(fields[3] ?? 0),
      windowCount: Number(fields[4] ?? 0),
      windows: []
    }));
  }

  private async listWindows(): Promise<Array<{ sessionId: string; window: TmuxWindow }>> {
    const output = await this.run(
      [
        "list-windows",
        "-a",
        "-F",
        [
          "#{session_id}",
          "#{window_id}",
          "#{window_index}",
          "#{window_name}",
          "#{window_active}",
          "#{window_panes}",
          "#{window_layout}"
        ].join(FIELD_SEPARATOR)
      ],
      { allowNoServer: true }
    );

    return parseRows(output).map((fields) => ({
      sessionId: fields[0] ?? "",
      window: {
        id: fields[1] ?? "",
        index: Number(fields[2] ?? 0),
        name: fields[3] ?? "",
        active: fields[4] === "1",
        paneCount: Number(fields[5] ?? 0),
        layout: fields[6] ?? "",
        panes: []
      }
    }));
  }

  private async listPanes(): Promise<Array<{ windowId: string; pane: TmuxPane }>> {
    const output = await this.run(
      [
        "list-panes",
        "-a",
        "-F",
        [
          "#{window_id}",
          "#{pane_id}",
          "#{pane_index}",
          "#{pane_title}",
          "#{pane_current_path}",
          "#{pane_current_command}",
          "#{pane_active}",
          "#{pane_width}",
          "#{pane_height}",
          "#{pane_dead}",
          "#{pane_in_mode}"
        ].join(FIELD_SEPARATOR)
      ],
      { allowNoServer: true }
    );

    return parseRows(output).map((fields) => ({
      windowId: fields[0] ?? "",
      pane: {
        id: fields[1] ?? "",
        index: Number(fields[2] ?? 0),
        title: fields[3] ?? "",
        currentPath: fields[4] ?? "",
        currentCommand: fields[5] ?? "",
        active: fields[6] === "1",
        width: Number(fields[7] ?? 0),
        height: Number(fields[8] ?? 0),
        dead: fields[9] === "1",
        inMode: fields[10] === "1",
        status: DEFAULT_PANE_STATUS
      }
    }));
  }

  private async annotatePaneStatuses(panes: TmuxPane[]): Promise<void> {
    await Promise.all(
      panes.map(async (pane) => {
        let visibleText = "";
        if (shouldCapturePaneStatus(pane)) {
          try {
            visibleText = await this.capturePaneForStatus(pane.id);
          } catch {
            visibleText = "";
          }
        }
        pane.status = classifyPaneStatus(pane, visibleText);
      })
    );
  }

  private async capturePaneForStatus(paneId: string): Promise<string> {
    return this.run(["capture-pane", "-p", "-J", "-S", `-${STATUS_CAPTURE_LINES}`, "-t", paneId]);
  }

  private async run(args: string[], options: TmuxCommandOptions = {}): Promise<string> {
    try {
      return await this.raw([...this.socketArgs(), ...args]);
    } catch (error) {
      if (options.allowNoServer && isNoServerError(error)) {
        return "";
      }

      throw error;
    }
  }

  private async raw(args: string[]): Promise<string> {
    try {
      const result = await execFileAsync("tmux", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 10 });
      return result.stdout;
    } catch (error) {
      const message = error instanceof Error ? error.message : "tmux command failed";
      throw badRequest(message, "tmux_command_failed");
    }
  }

  private readCreatedPaneId(output: string): string | null {
    const paneId = output.trim();
    return paneId.startsWith("%") ? paneId : null;
  }
}

export function terminalInputToSendKeysArgs(paneId: string, data: string): string[][] {
  const commands: string[][] = [];
  let literal = "";
  let index = 0;

  const flushLiteral = (): void => {
    if (literal) {
      commands.push(["send-keys", "-l", "-t", paneId, literal]);
      literal = "";
    }
  };

  const pushKey = (key: string): void => {
    flushLiteral();
    commands.push(["send-keys", "-t", paneId, key]);
  };

  while (index < data.length) {
    if (data[index] === "\r") {
      pushKey("Enter");
      index += data[index + 1] === "\n" ? 2 : 1;
      continue;
    }

    if (data[index] === "\n") {
      pushKey("Enter");
      index += 1;
      continue;
    }

    const escape = findEscapeKey(data, index);
    if (escape) {
      pushKey(escape.key);
      index += escape.sequence.length;
      continue;
    }

    const key = CONTROL_INPUT_KEYS.get(data[index]);
    if (key) {
      pushKey(key);
      index += 1;
      continue;
    }

    literal += data[index];
    index += 1;
  }

  flushLiteral();
  return commands;
}

export function classifyPaneStatus(
  pane: Pick<TmuxPane, "currentCommand" | "dead" | "inMode">,
  visibleText = ""
): TmuxPaneStatus {
  if (pane.dead) {
    return { kind: "dead", agent: null, label: "Dead" };
  }

  if (pane.inMode) {
    return { kind: "idle", agent: null, label: "Copy mode" };
  }

  const command = normalizeCommand(pane.currentCommand);
  const text = normalizeVisibleText(visibleText);
  const statusText = normalizeVisibleStatusText(visibleText);
  const agent = detectAgent(command, text);

  if (agent) {
    if (isBlockedAgentText(statusText)) {
      return { kind: "blocked", agent, label: `${formatAgentName(agent)} blocked` };
    }
    if (isWorkingAgentText(statusText)) {
      return { kind: "working", agent, label: `${formatAgentName(agent)} working` };
    }
    return { kind: "idle", agent, label: `${formatAgentName(agent)} idle` };
  }

  if (!command || SHELL_COMMANDS.has(command)) {
    return { kind: "idle", agent: null, label: "Idle" };
  }

  return { kind: "running", agent: null, label: "Running" };
}

function normalizeCommand(command: string): string {
  return command.trim().split(/[\\/]/).pop()?.toLowerCase() ?? "";
}

function shouldCapturePaneStatus(pane: Pick<TmuxPane, "currentCommand" | "dead" | "inMode">): boolean {
  if (pane.dead || pane.inMode) {
    return false;
  }

  const command = normalizeCommand(pane.currentCommand);
  return AGENT_COMMANDS.has(command) || /\b(agent|assistant)\b/.test(command);
}

export function windowDisplayNameFromCurrentPath(currentPath: string, fallbackName: string): string {
  const trimmed = currentPath.trim();
  if (!trimmed) {
    return fallbackName;
  }

  const normalized = trimmed.replace(/[\\/]+$/, "");
  if (!normalized) {
    return trimmed.startsWith("/") || trimmed.startsWith("\\") ? "/" : fallbackName;
  }

  return normalized.split(/[\\/]/).pop() || fallbackName;
}

function normalizeVisibleText(text: string): string {
  return text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeVisibleStatusText(text: string): string {
  const lines = text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(-8).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
}

function detectAgent(command: string, text: string): TmuxAgentKind | null {
  if (/(^|[-_\s])codex($|[-_\s])/.test(command) || /\bcodex\b/.test(text)) {
    return "codex";
  }
  if (/(^|[-_\s])claude($|[-_\s])|claude-code/.test(command) || /\bclaude code\b|\bclaude\b/.test(text)) {
    return "claude";
  }
  if (command === "pi" || command === "pi-agent" || /\bpi\b/.test(text)) {
    return "pi";
  }
  if (/\b(agent|assistant)\b/.test(command)) {
    return "unknown";
  }
  return null;
}

function isBlockedAgentText(text: string): boolean {
  return /\b(approval|approve|permission|allow|deny|confirm|confirmation|continue|proceed|accept|reject)\b/.test(text) ||
    /\b(do you want|requires approval|waiting for approval|press enter|yes\/no|\by\/n\b)\b/.test(text);
}

function isWorkingAgentText(text: string): boolean {
  return /\b(thinking|working|reading|editing|searching|executing|applying|analyzing|planning|calling|tool call|generating)\b/.test(text) ||
    /(^|[^-])\brunning\b/.test(text) ||
    /\b(esc to interrupt|ctrl-c to interrupt|ctrl\+c to interrupt|stop generating)\b/.test(text);
}

function formatAgentName(agent: TmuxAgentKind): string {
  switch (agent) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude";
    case "pi":
      return "Pi";
    case "unknown":
      return "Agent";
  }
}

function parseRows(output: string): string[][] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(FIELD_SEPARATOR));
}

function isNoServerError(error: unknown): boolean {
  return error instanceof Error && /no server running|failed to connect to server|error connecting/i.test(error.message);
}

function assertName(name: string): void {
  if (!name.trim()) {
    throw badRequest("Name cannot be empty", "invalid_name");
  }
}

function assertPositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw badRequest(`${field} must be a positive integer`, "invalid_number");
  }

  return value;
}

function findEscapeKey(data: string, index: number): { sequence: string; key: string } | null {
  if (data[index] !== "\u001b") {
    return null;
  }

  return ESCAPE_INPUT_KEYS.find((item) => data.startsWith(item.sequence, index)) ?? null;
}
