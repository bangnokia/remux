import { RemuxClient } from "@remux/api-client";
import { BottomSheet as ExpoBottomSheet, Host as ExpoHost, Icon as ExpoIcon, RNHostView as ExpoRNHostView } from "@expo/ui";
import { presentationBackground } from "@expo/ui/swift-ui/modifiers";
import type { TmuxPane, TmuxSession, TmuxTree, TmuxWindow } from "@remux/protocol";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Edit3,
  Keyboard as KeyboardIcon,
  Menu,
  Plus,
  Server,
  SquareTerminal,
  Trash2,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Keyboard as NativeKeyboard } from "react-native";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View
} from "./src/rn";
import TerminalPane from "./src/TerminalPane";
import { loadConnection, saveConnection, type SavedConnection } from "./src/storage";
import type { TerminalPaneHandle } from "./src/terminal-types";

type IconType = React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
type ExpoIconName = React.ComponentProps<typeof ExpoIcon>["name"];
type RenameTarget = { kind: "session" | "window"; id: string; name: string } | null;

const ENV_SERVER_URL =
  typeof process !== "undefined" ? process.env.EXPO_PUBLIC_REMUX_SERVER_URL?.trim() : undefined;
const DEFAULT_SERVER_URL = ENV_SERVER_URL || (Platform.OS === "android" ? "http://10.0.2.2:8787" : "http://127.0.0.1:8787");
const COMMAND_BAR_HEIGHT = 52;
const COMMAND_TOGGLE_HEIGHT = 44;
type CommandProgress = InstanceType<typeof Animated.Value>;

