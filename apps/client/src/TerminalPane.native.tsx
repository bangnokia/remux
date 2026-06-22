import React, { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { Keyboard as NativeKeyboard, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { StyleSheet, View } from "./rn";
import {
  TERMINAL_FONT_FACE,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_LEFT_PADDING,
  TERMINAL_LINE_HEIGHT,
  TERMINAL_RIGHT_PADDING,
  TERMINAL_SCROLLBAR_WIDTH,
  TERMINAL_TOP_PADDING,
  resolveTerminalFontUris,
  terminalFontFaceCss
} from "./terminal-font";
import type { TerminalPaneHandle, TerminalPaneProps } from "./terminal-types";

const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(function TerminalPane(
  { wsUrl, onStatus, onTreeChanged },
  ref
) {
  const webViewRef = useRef<WebView>(null);
  const lastLayoutRef = useRef<{ width: number; height: number } | null>(null);
  const html = terminalHtml(wsUrl);
  const source = Platform.OS === "android" ? { html, baseUrl: resolveAndroidWebViewBaseUrl() } : { html };

  const handleLayout = useCallback((event: { nativeEvent: { layout: { width: number; height: number } } }) => {
    const { width, height } = event.nativeEvent.layout;
    const nextLayout = { width: Math.floor(width), height: Math.floor(height) };
    const lastLayout = lastLayoutRef.current;
    if (lastLayout?.width === nextLayout.width && lastLayout.height === nextLayout.height) {
      return;
    }
    lastLayoutRef.current = nextLayout;
    syncViewportSize(nextLayout.width, nextLayout.height);
  }, []);

  const syncLastViewportSize = useCallback(() => {
    const layout = lastLayoutRef.current;
    if (layout) {
      syncViewportSize(layout.width, layout.height);
    }
  }, []);

  const syncViewportSize = useCallback((width: number, height: number) => {
    webViewRef.current?.injectJavaScript(
      `window.telemuxSetViewportSize && window.telemuxSetViewportSize(${Math.floor(width)}, ${Math.floor(height)}); true;`
    );
  }, []);

  const sendToTerminal = useCallback(
    (data: string) => {
      if (!data) {
        return;
      }

      webViewRef.current?.injectJavaScript(`window.telemuxSend(${JSON.stringify(data)}); true;`);
    },
    []
  );

  useImperativeHandle(ref, () => ({
    dismissKeyboard() {
      NativeKeyboard.dismiss();
    },
    send(data: string) {
      sendToTerminal(data);
    },
    sendInput(data: string) {
      sendToTerminal(data);
    },
    focusKeyboard() {
      webViewRef.current?.injectJavaScript("window.telemuxFocus && window.telemuxFocus(); true;");
    },
    fit() {
      webViewRef.current?.injectJavaScript(
        "window.telemuxScheduleFit ? window.telemuxScheduleFit() : window.telemuxFit && window.telemuxFit(); true;"
      );
    }
  }), [sendToTerminal]);

  function handleMessage(event: unknown): void {
    const data = readWebViewMessageData(event);
    try {
      const message = JSON.parse(data) as { type: string; value?: string };
      if (message.type === "status") {
        onStatus(message.value ?? "");
      } else if (message.type === "treeChanged") {
        onTreeChanged();
      }
    } catch {
      onStatus(data);
    }
  }

  return (
    <View onLayout={handleLayout} style={styles.shell}>
      <WebView
        key={`${wsUrl}:${TERMINAL_FONT_SIZE}:${TERMINAL_LINE_HEIGHT}`}
        ref={webViewRef}
        originWhitelist={["*"]}
        source={source}
        onMessage={handleMessage}
        onError={(event) => onStatus(event.nativeEvent.description || "terminal webview error")}
        onLoadEnd={syncLastViewportSize}
        style={styles.webView}
        containerStyle={styles.shell}
        javaScriptEnabled
        allowsInlineMediaPlayback
        bounces={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction
        allowFileAccess={Platform.OS === "android"}
        scrollEnabled={false}
      />
    </View>
  );
});

function readWebViewMessageData(event: unknown): string {
  const nativeEvent = (event as { nativeEvent?: { data?: unknown } }).nativeEvent;
  return typeof nativeEvent?.data === "string" ? nativeEvent.data : "";
}

function resolveAndroidWebViewBaseUrl(): string {
  const metroFontUri = resolveTerminalFontUris().find((uri) => uri.startsWith("http://") || uri.startsWith("https://"));
  if (!metroFontUri) {
    return "file:///android_res/";
  }

  try {
    return `${new URL(metroFontUri).origin}/`;
  } catch {
    return "file:///android_res/";
  }
}

function terminalHtml(wsUrl: string): string {
  const encodedUrl = JSON.stringify(wsUrl);
  const terminalFontUris = resolveTerminalFontUris();
  const terminalFontCss = terminalFontFaceCss(terminalFontUris);
  const encodedTerminalFontFace = JSON.stringify(TERMINAL_FONT_FACE);
  const encodedTerminalFontFamily = JSON.stringify(TERMINAL_FONT_FAMILY);
  const encodedTerminalFontSize = JSON.stringify(TERMINAL_FONT_SIZE);
  const encodedTerminalFontUris = JSON.stringify(terminalFontUris);
  const encodedTerminalLineHeight = JSON.stringify(TERMINAL_LINE_HEIGHT);
  const encodedTerminalLeftPadding = JSON.stringify(TERMINAL_LEFT_PADDING);
  const encodedTerminalRightPadding = JSON.stringify(TERMINAL_RIGHT_PADDING);
  const encodedTerminalScrollbarWidth = JSON.stringify(TERMINAL_SCROLLBAR_WIDTH);
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <style>
    ${terminalFontCss}

    :root {
      --telemux-terminal-left-padding: ${TERMINAL_LEFT_PADDING}px;
      --telemux-terminal-right-padding: ${TERMINAL_RIGHT_PADDING}px;
      --telemux-terminal-scrollbar-width: ${TERMINAL_SCROLLBAR_WIDTH}px;
      --telemux-terminal-top-padding: ${TERMINAL_TOP_PADDING}px;
    }

    html, body, #terminal-viewport {
      width: 100%;
      height: 100%;
      margin: 0;
      background: #0d1110;
      overflow: hidden;
    }

    html, body {
      min-height: 100%;
      position: fixed;
      inset: 0;
    }

    #terminal-viewport {
      height: var(--telemux-height, 100%);
      left: 0;
      position: fixed;
      top: 0;
      width: var(--telemux-width, 100%);
    }

    #terminal {
      caret-color: transparent !important;
      background: #0d1110;
      height: calc(var(--telemux-height, 100%) - var(--telemux-terminal-top-padding));
      outline: none !important;
      overflow: hidden;
      position: absolute;
      left: var(--telemux-terminal-left-padding);
      top: var(--telemux-terminal-top-padding);
      touch-action: none;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      -webkit-user-select: none;
      width: calc(
        var(--telemux-width, 100%) -
        var(--telemux-terminal-left-padding) -
        var(--telemux-terminal-right-padding) -
        var(--telemux-terminal-scrollbar-width)
      );
    }

    #terminal *,
    #terminal textarea,
    #terminal [contenteditable="true"] {
      caret-color: transparent !important;
      outline: none !important;
    }

    #terminal textarea {
      color: transparent !important;
      text-shadow: none !important;
    }

    #terminal canvas {
      display: block;
    }

    #terminal-scrollbar {
      bottom: 0;
      opacity: 0;
      pointer-events: none;
      position: absolute;
      right: var(--telemux-terminal-right-padding);
      top: var(--telemux-terminal-top-padding);
      transition: opacity 160ms ease;
      width: var(--telemux-terminal-scrollbar-width);
      z-index: 8;
    }

    #terminal-scrollbar.visible {
      opacity: 1;
    }

    #terminal-scrollbar-thumb {
      background: rgba(216, 229, 222, 0.34);
      left: 0;
      min-height: 20px;
      position: absolute;
      top: 0;
      width: 100%;
    }

    #live-indicator {
      align-items: center;
      background: rgba(17, 22, 19, 0.94);
      border: 1px solid rgba(124, 227, 139, 0.38);
      border-radius: 999px;
      bottom: 10px;
      color: #d8e5de;
      display: none;
      font: 700 12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 28px;
      padding: 0 10px;
      position: fixed;
      right: 10px;
      touch-action: manipulation;
      z-index: 20;
    }

    #live-indicator.visible {
      display: flex;
    }
  </style>
