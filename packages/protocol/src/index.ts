export const REMUX_API_VERSION = "0.1.0";

export type TmuxId = string;

export interface TmuxPane {
  id: TmuxId;
  index: number;
  title: string;
  currentPath: string;
  currentCommand: string;
  active: boolean;
  width: number;
  height: number;
  dead: boolean;
  inMode: boolean;
}

export interface TmuxWindow {
  id: TmuxId;
  index: number;
  name: string;
  active: boolean;
  panes: TmuxPane[];
  paneCount: number;
  layout: string;
}

export interface TmuxSession {
  id: TmuxId;
  name: string;
  attached: number;
  createdAt: number;
  windows: TmuxWindow[];
  windowCount: number;
}

export interface TmuxTree {
  sessions: TmuxSession[];
  activePaneId: string | null;
  updatedAt: string;
}

export interface HealthResponse {
  ok: true;
  version: string;
  tmuxVersion: string | null;
}

export interface Preferences {
  lastPaneId: string | null;
  favorites: string[];
  labels: Record<string, string>;
}

export interface CreateSessionRequest {
  name?: string;
}

export interface RenameRequest {
  name: string;
}

export interface CreateWindowRequest {
  sessionId: string;
  name?: string;
}

export interface SplitPaneRequest {
  direction: "horizontal" | "vertical";
}

export interface ResizePaneRequest {
  direction?: "left" | "right" | "up" | "down";
  amount?: number;
  cols?: number;
  rows?: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export type TerminalClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "focus"; paneId: string }
  | { type: "ping"; id: string };

export type TerminalServerMessage =
  | { type: "snapshot"; paneId: string; data: string; cols: number; rows: number }
  | { type: "output"; paneId: string; data: string }
  | { type: "treeChanged" }
  | { type: "paneExited"; paneId: string }
  | { type: "error"; code: string; message: string }
  | { type: "pong"; id: string };
