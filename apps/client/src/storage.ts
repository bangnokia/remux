import AsyncStorage from "@react-native-async-storage/async-storage";

export interface SavedConnection {
  baseUrl: string;
  token: string;
}

const CONNECTION_KEY = "remux.connection";

export async function loadConnection(): Promise<SavedConnection | null> {
  const raw = await AsyncStorage.getItem(CONNECTION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SavedConnection>;
    if (typeof parsed.baseUrl === "string" && typeof parsed.token === "string") {
      return { baseUrl: parsed.baseUrl, token: parsed.token };
    }
  } catch {
    return null;
  }

  return null;
}

export async function saveConnection(connection: SavedConnection): Promise<void> {
  await AsyncStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
}

export async function clearConnection(): Promise<void> {
  await AsyncStorage.removeItem(CONNECTION_KEY);
}
