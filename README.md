# Remux

Remux is a self-hosted tmux controller for resuming terminal work from web, iOS, and Android clients.

## Quick Start

```bash
npm install
npm run dev:server
npm run dev:client
```

The server defaults to `127.0.0.1:8787`, controls the local tmux socket, and leaves bearer auth disabled when `REMUX_TOKEN` is blank. For remote access, put it behind a VPN/tunnel and start with `REMUX_TOKEN=change-me npm run dev:server`.

## Client Dev

```bash
npm run dev:client
```

Expo serves web, iOS, and Android from `apps/client`. The Android emulator uses `http://10.0.2.2:8787` by default so it can reach the host machine. Override the startup URL for local smoke tests with:

```bash
EXPO_PUBLIC_REMUX_SERVER_URL=http://10.0.2.2:8800 npm --workspace @remux/client run android
```

Leave the token field blank when the server is running with blank `REMUX_TOKEN`.

## Apps

- `apps/server`: Node.js API and WebSocket tmux bridge.
- `apps/client`: Expo app for web, iOS, and Android.

## Packages

- `packages/protocol`: Shared API and WebSocket types.
- `packages/api-client`: Shared typed API client.
- `packages/config`: Shared config helpers.
