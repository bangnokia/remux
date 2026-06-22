import { CanvasRenderer, FitAddon, Terminal, init } from "ghostty-web";
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { TerminalServerMessage } from "@telemux/protocol";
import {
  TERMINAL_FONT_FACE,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_HORIZONTAL_PADDING,
  TERMINAL_LINE_HEIGHT,
  TERMINAL_SCROLLBAR_WIDTH,
  TERMINAL_TOP_PADDING,
  resolveTerminalFontUri,
  terminalFontFaceCss
} from "./terminal-font";
import type { TerminalPaneHandle, TerminalPaneProps } from "./terminal-types";

const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(function TerminalPane(
  { active = true, paneId, wsUrl, onStatus, onTreeChanged },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingMessagesRef = useRef<TerminalServerMessage[]>([]);
  const activeRef = useRef(active);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    activeRef.current = active;
    if (active) {
      window.setTimeout(() => fitTerminal(), 0);
    }
  }, [active]);

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
      installGhosttyScrollbarWidth();
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
        if (activeRef.current) {
          sendSocket(socketRef.current, { type: "resize", cols, rows });
        }
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
    if (!activeRef.current || !fitAddon || !terminal) {
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
    } else if (message.type === "treeChanged" || message.type === "paneExited") {
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
  canvas?: HTMLCanvasElement;
  ctx?: CanvasRenderingContext2D;
  devicePixelRatio?: number;
  measureFont?: () => TerminalFontMetrics;
  __telemuxOriginalMeasureFont?: () => TerminalFontMetrics;
  __telemuxOriginalRenderScrollbar?: (
    viewportY: number,
    scrollbackLength: number,
    rows: number,
    opacity?: number
  ) => void;
  __telemuxLineHeight?: number;
  __telemuxScrollbarWidth?: number;
  renderScrollbar?: (
    viewportY: number,
    scrollbackLength: number,
    rows: number,
    opacity?: number
  ) => void;
  theme?: {
    background?: string;
  };
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

function installGhosttyScrollbarWidth(): void {
  const prototype = (CanvasRenderer as unknown as { prototype?: TeleMuxCanvasRendererPrototype }).prototype;
  if (!prototype?.renderScrollbar) {
    return;
  }

  prototype.__telemuxOriginalRenderScrollbar ??= prototype.renderScrollbar;

  if (prototype.__telemuxScrollbarWidth === TERMINAL_SCROLLBAR_WIDTH) {
    return;
  }

  prototype.renderScrollbar = function renderScrollbarWithTelemuxWidth(
    this: TeleMuxCanvasRendererPrototype,
    viewportY: number,
    scrollbackLength: number,
    rows: number,
    opacity = 1
  ): void {
    const { canvas, ctx } = this;
    const originalRenderScrollbar = prototype.__telemuxOriginalRenderScrollbar;
    if (!canvas || !ctx || !originalRenderScrollbar) {
      originalRenderScrollbar?.call(this, viewportY, scrollbackLength, rows, opacity);
      return;
    }

    const devicePixelRatio = this.devicePixelRatio ?? 1;
    const height = canvas.height / devicePixelRatio;
    const width = canvas.width / devicePixelRatio;
    const scrollbarWidth = TERMINAL_SCROLLBAR_WIDTH;
    const scrollbarX = width - scrollbarWidth - 4;
    const margin = 4;
    const trackHeight = height - margin * 2;

    ctx.fillStyle = this.theme?.background ?? "#0d1110";
    ctx.fillRect(scrollbarX - 2, 0, scrollbarWidth + 6, height);
    if (opacity <= 0 || scrollbackLength === 0) {
      return;
    }

    const totalRows = scrollbackLength + rows;
    const thumbHeight = Math.max(20, rows / totalRows * trackHeight);
    const scrollRatio = viewportY / scrollbackLength;
    const thumbY = margin + (trackHeight - thumbHeight) * (1 - scrollRatio);

    ctx.fillStyle = `rgba(128, 128, 128, ${0.1 * opacity})`;
    ctx.fillRect(scrollbarX, margin, scrollbarWidth, trackHeight);
    ctx.fillStyle = `rgba(128, 128, 128, ${(viewportY > 0 ? 0.5 : 0.3) * opacity})`;
    ctx.fillRect(scrollbarX, thumbY, scrollbarWidth, thumbHeight);
  };
  prototype.__telemuxScrollbarWidth = TERMINAL_SCROLLBAR_WIDTH;
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
    paddingLeft: TERMINAL_HORIZONTAL_PADDING,
    paddingRight: TERMINAL_HORIZONTAL_PADDING,
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
