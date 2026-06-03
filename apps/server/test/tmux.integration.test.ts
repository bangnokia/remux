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

    await tmux.createSession("telemux_test");
    const tree = await tmux.tree();

    expect(tree.sessions).toHaveLength(1);
    expect(tree.sessions[0].name).toBe("telemux_test");
    expect(tree.sessions[0].windows[0].panes[0].id).toMatch(/^%/);
  });
});
