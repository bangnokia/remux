import React, { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { Keyboard as NativeKeyboard, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { StyleSheet, View } from "./rn";
import {
  TERMINAL_FONT_FACE,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_LINE_HEIGHT,
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
  const source = Platform.OS === "android" ? { html, baseUrl: "file:///android_res/" } : { html };

  const handleLayout = useCallback((event: { nativeEvent: { layout: { width: number; height: number } } }) => {
    const { width, height } = event.nativeEvent.layout;
    lastLayoutRef.current = { width, height };
    syncViewportSize(width, height);
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

function terminalHtml(wsUrl: string): string {
  const encodedUrl = JSON.stringify(wsUrl);
  const terminalFontCss = terminalFontFaceCss(resolveTerminalFontUris());
  const encodedTerminalFontFace = JSON.stringify(TERMINAL_FONT_FACE);
  const encodedTerminalFontFamily = JSON.stringify(TERMINAL_FONT_FAMILY);
  const encodedTerminalFontSize = JSON.stringify(TERMINAL_FONT_SIZE);
  const encodedTerminalLineHeight = JSON.stringify(TERMINAL_LINE_HEIGHT);
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <style>
    ${terminalFontCss}

    :root {
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
      left: 0;
      top: var(--telemux-terminal-top-padding);
      touch-action: none;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      -webkit-user-select: none;
      width: var(--telemux-width, 100vw);
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
    let pendingViewportFit;
    let lastSentCols;
    let lastSentRows;
    let followBottomUntil = 0;
    const terminalFontFace = ${encodedTerminalFontFace};
    const terminalFontFamily = ${encodedTerminalFontFamily};
    const terminalFontSize = ${encodedTerminalFontSize};
    const terminalLineHeight = ${encodedTerminalLineHeight};
    const terminalTopPadding = ${TERMINAL_TOP_PADDING};
    const touchScrollLinePx = 22;

    window.telemuxFit = () => {
      try {
        applyViewportSize();
        if (!fitToNativeViewport()) {
          fit && fit.fit();
        }
        sendResizeIfChanged();
      } catch {}
    };

    window.telemuxSetViewportSize = (width, height) => {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      nativeViewportWidth = Math.floor(width);
      nativeViewportHeight = Math.floor(height);
      document.documentElement.style.setProperty('--telemux-width', width + 'px');
      document.documentElement.style.setProperty('--telemux-height', height + 'px');
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
        scrollTerminalToBottom();
      } catch {}
    };

    async function main() {
      post({ type: 'status', value: 'terminal loading' });
      await loadTerminalFont();
      const { CanvasRenderer, FitAddon, Terminal, init } = await importGhostty();
      await init();
      installGhosttyLineHeight(CanvasRenderer);
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
      fit.observeResize();
      scheduleFit();

      term.onData((data) => {
        sendTerminalInput(data);
      });

      term.onResize(({ cols, rows }) => {
        sendResizeIfChanged(cols, rows);
      });

      socket = new WebSocket(${encodedUrl});
      socket.onopen = () => { post({ type: 'status', value: 'connected' }); window.telemuxFit(); window.telemuxFocus(); };
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
          term.write(message.data);
          scrollAfterRecentInput();
          requestAnimationFrame(scrollAfterRecentInput);
        } else if (message.type === 'treeChanged') {
          post({ type: 'treeChanged' });
        } else if (message.type === 'error') {
          post({ type: 'status', value: message.message });
        }
      };
      window.addEventListener('resize', window.telemuxFit);
      setTimeout(hideNativeCaret, 0);
      scheduleFit();
    }

    function sendTerminalInput(data) {
      followBottomUntil = Date.now() + 1000;
      scrollTerminalToBottom();
      socket && socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'input', data }));
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

    function scrollAfterRecentInput() {
      if (Date.now() < followBottomUntil) {
        scrollTerminalToBottom();
      }
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

      const cols = Math.max(20, Math.floor((width - 15) / metrics.width));
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
      if (pendingViewportFit) clearTimeout(pendingViewportFit);
      pendingViewportFit = setTimeout(() => {
        pendingViewportFit = undefined;
        window.telemuxFit();
        pendingViewportFit = setTimeout(() => {
          pendingViewportFit = undefined;
          window.telemuxFit();
        }, 120);
      }, 0);
    }

    async function loadTerminalFont() {
      if (!document.fonts || !terminalFontFace) return;

      try {
        await document.fonts.load(terminalFontSize + 'px "' + terminalFontFace + '"');
        await document.fonts.ready;
      } catch {}
    }

    function installNativeTouchScroll(root) {
      if (!root) return;
      let lastY = 0;
      let remainderPx = 0;
      let activeTouchId = null;

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
        if (!term || typeof term.scrollLines !== 'function' || !Number.isFinite(deltaY)) return;
        remainderPx += deltaY;
        const lineDelta = Math.trunc(remainderPx / touchScrollLinePx);
        if (lineDelta === 0) return;
        remainderPx -= lineDelta * touchScrollLinePx;
        term.scrollLines(-lineDelta);
      };

      root.addEventListener('touchstart', (event) => {
        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) return;
        activeTouchId = touch.identifier;
        lastY = touch.clientY;
        remainderPx = 0;
        blurWebInput();
        stopEvent(event);
      }, { passive: false, capture: true });

      root.addEventListener('touchmove', (event) => {
        const touches = Array.from(event.changedTouches || []);
        const touch = touches.find((item) => item.identifier === activeTouchId) || touches[0];
        if (!touch) return;
        const deltaY = touch.clientY - lastY;
        lastY = touch.clientY;
        scrollByPixels(deltaY);
        blurWebInput();
        stopEvent(event);
      }, { passive: false, capture: true });

      root.addEventListener('touchend', (event) => {
        activeTouchId = null;
        blurWebInput();
        stopEvent(event);
      }, { passive: false, capture: true });

      root.addEventListener('touchcancel', (event) => {
        activeTouchId = null;
        blurWebInput();
        stopEvent(event);
      }, { passive: false, capture: true });

      root.addEventListener('pointerdown', (event) => {
        blurWebInput();
        stopEvent(event);
      }, { passive: false, capture: true });

      root.addEventListener('mousedown', (event) => {
        blurWebInput();
        stopEvent(event);
      }, { passive: false, capture: true });

      root.addEventListener('wheel', (event) => {
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
