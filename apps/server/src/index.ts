import cors from "@fastify/cors";
import Fastify from "fastify";
import { readServerConfig } from "@remux/config";
import { initializeAuth } from "./auth.js";
import { MetadataStore } from "./metadata.js";
import { registerRoutes } from "./routes.js";
import { TmuxService } from "./tmux.js";

const config = readServerConfig();
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
