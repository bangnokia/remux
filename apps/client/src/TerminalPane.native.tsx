import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from "react";
import { Keyboard as NativeKeyboard, TextInput as NativeTextInput } from "react-native";
import { WebView } from "react-native-webview";
import { StyleSheet, View } from "./rn";
import {
  TERMINAL_FONT_FACE,
  TERMINAL_FONT_FAMILY,
  TERMINAL_TOP_PADDING,
  resolveTerminalFontUri,
  terminalFontFaceCss
} from "./terminal-font";
import type { TerminalPaneHandle, TerminalPaneProps } from "./terminal-types";

const KEYBOARD_PROXY_VALUE = " ";
const KEYBOARD_PROXY_SELECTION = {
  end: KEYBOARD_PROXY_VALUE.length,
  start: KEYBOARD_PROXY_VALUE.length
};
const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(function TerminalPane(
  { wsUrl, onStatus, onTreeChanged },
  ref
) {
  const webViewRef = useRef<WebView>(null);
  const keyboardInputRef = useRef<NativeTextInput>(null);
  const lastLayoutRef = useRef<{ width: number; height: number } | null>(null);
  const html = useMemo(() => terminalHtml(wsUrl), [wsUrl]);

  const resetKeyboardProxy = useCallback(() => {
    keyboardInputRef.current?.setNativeProps({
      selection: KEYBOARD_PROXY_SELECTION,
      text: KEYBOARD_PROXY_VALUE
    });
  }, []);

  const focusKeyboardProxy = useCallback(() => {
    resetKeyboardProxy();
    keyboardInputRef.current?.focus();
    requestAnimationFrame(() => {
      resetKeyboardProxy();
      keyboardInputRef.current?.focus();
    });
  }, [resetKeyboardProxy]);

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
      `window.remuxSetViewportSize && window.remuxSetViewportSize(${Math.floor(width)}, ${Math.floor(height)}); true;`
    );
  }, []);

  const sendToTerminal = useCallback(
    (data: string) => {
      if (!data) {
        return;
      }

      webViewRef.current?.injectJavaScript(`window.remuxSend(${JSON.stringify(data)}); true;`);
    },
    []
  );

  const handleKeyboardProxyChange = useCallback(
    (nextValue: string) => {
      if (nextValue === KEYBOARD_PROXY_VALUE) {
        return;
      }

      const rawInput = nextValue.length === 0
        ? "\u007f"
        : nextValue.startsWith(KEYBOARD_PROXY_VALUE)
          ? nextValue.slice(KEYBOARD_PROXY_VALUE.length)
          : nextValue;
      const terminalInput = rawInput.replace(/\n/g, "\r");
      sendToTerminal(terminalInput);
      resetKeyboardProxy();
    },
    [resetKeyboardProxy, sendToTerminal]
  );

  useImperativeHandle(ref, () => ({
    dismissKeyboard() {
      keyboardInputRef.current?.blur();
      NativeKeyboard.dismiss();
    },
    send(data: string) {
      sendToTerminal(data);
    },
    sendInput(data: string) {
      sendToTerminal(data);
    },
    focusKeyboard() {
      focusKeyboardProxy();
    },
    fit() {
      webViewRef.current?.injectJavaScript("window.remuxFit && window.remuxFit(); true;");
    }
  }), [focusKeyboardProxy, sendToTerminal]);

  function handleMessage(event: unknown): void {
    const data = readWebViewMessageData(event);
    try {
      const message = JSON.parse(data) as { type: string; value?: string };
      if (message.type === "status") {
        onStatus(message.value ?? "");
      } else if (message.type === "focus") {
        focusKeyboardProxy();
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
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html }}
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
        keyboardDisplayRequiresUserAction={false}
        pointerEvents="none"
        scrollEnabled={false}
      />
      <NativeTextInput
        ref={keyboardInputRef}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        blurOnSubmit={false}
        caretHidden
        contextMenuHidden
        defaultValue={KEYBOARD_PROXY_VALUE}
        keyboardAppearance="dark"
        multiline
        onChangeText={handleKeyboardProxyChange}
        onFocus={resetKeyboardProxy}
        onPressIn={focusKeyboardProxy}
        onTouchStart={focusKeyboardProxy}
        selection={KEYBOARD_PROXY_SELECTION}
        showSoftInputOnFocus
        spellCheck={false}
        style={styles.keyboardProxy}
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
  const terminalFontUri = resolveTerminalFontUri();
  const terminalFontCss = terminalFontFaceCss(terminalFontUri);
  const encodedTerminalFontFace = JSON.stringify(TERMINAL_FONT_FACE);
  const encodedTerminalFontFamily = JSON.stringify(TERMINAL_FONT_FAMILY);
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <style>
    ${terminalFontCss}

    :root {
      --remux-terminal-top-padding: ${TERMINAL_TOP_PADDING}px;
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
      height: calc(var(--remux-height, 100vh) - var(--remux-terminal-top-padding));
      outline: none !important;
      position: fixed;
      left: 0;
      top: var(--remux-terminal-top-padding);
      -webkit-tap-highlight-color: transparent;
      width: var(--remux-width, 100vw);
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
    let lastNativeKeyboardFocusAt = 0;
    const terminalFontFace = ${encodedTerminalFontFace};
    const terminalFontFamily = ${encodedTerminalFontFamily};
    const terminalTopPadding = ${TERMINAL_TOP_PADDING};

    window.remuxFit = () => {
      try {
        applyViewportSize();
        if (!fitToNativeViewport()) {
          fit && fit.fit();
        }
        sendResizeIfChanged();
      } catch {}
    };

    window.remuxSetViewportSize = (width, height) => {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      nativeViewportWidth = Math.floor(width);
      nativeViewportHeight = Math.floor(height);
      document.documentElement.style.setProperty('--remux-width', width + 'px');
      document.documentElement.style.setProperty('--remux-height', height + 'px');
      scheduleFit();
    };

    window.remuxSend = (data) => {
      socket && socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'input', data }));
    };

    window.remuxFocus = () => {
      try {
        hideNativeCaret();
      } catch {}
    };

    async function main() {
      post({ type: 'status', value: 'terminal loading' });
      await loadTerminalFont();
      const { FitAddon, Terminal, init } = await importGhostty();
      await init();
      term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontSize: 13,
        fontFamily: terminalFontFamily,
        theme: { background: '#0d1110', foreground: '#d8e5de', cursor: '#7ce38b', selectionBackground: '#2b3a32' }
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      const terminalRoot = document.getElementById('terminal');
      term.open(terminalRoot);
      installNativeFocusBridge(terminalRoot);
      hideNativeCaret();
      fit.observeResize();
      scheduleFit();

      term.onData((data) => {
        socket && socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'input', data }));
      });

      term.onResize(({ cols, rows }) => {
        sendResizeIfChanged(cols, rows);
      });

      socket = new WebSocket(${encodedUrl});
      socket.onopen = () => { post({ type: 'status', value: 'connected' }); window.remuxFit(); window.remuxFocus(); };
      socket.onclose = () => post({ type: 'status', value: 'disconnected' });
      socket.onerror = () => post({ type: 'status', value: 'socket error' });
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'snapshot') {
          const hasNativeViewport = Boolean(nativeViewportWidth && nativeViewportHeight);
          term.reset();
          if (!hasNativeViewport) {
            term.resize(message.cols, message.rows);
          }
          term.write(message.data);
          if (!hasNativeViewport) {
            scheduleFit();
          }
        } else if (message.type === 'output') {
          term.write(message.data);
        } else if (message.type === 'treeChanged') {
          post({ type: 'treeChanged' });
        } else if (message.type === 'error') {
          post({ type: 'status', value: message.message });
        }
      };
      window.addEventListener('resize', window.remuxFit);
      setTimeout(hideNativeCaret, 0);
      scheduleFit();
    }

    function applyViewportSize() {
      const width = nativeViewportWidth || document.documentElement.clientWidth || window.innerWidth;
      const height = nativeViewportHeight || document.documentElement.clientHeight || window.innerHeight;
      if (width > 0 && height > 0) {
        document.documentElement.style.setProperty('--remux-width', Math.floor(width) + 'px');
        document.documentElement.style.setProperty('--remux-height', Math.floor(height) + 'px');
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
        window.remuxFit();
        pendingViewportFit = setTimeout(() => {
          pendingViewportFit = undefined;
          window.remuxFit();
        }, 120);
      }, 0);
    }

    async function loadTerminalFont() {
      if (!document.fonts || !terminalFontFace) return;

      try {
        await document.fonts.load('13px "' + terminalFontFace + '"');
        await document.fonts.ready;
      } catch {}
    }

    function installNativeFocusBridge(root) {
      if (!root) return;
      const requestNativeKeyboard = () => {
        const now = Date.now();
        if (now - lastNativeKeyboardFocusAt < 120) return;
        lastNativeKeyboardFocusAt = now;
        post({ type: 'focus' });
      };

      root.addEventListener('pointerdown', requestNativeKeyboard, { passive: true });
      root.addEventListener('touchstart', requestNativeKeyboard, { passive: true });
      root.addEventListener('focusin', requestNativeKeyboard, { passive: true });
    }

    function hideNativeCaret() {
      const root = document.getElementById('terminal');
      if (!root) return;
      root.style.setProperty('caret-color', 'transparent', 'important');
      root.style.setProperty('outline', 'none', 'important');
      for (const element of root.querySelectorAll('textarea, [contenteditable="true"]')) {
        element.style.setProperty('caret-color', 'transparent', 'important');
        element.style.setProperty('outline', 'none', 'important');
      }
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
  },
  keyboardProxy: {
    backgroundColor: "transparent",
    bottom: 0,
    color: "transparent",
    fontSize: 16,
    height: "100%",
    left: 0,
    lineHeight: 20,
    padding: 0,
    position: "absolute",
    right: 0,
    textAlignVertical: "top",
    top: 0,
    width: "100%",
    zIndex: 2
  }
});

export default TerminalPane;
