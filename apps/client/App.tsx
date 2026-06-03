import { RemuxClient } from "@remux/api-client";
import {
  BottomSheet as ExpoBottomSheet,
  Host as ExpoHost,
  Icon as ExpoIcon,
  RNHostView as ExpoRNHostView
} from "@expo/ui";
import { presentationBackground } from "@expo/ui/swift-ui/modifiers";
import type { TmuxPane, TmuxSession, TmuxTree, TmuxWindow } from "@remux/protocol";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Edit3,
  Home,
  Keyboard as KeyboardIcon,
  Menu,
  Plus,
  Server,
  SquareTerminal,
  Trash2,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Keyboard as NativeKeyboard, TextInput as NativeTextInput } from "react-native";
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
import { deleteConnection, loadConnections, saveConnection, type SavedConnection } from "./src/storage";
import type { TerminalPaneHandle } from "./src/terminal-types";

type IconType = React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
type ExpoIconName = React.ComponentProps<typeof ExpoIcon>["name"];
type RenameTarget = { kind: "session" | "window"; id: string; name: string } | null;

const ENV_SERVER_URL =
  typeof process !== "undefined" ? process.env.EXPO_PUBLIC_REMUX_SERVER_URL?.trim() : undefined;
const DEFAULT_REMUX_PORT = "14441";
const DEFAULT_SERVER_FIELDS = readDefaultServerFields();
const DEFAULT_SETUP_HOST = DEFAULT_SERVER_FIELDS.host;
const DEFAULT_SETUP_PORT = DEFAULT_SERVER_FIELDS.port;
const NEW_CONNECTION_ID = "__new_connection__";
const COMMAND_BAR_HEIGHT = 52;
const COMMAND_KEYBOARD_PROXY_VALUE = " ";
const COMMAND_KEYBOARD_PROXY_SELECTION = {
  end: COMMAND_KEYBOARD_PROXY_VALUE.length,
  start: COMMAND_KEYBOARD_PROXY_VALUE.length
};
type CommandProgress = InstanceType<typeof Animated.Value>;

