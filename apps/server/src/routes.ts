import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import type { AuthState } from "./auth.js";
import { requireAuth } from "./auth.js";
import { badRequest, HttpError } from "./errors.js";
import type { MetadataStore } from "./metadata.js";
import { TerminalBridge } from "./control-mode.js";
import type { TmuxService } from "./tmux.js";
import { TELEMUX_API_VERSION } from "@telemux/protocol";
import type { TreeClientMessage, TreeServerMessage, TmuxTree } from "@telemux/protocol";
import type { RawData, WebSocket } from "ws";

interface RouteContext {
  auth: AuthState;
  metadata: MetadataStore;
  tmux: TmuxService;
}

const TREE_REFRESH_MS = 3000;

export async function registerRoutes(app: FastifyInstance, context: RouteContext): Promise<void> {
  await app.register(websocket);
  const treeBroadcaster = new TreeBroadcaster(context);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      void reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message
        }
      });
      return;
    }

    void reply.code(500).send({
      error: {
        code: "internal_error",
        message: error instanceof Error ? error.message : "Internal server error"
      }
    });
  });

  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/api/") && !(await requireAuth(request, reply, context.auth))) {
      return reply;
    }
  });

  app.get("/api/health", async () => ({
    ok: true,
    version: TELEMUX_API_VERSION,
    tmuxVersion: await context.tmux.version()
  }));

  app.get("/api/tmux/tree", async () => context.tmux.tree(context.metadata.getPreferences().lastPaneId));

  app.post("/api/sessions", async (request) => {
    const body = readBody<{ name?: unknown }>(request);
    const paneId = await context.tmux.createSession(readOptionalName(body.name));
    const tree = await context.tmux.tree(paneId ?? context.metadata.getPreferences().lastPaneId);
    treeBroadcaster.publish(tree);
    return tree;
  });

  app.patch("/api/sessions/:sessionId", async (request) => {
    const { sessionId } = readParams<{ sessionId: string }>(request);
    const body = readBody<{ name?: unknown }>(request);
    await context.tmux.renameSession(sessionId, readRequiredName(body.name));
    const tree = await context.tmux.tree(context.metadata.getPreferences().lastPaneId);
    treeBroadcaster.publish(tree);
    return tree;
  });

  app.delete("/api/sessions/:sessionId", async (request) => {
    const { sessionId } = readParams<{ sessionId: string }>(request);
    await context.tmux.killSession(sessionId);
    const tree = await context.tmux.tree(null);
    treeBroadcaster.publish(tree);
    return tree;
  });

  app.post("/api/windows", async (request) => {
    const body = readBody<{ sessionId?: unknown; name?: unknown }>(request);
    if (typeof body.sessionId !== "string") {
      throw badRequest("sessionId is required", "missing_session_id");
    }
    const paneId = await context.tmux.createWindow(body.sessionId, readOptionalName(body.name));
    const tree = await context.tmux.tree(paneId ?? context.metadata.getPreferences().lastPaneId);
    treeBroadcaster.publish(tree);
    return tree;
  });

  app.patch("/api/windows/:windowId", async (request) => {
    const { windowId } = readParams<{ windowId: string }>(request);
    const body = readBody<{ name?: unknown }>(request);
    await context.tmux.renameWindow(windowId, readRequiredName(body.name));
    const tree = await context.tmux.tree(context.metadata.getPreferences().lastPaneId);
    treeBroadcaster.publish(tree);
    return tree;
  });

  app.delete("/api/windows/:windowId", async (request) => {
    const { windowId } = readParams<{ windowId: string }>(request);
    await context.tmux.killWindow(windowId);
    const tree = await context.tmux.tree(context.metadata.getPreferences().lastPaneId);
    treeBroadcaster.publish(tree);
    return tree;
  });

  app.post("/api/panes/:paneId/split", async (request) => {
    const { paneId } = readParams<{ paneId: string }>(request);
    const body = readBody<{ direction?: unknown }>(request);
    const direction = body.direction === "vertical" ? "vertical" : "horizontal";
    await context.tmux.splitPane(paneId, direction);
    const tree = await context.tmux.tree(paneId);
    treeBroadcaster.publish(tree);
    return tree;
  });

  app.patch("/api/panes/:paneId/resize", async (request) => {
    const { paneId } = readParams<{ paneId: string }>(request);
    const body = readBody<{
      direction?: "left" | "right" | "up" | "down";
      amount?: number;
      cols?: number;
      rows?: number;
    }>(request);
    await context.tmux.resizePane(paneId, body);
    const tree = await context.tmux.tree(paneId);
    treeBroadcaster.publish(tree);
    return tree;
  });

  app.delete("/api/panes/:paneId", async (request) => {
    const { paneId } = readParams<{ paneId: string }>(request);
    await context.tmux.killPane(paneId);
    const tree = await context.tmux.tree(null);
    treeBroadcaster.publish(tree);
    return tree;
  });

  app.get("/api/preferences", async () => context.metadata.getPreferences());

  app.patch("/api/preferences", async (request) => {
    const body = readBody<Record<string, unknown>>(request);
    return context.metadata.updatePreferences({
      lastPaneId: typeof body.lastPaneId === "string" || body.lastPaneId === null ? body.lastPaneId : undefined,
      favorites: Array.isArray(body.favorites) ? body.favorites.filter((item): item is string => typeof item === "string") : undefined,
      labels:
        body.labels && typeof body.labels === "object" && !Array.isArray(body.labels)
          ? (body.labels as Record<string, string>)
          : undefined
    });
  });

  app.get("/ws/terminal", { websocket: true }, async (socket, request) => {
    const token = readTokenFromWebSocketRequest(request);
    if (!context.auth.verifyToken(token)) {
      socket.close(1008, "unauthorized");
      return;
    }

    const paneId = readPaneIdFromRequest(request);
    if (!paneId) {
      socket.close(1008, "paneId required");
      return;
    }

    try {
      const target = await context.tmux.findPane(paneId);
      const bridge = new TerminalBridge(socket, context.tmux, context.metadata, {
        paneId,
        sessionId: target.sessionId
      });
      await bridge.start();
    } catch (error) {
      socket.send(
        JSON.stringify({
          type: "error",
          code: "terminal_attach_failed",
          message: error instanceof Error ? error.message : "Unable to attach terminal"
        })
      );
      socket.close(1011, "attach failed");
    }
  });

  app.get("/ws/tree", { websocket: true }, async (socket, request) => {
    const token = readTokenFromWebSocketRequest(request);
    if (!context.auth.verifyToken(token)) {
      socket.close(1008, "unauthorized");
      return;
    }

    treeBroadcaster.add(socket);
  });
}

