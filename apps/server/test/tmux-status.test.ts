import { describe, expect, it } from "vitest";
import { classifyPaneStatus, windowDisplayNameFromCurrentPath } from "../src/tmux.js";

const basePane = {
  currentCommand: "zsh",
  dead: false,
  inMode: false
};

describe("classifyPaneStatus", () => {
  it("marks shells as idle", () => {
    expect(classifyPaneStatus(basePane).kind).toBe("idle");
  });

  it("marks foreground non-shell commands as running", () => {
    expect(classifyPaneStatus({ ...basePane, currentCommand: "vim" }).kind).toBe("running");
  });

  it("detects working Codex screens", () => {
    const status = classifyPaneStatus({ ...basePane, currentCommand: "codex" }, "Thinking\nEsc to interrupt");

    expect(status).toMatchObject({ agent: "codex", kind: "working" });
  });

  it("detects blocked Claude screens", () => {
    const status = classifyPaneStatus({ ...basePane, currentCommand: "claude" }, "Permission required. Allow this command?");

    expect(status).toMatchObject({ agent: "claude", kind: "blocked" });
  });

  it("detects idle agent screens", () => {
    const status = classifyPaneStatus({ ...basePane, currentCommand: "pi" }, "What would you like to do?");

    expect(status).toMatchObject({ agent: "pi", kind: "idle" });
  });

  it("does not keep Pi working because stale scrollback mentioned running", () => {
    const status = classifyPaneStatus(
      { ...basePane, currentCommand: "pi" },
      [
        "Restart browser after N pages if crawling long-running jobs.",
        "That keeps it faster, cheaper, and more reliable.",
        "",
        "~/Code",
        "↑211k ↓11k R478k CH97.8% 12.0%/272k (auto)  gpt"
      ].join("\n")
    );

    expect(status).toMatchObject({ agent: "pi", kind: "idle" });
  });

  it("marks dead panes as dead", () => {
    expect(classifyPaneStatus({ ...basePane, dead: true }).kind).toBe("dead");
  });
});

describe("windowDisplayNameFromCurrentPath", () => {
  it("uses the current folder name", () => {
    expect(windowDisplayNameFromCurrentPath("/home/dau/Code/telemux", "zsh")).toBe("telemux");
  });

  it("handles trailing slashes", () => {
    expect(windowDisplayNameFromCurrentPath("/home/dau/Code/project/", "zsh")).toBe("project");
  });

  it("falls back when tmux does not report a path", () => {
    expect(windowDisplayNameFromCurrentPath("", "zsh")).toBe("zsh");
  });
});
