import { RemuxClient } from "@remux/api-client";
import { Host as ExpoHost, Icon as ExpoIcon } from "@expo/ui";
import type { TmuxPane, TmuxSession, TmuxTree, TmuxWindow } from "@remux/protocol";
import {
  ChevronRight,
  Edit3,
  LogOut,
  Plus,
  RefreshCw,
  Server,
  SquareTerminal,
  X
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { clearConnection, loadConnection, saveConnection, type SavedConnection } from "./src/storage";

type IconType = React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
type ExpoIconName = React.ComponentProps<typeof ExpoIcon>["name"];
type RenameTarget = { kind: "session" | "window"; id: string; name: string } | null;

const ENV_SERVER_URL =
  typeof process !== "undefined" ? process.env.EXPO_PUBLIC_REMUX_SERVER_URL?.trim() : undefined;
const DEFAULT_SERVER_URL = ENV_SERVER_URL || (Platform.OS === "android" ? "http://10.0.2.2:8787" : "http://127.0.0.1:8787");

export default function App(): React.ReactElement {
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const [connection, setConnection] = useState<SavedConnection | null>(null);
  const [setupBaseUrl, setSetupBaseUrl] = useState(DEFAULT_SERVER_URL);
  const [setupToken, setSetupToken] = useState("");
  const [tree, setTree] = useState<TmuxTree | null>(null);
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const [terminalStatus, setTerminalStatus] = useState("idle");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSwitcher, setShowSwitcher] = useState(false);
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

  async function disconnect(): Promise<void> {
    await clearConnection();
    setConnection(null);
    setTree(null);
    setSelectedPaneId(null);
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
        <View style={[styles.topBar, wide ? styles.topBarWide : null]}>
          <View style={styles.titleCluster}>
            <Text style={styles.brandSmall}>Remux</Text>
            <Text numberOfLines={1} style={styles.targetText}>
              {selected
                ? `${selected.session.name} / ${selected.window.index}: ${selected.window.name} / ${terminalStatus}`
                : `No window selected / ${terminalStatus}`}
            </Text>
          </View>
          <View style={styles.topActions}>
            {!wide ? <IconButton icon={Server} iosSymbol="server.rack" label="Sessions" onPress={() => setShowSwitcher((value) => !value)} /> : null}
            <IconButton icon={RefreshCw} iosSymbol="arrow.clockwise" label="Refresh" onPress={() => void refreshTree()} />
            <IconButton icon={LogOut} iosSymbol="rectangle.portrait.and.arrow.right" label="Disconnect" onPress={() => void disconnect()} />
          </View>
        </View>

        <View style={[styles.workspace, wide ? styles.workspaceWide : null]}>
          {wide ? (
            <View style={styles.sidebar}>
              <SessionTree
                selectedWindowId={selected?.window.id ?? null}
                tree={tree}
                onCreateSession={() => void createSession()}
                onCreateWindow={() => void createWindow()}
                onRename={setRenameTarget}
                onSelectWindow={selectWindow}
              />
            </View>
          ) : null}

          <View style={styles.primary}>
            <View style={styles.terminalFrame}>
              {loading ? (
                <View style={styles.emptyState}>
                  <ActivityIndicator color={palette.accent} />
                </View>
              ) : terminalUrl && selectedPaneId ? (
                <TerminalPane
                  key={selectedPaneId}
                  paneId={selectedPaneId}
                  wsUrl={terminalUrl}
                  onStatus={setTerminalStatus}
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
            </View>

            {error ? <Text style={styles.errorTextInline}>{error}</Text> : null}
          </View>
        </View>

        {!wide && showSwitcher ? (
          <View style={styles.mobileSwitcher}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Sessions</Text>
              <IconButton icon={X} iosSymbol="xmark" label="Close" onPress={() => setShowSwitcher(false)} />
            </View>
            <SessionTree
              selectedWindowId={selected?.window.id ?? null}
              tree={tree}
              onCreateSession={() => void createSession()}
              onCreateWindow={() => void createWindow()}
              onRename={setRenameTarget}
              onSelectWindow={selectWindow}
            />
          </View>
        ) : null}

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

function SessionTree({
  tree,
  selectedWindowId,
  onCreateSession,
  onCreateWindow,
  onSelectWindow,
  onRename
}: {
  tree: TmuxTree | null;
  selectedWindowId: string | null;
  onCreateSession(): void;
  onCreateWindow(): void;
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
            <TouchableOpacity
              accessibilityLabel={`Rename session ${session.name}`}
              onPress={() => onRename({ kind: "session", id: session.id, name: session.name })}
              style={styles.inlineIcon}
            >
              <AdaptiveIcon fallback={Edit3} iosSymbol="pencil" color={palette.muted} size={14} />
            </TouchableOpacity>
          </View>
          {session.windows.map((window) => (
            <WindowNode
              key={window.id}
              window={window}
              selected={window.id === selectedWindowId}
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
  onRename,
  onSelect
}: {
  window: TmuxWindow;
  selected: boolean;
  onRename(): void;
  onSelect(): void;
}): React.ReactElement {
  return (
    <Pressable onPress={onSelect} style={[styles.windowRow, selected ? styles.windowRowSelected : null]}>
      <View style={styles.windowNameGroup}>
        <AdaptiveIcon fallback={ChevronRight} iosSymbol="chevron.right" color={palette.muted} size={14} />
        <Text numberOfLines={1} style={[styles.windowName, selected ? styles.windowNameSelected : null]}>
          {window.index}: {window.name}
        </Text>
      </View>
      <TouchableOpacity
        accessibilityLabel={`Rename window ${window.name}`}
        onPress={onRename}
        style={styles.inlineIcon}
      >
        <AdaptiveIcon fallback={Edit3} iosSymbol="pencil" color={selected ? palette.accent : palette.muted} size={14} />
      </TouchableOpacity>
    </Pressable>
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
  return (
    <View style={styles.renameOverlay}>
      <View style={styles.renamePanel}>
        <Text style={styles.sheetTitle}>Rename {target.kind}</Text>
        <TextInput
          autoFocus
          onChangeText={setName}
          onSubmitEditing={() => onSubmit(name)}
          selectTextOnFocus
          style={styles.input}
          value={name}
        />
        <View style={styles.renameActions}>
          <Pressable onPress={onCancel} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </Pressable>
          <Pressable onPress={() => onSubmit(name)} style={styles.primaryButtonCompact}>
            <Text style={styles.primaryButtonText}>Save</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function IconButton({
  icon: Icon,
  iosSymbol,
  label,
  danger,
  onPress
}: {
  icon: IconType;
  iosSymbol: ExpoIconName;
  label: string;
  danger?: boolean;
  onPress(): void;
}): React.ReactElement {
  return (
    <TouchableOpacity accessibilityLabel={label} onPress={onPress} style={styles.iconButton}>
      <AdaptiveIcon fallback={Icon} iosSymbol={iosSymbol} color={danger ? palette.danger : palette.text} size={18} />
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
  brandSmall: {
    color: palette.text,
    fontSize: 18,
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
  topBar: {
    alignItems: "center",
    backgroundColor: "rgba(16, 20, 18, 0.72)",
    flexDirection: "row",
    gap: 12,
    left: 0,
    minHeight: 48,
    paddingHorizontal: 10,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 20
  },
  topBarWide: {
    left: 300
  },
  titleCluster: {
    flex: 1,
    minWidth: 0
  },
  targetText: {
    color: palette.muted,
    fontSize: 12,
    marginTop: 2
  },
  topActions: {
    flexDirection: "row",
    gap: 8
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
    backgroundColor: palette.panelStrong,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  sidebar: {
    backgroundColor: palette.panel,
    borderRightColor: palette.line,
    borderRightWidth: 1,
    width: 300
  },
  tree: {
    flex: 1,
    minHeight: 0,
    width: "100%"
  },
  treeContent: {
    padding: 12,
    paddingBottom: 32
  },
  treeHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18
  },
  treeTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: "800"
  },
  treeActions: {
    flexDirection: "row",
    gap: 8
  },
  sessionBlock: {
    marginBottom: 16
  },
  sessionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    marginBottom: 8
  },
  sessionName: {
    color: palette.text,
    flex: 1,
    fontSize: 14,
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
    borderLeftWidth: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 38,
    paddingLeft: 8,
    paddingRight: 2
  },
  windowRowSelected: {
    backgroundColor: palette.panelStrong,
    borderLeftColor: palette.accent
  },
  windowNameGroup: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 4,
    minWidth: 0
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
  mobileSwitcher: {
    backgroundColor: palette.panel,
    borderTopColor: palette.line,
    borderTopWidth: 1,
    bottom: 0,
    height: "58%",
    left: 0,
    position: "absolute",
    right: 0
  },
  sheetHeader: {
    alignItems: "center",
    borderBottomColor: palette.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 46,
    paddingHorizontal: 12
  },
  sheetTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: "800"
  },
  renameOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    padding: 22,
    position: "absolute",
    right: 0,
    top: 0
  },
  renamePanel: {
    backgroundColor: palette.panel,
    borderColor: palette.line,
    borderWidth: 1,
    gap: 12,
    maxWidth: 420,
    padding: 16,
    width: "100%"
  },
  renameActions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end"
  }
});
