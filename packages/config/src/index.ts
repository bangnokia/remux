export interface ServerConfig {
  host: string;
  port: number;
  databasePath: string;
  token: string;
  tmuxSocketName: string | null;
}

export const DEFAULT_REMUX_PORT = 14441;

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env.REMUX_HOST ?? "127.0.0.1",
    port: readPort(env.REMUX_PORT, DEFAULT_REMUX_PORT),
    databasePath: env.REMUX_DB_PATH ?? "~/.remux/remux.db",
    token: env.REMUX_TOKEN ?? "",
    tmuxSocketName: env.REMUX_TMUX_SOCKET ?? null
  };
}

function readPort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return parsed;
}
