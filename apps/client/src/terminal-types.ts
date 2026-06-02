export interface TerminalPaneHandle {
  fit(): void;
  send(data: string): void;
}

export interface TerminalPaneProps {
  paneId: string;
  wsUrl: string;
  onStatus(status: string): void;
  onTreeChanged(): void;
}