class TreeBroadcaster {
  private readonly sockets = new Set<WebSocket>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastSignature: string | null = null;
  private refreshInFlight = false;

  constructor(private readonly context: RouteContext) {}

  add(socket: WebSocket): void {
    this.sockets.add(socket);
    socket.on("message", (data) => this.handleMessage(socket, data));
    socket.on("close", () => this.delete(socket));
    socket.on("error", () => this.delete(socket));
    this.start();
    void this.refresh({ force: true });
  }

  publish(tree: TmuxTree): void {
    this.sendTreeIfChanged(tree, { force: true });
  }

  private delete(socket: WebSocket): void {
    this.sockets.delete(socket);
    if (this.sockets.size === 0) {
      this.stop();
    }
  }

  private start(): void {
    if (this.interval) {
      return;
    }

    this.interval = setInterval(() => {
      void this.refresh();
    }, TREE_REFRESH_MS);
  }

  private stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.lastSignature = null;
  }

  private async refresh(options: { force?: boolean } = {}): Promise<void> {
    if (this.refreshInFlight || this.sockets.size === 0) {
      return;
    }

    this.refreshInFlight = true;
    try {
      const tree = await this.context.tmux.tree(this.context.metadata.getPreferences().lastPaneId);
      this.sendTreeIfChanged(tree, options);
    } catch (error) {
      this.broadcast({
        type: "error",
        code: "tree_refresh_failed",
        message: error instanceof Error ? error.message : "Unable to refresh tmux tree"
      });
    } finally {
      this.refreshInFlight = false;
    }
  }

  private sendTreeIfChanged(tree: TmuxTree, options: { force?: boolean } = {}): void {
    if (this.sockets.size === 0) {
      return;
    }

    const signature = treeSignature(tree);
    if (!options.force && signature === this.lastSignature) {
      return;
    }

    this.lastSignature = signature;
    this.broadcast({ type: "tree", tree });
  }

  private handleMessage(socket: WebSocket, data: RawData): void {
    let message: TreeClientMessage;
    try {
      message = JSON.parse(rawDataToString(data)) as TreeClientMessage;
    } catch {
      sendTreeMessage(socket, { type: "error", code: "invalid_message", message: "Tree message must be JSON" });
      return;
    }

    if (message.type === "ping") {
      sendTreeMessage(socket, { type: "pong", id: message.id });
    }
  }

  private broadcast(message: TreeServerMessage): void {
    for (const socket of this.sockets) {
      sendTreeMessage(socket, message);
    }
  }
}

function readBody<T>(request: FastifyRequest): T {
  return (request.body ?? {}) as T;
}

function readParams<T>(request: FastifyRequest): T {
  return request.params as T;
}

function readRequiredName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest("name is required", "missing_name");
  }
  return value.trim();
}

function readOptionalName(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw badRequest("name must be a string", "invalid_name");
  }

  return value.trim() || undefined;
}

function readTokenFromWebSocketRequest(request: FastifyRequest): string | null {
  const queryToken = (request.query as { token?: unknown }).token;
  if (typeof queryToken === "string") {
    return queryToken;
  }

  const header = request.headers.authorization;
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" ? token ?? null : null;
}

function readPaneIdFromRequest(request: FastifyRequest): string | null {
  const queryPaneId = (request.query as { paneId?: unknown }).paneId;
  return typeof queryPaneId === "string" && queryPaneId ? queryPaneId : null;
}

function sendTreeMessage(socket: WebSocket, message: TreeServerMessage): void {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

function treeSignature(tree: TmuxTree): string {
  return JSON.stringify({
    ...tree,
    updatedAt: undefined
  });
}

function rawDataToString(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return data.toString("utf8");
}
