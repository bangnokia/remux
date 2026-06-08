import { DEFAULT_TELEMUX_PORT, readServerConfig } from "@telemux/config";
import { updateServerCli } from "./self-update.js";
import { TELEMUX_SERVER_VERSION } from "./version.js";

const cliOptions = readCliOptions(process.argv.slice(2));
if (cliOptions.action === "help") {
  console.log(usage());
  process.exit(0);
}
if (cliOptions.action === "version") {
  console.log(TELEMUX_SERVER_VERSION);
  process.exit(0);
}
if (cliOptions.action === "update-help") {
  console.log(updateUsage());
  process.exit(0);
}
if (cliOptions.action === "update") {
  await updateServerCli({
    currentVersion: TELEMUX_SERVER_VERSION,
    executablePath: process.argv[1]
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Telemux update failed.");
    process.exit(1);
  });
  process.exit(0);
}

await startServer(cliOptions.env);

type CliAction = "serve" | "help" | "version" | "update" | "update-help";

interface CliOptions {
  action: CliAction;
  env: NodeJS.ProcessEnv;
}

function readCliOptions(args: string[]): CliOptions {
  const env: NodeJS.ProcessEnv = {};

  if (args[0] === "update") {
    if (args.length === 1) {
      return { action: "update", env };
    }
    if (args.length === 2 && (args[1] === "--help" || args[1] === "-h")) {
      return { action: "update-help", env };
    }

    console.error(`Unknown update option: ${args.slice(1).join(" ")}`);
    console.error(updateUsage());
    process.exit(1);
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return { action: "help", env };
    }

    if (arg === "--version") {
      return { action: "version", env };
    }

    if (arg === "--no-auth") {
      env.TELEMUX_TOKEN = "";
      continue;
    }

    const [flag, inlineValue] = splitFlag(arg);
    const value = inlineValue ?? args[index + 1];

    switch (flag) {
      case "--host":
        env.TELEMUX_HOST = readCliValue(flag, value);
        index += inlineValue === undefined ? 1 : 0;
        break;
      case "--port":
        env.TELEMUX_PORT = readCliValue(flag, value);
        index += inlineValue === undefined ? 1 : 0;
        break;
      case "--token":
        env.TELEMUX_TOKEN = readCliValue(flag, value);
        index += inlineValue === undefined ? 1 : 0;
        break;
      case "--db-path":
        env.TELEMUX_DB_PATH = readCliValue(flag, value);
        index += inlineValue === undefined ? 1 : 0;
        break;
      case "--tmux-socket":
        env.TELEMUX_TMUX_SOCKET = readCliValue(flag, value);
        index += inlineValue === undefined ? 1 : 0;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        console.error(usage());
        process.exit(1);
    }
  }

  return { action: "serve", env };
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
  return `Telemux server

Usage:
  telemux-server [options]
  telemux-server update

Options:
  --host <host>          Host to bind. Default: 127.0.0.1
  --port <port>          Port to listen on. Default: ${DEFAULT_TELEMUX_PORT}
  --token <token>        Bearer token required by clients.
  --no-auth              Disable bearer auth. Only use behind a trusted tunnel.
  --db-path <path>       Metadata database path. Default: ~/.telemux/telemux.db
  --tmux-socket <name>   tmux socket name, passed as tmux -L <name>.
  --version              Show CLI version.
  -h, --help             Show this help.

Commands:
  update                 Replace this CLI with the latest GitHub release asset.

Environment variables with the same behavior:
  TELEMUX_HOST, TELEMUX_PORT, TELEMUX_TOKEN, TELEMUX_DB_PATH, TELEMUX_TMUX_SOCKET

Backward-compatible REMUX_* aliases are still accepted.
`;
}

function updateUsage(): string {
  return `Telemux server update

Usage:
  telemux-server update

Downloads the latest telemux-server-node24.tar.gz asset from the GitHub release page and replaces the current CLI file.
`;
}

async function startServer(env: NodeJS.ProcessEnv): Promise<void> {
  const { default: cors } = await import("@fastify/cors");
  const { default: Fastify } = await import("fastify");
  const { initializeAuth } = await import("./auth.js");
  const { MetadataStore } = await import("./metadata.js");
  const { registerRoutes } = await import("./routes.js");
  const { TmuxService } = await import("./tmux.js");

  const config = readServerConfig({ ...process.env, ...env });
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
    app.log.warn("Telemux bearer auth is disabled. Set TELEMUX_TOKEN to require a token.");
  } else if (auth.generatedToken) {
    app.log.warn(`Generated TELEMUX bearer token: ${auth.generatedToken}`);
    app.log.warn("Store this token now or restart with TELEMUX_TOKEN to rotate it.");
  }

  app.log.info(`Telemux server listening on http://${config.host}:${config.port}`);
}
