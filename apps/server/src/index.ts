import cors from "@fastify/cors";
import Fastify from "fastify";
import { DEFAULT_REMUX_PORT, readServerConfig } from "@remux/config";
import { initializeAuth } from "./auth.js";
import { MetadataStore } from "./metadata.js";
import { registerRoutes } from "./routes.js";
import { TmuxService } from "./tmux.js";

const cliOptions = readCliOptions(process.argv.slice(2));
if (cliOptions.help) {
  console.log(usage());
  process.exit(0);
}

const config = readServerConfig({ ...process.env, ...cliOptions.env });
const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  credentials: false
});

const metadata = new MetadataStore(config.databasePath);
const auth = initializeAuth(metadata, config.token);
const tmux = new TmuxService(config.tmuxSocketName);

await registerRoutes(app, { auth, metadata, tmux });

await app.listen({ host: config.host, port: config.port });

if (!auth.authRequired) {
  app.log.warn("Remux bearer auth is disabled. Set REMUX_TOKEN to require a token.");
} else if (auth.generatedToken) {
  app.log.warn(`Generated REMUX bearer token: ${auth.generatedToken}`);
  app.log.warn("Store this token now or restart with REMUX_TOKEN to rotate it.");
}

app.log.info(`Remux server listening on http://${config.host}:${config.port}`);

interface CliOptions {
  help: boolean;
  env: NodeJS.ProcessEnv;
}

function readCliOptions(args: string[]): CliOptions {
  const env: NodeJS.ProcessEnv = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return { help: true, env };
    }

    if (arg === "--no-auth") {
      env.REMUX_TOKEN = "";
      continue;
    }

    const [flag, inlineValue] = splitFlag(arg);
    const value = inlineValue ?? args[index + 1];

    switch (flag) {
      case "--host":
        env.REMUX_HOST = readCliValue(flag, value);
        index += inlineValue === undefined ? 1 : 0;
        break;
      case "--port":
        env.REMUX_PORT = readCliValue(flag, value);
        index += inlineValue === undefined ? 1 : 0;
        break;
      case "--token":
        env.REMUX_TOKEN = readCliValue(flag, value);
        index += inlineValue === undefined ? 1 : 0;
        break;
      case "--db-path":
        env.REMUX_DB_PATH = readCliValue(flag, value);
        index += inlineValue === undefined ? 1 : 0;
        break;
      case "--tmux-socket":
        env.REMUX_TMUX_SOCKET = readCliValue(flag, value);
        index += inlineValue === undefined ? 1 : 0;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        console.error(usage());
        process.exit(1);
    }
  }

  return { help: false, env };
}

function splitFlag(arg: string): [flag: string, value: string | undefined] {
  const separatorIndex = arg.indexOf("=");
  if (separatorIndex === -1) {
    return [arg, undefined];
  }

  return [arg.slice(0, separatorIndex), arg.slice(separatorIndex + 1)];
}

function readCliValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    console.error(`${flag} requires a value.`);
    console.error(usage());
    process.exit(1);
  }

  return value;
}

function usage(): string {
  return `Remux server

Usage:
  remux-server [options]

Options:
  --host <host>          Host to bind. Default: 127.0.0.1
  --port <port>          Port to listen on. Default: ${DEFAULT_REMUX_PORT}
  --token <token>        Bearer token required by clients.
  --no-auth              Disable bearer auth. Only use behind a trusted tunnel.
  --db-path <path>       Metadata database path. Default: ~/.remux/remux.db
  --tmux-socket <name>   tmux socket name, passed as tmux -L <name>.
  -h, --help             Show this help.

Environment variables with the same behavior:
  REMUX_HOST, REMUX_PORT, REMUX_TOKEN, REMUX_DB_PATH, REMUX_TMUX_SOCKET
`;
}
