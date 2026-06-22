import type {
  CreateSessionRequest,
  CreateWindowRequest,
  HealthResponse,
  Preferences,
  RenameRequest,
  ResizePaneRequest,
  SplitPaneRequest,
  TmuxTree
} from "@telemux/protocol";

export interface TelemuxClientOptions {
  baseUrl: string;
  token?: string;
}

export class TelemuxApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = "TelemuxApiError";
  }
}

export class TelemuxClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(options: TelemuxClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token?.trim() ?? "";
  }

  health(): Promise<HealthResponse> {
    return this.request("/api/health");
  }

  tree(): Promise<TmuxTree> {
    return this.request("/api/tmux/tree");
  }

  createSession(body: CreateSessionRequest = {}): Promise<TmuxTree> {
    return this.request("/api/sessions", { method: "POST", body });
  }

  renameSession(sessionId: string, body: RenameRequest): Promise<TmuxTree> {
    return this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "PATCH", body });
  }

  killSession(sessionId: string): Promise<TmuxTree> {
    return this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  }

  createWindow(body: CreateWindowRequest): Promise<TmuxTree> {
    return this.request("/api/windows", { method: "POST", body });
  }

  renameWindow(windowId: string, body: RenameRequest): Promise<TmuxTree> {
    return this.request(`/api/windows/${encodeURIComponent(windowId)}`, { method: "PATCH", body });
  }

  killWindow(windowId: string): Promise<TmuxTree> {
    return this.request(`/api/windows/${encodeURIComponent(windowId)}`, { method: "DELETE" });
  }

  splitPane(paneId: string, body: SplitPaneRequest): Promise<TmuxTree> {
    return this.request(`/api/panes/${encodeURIComponent(paneId)}/split`, { method: "POST", body });
  }

  resizePane(paneId: string, body: ResizePaneRequest): Promise<TmuxTree> {
    return this.request(`/api/panes/${encodeURIComponent(paneId)}/resize`, { method: "PATCH", body });
  }

  killPane(paneId: string): Promise<TmuxTree> {
    return this.request(`/api/panes/${encodeURIComponent(paneId)}`, { method: "DELETE" });
  }

  preferences(): Promise<Preferences> {
    return this.request("/api/preferences");
  }

  updatePreferences(body: Partial<Preferences>): Promise<Preferences> {
    return this.request("/api/preferences", { method: "PATCH", body });
  }

  terminalWebSocketUrl(paneId: string): string {
    const url = new URL(`${this.baseUrl}/ws/terminal`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("paneId", paneId);
    if (this.token) {
      url.searchParams.set("token", this.token);
    }
    return url.toString();
  }

  treeWebSocketUrl(): string {
    const url = new URL(`${this.baseUrl}/ws/tree`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (this.token) {
      url.searchParams.set("token", this.token);
    }
    return url.toString();
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    const hasBody = options.body !== undefined;
    const headers: Record<string, string> = {};
    if (hasBody) {
      headers["Content-Type"] = "application/json";
    }
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined
    });

    if (!response.ok) {
      let code = "http_error";
      let message = response.statusText;
      try {
        const parsed = (await response.json()) as { error?: { code?: string; message?: string } };
        code = parsed.error?.code ?? code;
        message = parsed.error?.message ?? message;
      } catch {
        // Keep the response status text when the body is not JSON.
      }
      throw new TelemuxApiError(message, response.status, code);
    }

    return response.json() as Promise<T>;
  }
}

export type RemuxClientOptions = TelemuxClientOptions;
export { TelemuxApiError as RemuxApiError, TelemuxClient as RemuxClient };
