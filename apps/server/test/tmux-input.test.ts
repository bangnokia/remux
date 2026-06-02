import { describe, expect, it } from "vitest";
import { terminalInputToSendKeysArgs } from "../src/tmux.js";

describe("terminalInputToSendKeysArgs", () => {
  it("keeps text literal and sends Enter as a tmux key", () => {
    expect(terminalInputToSendKeysArgs("%1", "whoami\r")).toEqual([
      ["send-keys", "-l", "-t", "%1", "whoami"],
      ["send-keys", "-t", "%1", "Enter"]
    ]);
  });

  it("treats CRLF as a single Enter", () => {
    expect(terminalInputToSendKeysArgs("%1", "pwd\r\n")).toEqual([
      ["send-keys", "-l", "-t", "%1", "pwd"],
      ["send-keys", "-t", "%1", "Enter"]
    ]);
  });

  it("maps common terminal control sequences to tmux keys", () => {
    expect(terminalInputToSendKeysArgs("%1", "\u001b[A\u001b[B\u007f\u0003")).toEqual([
      ["send-keys", "-t", "%1", "Up"],
      ["send-keys", "-t", "%1", "Down"],
      ["send-keys", "-t", "%1", "BSpace"],
      ["send-keys", "-t", "%1", "C-c"]
    ]);
  });
});
