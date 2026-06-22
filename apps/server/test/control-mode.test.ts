import { describe, expect, it } from "vitest";
import {
  decodeTmuxOutput,
  formatSnapshotForTerminal,
  isTreeChangeNotification,
  stripTerminalStringControls,
  TerminalBridge,
  TerminalOutputSanitizer
} from "../src/control-mode.js";

describe("decodeTmuxOutput", () => {
  it("decodes tmux octal escapes", () => {
    expect(decodeTmuxOutput("hello\\012world\\033[31m")).toBe("hello\nworld\u001b[31m");
  });

  it("preserves escaped backslashes", () => {
    expect(decodeTmuxOutput("a\\\\b")).toBe("a\\b");
  });
});

describe("stripTerminalStringControls", () => {
  it("strips OSC strings terminated by BEL or ST", () => {
    expect(stripTerminalStringControls("a\u001b]7;file://host/tmp\u0007b")).toBe("ab");
    expect(stripTerminalStringControls("a\u001b]0;title\u001b\\b")).toBe("ab");
  });

  it("strips xterm title strings", () => {
    expect(stripTerminalStringControls("a\u001bkprintf\u001b\\b")).toBe("ab");
  });

  it("strips DCS, PM, SOS, and APC strings", () => {
    expect(stripTerminalStringControls("a\u001bPpayload\u001b\\b")).toBe("ab");
    expect(stripTerminalStringControls("a\u001b^payload\u001b\\b")).toBe("ab");
    expect(stripTerminalStringControls("a\u001bXpayload\u001b\\b")).toBe("ab");
    expect(stripTerminalStringControls("a\u001b_payload\u001b\\b")).toBe("ab");
  });

  it("preserves normal CSI terminal controls", () => {
    expect(stripTerminalStringControls("a\u001b[31mred\u001b[0m\u001b[2K")).toBe("a\u001b[31mred\u001b[0m\u001b[2K");
  });

  it("strips split string controls across chunks", () => {
    const sanitizer = new TerminalOutputSanitizer();

    expect(sanitizer.sanitize("a\u001b]7;file://host")).toBe("a");
    expect(sanitizer.sanitize("/tmp\u001b\\b")).toBe("b");
  });

  it("preserves split non-string escape sequences", () => {
    const sanitizer = new TerminalOutputSanitizer();

    expect(sanitizer.sanitize("a\u001b")).toBe("a");
    expect(sanitizer.sanitize("[31mred")).toBe("\u001b[31mred");
  });
});

describe("formatSnapshotForTerminal", () => {
  it("moves the terminal cursor to the tmux cursor position", () => {
    expect(formatSnapshotForTerminal("prompt\n\n", 6, 2)).toBe("prompt\n\u001b[3;7H");
  });

  it("does not append invalid cursor positions", () => {
    expect(formatSnapshotForTerminal("prompt", -1, 2)).toBe("prompt");
  });

  it("removes the final capture newline so the snapshot does not scroll before cursor placement", () => {
    expect(formatSnapshotForTerminal("line 1\nprompt\n", 6, 1)).toBe("line 1\nprompt\u001b[2;7H");
  });
});

describe("TerminalBridge snapshots", () => {
  it("waits for tmux to report the WebSocket viewport size before capturing", async () => {
    const sentMessages: unknown[] = [];
    const calls: string[] = [];
    let paneSizeCalls = 0;
    const socket = {
      OPEN: 1,
      readyState: 1,
      send(data: string) {
        sentMessages.push(JSON.parse(data));
      }
    };
    const bridge = new TerminalBridge(
      socket as never,
      {
        capturePane: async () => {
          calls.push("capture");
          return "prompt\n";
        },
        paneSize: async () => {
          calls.push("size");
          paneSizeCalls += 1;
          return paneSizeCalls === 1
            ? { cols: 160, rows: 48, cursorX: 0, cursorY: 0 }
            : { cols: 44, rows: 16, cursorX: 6, cursorY: 0 };
        }
      } as never,
      { updatePreferences: () => undefined } as never,
      { paneId: "%1", sessionId: "$1" }
    );

    bridge["clientCols"] = 44;
    bridge["clientRows"] = 16;
    await bridge["sendSnapshot"]({ waitForResize: true });

    expect(calls).toEqual(["size", "size", "capture"]);
    expect(sentMessages).toEqual([
      {
        type: "snapshot",
        paneId: "%1",
        data: "prompt\u001b[1;7H",
        cols: 44,
        rows: 16
      }
    ]);
  });
});

describe("isTreeChangeNotification", () => {
  it("detects tmux notifications that mean pane or window state changed", () => {
    expect(isTreeChangeNotification("%layout-change @0 b25d,80x24,0,0,0 b25d,80x24,0,0,0 *")).toBe(true);
    expect(isTreeChangeNotification("%unlinked-window-close @1")).toBe(true);
    expect(isTreeChangeNotification("%pane-exited %1")).toBe(true);
    expect(isTreeChangeNotification("%pane-died %1")).toBe(true);
    expect(isTreeChangeNotification("%output %1 hello")).toBe(false);
  });
});