export default function App(): React.ReactElement {
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const sheetWidth = Math.max(0, width - 32);
  const terminalRef = useRef<TerminalPaneHandle>(null);
  const keyboardOffset = useRef(new Animated.Value(0)).current;
  const pendingRenameTargetRef = useRef<RenameTarget>(null);
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [connection, setConnection] = useState<SavedConnection | null>(null);
  const [setupLabel, setSetupLabel] = useState("");
  const [setupHost, setSetupHost] = useState(DEFAULT_SETUP_HOST);
  const [setupPort, setSetupPort] = useState(DEFAULT_SETUP_PORT);
  const [tree, setTree] = useState<TmuxTree | null>(null);
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectingConnectionId, setConnectingConnectionId] = useState<string | null>(null);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);

  const client = useMemo(() => (connection ? new RemuxClient(connection) : null), [connection]);
  const selected = useMemo(() => findSelectedTarget(tree, selectedPaneId), [tree, selectedPaneId]);
  const terminalUrl = client && selectedPaneId ? client.terminalWebSocketUrl(selectedPaneId) : null;
  const terminalBottomInset = COMMAND_BAR_HEIGHT + keyboardHeight;

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
    void loadConnections().then((saved) => {
      setConnections(saved);
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
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSubscription = NativeKeyboard.addListener(showEvent, (event) => {
      const height = Math.max(0, event.endCoordinates?.height ?? 0);
      setKeyboardHeight(height);
      setKeyboardVisible(true);
      Animated.timing(keyboardOffset, {
        duration: Math.max(120, event.duration ?? 220),
        easing: Easing.out(Easing.cubic),
        toValue: height,
        useNativeDriver: true
      }).start();
    });

    const hideSubscription = NativeKeyboard.addListener(hideEvent, (event) => {
      setKeyboardHeight(0);
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
    const nextConnection = buildConnectionFromFields(setupLabel, setupHost, setupPort);
    if (typeof nextConnection === "string") {
      setError(nextConnection);
      return;
    }

    await connectToConnection(nextConnection, { save: true });
  }

  async function connectToSavedConnection(savedConnection: SavedConnection): Promise<void> {
    await connectToConnection(savedConnection, { save: false });
  }

  async function connectToConnection(nextConnection: SavedConnection, options: { save: boolean }): Promise<void> {
    let connected = false;
    setLoading(true);
    setError(null);
    setConnectingConnectionId(options.save ? NEW_CONNECTION_ID : nextConnection.id);
    try {
      const nextClient = new RemuxClient(nextConnection);
      await nextClient.health();
      if (options.save) {
        const nextConnections = await saveConnection(nextConnection, connections);
        setConnections(nextConnections);
        setSetupLabel("");
        setSetupHost(nextConnection.host);
        setSetupPort(nextConnection.port);
      }
      setConnection(nextConnection);
      connected = true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Connection failed");
    } finally {
      setConnectingConnectionId(null);
      if (!connected) {
        setLoading(false);
      }
    }
  }

  async function removeSavedConnection(connectionId: string): Promise<void> {
    const nextConnections = await deleteConnection(connectionId, connections);
    setConnections(nextConnections);
  }

  function returnHome(): void {
    terminalRef.current?.dismissKeyboard();
    NativeKeyboard.dismiss();
    setShowSwitcher(false);
    setRenameTarget(null);
    setConnection(null);
    setTree(null);
    setSelectedPaneId(null);
    setError(null);
    setLoading(false);
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
    terminalRef.current?.sendInput(data);
  }

  function sendTerminalInput(data: string): void {
    terminalRef.current?.sendInput(data);
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
      <WelcomeScreen
        connectingConnectionId={connectingConnectionId}
        connections={connections}
        error={error}
        loading={loading}
        setupHost={setupHost}
        setupLabel={setupLabel}
        setupPort={setupPort}
        onConnect={() => void connect()}
        onConnectSaved={(savedConnection) => void connectToSavedConnection(savedConnection)}
        onDeleteSaved={(connectionId) => void removeSavedConnection(connectionId)}
        onSetupHostChange={setSetupHost}
        onSetupLabelChange={setSetupLabel}
        onSetupPortChange={setSetupPort}
      />
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
                  marginBottom: terminalBottomInset
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
          onArrowDown={() => sendTerminalKey("\u001b[B")}
          onArrowUp={() => sendTerminalKey("\u001b[A")}
          onControl={() => sendTerminalKey("\u0003")}
          onTab={() => sendTerminalKey("\t")}
          onInput={sendTerminalInput}
          onMenu={() => setShowSwitcher((value) => !value)}
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
                  <IconButton icon={Home} iosSymbol="house" label="Home" onPress={returnHome} />
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

function WelcomeScreen({
  connectingConnectionId,
  connections,
  error,
  loading,
  setupHost,
  setupLabel,
  setupPort,
  onConnect,
  onConnectSaved,
  onDeleteSaved,
  onSetupHostChange,
  onSetupLabelChange,
  onSetupPortChange
}: {
  connectingConnectionId: string | null;
  connections: SavedConnection[];
  error: string | null;
  loading: boolean;
  setupHost: string;
  setupLabel: string;
  setupPort: string;
  onConnect(): void;
  onConnectSaved(connection: SavedConnection): void;
  onDeleteSaved(connectionId: string): void;
  onSetupHostChange(value: string): void;
  onSetupLabelChange(value: string): void;
  onSetupPortChange(value: string): void;
}): React.ReactElement {
  const { width } = useWindowDimensions();
  const busy = loading || connectingConnectionId !== null;
  const formConnecting = connectingConnectionId === NEW_CONNECTION_ID;
  const hasSavedServers = connections.length > 0;
  const sheetWidth = Math.max(0, width - 32);
  const [showAddServerSheet, setShowAddServerSheet] = useState(!hasSavedServers);

  useEffect(() => {
    if (!hasSavedServers) {
      setShowAddServerSheet(true);
    }
  }, [hasSavedServers]);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.setupScroll}
        contentContainerStyle={styles.setupScrollContent}
      >
        <View style={styles.setup}>
          <View style={styles.setupHeader}>
            <AdaptiveIcon fallback={Server} iosSymbol="server.rack" color={palette.accent} size={28} />
            <Text style={styles.brand}>Remux</Text>
            <Text style={styles.muted}>Connect to a tmux host reachable through your tunnel or VPN.</Text>
          </View>

          <View style={styles.savedServers}>
            <View style={styles.setupSectionHeader}>
              <Text style={styles.setupSectionTitle}>Servers</Text>
              <View style={styles.setupSectionActions}>
                {loading && !connectingConnectionId ? <ActivityIndicator color={palette.accent} /> : null}
                {hasSavedServers ? (
                  <Pressable disabled={busy} onPress={() => setShowAddServerSheet(true)} style={styles.textButton}>
                    <Text style={[styles.textButtonText, busy ? styles.textButtonTextDisabled : null]}>Add server</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
            {hasSavedServers ? (
              <View style={styles.savedServerList}>
                {connections.map((savedConnection) => (
                  <SavedServerRow
                    key={savedConnection.id}
                    connection={savedConnection}
                    connecting={connectingConnectionId === savedConnection.id}
                    disabled={busy}
                    onConnect={() => onConnectSaved(savedConnection)}
                    onDelete={() => onDeleteSaved(savedConnection.id)}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.emptyServerState}>
                <AdaptiveIcon fallback={Server} iosSymbol="server.rack" color={palette.faint} size={22} />
                <Text style={styles.emptyServerText}>No saved servers yet.</Text>
                <Pressable disabled={busy} onPress={() => setShowAddServerSheet(true)} style={styles.textButton}>
                  <Text style={[styles.textButtonText, busy ? styles.textButtonTextDisabled : null]}>Add server</Text>
                </Pressable>
              </View>
            )}
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      </ScrollView>
      <ExpoBottomSheet
        isPresented={showAddServerSheet}
        onDismiss={() => setShowAddServerSheet(false)}
        showDragIndicator
        snapPoints={[{ fraction: 0.58 }, "full"]}
        modifiers={Platform.OS === "ios" ? [presentationBackground(palette.bg)] : undefined}
      >
        <ExpoRNHostView>
          <View style={[styles.addServerSheetContent, { width: sheetWidth }]}>
            <AddServerForm
              busy={busy}
              formConnecting={formConnecting}
              setupHost={setupHost}
              setupLabel={setupLabel}
              setupPort={setupPort}
              onCancel={hasSavedServers ? () => setShowAddServerSheet(false) : undefined}
              onConnect={onConnect}
              onSetupHostChange={onSetupHostChange}
              onSetupLabelChange={onSetupLabelChange}
              onSetupPortChange={onSetupPortChange}
            />
          </View>
        </ExpoRNHostView>
      </ExpoBottomSheet>
    </SafeAreaView>
  );
}

function AddServerForm({
  busy,
  formConnecting,
  setupHost,
  setupLabel,
  setupPort,
  onCancel,
  onConnect,
  onSetupHostChange,
  onSetupLabelChange,
  onSetupPortChange
}: {
  busy: boolean;
  formConnecting: boolean;
  setupHost: string;
  setupLabel: string;
  setupPort: string;
  onCancel?: () => void;
  onConnect(): void;
  onSetupHostChange(value: string): void;
  onSetupLabelChange(value: string): void;
  onSetupPortChange(value: string): void;
}): React.ReactElement {
  return (
    <View style={styles.form}>
      <Text style={styles.setupSectionTitle}>Add server</Text>
      <Text style={styles.label}>Label (optional)</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onSetupLabelChange}
        placeholder="MacBook"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={setupLabel}
      />
      <Text style={styles.label}>Host</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={onSetupHostChange}
        placeholder="100.x.y.z"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={setupHost}
      />
      <Text style={styles.label}>Port</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="number-pad"
        onChangeText={onSetupPortChange}
        placeholder={DEFAULT_REMUX_PORT}
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={setupPort}
      />
      <Pressable disabled={busy} onPress={onConnect} style={[styles.primaryButton, busy ? styles.primaryButtonDisabled : null]}>
        {formConnecting ? <ActivityIndicator color={palette.bg} /> : <Text style={styles.primaryButtonText}>Connect</Text>}
      </Pressable>
      {onCancel ? (
        <Pressable disabled={busy} onPress={onCancel} style={styles.cancelTextButton}>
          <Text style={[styles.textButtonTextMuted, busy ? styles.textButtonTextDisabled : null]}>Cancel</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function SavedServerRow({
  connection,
  connecting,
  disabled,
  onConnect,
  onDelete
}: {
  connection: SavedConnection;
  connecting: boolean;
  disabled: boolean;
  onConnect(): void;
  onDelete(): void;
}): React.ReactElement {
  return (
    <View style={styles.savedServerRow}>
      <Pressable disabled={disabled} onPress={onConnect} style={styles.savedServerSelect}>
        <AdaptiveIcon fallback={Server} iosSymbol="server.rack" color={connecting ? palette.accent : palette.muted} size={17} />
        <View style={styles.savedServerTextGroup}>
          <Text numberOfLines={1} style={styles.savedServerLabel}>{connection.label}</Text>
          <Text numberOfLines={1} style={styles.savedServerAddress}>{connection.host}:{connection.port}</Text>
        </View>
        {connecting ? <ActivityIndicator color={palette.accent} /> : <Text style={styles.savedServerAction}>Connect</Text>}
      </Pressable>
      <TouchableOpacity
        accessibilityLabel={`Delete saved server ${connection.label}`}
        disabled={disabled}
        onPress={onDelete}
        style={styles.savedServerDelete}
      >
        <AdaptiveIcon fallback={Trash2} iosSymbol="trash" color={palette.faint} size={15} />
      </TouchableOpacity>
    </View>
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
  onArrowDown,
  onArrowUp,
  onControl,
  onTab,
  onInput,
  onMenu
}: {
  keyboardOffset: CommandProgress;
  keyboardVisible: boolean;
  onArrowDown(): void;
  onArrowUp(): void;
  onControl(): void;
  onTab(): void;
  onInput(data: string): void;
  onMenu(): void;
}): React.ReactElement {
  const keyboardTranslateY = Animated.multiply(keyboardOffset, -1);

  return (
    <Animated.View
      style={[
        styles.commandBar,
        {
          transform: [{ translateY: keyboardTranslateY }]
        }
      ]}
    >
      <CommandIconButton icon={Menu} iosSymbol="line.3.horizontal" label="Sessions" onPress={onMenu} />
      <View style={styles.commandDivider} />
      <CommandTextButton label="Send Ctrl-C" text="Ctrl" onPress={onControl} />
      <CommandTextButton label="Send Tab" text="Tab" onPress={onTab} />
      <CommandIconButton icon={ArrowUp} iosSymbol="arrow.up" label="Arrow up" onPress={onArrowUp} />
      <CommandIconButton icon={ArrowDown} iosSymbol="arrow.down" label="Arrow down" onPress={onArrowDown} />
      <CommandKeyboardButton
        active={keyboardVisible}
        label="Keyboard input"
        onInput={onInput}
      />
      <View style={styles.commandSpacer} />
    </Animated.View>
  );
}

function CommandKeyboardButton({
  active,
  label,
  onInput
}: {
  active: boolean;
  label: string;
  onInput(data: string): void;
}): React.ReactElement {
  const inputRef = useRef<NativeTextInput>(null);

  const resetInput = useCallback(() => {
    inputRef.current?.setNativeProps({
      selection: COMMAND_KEYBOARD_PROXY_SELECTION,
      text: COMMAND_KEYBOARD_PROXY_VALUE
    });
  }, []);

  const focusInput = useCallback(() => {
    resetInput();
    inputRef.current?.focus();
    requestAnimationFrame(() => {
      resetInput();
      inputRef.current?.focus();
    });
  }, [resetInput]);

  const handleChangeText = useCallback((nextValue: string) => {
    if (nextValue === COMMAND_KEYBOARD_PROXY_VALUE) {
      return;
    }

    const rawInput = nextValue.length === 0
      ? "\u007f"
      : nextValue.startsWith(COMMAND_KEYBOARD_PROXY_VALUE)
        ? nextValue.slice(COMMAND_KEYBOARD_PROXY_VALUE.length)
        : nextValue;
    onInput(rawInput.replace(/\n/g, "\r"));
    resetInput();
  }, [onInput, resetInput]);

  return (
    <Pressable
      accessibilityLabel={label}
      onPress={focusInput}
      onPressIn={focusInput}
      onTouchStart={focusInput}
      style={styles.commandKeyboardButton}
    >
      <AdaptiveIcon fallback={KeyboardIcon} iosSymbol="keyboard" color={active ? palette.accent : palette.text} size={18} />
      <NativeTextInput
        ref={inputRef}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        blurOnSubmit={false}
        caretHidden
        contextMenuHidden
        defaultValue={COMMAND_KEYBOARD_PROXY_VALUE}
        keyboardAppearance="dark"
        multiline
        onChangeText={handleChangeText}
        onFocus={resetInput}
        onPressIn={focusInput}
        onTouchStart={focusInput}
        selection={COMMAND_KEYBOARD_PROXY_SELECTION}
        showSoftInputOnFocus
        spellCheck={false}
        style={styles.commandKeyboardInput}
      />
    </Pressable>
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

function readDefaultServerFields(): { host: string; port: string } {
  const envFields = ENV_SERVER_URL ? splitHostAndInlinePort(ENV_SERVER_URL) : null;
  if (envFields?.host) {
    return {
      host: envFields.host,
      port: envFields.port ?? DEFAULT_REMUX_PORT
    };
  }

  return {
    host: Platform.OS === "android" ? "10.0.2.2" : "127.0.0.1",
    port: DEFAULT_REMUX_PORT
  };
}

function buildConnectionFromFields(labelInput: string, hostInput: string, portInput: string): SavedConnection | string {
  const parsedHost = splitHostAndInlinePort(hostInput);
  const host = parsedHost?.host.trim() ?? "";
  if (!host) {
    return "Host is required.";
  }

  const typedPort = portInput.trim();
  const port = parsedHost?.port && (!typedPort || typedPort === DEFAULT_REMUX_PORT)
    ? parsedHost.port
    : typedPort || DEFAULT_REMUX_PORT;
  if (!isValidPort(port)) {
    return "Port must be between 1 and 65535.";
  }

  const label = labelInput.trim() || host;
  return {
    id: `${host}:${port}`,
    label,
    host,
    port,
    baseUrl: `http://${formatHostForUrl(host)}:${port}`,
    token: ""
  };
}

function splitHostAndInlinePort(value: string): { host: string; port?: string } | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes("://")) {
    try {
      const url = new URL(trimmed);
      return {
        host: url.hostname,
        port: url.port || undefined
      };
    } catch {
      return null;
    }
  }

  const withoutPath = trimmed.split("/")[0] ?? "";
  const ipv6Match = withoutPath.match(/^\[([^\]]+)](?::(\d+))?$/);
  if (ipv6Match) {
    return {
      host: ipv6Match[1],
      port: ipv6Match[2]
    };
  }

  const [host, inlinePort, ...rest] = withoutPath.split(":");
  if (host && inlinePort && rest.length === 0 && /^\d+$/.test(inlinePort)) {
    return { host, port: inlinePort };
  }

  return { host: withoutPath };
}

function isValidPort(port: string): boolean {
  const value = Number(port);
  return Number.isInteger(value) && value > 0 && value <= 65535;
}

function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
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
    justifyContent: "center",
    maxWidth: 460,
    padding: 24,
    width: "100%"
  },
  setupScroll: {
    flex: 1
  },
  setupScrollContent: {
    flexGrow: 1,
    justifyContent: "center"
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
    gap: 9
  },
  setupSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10
  },
  setupSectionActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  setupSectionTitle: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "800"
  },
  textButton: {
    minHeight: 30,
    justifyContent: "center"
  },
  textButtonText: {
    color: palette.accent,
    fontSize: 13,
    fontWeight: "800"
  },
  textButtonTextMuted: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  textButtonTextDisabled: {
    opacity: 0.5
  },
  cancelTextButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38
  },
  savedServers: {
    gap: 8
  },
  savedServerList: {
    gap: 8
  },
  savedServerRow: {
    alignItems: "center",
    backgroundColor: palette.panel,
    flexDirection: "row",
    minHeight: 58,
    overflow: "hidden"
  },
  savedServerSelect: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 58,
    minWidth: 0,
    paddingLeft: 12,
    paddingRight: 8
  },
  savedServerTextGroup: {
    flex: 1,
    minWidth: 0
  },
  savedServerLabel: {
    color: palette.text,
    fontSize: 15,
    fontWeight: "700"
  },
  savedServerAddress: {
    color: palette.muted,
    fontSize: 12,
    marginTop: 2
  },
  savedServerAction: {
    color: palette.accent,
    flexShrink: 0,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  savedServerDelete: {
    alignItems: "center",
    height: 58,
    justifyContent: "center",
    width: 48
  },
  emptyServerState: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 4
  },
  emptyServerText: {
    flex: 1,
    color: palette.muted,
    fontSize: 14
  },
  label: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  input: {
    backgroundColor: "rgba(216, 229, 222, 0.07)",
    borderColor: "rgba(216, 229, 222, 0.1)",
    borderRadius: 14,
    borderWidth: 1,
    color: palette.text,
    fontSize: 15,
    minHeight: 50,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: palette.accent,
    borderRadius: 14,
    justifyContent: "center",
    marginTop: 10,
    minHeight: 50,
    paddingHorizontal: 18
  },
  primaryButtonDisabled: {
    opacity: 0.62
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
  addServerSheetContent: {
    alignSelf: "stretch",
    backgroundColor: palette.bg,
    paddingBottom: 26,
    paddingHorizontal: 2,
    paddingTop: 2
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
  commandButton: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    minWidth: 38,
    paddingHorizontal: 10
  },
  commandKeyboardButton: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    minWidth: 38,
    paddingHorizontal: 10,
    position: "relative"
  },
  commandKeyboardInput: {
    backgroundColor: "transparent",
    bottom: 0,
    color: "transparent",
    fontSize: 16,
    height: 36,
    left: 0,
    lineHeight: 20,
    opacity: 0.01,
    padding: 0,
    position: "absolute",
    right: 0,
    top: 0,
    width: 38,
    zIndex: 2
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
