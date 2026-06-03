export interface ServerConfig {
  host: string;
  port: number;
  databasePath: string;
  token: string;
  tmuxSocketName: string | null;
}

export const DEFAULT_TELEMUX_PORT = 14441;
export const DEFAULT_REMUX_PORT = DEFAULT_TELEMUX_PORT;

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env.TELEMUX_HOST ?? env.REMUX_HOST ?? "127.0.0.1",
    port: readPort(env.TELEMUX_PORT ?? env.REMUX_PORT, DEFAULT_TELEMUX_PORT),
    databasePath: env.TELEMUX_DB_PATH ?? env.REMUX_DB_PATH ?? "~/.telemux/telemux.db",
    token: env.TELEMUX_TOKEN ?? env.REMUX_TOKEN ?? "",
    tmuxSocketName: env.TELEMUX_TMUX_SOCKET ?? env.REMUX_TMUX_SOCKET ?? null
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
