import { CanvasRenderer, FitAddon, Terminal, init } from "ghostty-web";
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { TerminalServerMessage } from "@telemux/protocol";
import {
  TERMINAL_FONT_FACE,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_LINE_HEIGHT,
  TERMINAL_TOP_PADDING,
  resolveTerminalFontUri,
  terminalFontFaceCss
} from "./terminal-font";
import type { TerminalPaneHandle, TerminalPaneProps } from "./terminal-types";

const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(function TerminalPane(
  { paneId, wsUrl, onStatus, onTreeChanged },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingMessagesRef = useRef<TerminalServerMessage[]>([]);
  const [connected, setConnected] = useState(false);

  useImperativeHandle(ref, () => ({
    dismissKeyboard() {
      terminalRef.current?.focus();
    },
    send(data: string) {
      sendSocket(socketRef.current, { type: "input", data });
      terminalRef.current?.focus();
    },
    sendInput(data: string) {
      sendSocket(socketRef.current, { type: "input", data });
    },
    focusKeyboard() {
      terminalRef.current?.focus();
    },
    fit() {
      fitTerminal();
    }
  }));

  useEffect(() => {
    let disposed = false;
    const removeTerminalFontFace = installTerminalFontFace();

    void loadTerminalFont().then(() => init()).then(() => {
      if (disposed || !containerRef.current) {
        return;
      }

      installGhosttyLineHeight();
      const terminal = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: TERMINAL_FONT_SIZE,
        theme: {
          background: "#0d1110",
          foreground: "#d8e5de",
          cursor: "#7ce38b",
          selectionBackground: "#2b3a32"
        }
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      terminal.focus();
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      fitAddon.observeResize();

      terminal.onData((data) => {
        sendSocket(socketRef.current, { type: "input", data });
      });
      terminal.onResize(({ cols, rows }) => {
        sendSocket(socketRef.current, { type: "resize", cols, rows });
      });
      for (const message of pendingMessagesRef.current.splice(0)) {
        handleTerminalMessage(message);
      }
      window.setTimeout(() => fitTerminal(), 0);
    });

    return () => {
      disposed = true;
      fitAddonRef.current?.dispose();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      removeTerminalFontFace();
    };
  }, []);

  useEffect(() => {
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;
    onStatus("connecting");
    setConnected(false);

    socket.onopen = () => {
      setConnected(true);
      onStatus("connected");
      fitTerminal();
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as TerminalServerMessage;
      handleTerminalMessage(message);
    };

    socket.onerror = () => {
      onStatus("socket error");
    };

    socket.onclose = () => {
      setConnected(false);
      onStatus("disconnected");
    };

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [paneId, wsUrl, onStatus, onTreeChanged]);

  function fitTerminal(): void {
    const fitAddon = fitAddonRef.current;
    const terminal = terminalRef.current;
    if (!fitAddon || !terminal) {
      return;
    }

    try {
      fitAddon.fit();
      sendSocket(socketRef.current, {
        type: "resize",
        cols: terminal.cols,
        rows: terminal.rows
      });
    } catch {
      // The terminal can throw while the container is still measuring.
    }
  }

  function handleTerminalMessage(message: TerminalServerMessage): void {
    const terminal = terminalRef.current;
    if (!terminal && (message.type === "snapshot" || message.type === "output")) {
      pendingMessagesRef.current.push(message);
      return;
    }

    if (message.type === "snapshot") {
      fitTerminal();
      terminal?.reset();
      terminal?.write(message.data);
      window.setTimeout(() => fitTerminal(), 0);
    } else if (message.type === "output") {
      terminal?.write(message.data);
    } else if (message.type === "treeChanged") {
      onTreeChanged();
    } else if (message.type === "error") {
      onStatus(message.message);
    }
  }

  return (
    <div style={styles.shell}>
      <div ref={containerRef} style={styles.terminal} />
      {!connected ? <div style={styles.badge}>offline</div> : null}
    </div>
  );
});

function sendSocket(socket: WebSocket | null, payload: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

interface TerminalFontMetrics {
  width: number;
  height: number;
  baseline: number;
}

interface TeleMuxCanvasRendererPrototype {
  measureFont?: () => TerminalFontMetrics;
  __telemuxOriginalMeasureFont?: () => TerminalFontMetrics;
  __telemuxLineHeight?: number;
}

function installGhosttyLineHeight(): void {
  const prototype = (CanvasRenderer as unknown as { prototype?: TeleMuxCanvasRendererPrototype }).prototype;
  if (!prototype?.measureFont) {
    return;
  }

  prototype.__telemuxOriginalMeasureFont ??= prototype.measureFont;

  if (prototype.__telemuxLineHeight === TERMINAL_LINE_HEIGHT) {
    return;
  }

  prototype.measureFont = function measureFontWithTelemuxLineHeight(this: unknown): TerminalFontMetrics {
    const metrics = prototype.__telemuxOriginalMeasureFont?.call(this);
    if (!metrics?.height || !metrics.baseline) {
      return metrics ?? { width: 0, height: 0, baseline: 0 };
    }

    const nextHeight = Math.max(metrics.height, Math.ceil(metrics.height * TERMINAL_LINE_HEIGHT));
    const extraHeight = nextHeight - metrics.height;
    return {
      ...metrics,
      height: nextHeight,
      baseline: metrics.baseline + Math.floor(extraHeight / 2)
    };
  };
  prototype.__telemuxLineHeight = TERMINAL_LINE_HEIGHT;
}

function installTerminalFontFace(): () => void {
  const fontUri = resolveTerminalFontUri();
  const cssText = terminalFontFaceCss(fontUri);
  if (!cssText || typeof document === "undefined") {
    return () => undefined;
  }

  const style = document.createElement("style");
  style.dataset.telemuxTerminalFont = TERMINAL_FONT_FACE;
  style.textContent = cssText;
  document.head.appendChild(style);

  return () => {
    style.remove();
  };
}

async function loadTerminalFont(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) {
    return;
  }

  try {
    await document.fonts.load(`${TERMINAL_FONT_SIZE}px "${TERMINAL_FONT_FACE}"`);
    await document.fonts.ready;
  } catch {
    // The terminal still has a monospace fallback if the custom font cannot load.
  }
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    backgroundColor: "#0d1110",
    boxSizing: "border-box",
    flex: 1,
    minHeight: 0,
    paddingTop: TERMINAL_TOP_PADDING,
    position: "relative",
    width: "100%"
  },
  terminal: {
    height: "100%",
    minHeight: 0,
    overflow: "hidden",
    width: "100%"
  },
  badge: {
    background: "#26312b",
    color: "#d8e5de",
    fontFamily: "system-ui, sans-serif",
    fontSize: 12,
    padding: "4px 8px",
    position: "absolute",
    right: 10,
    top: 10
  }
};

export default TerminalPane;
