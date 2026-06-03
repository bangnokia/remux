import AsyncStorage from "@react-native-async-storage/async-storage";

export interface SavedConnection {
  id: string;
  label: string;
  host: string;
  port: string;
  baseUrl: string;
  token: string;
}

const CONNECTION_KEY = "remux.connection";
const CONNECTIONS_KEY = "remux.connections.v1";

export async function loadConnections(): Promise<SavedConnection[]> {
  const raw = await AsyncStorage.getItem(CONNECTIONS_KEY);
  const storedConnections = parseConnections(raw);
  if (storedConnections.length > 0) {
    return storedConnections;
  }

  const legacyConnection = await loadLegacyConnection();
  if (!legacyConnection) {
    return [];
  }

  await saveConnections([legacyConnection]);
  await AsyncStorage.removeItem(CONNECTION_KEY);
  return [legacyConnection];
}

export async function saveConnection(
  connection: SavedConnection,
  existingConnections: SavedConnection[]
): Promise<SavedConnection[]> {
  const nextConnections = [
    connection,
    ...existingConnections.filter((item) => item.id !== connection.id)
  ];
  await saveConnections(nextConnections);
  return nextConnections;
}

export async function deleteConnection(
  connectionId: string,
  existingConnections: SavedConnection[]
): Promise<SavedConnection[]> {
  const nextConnections = existingConnections.filter((item) => item.id !== connectionId);
  await saveConnections(nextConnections);
  return nextConnections;
}

export async function clearConnections(): Promise<void> {
  await AsyncStorage.multiRemove([CONNECTION_KEY, CONNECTIONS_KEY]);
}

async function saveConnections(connections: SavedConnection[]): Promise<void> {
  await AsyncStorage.setItem(CONNECTIONS_KEY, JSON.stringify(connections));
}

async function loadLegacyConnection(): Promise<SavedConnection | null> {
  const raw = await AsyncStorage.getItem(CONNECTION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { baseUrl?: unknown; token?: unknown };
    if (typeof parsed.baseUrl === "string" && typeof parsed.token === "string") {
      return connectionFromBaseUrl(parsed.baseUrl, parsed.token);
    }
  } catch {
    return null;
  }

  return null;
}

function parseConnections(raw: string | null): SavedConnection[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      const connection = parseConnection(item);
      return connection ? [connection] : [];
    });
  } catch {
    return [];
  }
}

function parseConnection(value: unknown): SavedConnection | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Partial<SavedConnection>;
  if (
    typeof item.id !== "string" ||
    typeof item.label !== "string" ||
    typeof item.host !== "string" ||
    typeof item.port !== "string" ||
    typeof item.baseUrl !== "string" ||
    typeof item.token !== "string"
  ) {
    return null;
  }

  return {
    id: item.id,
    label: item.label,
    host: item.host,
    port: item.port,
    baseUrl: item.baseUrl,
    token: item.token
  };
}

function connectionFromBaseUrl(baseUrl: string, token: string): SavedConnection | null {
  try {
    const url = new URL(baseUrl);
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    const host = url.hostname;
    return {
      id: `${host}:${port}`,
      label: host,
      host,
      port,
      baseUrl: url.origin,
      token
    };
  } catch {
    return null;
  }
}
