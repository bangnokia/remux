import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { TextInput as NativeTextInput } from "react-native";
import { WebView } from "react-native-webview";
import { StyleSheet, View } from "./rn";
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
  const [keyboardProxyValue, setKeyboardProxyValue] = useState(KEYBOARD_PROXY_VALUE);
  const html = useMemo(() => terminalHtml(wsUrl), [wsUrl]);

  const focusWebTerminal = useCallback(() => {
    webViewRef.current?.injectJavaScript("window.remuxFocus && window.remuxFocus(); true;");
  }, []);

  const resetKeyboardProxy = useCallback(() => {
    setKeyboardProxyValue(KEYBOARD_PROXY_VALUE);
    keyboardInputRef.current?.setNativeProps({
      selection: KEYBOARD_PROXY_SELECTION,
      text: KEYBOARD_PROXY_VALUE
    });
  }, []);

  const focusKeyboardProxy = useCallback(() => {
    keyboardInputRef.current?.focus();
    resetKeyboardProxy();
  }, [resetKeyboardProxy]);

  const focusTerminal = useCallback(() => {
    focusWebTerminal();
    focusKeyboardProxy();
  }, [focusKeyboardProxy, focusWebTerminal]);

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
    send(data: string) {
      sendToTerminal(data);
      focusWebTerminal();
    },
    fit() {
      webViewRef.current?.injectJavaScript("window.remuxFit && window.remuxFit(); true;");
    }
  }), [focusWebTerminal, sendToTerminal]);

  function handleMessage(event: unknown): void {
    const data = readWebViewMessageData(event);
    try {
      const message = JSON.parse(data) as { type: string; value?: string };
      if (message.type === "status") {
        onStatus(message.value ?? "");
        focusWebTerminal();
      } else if (message.type === "treeChanged") {
        onTreeChanged();
      }
    } catch {
      onStatus(data);
    }
  }

  return (
    <View onLayout={handleLayout} onTouchEnd={focusKeyboardProxy} onTouchStart={focusTerminal} style={styles.shell}>
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
        keyboardAppearance="dark"
        multiline
        onChangeText={handleKeyboardProxyChange}
        onFocus={resetKeyboardProxy}
        selection={KEYBOARD_PROXY_SELECTION}
        spellCheck={false}
        style={styles.keyboardProxy}
        value={keyboardProxyValue}
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
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <style>
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
      height: var(--remux-height, 100vh);
      outline: none !important;
      position: fixed;
      inset: 0;
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
        term && term.focus && term.focus();
        hideNativeCaret();
      } catch {}
    };

    async function main() {
      post({ type: 'status', value: 'terminal loading' });
      const { FitAddon, Terminal, init } = await importGhostty();
      await init();
      term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontSize: 13,
        fontFamily: 'Menlo, Cascadia Code, monospace',
        theme: { background: '#0d1110', foreground: '#d8e5de', cursor: '#7ce38b', selectionBackground: '#2b3a32' }
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(document.getElementById('terminal'));
      term.focus();
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
          term.reset();
          term.resize(message.cols, message.rows);
          term.write(message.data);
          scheduleFit();
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
      const height = nativeViewportHeight || document.documentElement.clientHeight || window.innerHeight;
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
        window.remuxFit();
        pendingViewportFit = setTimeout(window.remuxFit, 120);
      }, 0);
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
    height: 1,
    left: 0,
    opacity: 0.01,
    padding: 0,
    position: "absolute",
    width: 1
  }
});

export default TerminalPane;
