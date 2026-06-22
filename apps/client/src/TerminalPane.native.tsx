import React, { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { Keyboard as NativeKeyboard, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { StyleSheet, View } from "./rn";
import {
  TERMINAL_FONT_FACE,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_HORIZONTAL_PADDING,
  TERMINAL_LINE_HEIGHT,
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
      webViewRef.current?.injectJavaScript("window.telemuxFit && window.telemuxFit(); true;");
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
  const encodedTerminalHorizontalPadding = JSON.stringify(TERMINAL_HORIZONTAL_PADDING);
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <style>
    ${terminalFontCss}

    :root {
      --telemux-terminal-horizontal-inset: ${TERMINAL_HORIZONTAL_PADDING * 2}px;
      --telemux-terminal-horizontal-padding: ${TERMINAL_HORIZONTAL_PADDING}px;
      --telemux-terminal-top-padding: ${TERMINAL_TOP_PADDING}px;
    }

    html, body, #terminal {
      width: 100%;
      height: 100%;
      margin: 0;
      background: #0d1110;
      overflow: hidden;
    }

    html, body {
      min-height: 100%;
      min-height: 100vh;
      position: fixed;
      inset: 0;
    }

    #terminal {
      caret-color: transparent !important;
      height: calc(var(--telemux-height, 100vh) - var(--telemux-terminal-top-padding));
      outline: none !important;
      position: fixed;
      left: var(--telemux-terminal-horizontal-padding);
      top: var(--telemux-terminal-top-padding);
      touch-action: none;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      -webkit-user-select: none;
      width: calc(var(--telemux-width, 100vw) - var(--telemux-terminal-horizontal-inset));
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
  </style>
</head>
<body>
  <div id="terminal"></div>
  <script>
    const post = (message) => window.ReactNativeWebView.postMessage(JSON.stringify(message));
    const ghosttyModuleUrls = [
      "https://cdn.jsdelivr.net/npm/ghostty-web@0.4.0/+esm",
      "https://esm.sh/ghostty-web@0.4.0"
    ];
    let term;
    let fit;
    let socket;
    let nativeViewportWidth;
    let nativeViewportHeight;
    let pendingViewportFit = 0;
    let lastSentCols;
    let lastSentRows;
    let followBottomUntil = 0;
    const terminalFontFace = ${encodedTerminalFontFace};
    const terminalFontFamily = ${encodedTerminalFontFamily};
    const terminalFontSize = ${encodedTerminalFontSize};
    const terminalFontUris = ${encodedTerminalFontUris};
    const terminalLineHeight = ${encodedTerminalLineHeight};
    const terminalHorizontalPadding = ${encodedTerminalHorizontalPadding};
    const terminalScrollbarWidth = ${TERMINAL_SCROLLBAR_WIDTH};
    const terminalTopPadding = ${TERMINAL_TOP_PADDING};
    const touchScrollLinePx = 14;

    window.telemuxFit = () => {
      try {
        const shouldFollowBottom = shouldFollowTerminalBottom();
        applyViewportSize();
        if (!fitToNativeViewport()) {
          fit && fit.fit();
        }
        sendResizeIfChanged();
        if (shouldFollowBottom) {
          keepTerminalBottomVisible();
        }
      } catch {}
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
        keepTerminalBottomVisible();
      } catch {}
    };

    async function main() {
      post({ type: 'status', value: 'terminal loading' });
      await loadTerminalFont();
      const { CanvasRenderer, FitAddon, Terminal, init } = await importGhostty();
      await init();
      installGhosttyLineHeight(CanvasRenderer);
      installGhosttyScrollbarWidth(CanvasRenderer);
      term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontSize: terminalFontSize,
        fontFamily: terminalFontFamily,
        theme: { background: '#0d1110', foreground: '#d8e5de', cursor: '#7ce38b', selectionBackground: '#2b3a32' }
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      const terminalRoot = document.getElementById('terminal');
      term.open(terminalRoot);
      term.blur && term.blur();
      installNativeTouchScroll(terminalRoot);
      hideNativeCaret();
      scheduleFit();

      term.onData((data) => {
        sendTerminalInput(data);
      });

      term.onResize(({ cols, rows }) => {
        sendResizeIfChanged(cols, rows);
      });

      socket = new WebSocket(${encodedUrl});
      socket.onopen = () => { post({ type: 'status', value: 'connected' }); scheduleFit(); window.telemuxFocus(); };
      socket.onclose = () => post({ type: 'status', value: 'disconnected' });
      socket.onerror = () => post({ type: 'status', value: 'socket error' });
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'snapshot') {
          window.telemuxFit();
          term.reset();
          term.write(message.data);
          scrollTerminalToBottom();
          scheduleFit();
        } else if (message.type === 'output') {
          const shouldFollowBottom = shouldFollowTerminalBottom();
          term.write(message.data);
          if (shouldFollowBottom) {
            keepTerminalBottomVisible();
          }
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

    function sendTerminalInput(data) {
      followBottomUntil = Date.now() + 1000;
      keepTerminalBottomVisible();
      socket && socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'input', data }));
    }

    function shouldFollowTerminalBottom() {
      return Date.now() < followBottomUntil || isTerminalAtBottom();
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
      scrollTerminalToBottom();
      requestAnimationFrame(scrollTerminalToBottom);
      setTimeout(scrollTerminalToBottom, 50);
      setTimeout(scrollTerminalToBottom, 150);
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
      } catch {}
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

      const cols = Math.max(20, Math.floor((width - terminalHorizontalPadding * 2) / metrics.width));
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

    function scheduleFit() {
      if (pendingViewportFit) {
        cancelAnimationFrame(pendingViewportFit);
      }
      pendingViewportFit = requestAnimationFrame(() => {
        pendingViewportFit = 0;
        window.telemuxFit();
      });
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
        return before === null || after === null || Math.abs(before - after) > 0.001;
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
        scrollByPixels(deltaY);
        blurWebInput();
        stopEvent(event);
      }, { passive: false, capture: true });

      root.addEventListener('touchend', (event) => {
        activeTouchId = null;
        startInertia();
        blurWebInput();
        stopEvent(event);
      }, { passive: false, capture: true });

      root.addEventListener('touchcancel', (event) => {
        activeTouchId = null;
        cancelInertia();
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
        scrollByPixels(event.deltaY);
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

    function installGhosttyScrollbarWidth(CanvasRenderer) {
      const prototype = CanvasRenderer && CanvasRenderer.prototype;
      if (!prototype || typeof prototype.renderScrollbar !== 'function') return;

      if (!prototype.__telemuxOriginalRenderScrollbar) {
        prototype.__telemuxOriginalRenderScrollbar = prototype.renderScrollbar;
      }

      if (prototype.__telemuxScrollbarWidth === terminalScrollbarWidth) return;

      prototype.renderScrollbar = function renderScrollbarWithTelemuxWidth(viewportY, scrollbackLength, rows, opacity = 1) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const devicePixelRatio = this.devicePixelRatio || 1;
        if (!ctx || !canvas) {
          return prototype.__telemuxOriginalRenderScrollbar.call(this, viewportY, scrollbackLength, rows, opacity);
        }

        const height = canvas.height / devicePixelRatio;
        const width = canvas.width / devicePixelRatio;
        const scrollbarWidth = terminalScrollbarWidth;
        const scrollbarX = width - scrollbarWidth - 4;
        const margin = 4;
        const trackHeight = height - margin * 2;

        ctx.fillStyle = this.theme && this.theme.background ? this.theme.background : '#0d1110';
        ctx.fillRect(scrollbarX - 2, 0, scrollbarWidth + 6, height);
        if (opacity <= 0 || scrollbackLength === 0) return;

        const totalRows = scrollbackLength + rows;
        const thumbHeight = Math.max(20, rows / totalRows * trackHeight);
        const scrollRatio = viewportY / scrollbackLength;
        const thumbY = margin + (trackHeight - thumbHeight) * (1 - scrollRatio);
        ctx.fillStyle = 'rgba(128, 128, 128, ' + (0.1 * opacity) + ')';
        ctx.fillRect(scrollbarX, margin, scrollbarWidth, trackHeight);
        ctx.fillStyle = 'rgba(128, 128, 128, ' + ((viewportY > 0 ? 0.5 : 0.3) * opacity) + ')';
        ctx.fillRect(scrollbarX, thumbY, scrollbarWidth, thumbHeight);
      };
      prototype.__telemuxScrollbarWidth = terminalScrollbarWidth;
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