</head>
<body>
  <div id="terminal-viewport">
    <div id="terminal"></div>
    <div id="terminal-scrollbar" aria-hidden="true">
      <div id="terminal-scrollbar-thumb"></div>
    </div>
  </div>
  <button id="live-indicator" type="button">Live</button>
  <script>
    const post = (message) => window.ReactNativeWebView.postMessage(JSON.stringify(message));
    const ghosttyModuleUrls = [
      "https://cdn.jsdelivr.net/npm/ghostty-web@0.4.0/+esm",
      "https://esm.sh/ghostty-web@0.4.0"
    ];
    let term;
    let socket;
    let nativeViewportWidth;
    let nativeViewportHeight;
    let pendingViewportFit = 0;
    let pendingBottomScrollFrame = 0;
    let pendingBottomScrollTimers = [];
    let pendingScrollbarFrame = 0;
    let scrollbarHideTimer = 0;
    let lastSentCols;
    let lastSentRows;
    let followBottomUntil = 0;
    let liveFollowPaused = false;
    let pendingOutputWhilePaused = false;
    let touchScrollActive = false;
    const terminalFontFace = ${encodedTerminalFontFace};
    const terminalFontFamily = ${encodedTerminalFontFamily};
    const terminalFontSize = ${encodedTerminalFontSize};
    const terminalFontUris = ${encodedTerminalFontUris};
    const terminalLineHeight = ${encodedTerminalLineHeight};
    const terminalLeftPadding = ${encodedTerminalLeftPadding};
    const terminalRightPadding = ${encodedTerminalRightPadding};
    const terminalScrollbarWidth = ${encodedTerminalScrollbarWidth};
    const terminalTopPadding = ${TERMINAL_TOP_PADDING};
    const touchScrollLinePx = 14;

    window.telemuxFit = () => {
      try {
        const shouldFollowBottom = shouldFollowTerminalBottom();
        applyViewportSize();
        fitToNativeViewport();
        sendResizeIfChanged();
        scheduleScrollbarUpdate(false);
        if (shouldFollowBottom) {
          keepTerminalBottomVisible();
        }
      } catch {}
    };

    window.telemuxScheduleFit = () => {
      scheduleFit();
    };

    window.telemuxSetViewportSize = (width, height) => {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      const nextWidth = Math.floor(width);
      const nextHeight = Math.floor(height);
      if (nativeViewportWidth === nextWidth && nativeViewportHeight === nextHeight) return;
      nativeViewportWidth = nextWidth;
      nativeViewportHeight = nextHeight;
      document.documentElement.style.setProperty('--telemux-width', nextWidth + 'px');
      document.documentElement.style.setProperty('--telemux-height', nextHeight + 'px');
      scheduleScrollbarUpdate(false);
      scheduleFit();
    };

    window.telemuxSend = (data) => {
      sendTerminalInput(data);
    };

    window.telemuxScroll = (lines) => {
      if (!term || typeof term.scrollLines !== 'function' || !Number.isFinite(lines)) return;
      term.scrollLines(lines);
    };

    window.telemuxFocus = () => {
      try {
        hideNativeCaret();
        resumeLiveFollow(true);
      } catch {}
    };

    async function main() {
      post({ type: 'status', value: 'terminal loading' });
      await loadTerminalFont();
      const { CanvasRenderer, Terminal, init } = await importGhostty();
      await init();
      installGhosttyLineHeight(CanvasRenderer);
      installGhosttyScrollbarSuppression(Terminal, CanvasRenderer);
      term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontSize: terminalFontSize,
        fontFamily: terminalFontFamily,
        theme: { background: '#0d1110', foreground: '#d8e5de', cursor: '#7ce38b', selectionBackground: '#2b3a32' }
      });
      const terminalRoot = document.getElementById('terminal');
      const terminalViewport = document.getElementById('terminal-viewport');
      term.open(terminalRoot);
      term.blur && term.blur();
      installNativeTouchScroll(terminalViewport || terminalRoot);
      installLiveIndicator();
      hideNativeCaret();
      scheduleFit();

      term.onData((data) => {
        sendTerminalInput(data);
      });

      term.onResize(({ cols, rows }) => {
        sendResizeIfChanged(cols, rows);
        scheduleScrollbarUpdate(false);
      });

      if (typeof term.onScroll === 'function') {
        term.onScroll(() => scheduleScrollbarUpdate(true));
      }

      socket = new WebSocket(${encodedUrl});
      socket.onopen = () => { post({ type: 'status', value: 'connected' }); scheduleFit(); window.telemuxFocus(); };
      socket.onclose = () => post({ type: 'status', value: 'disconnected' });
      socket.onerror = () => post({ type: 'status', value: 'socket error' });
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'snapshot') {
          const shouldFollowBottom = shouldFollowTerminalBottom();
          cancelPendingFit();
          resizeTerminalToSnapshot(message);
          term.reset();
          term.write(message.data);
          if (shouldFollowBottom) {
            scrollTerminalToBottom();
          } else {
            pendingOutputWhilePaused = true;
            updateLiveIndicator();
          }
          scheduleScrollbarUpdate(false);
        } else if (message.type === 'output') {
          const shouldFollowBottom = shouldFollowTerminalBottom();
          term.write(message.data);
          if (shouldFollowBottom) {
            keepTerminalBottomVisible();
          } else if (liveFollowPaused || !isTerminalAtBottom()) {
            liveFollowPaused = true;
            pendingOutputWhilePaused = true;
            updateLiveIndicator();
          }
          scheduleScrollbarUpdate(false);
        } else if (message.type === 'treeChanged' || message.type === 'paneExited') {
          post({ type: 'treeChanged' });
        } else if (message.type === 'error') {
          post({ type: 'status', value: message.message });
        }
      };
      window.addEventListener('resize', () => {
        if (!nativeViewportWidth || !nativeViewportHeight) {
          scheduleFit();
        }
      });
      setTimeout(hideNativeCaret, 0);
    }

    function resizeTerminalToSnapshot(message) {
      if (!term) return;
      const cols = Number(message.cols);
      const rows = Number(message.rows);
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) return;
      if (cols !== term.cols || rows !== term.rows) {
        term.resize(cols, rows);
      }
    }

    function sendTerminalInput(data) {
      resumeLiveFollow(true);
      followBottomUntil = Date.now() + 1000;
      keepTerminalBottomVisible();
      socket && socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'input', data }));
    }

    function shouldFollowTerminalBottom() {
      if (Date.now() < followBottomUntil) return true;
      if (liveFollowPaused || touchScrollActive) return false;
      return isTerminalAtBottom();
    }

    function isTerminalAtBottom() {
      try {
        if (!term) return true;
        const activeBuffer = term.buffer && term.buffer.active;
        const viewportY = Number(activeBuffer && activeBuffer.viewportY);
        const baseY = Number(activeBuffer && activeBuffer.baseY);
        if (Number.isFinite(viewportY) && Number.isFinite(baseY)) {
          return baseY - viewportY <= 1;
        }
      } catch {}
      return true;
    }

    function keepTerminalBottomVisible() {
      if (liveFollowPaused && Date.now() >= followBottomUntil) {
        return;
      }
      scrollTerminalToBottom();
      if (pendingBottomScrollFrame || pendingBottomScrollTimers.length > 0) {
        return;
      }

      pendingBottomScrollFrame = requestAnimationFrame(() => {
        pendingBottomScrollFrame = 0;
        scrollTerminalToBottom();
      });

      pendingBottomScrollTimers = [50, 150].map((delay) => {
        const timeoutId = setTimeout(() => {
          pendingBottomScrollTimers = pendingBottomScrollTimers.filter((timer) => timer !== timeoutId);
          scrollTerminalToBottom();
        }, delay);
        return timeoutId;
      });
    }

    function scrollTerminalToBottom() {
      try {
        if (!term) return;
        if (typeof term.scrollToBottom === 'function') {
          term.scrollToBottom();
        } else if (typeof term.scrollLines === 'function') {
          const activeBufferLength = term.buffer && term.buffer.active && term.buffer.active.length;
          term.scrollLines(activeBufferLength || 9999);
        }
        scheduleScrollbarUpdate(false);
      } catch {}
    }

    function pauseLiveFollowIfReading() {
      if (isTerminalAtBottom()) {
        resumeLiveFollow(false);
        return;
      }

      liveFollowPaused = true;
      updateLiveIndicator();
    }

    function resumeLiveFollow(scrollToBottom) {
      liveFollowPaused = false;
      pendingOutputWhilePaused = false;
      updateLiveIndicator();
      scheduleScrollbarUpdate(false);
      if (scrollToBottom) {
        keepTerminalBottomVisible();
      }
    }

    function updateLiveIndicator() {
      const indicator = document.getElementById('live-indicator');
      if (!indicator) return;
      indicator.textContent = pendingOutputWhilePaused ? 'New output' : 'Live';
      indicator.classList.toggle('visible', liveFollowPaused || pendingOutputWhilePaused);
    }

    function installLiveIndicator() {
      const indicator = document.getElementById('live-indicator');
      if (!indicator) return;
      indicator.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        resumeLiveFollow(true);
      });
      indicator.addEventListener('touchstart', (event) => {
        event.stopPropagation();
      }, { passive: true });
    }

    function applyViewportSize() {
      const width = nativeViewportWidth || document.documentElement.clientWidth || window.innerWidth;
      const height = nativeViewportHeight || document.documentElement.clientHeight || window.innerHeight;
      if (width > 0 && height > 0) {
        document.documentElement.style.setProperty('--telemux-width', Math.floor(width) + 'px');
        document.documentElement.style.setProperty('--telemux-height', Math.floor(height) + 'px');
      }
    }

    function fitToNativeViewport() {
      if (!term || !term.renderer || typeof term.renderer.getMetrics !== 'function') return false;
      const metrics = term.renderer.getMetrics();
      if (!metrics || !metrics.width || !metrics.height) return false;

      const width = nativeViewportWidth || document.documentElement.clientWidth || window.innerWidth;
      const height = (nativeViewportHeight || document.documentElement.clientHeight || window.innerHeight) - terminalTopPadding;
      if (!width || !height) return false;

      const terminalWidth = Math.max(0, width - terminalLeftPadding - terminalRightPadding - terminalScrollbarWidth);
      const cols = Math.max(20, Math.floor(terminalWidth / metrics.width));
      const rows = Math.max(5, Math.floor(height / metrics.height));
      if (cols !== term.cols || rows !== term.rows) {
        term.resize(cols, rows);
      }
      return true;
    }

    function sendResizeIfChanged(cols = term && term.cols, rows = term && term.rows) {
      if (!socket || socket.readyState !== WebSocket.OPEN || !Number.isInteger(cols) || !Number.isInteger(rows)) return;
      if (cols === lastSentCols && rows === lastSentRows) return;
      lastSentCols = cols;
      lastSentRows = rows;
      socket.send(JSON.stringify({ type: 'resize', cols, rows }));
    }

    function scheduleScrollbarUpdate(visible) {
      if (pendingScrollbarFrame) {
        cancelAnimationFrame(pendingScrollbarFrame);
      }
      pendingScrollbarFrame = requestAnimationFrame(() => {
        pendingScrollbarFrame = 0;
        updateFixedScrollbar(visible);
      });
    }

    function updateFixedScrollbar(visible) {
      const scrollbar = document.getElementById('terminal-scrollbar');
      const thumb = document.getElementById('terminal-scrollbar-thumb');
      if (!scrollbar || !thumb || !term) return;

      const scrollbackLength = getTerminalScrollbackLength();
      const rows = Number(term.rows) || 0;
      if (scrollbackLength <= 0 || rows <= 0) {
        scrollbar.classList.remove('visible');
        thumb.style.height = '0px';
        thumb.style.transform = 'translateY(0px)';
        return;
      }

      const trackHeight = scrollbar.clientHeight || Math.max(0, (nativeViewportHeight || window.innerHeight || 0) - terminalTopPadding);
      if (trackHeight <= 0) return;

      const viewportY = Math.max(0, Math.min(scrollbackLength, getTerminalViewportY()));
      const totalRows = scrollbackLength + rows;
      const thumbHeight = Math.max(20, Math.round((rows / totalRows) * trackHeight));
      const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
      const scrollRatio = scrollbackLength > 0 ? viewportY / scrollbackLength : 0;
      const thumbTop = Math.round(maxThumbTop * (1 - scrollRatio));
      const shouldStayVisible = viewportY > 0 || touchScrollActive || liveFollowPaused;

      thumb.style.height = thumbHeight + 'px';
      thumb.style.transform = 'translateY(' + thumbTop + 'px)';
      scrollbar.classList.toggle('visible', Boolean(visible) || shouldStayVisible);

      if (scrollbarHideTimer) {
        window.clearTimeout(scrollbarHideTimer);
        scrollbarHideTimer = 0;
      }

      if (visible && !shouldStayVisible) {
        scrollbarHideTimer = window.setTimeout(() => {
          scrollbar.classList.remove('visible');
          scrollbarHideTimer = 0;
        }, 900);
      }
    }

    function getTerminalViewportY() {
      try {
        if (!term) return 0;
        if (typeof term.getViewportY === 'function') {
          const viewportY = Number(term.getViewportY());
          return Number.isFinite(viewportY) ? viewportY : 0;
        }
        const viewportY = Number(term.viewportY);
        return Number.isFinite(viewportY) ? viewportY : 0;
      } catch {
        return 0;
      }
    }

    function getTerminalScrollbackLength() {
      try {
        if (!term) return 0;
        if (typeof term.getScrollbackLength === 'function') {
          const scrollbackLength = Number(term.getScrollbackLength());
          return Number.isFinite(scrollbackLength) ? scrollbackLength : 0;
        }
      } catch {}
      return 0;
    }

    function scheduleFit() {
      cancelPendingFit();
      pendingViewportFit = requestAnimationFrame(() => {
        pendingViewportFit = requestAnimationFrame(() => {
          pendingViewportFit = 0;
          window.telemuxFit();
        });
      });
    }

    function cancelPendingFit() {
      if (pendingViewportFit) {
        cancelAnimationFrame(pendingViewportFit);
        pendingViewportFit = 0;
      }
    }

    async function loadTerminalFont() {
      if (!document.fonts || !terminalFontFace) return;

      if (typeof FontFace === 'function') {
        for (const fontUri of terminalFontUris) {
          try {
            const fontFace = new FontFace(
              terminalFontFace,
              'url(' + JSON.stringify(fontUri) + ') format("truetype")',
              { display: 'block', style: 'normal', weight: '400' }
            );
            await fontFace.load();
            document.fonts.add(fontFace);
            if (document.fonts.check(terminalFontSize + 'px "' + terminalFontFace + '"')) {
              return;
            }
          } catch {}
        }
      }

      try {
        await document.fonts.load(terminalFontSize + 'px "' + terminalFontFace + '"');
        await document.fonts.ready;
      } catch {}
    }

    function installNativeTouchScroll(root) {
      if (!root) return;
      let lastY = 0;
      let lastTouchTime = 0;
      let activeTouchId = null;
      let velocityPxPerMs = 0;
      let inertiaFrame = 0;
      let inertiaVelocityPxPerMs = 0;
      let lastInertiaTime = 0;
      const maxInertiaVelocityPxPerMs = 2.6;
      const minInertiaVelocityPxPerMs = 0.015;
      const inertiaDecayMs = 520;

      const stopEvent = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
      };

      const blurWebInput = () => {
        try {
          term && term.blur && term.blur();
          const active = document.activeElement;
          active && typeof active.blur === 'function' && active.blur();
        } catch {}
      };

      const scrollByPixels = (deltaY) => {
        if (!term || typeof term.scrollLines !== 'function' || !Number.isFinite(deltaY)) return false;
        const lineDelta = deltaY / touchScrollLinePx;
        if (lineDelta === 0) return true;
        const before = typeof term.getViewportY === 'function' ? term.getViewportY() : null;
        term.scrollLines(-lineDelta);
        const after = typeof term.getViewportY === 'function' ? term.getViewportY() : null;
        const moved = before === null || after === null || Math.abs(before - after) > 0.001;
        if (moved) {
          scheduleScrollbarUpdate(true);
        }
        return moved;
      };

      const cancelInertia = () => {
        if (inertiaFrame) {
          cancelAnimationFrame(inertiaFrame);
          inertiaFrame = 0;
        }
        inertiaVelocityPxPerMs = 0;
      };

      const startInertia = () => {
        cancelInertia();
        if (!Number.isFinite(velocityPxPerMs) || Math.abs(velocityPxPerMs) < 0.08) {
          velocityPxPerMs = 0;
          return;
        }

        inertiaVelocityPxPerMs = Math.max(
          -maxInertiaVelocityPxPerMs,
          Math.min(maxInertiaVelocityPxPerMs, velocityPxPerMs)
        );
        velocityPxPerMs = 0;
        lastInertiaTime = performance.now();

        const step = (now) => {
          const elapsed = Math.min(34, Math.max(1, now - lastInertiaTime));
          lastInertiaTime = now;
          const moved = scrollByPixels(inertiaVelocityPxPerMs * elapsed);
          if (moved) {
            pauseLiveFollowIfReading();
          }
          inertiaVelocityPxPerMs *= Math.exp(-elapsed / inertiaDecayMs);

          if (moved && Math.abs(inertiaVelocityPxPerMs) >= minInertiaVelocityPxPerMs) {
            inertiaFrame = requestAnimationFrame(step);
            return;
          }

          inertiaFrame = 0;
          inertiaVelocityPxPerMs = 0;
        };

        inertiaFrame = requestAnimationFrame(step);
      };

      root.addEventListener('touchstart', (event) => {
        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) return;
        cancelInertia();
        touchScrollActive = true;
        activeTouchId = touch.identifier;
        lastY = touch.clientY;
        lastTouchTime = performance.now();
        velocityPxPerMs = 0;
        blurWebInput();
        stopEvent(event);
      }, { passive: false, capture: true });

      root.addEventListener('touchmove', (event) => {
        const touches = Array.from(event.changedTouches || []);
        const touch = touches.find((item) => item.identifier === activeTouchId) || touches[0];
        if (!touch) return;
        const now = performance.now();
        const deltaY = touch.clientY - lastY;
        const elapsed = Math.max(1, now - lastTouchTime);
        const instantVelocity = deltaY / elapsed;
        velocityPxPerMs = velocityPxPerMs === 0
          ? instantVelocity
          : velocityPxPerMs * 0.65 + instantVelocity * 0.35;
        lastY = touch.clientY;
        lastTouchTime = now;
        if (scrollByPixels(deltaY)) {
          pauseLiveFollowIfReading();
        }
        blurWebInput();
        stopEvent(event);
      }, { passive: false, capture: true });

      root.addEventListener('touchend', (event) => {
        activeTouchId = null;
        touchScrollActive = false;
        pauseLiveFollowIfReading();
        startInertia();
        blurWebInput();
        stopEvent(event);
      }, { passive: false, capture: true });

      root.addEventListener('touchcancel', (event) => {
        activeTouchId = null;
        touchScrollActive = false;
        cancelInertia();
        pauseLiveFollowIfReading();
        blurWebInput();
        stopEvent(event);
      }, { passive: false, capture: true });

      root.addEventListener('pointerdown', (event) => {
        cancelInertia();
        blurWebInput();
        stopEvent(event);
      }, { passive: false, capture: true });

      root.addEventListener('mousedown', (event) => {
        cancelInertia();
        blurWebInput();
        stopEvent(event);
      }, { passive: false, capture: true });

      root.addEventListener('wheel', (event) => {
        cancelInertia();
        if (scrollByPixels(event.deltaY)) {
          pauseLiveFollowIfReading();
        }
        stopEvent(event);
      }, { passive: false, capture: true });
    }

    function installGhosttyLineHeight(CanvasRenderer) {
      const prototype = CanvasRenderer && CanvasRenderer.prototype;
      if (!prototype || typeof prototype.measureFont !== 'function') return;

      if (!prototype.__telemuxOriginalMeasureFont) {
        prototype.__telemuxOriginalMeasureFont = prototype.measureFont;
      }

      if (prototype.__telemuxLineHeight === terminalLineHeight) return;

      prototype.measureFont = function measureFontWithTelemuxLineHeight() {
        const metrics = prototype.__telemuxOriginalMeasureFont.call(this);
        if (!metrics || !metrics.height || !metrics.baseline) return metrics;

        const nextHeight = Math.max(metrics.height, Math.ceil(metrics.height * terminalLineHeight));
        const extraHeight = nextHeight - metrics.height;
        return {
          ...metrics,
          height: nextHeight,
          baseline: metrics.baseline + Math.floor(extraHeight / 2)
        };
      };
      prototype.__telemuxLineHeight = terminalLineHeight;
    }

    function installGhosttyScrollbarSuppression(Terminal, CanvasRenderer) {
      const rendererPrototype = CanvasRenderer && CanvasRenderer.prototype;
      if (rendererPrototype && typeof rendererPrototype.renderScrollbar === 'function' && !rendererPrototype.__telemuxScrollbarSuppressed) {
        rendererPrototype.__telemuxOriginalRenderScrollbar = rendererPrototype.renderScrollbar;
        rendererPrototype.renderScrollbar = function renderScrollbarDisabled() {};
        rendererPrototype.__telemuxScrollbarSuppressed = true;
      }

      const terminalPrototype = Terminal && Terminal.prototype;
      if (!terminalPrototype || terminalPrototype.__telemuxScrollbarSuppressed) return;

      const hideScrollbarState = function hideScrollbarState() {
        if (this.scrollbarHideTimeout) {
          window.clearTimeout(this.scrollbarHideTimeout);
          this.scrollbarHideTimeout = undefined;
        }
        this.scrollbarVisible = false;
        this.scrollbarOpacity = 0;
      };

      terminalPrototype.__telemuxOriginalShowScrollbar = terminalPrototype.showScrollbar;
      terminalPrototype.__telemuxOriginalHideScrollbar = terminalPrototype.hideScrollbar;
      terminalPrototype.__telemuxOriginalFadeInScrollbar = terminalPrototype.fadeInScrollbar;
      terminalPrototype.__telemuxOriginalFadeOutScrollbar = terminalPrototype.fadeOutScrollbar;
      terminalPrototype.showScrollbar = hideScrollbarState;
      terminalPrototype.hideScrollbar = hideScrollbarState;
      terminalPrototype.fadeInScrollbar = hideScrollbarState;
      terminalPrototype.fadeOutScrollbar = hideScrollbarState;
      terminalPrototype.__telemuxScrollbarSuppressed = true;
    }

    function hideNativeCaret() {
      const root = document.getElementById('terminal');
      if (!root) return;
      root.style.setProperty('caret-color', 'transparent', 'important');
      root.style.setProperty('outline', 'none', 'important');
      for (const element of root.querySelectorAll('textarea, [contenteditable="true"]')) {
        element.blur && element.blur();
        element.setAttribute('readonly', 'readonly');
        element.style.setProperty('caret-color', 'transparent', 'important');
        element.style.setProperty('outline', 'none', 'important');
      };
    }

    async function importGhostty() {
      let lastError;
      for (const url of ghosttyModuleUrls) {
        try {
          return await import(url);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error('ghostty-web import failed');
    }

    main().catch((error) => post({ type: 'status', value: error instanceof Error ? error.message : 'terminal init failed' }));
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: "#0d1110",
    flex: 1,
    minHeight: 0
  },
  webView: {
    backgroundColor: "#0d1110",
    flex: 1
  }
});

export default TerminalPane;
