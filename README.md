# Remux

Remux is a self-hosted tmux controller for resuming terminal work from web, iOS, and Android clients.

## What You Need

- A server or laptop that can run `tmux`.
- Node.js 24 or newer on the server.
- Network reachability from the phone to the server. Tailscale, WireGuard, or another private VPN is recommended.
- The Android APK and server CLI assets from the latest GitHub Release.

The server controls tmux on the same machine where it runs. If you already have tmux sessions there, Remux can reuse them.

## Download Builds

GitHub Actions publishes build outputs to the `latest` GitHub Release on every push to `main` and on manual runs.

Download from:

```text
https://github.com/bangnokia/remux/releases/latest
```

Release assets:

- `remux-android-release.apk`: Android APK.
- `remux-android-release.apk.sha256`: Android APK SHA-256 checksum.
- `remux-server-node24.tar.gz`: standalone Node 24 server CLI.
- `remux-server-node24.tar.gz.sha256`: server CLI SHA-256 checksum.

You can also build them locally:

```bash
npm ci
npm run build:server:standalone
npm run build:android:apk
```

Local outputs:

- Server CLI: `dist/remux-server.mjs`
- Android release APK: `apps/client/android/app/build/outputs/apk/release/*.apk`

## Server Setup

Install `tmux` and Node.js 24 on the server.

Ubuntu/Debian example:

```bash
sudo apt update
sudo apt install -y tmux curl
node --version
tmux -V
```

Download `remux-server-node24.tar.gz` from the latest GitHub Release, then unpack it on the server:

```bash
mkdir -p ~/remux
tar -xzf remux-server-node24.tar.gz -C ~/remux
chmod +x ~/remux/remux-server.mjs
```

Start Remux on all interfaces with a token:

```bash
~/remux/remux-server.mjs \
  --host 0.0.0.0 \
  --port 8787 \
  --token "change-this-token"
```

The server URL for the Android app will be:

```text
http://SERVER_IP_OR_TAILSCALE_IP:8787
```

If you are testing only on the same machine, you can disable auth:

```bash
~/remux/remux-server.mjs --no-auth
```

Do not expose a `--no-auth` server on a public network.

### Server Options

The standalone CLI accepts these options:

```text
--host <host>          Host to bind. Default: 127.0.0.1
--port <port>          Port to listen on. Default: 8787
--token <token>        Bearer token required by clients.
--no-auth              Disable bearer auth. Only use behind a trusted tunnel.
--db-path <path>       Metadata database path. Default: ~/.remux/remux.db
--tmux-socket <name>   tmux socket name, passed as tmux -L <name>.
--help                 Show CLI help.
```

The same config can be set with environment variables:

```text
REMUX_HOST
REMUX_PORT
REMUX_TOKEN
REMUX_DB_PATH
REMUX_TMUX_SOCKET
```

Example with environment variables:

```bash
REMUX_HOST=0.0.0.0 \
REMUX_PORT=8787 \
REMUX_TOKEN=change-this-token \
~/remux/remux-server.mjs
```

### Keep The Server Running With systemd

Create `/etc/systemd/system/remux.service`:

```ini
[Unit]
Description=Remux tmux server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=YOUR_LINUX_USER
WorkingDirectory=/home/YOUR_LINUX_USER
Environment=REMUX_HOST=0.0.0.0
Environment=REMUX_PORT=8787
Environment=REMUX_TOKEN=change-this-token
ExecStart=/home/YOUR_LINUX_USER/remux/remux-server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now remux
sudo systemctl status remux
```

View logs:

```bash
journalctl -u remux -f
```

## Android Setup

Install `remux-android-release.apk` from the latest GitHub Release.

If you downloaded the APK on a computer:

```bash
adb install remux-android-release.apk
```

Or copy it to the phone and open it with Android's package installer.

In the Remux app:

1. Set **Server URL** to `http://SERVER_IP_OR_TAILSCALE_IP:8787`.
2. Enter the bearer token from `--token` or `REMUX_TOKEN`.
3. Leave the token blank only when the server is running with `--no-auth`.
4. Tap **Connect**.

For Tailscale, use the server's Tailscale IP, for example:

```text
http://100.x.y.z:8787
```

The Android app enables cleartext HTTP for private-network/VPN use. For public internet exposure, put Remux behind HTTPS and require a strong token.

## Development

```bash
npm install
npm run dev:server
npm run dev:client
```

The development server defaults to `127.0.0.1:8787`, controls the local tmux socket, and leaves bearer auth disabled when `REMUX_TOKEN` is blank.

Expo serves web, iOS, and Android from `apps/client`. The Android emulator uses `http://10.0.2.2:8787` by default so it can reach the host machine. Override the startup URL with:

```bash
EXPO_PUBLIC_REMUX_SERVER_URL=http://10.0.2.2:8800 npm --workspace @remux/client run android
```

Leave the token field blank when the server is running with blank `REMUX_TOKEN`.

## Build Commands

```bash
npm run typecheck
npm run test
npm run build:server:standalone
npm run build:android:apk
```

## Apps

- `apps/server`: Node.js API and WebSocket tmux bridge.
- `apps/client`: Expo app for web, iOS, and Android.

## Packages

- `packages/protocol`: Shared API and WebSocket types.
- `packages/api-client`: Shared typed API client.
- `packages/config`: Shared config helpers.
