import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import type { Preferences } from "@telemux/protocol";

const DEFAULT_PREFERENCES: Preferences = {
  lastPaneId: null,
  favorites: [],
  labels: {}
};

export class MetadataStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    const path = expandPath(databasePath);
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  }

  getString(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM metadata WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setString(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  deleteString(key: string): void {
    this.db.prepare("DELETE FROM metadata WHERE key = ?").run(key);
  }

  getPreferences(): Preferences {
    const raw = this.getString("preferences");
    if (!raw) {
      return DEFAULT_PREFERENCES;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<Preferences>;
      return normalizePreferences(parsed);
    } catch {
      return DEFAULT_PREFERENCES;
    }
  }

  updatePreferences(next: Partial<Preferences>): Preferences {
    const preferences = normalizePreferences({ ...this.getPreferences(), ...next });
    this.setString("preferences", JSON.stringify(preferences));
    return preferences;
  }
}

function normalizePreferences(value: Partial<Preferences>): Preferences {
  return {
    lastPaneId: typeof value.lastPaneId === "string" ? value.lastPaneId : null,
    favorites: Array.isArray(value.favorites)
      ? value.favorites.filter((item): item is string => typeof item === "string")
      : [],
    labels: value.labels && typeof value.labels === "object" && !Array.isArray(value.labels) ? value.labels : {}
  };
}

function expandPath(path: string): string {
  if (path === "~") {
    return homedir();
  }

  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }

  return resolve(path);
}