export default function App(): React.ReactElement {
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const sheetWidth = Math.max(0, width - 32);
  const terminalRef = useRef<TerminalPaneHandle>(null);
  const commandProgress = useRef(new Animated.Value(1)).current;
  const keyboardOffset = useRef(new Animated.Value(0)).current;
  const pendingRenameTargetRef = useRef<RenameTarget>(null);
  const [connection, setConnection] = useState<SavedConnection | null>(null);
  const [setupBaseUrl, setSetupBaseUrl] = useState(DEFAULT_SERVER_URL);
  const [setupToken, setSetupToken] = useState("");
  const [tree, setTree] = useState<TmuxTree | null>(null);
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [commandBarVisible, setCommandBarVisible] = useState(true);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);

  const client = useMemo(() => (connection ? new RemuxClient(connection) : null), [connection]);
  const selected = useMemo(() => findSelectedTarget(tree, selectedPaneId), [tree, selectedPaneId]);
  const terminalUrl = client && selectedPaneId ? client.terminalWebSocketUrl(selectedPaneId) : null;

  const refreshTree = useCallback(async () => {
    if (!client) {
      return;
    }

    const nextTree = await client.tree();
    setTree(nextTree);
    setSelectedPaneId((current) => {
      if (current && paneExists(nextTree, current)) {
        return current;
      }
      return nextTree.activePaneId && paneExists(nextTree, nextTree.activePaneId)
        ? nextTree.activePaneId
        : firstPaneId(nextTree);
    });
  }, [client]);

  const handleTreeChanged = useCallback(() => {
    void refreshTree();
  }, [refreshTree]);

  useEffect(() => {
    void loadConnection().then((saved) => {
      if (saved) {
        setConnection(saved);
        setSetupBaseUrl(saved.baseUrl);
        setSetupToken(saved.token);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!client) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([client.preferences(), client.tree()])
      .then(([preferences, nextTree]) => {
        if (cancelled) {
          return;
        }
        setTree(nextTree);
        const preferredPane = preferences.lastPaneId && paneExists(nextTree, preferences.lastPaneId)
          ? preferences.lastPaneId
          : firstPaneId(nextTree);
        setSelectedPaneId(preferredPane);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Unable to connect");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    if (client && selectedPaneId) {
      void client.updatePreferences({ lastPaneId: selectedPaneId });
    }
  }, [client, selectedPaneId]);

  useEffect(() => {
    Animated.timing(commandProgress, {
      duration: commandBarVisible ? 190 : 160,
      easing: commandBarVisible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      toValue: commandBarVisible ? 1 : 0,
      useNativeDriver: true
    }).start();
  }, [commandBarVisible, commandProgress]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSubscription = NativeKeyboard.addListener(showEvent, (event) => {
      const height = Math.max(0, event.endCoordinates?.height ?? 0);
      setKeyboardVisible(true);
      Animated.timing(keyboardOffset, {
        duration: Math.max(120, event.duration ?? 220),
        easing: Easing.out(Easing.cubic),
        toValue: height,
        useNativeDriver: true
      }).start();
    });

    const hideSubscription = NativeKeyboard.addListener(hideEvent, (event) => {
      setKeyboardVisible(false);
      Animated.timing(keyboardOffset, {
        duration: Math.max(120, event.duration ?? 180),
        easing: Easing.in(Easing.cubic),
        toValue: 0,
        useNativeDriver: true
      }).start();
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [keyboardOffset]);

  async function connect(): Promise<void> {
    const nextConnection = {
      baseUrl: setupBaseUrl.trim().replace(/\/+$/, ""),
      token: setupToken.trim()
    };

    if (!nextConnection.baseUrl) {
      setError("Server URL is required.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextClient = new RemuxClient(nextConnection);
      await nextClient.health();
      await saveConnection(nextConnection);
      setConnection(nextConnection);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  }

  async function runTreeAction(action: () => Promise<TmuxTree>, selectPane?: string | null): Promise<void> {
    if (!client) {
      return;
    }

    setError(null);
    try {
      const nextTree = await action();
      setTree(nextTree);
      if (selectPane !== undefined) {
        setSelectedPaneId(selectPane);
      } else if (!selectedPaneId || !paneExists(nextTree, selectedPaneId)) {
        setSelectedPaneId(firstPaneId(nextTree));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "tmux action failed");
    }
  }

  async function createSession(): Promise<void> {
    await runTreeAction(() => client!.createSession());
  }

  async function createWindow(): Promise<void> {
    if (!selected?.session) {
      await createSession();
      return;
    }
    await runTreeAction(() => client!.createWindow({ sessionId: selected.session.id }));
  }

  async function createWindowForSession(sessionId: string): Promise<void> {
    await runTreeAction(() => client!.createWindow({ sessionId }));
  }

  async function deleteSession(sessionId: string): Promise<void> {
    await runTreeAction(() => client!.killSession(sessionId));
  }

  async function deleteWindow(windowId: string): Promise<void> {
    await runTreeAction(() => client!.killWindow(windowId));
  }

  async function submitRename(nextName: string): Promise<void> {
    if (!renameTarget) {
      return;
    }

    const trimmed = nextName.trim();
    if (!trimmed) {
      setRenameTarget(null);
      return;
    }

    const target = renameTarget;
    setRenameTarget(null);
    await runTreeAction(() =>
      target.kind === "session"
        ? client!.renameSession(target.id, { name: trimmed })
        : client!.renameWindow(target.id, { name: trimmed })
    );
  }

  function selectPane(paneId: string): void {
    setSelectedPaneId(paneId);
    setShowSwitcher(false);
  }

  function selectWindow(window: TmuxWindow): void {
    const paneId = windowActivePaneId(window);
    if (paneId) {
      selectPane(paneId);
    }
  }

  function sendTerminalKey(data: string): void {
    terminalRef.current?.send(data);
  }

  function toggleTerminalKeyboard(): void {
    if (keyboardVisible) {
      terminalRef.current?.dismissKeyboard();
    } else {
      terminalRef.current?.focusKeyboard();
    }
  }

  function flushPendingRename(): void {
    const target = pendingRenameTargetRef.current;
    if (!target) {
      return;
    }

    pendingRenameTargetRef.current = null;
    setRenameTarget(target);
  }

  function handleSwitcherDismiss(): void {
    setShowSwitcher(false);
    flushPendingRename();
  }

  function openRenameFromSwitcher(target: NonNullable<RenameTarget>): void {
    pendingRenameTargetRef.current = target;
    setShowSwitcher(false);
    setTimeout(flushPendingRename, 260);
  }

  if (!connection) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" />
        <View style={styles.setup}>
          <View style={styles.setupHeader}>
            <AdaptiveIcon fallback={Server} iosSymbol="server.rack" color={palette.accent} size={28} />
            <Text style={styles.brand}>Remux</Text>
            <Text style={styles.muted}>Connect to a tmux host reachable through your tunnel or VPN.</Text>
          </View>
          <View style={styles.form}>
            <Text style={styles.label}>Server URL</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={setSetupBaseUrl}
              placeholder="http://127.0.0.1:8787"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={setupBaseUrl}
            />
            <Text style={styles.label}>Bearer token (optional)</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setSetupToken}
              placeholder="Blank for local dev"
              placeholderTextColor={palette.muted}
              secureTextEntry
              style={styles.input}
              value={setupToken}
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Pressable disabled={loading} onPress={() => void connect()} style={styles.primaryButton}>
              {loading ? <ActivityIndicator color={palette.bg} /> : <Text style={styles.primaryButtonText}>Connect</Text>}
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />
      <View style={styles.app}>
        <View style={[styles.workspace, wide ? styles.workspaceWide : null]}>
          {wide ? (
            <View style={styles.sidebar}>
              <SessionTree
                selectedWindowId={selected?.window.id ?? null}
                tree={tree}
                onCreateSession={() => void createSession()}
                onCreateWindow={() => void createWindow()}
                onDeleteSession={(sessionId) => void deleteSession(sessionId)}
                onDeleteWindow={(windowId) => void deleteWindow(windowId)}
                onRename={setRenameTarget}
                onSelectWindow={selectWindow}
              />
            </View>
          ) : null}

          <View style={styles.primary}>
            <Animated.View
              style={[
                styles.terminalFrame,
                {
                  transform: [
                    {
                      translateY: commandProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -COMMAND_BAR_HEIGHT]
                      })
                    },
                    {
                      translateY: Animated.multiply(keyboardOffset, -1)
                    }
                  ]
                }
              ]}
            >
              {loading ? (
                <View style={styles.emptyState}>
                  <ActivityIndicator color={palette.accent} />
                </View>
              ) : terminalUrl && selectedPaneId ? (
                <TerminalPane
                  ref={terminalRef}
                  key={selectedPaneId}
                  paneId={selectedPaneId}
                  wsUrl={terminalUrl}
                  onStatus={() => undefined}
                  onTreeChanged={handleTreeChanged}
                />
              ) : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>No tmux panes</Text>
                  <Text style={styles.muted}>Create a session to start a shell on this host.</Text>
                  <Pressable onPress={() => void createSession()} style={styles.primaryButtonCompact}>
                    <Text style={styles.primaryButtonText}>Create session</Text>
                  </Pressable>
                </View>
              )}
            </Animated.View>

            {error ? <Text style={styles.errorTextInline}>{error}</Text> : null}
          </View>
        </View>

        <CommandBar
          keyboardOffset={keyboardOffset}
          keyboardVisible={keyboardVisible}
          progress={commandProgress}
          visible={commandBarVisible}
          onArrowDown={() => sendTerminalKey("\u001b[B")}
          onArrowUp={() => sendTerminalKey("\u001b[A")}
          onControl={() => sendTerminalKey("\u0003")}
          onKeyboard={toggleTerminalKeyboard}
          onMenu={() => setShowSwitcher((value) => !value)}
          onToggle={() => setCommandBarVisible((value) => !value)}
        />

        <ExpoBottomSheet
          isPresented={showSwitcher}
          onDismiss={handleSwitcherDismiss}
          showDragIndicator
          snapPoints={[{ fraction: 0.58 }, "full"]}
          modifiers={Platform.OS === "ios" ? [presentationBackground(palette.bg)] : undefined}
        >
          <ExpoRNHostView>
            <View style={[styles.sheetContent, { width: sheetWidth }]}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Sessions</Text>
                <View style={styles.sheetHeaderActions}>
                  <IconButton icon={Plus} iosSymbol="plus" label="New session" onPress={() => void createSession()} />
                </View>
              </View>
              <SessionSheet
                selectedWindowId={selected?.window.id ?? null}
                tree={tree}
                onCreateSession={() => void createSession()}
                onCreateWindow={(sessionId) => void createWindowForSession(sessionId)}
                onDeleteSession={(sessionId) => void deleteSession(sessionId)}
                onDeleteWindow={(windowId) => void deleteWindow(windowId)}
                onRename={openRenameFromSwitcher}
                onSelectWindow={selectWindow}
              />
            </View>
          </ExpoRNHostView>
        </ExpoBottomSheet>

        {renameTarget ? (
          <RenameSheet
            target={renameTarget}
            onCancel={() => setRenameTarget(null)}
            onSubmit={(nextName) => void submitRename(nextName)}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function SessionSheet({
  tree,
  selectedWindowId,
  onCreateSession,
  onCreateWindow,
  onDeleteSession,
  onDeleteWindow,
  onSelectWindow,
  onRename
}: {
  tree: TmuxTree | null;
  selectedWindowId: string | null;
  onCreateSession(): void;
  onCreateWindow(sessionId: string): void;
  onDeleteSession(sessionId: string): void;
  onDeleteWindow(windowId: string): void;
  onSelectWindow(window: TmuxWindow): void;
  onRename(target: RenameTarget): void;
}): React.ReactElement {
  if (!tree?.sessions.length) {
    return (
      <View style={styles.sheetEmpty}>
        <Text style={styles.emptyTitle}>No sessions</Text>
        <Text style={styles.muted}>Create a session to start a shell on this host.</Text>
        <Pressable onPress={onCreateSession} style={styles.primaryButtonCompact}>
          <Text style={styles.primaryButtonText}>Create session</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetList}>
      {tree.sessions.map((session) => (
        <View key={session.id} style={styles.sheetSession}>
          <View style={styles.sheetSessionHeader}>
            <View style={styles.sheetSessionTitleGroup}>
              <Text numberOfLines={1} style={styles.sheetSessionName}>{session.name}</Text>
            </View>
            <View style={styles.sheetSessionActions}>
              <IconButton
                icon={Plus}
                iosSymbol="plus"
                label={`New window in ${session.name}`}
                onPress={() => onCreateWindow(session.id)}
                size={16}
              />
              <IconButton
                icon={Edit3}
                iosSymbol="pencil"
                label={`Rename session ${session.name}`}
                onPress={() => onRename({ kind: "session", id: session.id, name: session.name })}
                size={16}
              />
              <IconButton
                icon={Trash2}
                iosSymbol="trash"
                label={`Destroy session ${session.name}`}
                onPress={() => onDeleteSession(session.id)}
                size={16}
              />
            </View>
          </View>
          {session.windows.map((window) => (
            <SheetWindowRow
              key={window.id}
              selected={window.id === selectedWindowId}
              window={window}
              onDelete={() => onDeleteWindow(window.id)}
              onRename={() => onRename({ kind: "window", id: window.id, name: window.name })}
              onSelect={() => onSelectWindow(window)}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function SheetWindowRow({
  window,
  selected,
  onDelete,
  onRename,
  onSelect
}: {
  window: TmuxWindow;
  selected: boolean;
  onDelete(): void;
  onRename(): void;
  onSelect(): void;
}): React.ReactElement {
  return (
    <View style={styles.sheetWindowRow}>
      <Pressable onPress={onSelect} style={styles.sheetWindowSelect}>
        <AdaptiveIcon fallback={ChevronRight} iosSymbol="chevron.right" color={selected ? palette.accent : palette.faint} size={16} />
        <View style={styles.sheetWindowTextGroup}>
          <Text numberOfLines={1} style={[styles.sheetWindowName, selected ? styles.sheetWindowNameSelected : null]}>
            {window.index}: {window.name}
          </Text>
        </View>
      </Pressable>
      <View style={styles.sheetWindowActions}>
        <IconButton
          icon={Edit3}
          iosSymbol="pencil"
          label={`Rename window ${window.name}`}
          onPress={onRename}
          size={16}
        />
        <IconButton
          icon={Trash2}
          iosSymbol="trash"
          label={`Destroy window ${window.name}`}
          onPress={onDelete}
          size={16}
        />
      </View>
    </View>
  );
}

function SessionTree({
  tree,
  selectedWindowId,
  onCreateSession,
  onCreateWindow,
  onDeleteSession,
  onDeleteWindow,
  onSelectWindow,
  onRename
}: {
  tree: TmuxTree | null;
  selectedWindowId: string | null;
  onCreateSession(): void;
  onCreateWindow(): void;
  onDeleteSession(sessionId: string): void;
  onDeleteWindow(windowId: string): void;
  onSelectWindow(window: TmuxWindow): void;
  onRename(target: RenameTarget): void;
}): React.ReactElement {
  return (
    <ScrollView style={styles.tree} contentContainerStyle={styles.treeContent}>
      <View style={styles.treeHeader}>
        <Text style={styles.treeTitle}>Sessions</Text>
        <View style={styles.treeActions}>
          <IconButton icon={Plus} iosSymbol="plus" label="New session" onPress={onCreateSession} />
          <IconButton icon={SquareTerminal} iosSymbol="macwindow.badge.plus" label="New window" onPress={onCreateWindow} />
        </View>
      </View>
      {!tree?.sessions.length ? <Text style={styles.muted}>No tmux server state yet.</Text> : null}
      {tree?.sessions.map((session) => (
        <View key={session.id} style={styles.sessionBlock}>
          <View style={styles.sessionHeader}>
            <Text numberOfLines={1} style={styles.sessionName}>{session.name}</Text>
            <View style={styles.sessionHeaderActions}>
              <TouchableOpacity
                accessibilityLabel={`Rename session ${session.name}`}
                onPress={() => onRename({ kind: "session", id: session.id, name: session.name })}
                style={styles.inlineIcon}
              >
                <AdaptiveIcon fallback={Edit3} iosSymbol="pencil" color={palette.muted} size={14} />
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityLabel={`Destroy session ${session.name}`}
                onPress={() => onDeleteSession(session.id)}
                style={styles.inlineIcon}
              >
                <AdaptiveIcon fallback={Trash2} iosSymbol="trash" color={palette.danger} size={14} />
              </TouchableOpacity>
            </View>
          </View>
          {session.windows.map((window) => (
            <WindowNode
              key={window.id}
              window={window}
              selected={window.id === selectedWindowId}
              onDelete={() => onDeleteWindow(window.id)}
              onRename={() => onRename({ kind: "window", id: window.id, name: window.name })}
              onSelect={() => onSelectWindow(window)}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function WindowNode({
  window,
  selected,
  onDelete,
  onRename,
  onSelect
}: {
  window: TmuxWindow;
  selected: boolean;
  onDelete(): void;
  onRename(): void;
  onSelect(): void;
}): React.ReactElement {
  return (
    <View style={[styles.windowRow, selected ? styles.windowRowSelected : null]}>
      <Pressable onPress={onSelect} style={styles.windowSelectArea}>
        <AdaptiveIcon fallback={ChevronRight} iosSymbol="chevron.right" color={palette.muted} size={14} />
        <Text numberOfLines={1} style={[styles.windowName, selected ? styles.windowNameSelected : null]}>
          {window.index}: {window.name}
        </Text>
      </Pressable>
      <View style={styles.windowActions}>
        <TouchableOpacity
          accessibilityLabel={`Rename window ${window.name}`}
          onPress={onRename}
          style={styles.inlineIcon}
        >
          <AdaptiveIcon fallback={Edit3} iosSymbol="pencil" color={selected ? palette.accent : palette.muted} size={14} />
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel={`Destroy window ${window.name}`}
          onPress={onDelete}
          style={styles.inlineIcon}
        >
          <AdaptiveIcon fallback={Trash2} iosSymbol="trash" color={palette.danger} size={14} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function CommandBar({
  keyboardOffset,
  keyboardVisible,
  progress,
  visible,
  onArrowDown,
  onArrowUp,
  onControl,
  onKeyboard,
  onMenu,
  onToggle
}: {
  keyboardOffset: CommandProgress;
  keyboardVisible: boolean;
  progress: CommandProgress;
  visible: boolean;
  onArrowDown(): void;
  onArrowUp(): void;
  onControl(): void;
  onKeyboard(): void;
  onMenu(): void;
  onToggle(): void;
}): React.ReactElement {
  const keyboardTranslateY = Animated.multiply(keyboardOffset, -1);
  const barTranslateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [COMMAND_BAR_HEIGHT + 10, 0]
  });
  const toggleOpacity = progress.interpolate({
    inputRange: [0, 0.72, 1],
    outputRange: [1, 0, 0]
  });
  const toggleTranslateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, COMMAND_TOGGLE_HEIGHT + 8]
  });
  const toggleScale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.9]
  });

  return (
    <>
      <Animated.View
        pointerEvents={visible ? "auto" : "none"}
        style={[
          styles.commandBar,
          {
            opacity: progress,
            transform: [{ translateY: keyboardTranslateY }, { translateY: barTranslateY }]
          }
        ]}
      >
        <CommandIconButton icon={Menu} iosSymbol="line.3.horizontal" label="Sessions" onPress={onMenu} />
        <View style={styles.commandDivider} />
        <CommandTextButton label="Send Ctrl-C" text="Ctrl" onPress={onControl} />
        <CommandIconButton icon={ArrowUp} iosSymbol="arrow.up" label="Arrow up" onPress={onArrowUp} />
        <CommandIconButton icon={ArrowDown} iosSymbol="arrow.down" label="Arrow down" onPress={onArrowDown} />
        <CommandIconButton
          active={keyboardVisible}
          icon={KeyboardIcon}
          iosSymbol="keyboard"
          label={keyboardVisible ? "Hide keyboard" : "Show keyboard"}
          onPress={onKeyboard}
        />
        <View style={styles.commandSpacer} />
        <CommandIconButton icon={ChevronDown} iosSymbol="chevron.down" label="Hide command bar" onPress={onToggle} />
      </Animated.View>
      <Animated.View
        pointerEvents={visible ? "none" : "auto"}
        style={[
          styles.commandBarCollapsed,
          {
            opacity: toggleOpacity,
            transform: [{ translateY: keyboardTranslateY }, { translateY: toggleTranslateY }, { scale: toggleScale }]
          }
        ]}
      >
        <CommandIconButton icon={ChevronUp} iosSymbol="chevron.up" label="Show command bar" onPress={onToggle} />
      </Animated.View>
    </>
  );
}

function CommandIconButton({
  active,
  icon: Icon,
  iosSymbol,
  label,
  onPress
}: {
  active?: boolean;
  icon: IconType;
  iosSymbol: ExpoIconName;
  label: string;
  onPress(): void;
}): React.ReactElement {
  return (
    <TouchableOpacity accessibilityLabel={label} onPress={onPress} style={styles.commandButton}>
      <AdaptiveIcon fallback={Icon} iosSymbol={iosSymbol} color={active ? palette.accent : palette.text} size={18} />
    </TouchableOpacity>
  );
}

function CommandTextButton({
  label,
  text,
  onPress
}: {
  label: string;
  text: string;
  onPress(): void;
}): React.ReactElement {
  return (
    <TouchableOpacity accessibilityLabel={label} onPress={onPress} style={styles.commandButton}>
      <Text style={styles.commandButtonText}>{text}</Text>
    </TouchableOpacity>
  );
}

function AdaptiveIcon({
  fallback: Fallback,
  iosSymbol,
  color,
  size = 18,
  strokeWidth = 2
}: {
  fallback: IconType;
  iosSymbol: ExpoIconName;
  color?: string;
  size?: number;
  strokeWidth?: number;
}): React.ReactElement {
  if (Platform.OS === "ios") {
    return (
      <ExpoHost colorScheme="dark" matchContents style={{ height: size, width: size }}>
        <ExpoIcon color={color} name={iosSymbol} size={size} />
      </ExpoHost>
    );
  }
  return <Fallback color={color} size={size} strokeWidth={strokeWidth} />;
}

function RenameSheet({
  target,
  onCancel,
  onSubmit
}: {
  target: NonNullable<RenameTarget>;
  onCancel(): void;
  onSubmit(name: string): void;
}): React.ReactElement {
  const [name, setName] = useState(target.name);
  const canSubmit = name.trim().length > 0;

  return (
    <Modal animationType="slide" onRequestClose={onCancel} transparent visible>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.renameOverlay}
      >
        <Pressable accessibilityLabel="Cancel rename" onPress={onCancel} style={styles.renameBackdrop} />
        <View style={styles.renamePanel}>
          <View style={styles.renameHandle} />
          <Text style={styles.renameTitle}>Rename {target.kind}</Text>
          <TextInput
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setName}
            onSubmitEditing={() => {
              if (canSubmit) {
                onSubmit(name);
              }
            }}
            placeholder={`${target.kind} name`}
            placeholderTextColor={palette.faint}
            returnKeyType="done"
            selectTextOnFocus
            style={styles.renameInput}
            value={name}
          />
          <View style={styles.renameActions}>
            <Pressable onPress={onCancel} style={styles.renameActionButton}>
              <Text style={styles.renameCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={!canSubmit}
              onPress={() => {
                if (canSubmit) {
                  onSubmit(name);
                }
              }}
              style={[styles.renameActionButton, styles.renameSaveButton, !canSubmit ? styles.renameSaveButtonDisabled : null]}
            >
              <Text style={[styles.renameSaveText, !canSubmit ? styles.renameSaveTextDisabled : null]}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function IconButton({
  icon: Icon,
  iosSymbol,
  label,
  danger,
  size = 18,
  onPress
}: {
  icon: IconType;
  iosSymbol: ExpoIconName;
  label: string;
  danger?: boolean;
  size?: number;
  onPress(): void;
}): React.ReactElement {
  return (
    <TouchableOpacity accessibilityLabel={label} onPress={onPress} style={styles.iconButton}>
      <AdaptiveIcon fallback={Icon} iosSymbol={iosSymbol} color={danger ? palette.danger : palette.text} size={size} />
    </TouchableOpacity>
  );
}

function findSelectedTarget(tree: TmuxTree | null, paneId: string | null): {
  session: TmuxSession;
  window: TmuxWindow;
  pane: TmuxPane;
} | null {
  if (!tree || !paneId) {
    return null;
  }

  for (const session of tree.sessions) {
    for (const window of session.windows) {
      const pane = window.panes.find((item) => item.id === paneId);
      if (pane) {
        return { session, window, pane };
      }
    }
  }

  return null;
}

function paneExists(tree: TmuxTree, paneId: string): boolean {
  return tree.sessions.some((session) =>
    session.windows.some((window) => window.panes.some((pane) => pane.id === paneId))
  );
}

function windowActivePaneId(window: TmuxWindow): string | null {
  return window.panes.find((pane) => pane.active)?.id ?? window.panes[0]?.id ?? null;
}

function firstPaneId(tree: TmuxTree): string | null {
  return tree.sessions[0]?.windows[0]?.panes[0]?.id ?? null;
}

const palette = {
  bg: "#101412",
  panel: "#151b18",
  panelStrong: "#1d2520",
  text: "#d8e5de",
  muted: "#87958d",
  faint: "#526159",
  accent: "#7ce38b",
  accentStrong: "#58c96a",
  danger: "#ff7d7d",
  line: "#26312b"
};

const styles = StyleSheet.create({
  root: {
    backgroundColor: palette.bg,
    flex: 1
  },
  app: {
    backgroundColor: palette.bg,
    flex: 1,
    position: "relative"
  },
  setup: {
    alignSelf: "center",
    flex: 1,
    justifyContent: "center",
    maxWidth: 460,
    padding: 24,
    width: "100%"
  },
  setupHeader: {
    gap: 12,
    marginBottom: 28
  },
  brand: {
    color: palette.text,
    fontSize: 42,
    fontWeight: "800",
    letterSpacing: 0
  },
  muted: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 20
  },
  form: {
    gap: 10
  },
  label: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  input: {
    backgroundColor: palette.panel,
    borderColor: palette.line,
    borderWidth: 1,
    color: palette.text,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: palette.accent,
    justifyContent: "center",
    marginTop: 10,
    minHeight: 48,
    paddingHorizontal: 18
  },
  primaryButtonCompact: {
    alignItems: "center",
    backgroundColor: palette.accent,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 14
  },
  primaryButtonText: {
    color: palette.bg,
    fontSize: 14,
    fontWeight: "800"
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: palette.line,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 14
  },
  secondaryButtonText: {
    color: palette.text,
    fontSize: 14,
    fontWeight: "700"
  },
  errorText: {
    color: palette.danger,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6
  },
  errorTextInline: {
    color: palette.danger,
    fontSize: 12,
    left: 12,
    position: "absolute",
    right: 12,
    top: 12,
    zIndex: 25,
    backgroundColor: "rgba(16, 20, 18, 0.86)",
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  workspace: {
    flex: 1,
    minHeight: 0
  },
  workspaceWide: {
    flexDirection: "row"
  },
  primary: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    position: "relative"
  },
  terminalFrame: {
    backgroundColor: "#0d1110",
    flex: 1,
    minHeight: 0
  },
  emptyState: {
    alignItems: "center",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    padding: 24
  },
  emptyTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: "800"
  },
  iconButton: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32
  },
  sidebar: {
    backgroundColor: "#111613",
    borderRightColor: "rgba(216, 229, 222, 0.08)",
    borderRightWidth: 1,
    width: 288
  },
  tree: {
    flex: 1,
    minHeight: 0,
    width: "100%"
  },
  treeContent: {
    padding: 10,
    paddingBottom: 32
  },
  treeHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14
  },
  treeTitle: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "800"
  },
  treeActions: {
    flexDirection: "row",
    gap: 8
  },
  sessionBlock: {
    marginBottom: 14
  },
  sessionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    marginBottom: 6
  },
  sessionHeaderActions: {
    flexDirection: "row",
    gap: 2
  },
  sessionName: {
    color: palette.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "800"
  },
  inlineIcon: {
    alignItems: "center",
    height: 26,
    justifyContent: "center",
    width: 26
  },
  windowRow: {
    alignItems: "center",
    borderLeftColor: "transparent",
    borderLeftWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 36,
    paddingLeft: 8,
    paddingRight: 2
  },
  windowRowSelected: {
    backgroundColor: "rgba(216, 229, 222, 0.06)",
    borderLeftColor: palette.accent
  },
  windowSelectArea: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 4,
    minHeight: 36,
    minWidth: 0
  },
  windowActions: {
    flexDirection: "row",
    gap: 2
  },
  windowName: {
    color: palette.muted,
    flex: 1,
    fontSize: 12,
    fontWeight: "700"
  },
  windowNameSelected: {
    color: palette.text,
    fontWeight: "800"
  },
  sheetContent: {
    alignSelf: "stretch",
    backgroundColor: palette.bg,
    minHeight: 420,
    paddingBottom: 18,
    paddingHorizontal: 0
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 38,
    paddingBottom: 8
  },
  sheetHeaderActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6
  },
  sheetTitle: {
    color: palette.text,
    fontSize: 17,
    fontWeight: "800"
  },
  sheetScroll: {
    alignSelf: "stretch",
    maxHeight: 620,
    minHeight: 320,
    width: "100%"
  },
  sheetList: {
    paddingBottom: 96,
    paddingTop: 4
  },
  sheetEmpty: {
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
    minHeight: 300,
    padding: 24
  },
  sheetSession: {
    marginBottom: 14
  },
  sheetSessionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    minHeight: 34
  },
  sheetSessionTitleGroup: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden"
  },
  sheetSessionName: {
    color: palette.text,
    fontSize: 16,
    fontWeight: "800"
  },
  sheetSessionActions: {
    alignItems: "center",
    flexShrink: 0,
    flexDirection: "row",
    gap: 4
  },
  sheetWindowRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    minHeight: 38,
    paddingLeft: 12,
    paddingVertical: 1
  },
  sheetWindowSelect: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 38,
    minWidth: 0,
    overflow: "hidden"
  },
  sheetWindowTextGroup: {
    flex: 1,
    minWidth: 0
  },
  sheetWindowName: {
    color: palette.muted,
    fontSize: 15,
    fontWeight: "400"
  },
  sheetWindowNameSelected: {
    color: palette.text
  },
  sheetWindowActions: {
    alignItems: "center",
    flexShrink: 0,
    flexDirection: "row",
    gap: 4
  },
  renameOverlay: {
    flex: 1,
    justifyContent: "flex-end"
  },
  renameBackdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.58)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  renamePanel: {
    backgroundColor: "#111613",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    gap: 14,
    paddingBottom: 28,
    paddingHorizontal: 18,
    paddingTop: 10,
    width: "100%"
  },
  renameHandle: {
    alignSelf: "center",
    backgroundColor: "rgba(216, 229, 222, 0.32)",
    borderRadius: 3,
    height: 5,
    marginBottom: 8,
    width: 48
  },
  renameTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0
  },
  renameInput: {
    backgroundColor: "rgba(216, 229, 222, 0.08)",
    color: palette.text,
    fontSize: 20,
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  renameActions: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingTop: 4
  },
  renameActionButton: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 46
  },
  renameCancelText: {
    color: palette.muted,
    fontSize: 16,
    fontWeight: "700"
  },
  renameSaveButton: {
    backgroundColor: "rgba(124, 227, 139, 0.16)"
  },
  renameSaveButtonDisabled: {
    backgroundColor: "rgba(216, 229, 222, 0.06)"
  },
  renameSaveText: {
    color: palette.accent,
    fontSize: 16,
    fontWeight: "800"
  },
  renameSaveTextDisabled: {
    color: palette.faint
  },
  commandBar: {
    alignItems: "center",
    backgroundColor: "rgba(16, 20, 18, 0.92)",
    borderTopColor: "rgba(216, 229, 222, 0.08)",
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: "row",
    gap: 7,
    height: COMMAND_BAR_HEIGHT,
    left: 0,
    paddingHorizontal: 10,
    position: "absolute",
    right: 0,
    zIndex: 35
  },
  commandBarCollapsed: {
    alignItems: "center",
    bottom: 8,
    height: 40,
    justifyContent: "center",
    position: "absolute",
    right: 10,
    width: 40,
    zIndex: 35
  },
  commandButton: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    minWidth: 38,
    paddingHorizontal: 10
  },
  commandButtonText: {
    color: palette.text,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0
  },
  commandDivider: {
    backgroundColor: "rgba(216, 229, 222, 0.1)",
    height: 24,
    width: 1
  },
  commandSpacer: {
    flex: 1
  }
});
