export interface TerminalPaneHandle {
  dismissKeyboard(): void;
  fit(): void;
  focusKeyboard(): void;
  send(data: string): void;
  sendInput(data: string): void;
}

export interface TerminalPaneProps {
  active?: boolean;
  paneId: string;
  wsUrl: string;
  onStatus(status: string): void;
  onTreeChanged(): void;
}
