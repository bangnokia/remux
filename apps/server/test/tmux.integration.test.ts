import { execFileSync } from "node:child_process";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { TmuxService } from "../src/tmux.js";

let hasTmux = false;
const sockets: string[] = [];

beforeAll(() => {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    hasTmux = true;
  } catch {
    hasTmux = false;
  }
});

afterEach(() => {
  for (const socketName of sockets.splice(0)) {
    try {
      execFileSync("tmux", ["-L", socketName, "kill-server"], { stdio: "ignore" });
    } catch {
      // The tmux server may already be gone.
    }
  }
});

describe.runIf(() => hasTmux)("TmuxService", () => {
  it("creates and inspects sessions on an isolated socket", async () => {
    const socketName = `telemux-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sockets.push(socketName);
    const tmux = new TmuxService(socketName);

    expect((await tmux.tree()).sessions).toHaveLength(0);

    const firstPaneId = await tmux.createSession("telemux_test");
    const tree = await tmux.tree();

    expect(tree.sessions).toHaveLength(1);
    expect(tree.sessions[0].name).toBe("telemux_test");
    expect(tree.sessions[0].windows[0].panes[0].id).toMatch(/^%/);
    expect(firstPaneId).toBe(tree.sessions[0].windows[0].panes[0].id);
  });

  it("returns the new pane id when creating a window", async () => {
    const socketName = `telemux-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sockets.push(socketName);
    const tmux = new TmuxService(socketName);

    await tmux.createSession("telemux_test");
    const initialTree = await tmux.tree();
    const sessionId = initialTree.sessions[0].id;
    const paneId = await tmux.createWindow(sessionId);
    const tree = await tmux.tree(paneId);

    expect(paneId).toMatch(/^%/);
    expect(tree.activePaneId).toBe(paneId);
    expect(tree.sessions[0].windows).toHaveLength(2);
    expect(tree.sessions[0].windows.some((window) => window.panes.some((pane) => pane.id === paneId))).toBe(true);
  });
});
