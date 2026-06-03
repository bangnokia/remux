# Telemux

Telemux is a self-hosted tmux controller for resuming terminal work from web, iOS, and Android clients.

## What You Need

- A server or laptop that can run `tmux`.
- Node.js 24 or newer on the server.
- Network reachability from the phone to the server. Tailscale, WireGuard, or another private VPN is recommended.
- The Android APK, iOS IPA, and server CLI assets from the latest GitHub Release.

The server controls tmux on the same machine where it runs. If you already have tmux sessions there, Telemux can reuse them.

## Download Builds

GitHub Actions builds and publishes release assets only when a tag is pushed. Normal commits, `main` pushes, and pull requests do not trigger the GitHub build workflow.

Download from:

```text
https://github.com/bangnokia/telemux/releases/latest
```

To create a release build, push a new tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Release assets:

- `telemux-android-release.apk`: Android APK.
- `telemux-android-release.apk.sha256`: Android APK SHA-256 checksum.
- `telemux-ios-release.ipa`: signed iOS IPA.
- `telemux-ios-release.ipa.sha256`: iOS IPA SHA-256 checksum.
- `telemux-server-node24.tar.gz`: standalone Node 24 server CLI.
- `telemux-server-node24.tar.gz.sha256`: server CLI SHA-256 checksum.

You can also build them locally:

```bash
npm ci
npm run build:server:standalone
npm run build:android:apk
```

Local outputs:

- Server CLI: `dist/telemux-server.mjs`
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

Download `telemux-server-node24.tar.gz` from the latest GitHub Release, then unpack it on the server:

```bash
mkdir -p ~/telemux
tar -xzf telemux-server-node24.tar.gz -C ~/telemux
chmod +x ~/telemux/telemux-server.mjs
```

Start Telemux on all interfaces with a token:

```bash
~/telemux/telemux-server.mjs \
  --host 0.0.0.0 \
  --port 14441 \
  --token "change-this-token"
```

Use these values in the app:

```text
Host: SERVER_IP_OR_TAILSCALE_IP
Port: 14441
```

If you are testing only on the same machine, you can disable auth:

```bash
~/telemux/telemux-server.mjs --no-auth
```

Do not expose a `--no-auth` server on a public network.

### Server Options

The standalone CLI accepts these options:

```text
--host <host>          Host to bind. Default: 127.0.0.1
--port <port>          Port to listen on. Default: 14441
--token <token>        Bearer token required by clients.
--no-auth              Disable bearer auth. Only use behind a trusted tunnel.
--db-path <path>       Metadata database path. Default: ~/.telemux/telemux.db
--tmux-socket <name>   tmux socket name, passed as tmux -L <name>.
--help                 Show CLI help.
```

The same config can be set with environment variables:

```text
TELEMUX_HOST
TELEMUX_PORT
TELEMUX_TOKEN
TELEMUX_DB_PATH
TELEMUX_TMUX_SOCKET
```

The previous `REMUX_*` environment variable names are still accepted as compatibility aliases.

Example with environment variables:

```bash
TELEMUX_HOST=0.0.0.0 \
TELEMUX_PORT=14441 \
TELEMUX_TOKEN=change-this-token \
~/telemux/telemux-server.mjs
```

### Keep The Server Running With systemd

Create `/etc/systemd/system/telemux.service`:

```ini
[Unit]
Description=Telemux tmux server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=YOUR_LINUX_USER
WorkingDirectory=/home/YOUR_LINUX_USER
Environment=TELEMUX_HOST=0.0.0.0
Environment=TELEMUX_PORT=14441
Environment=TELEMUX_TOKEN=change-this-token
ExecStart=/home/YOUR_LINUX_USER/telemux/telemux-server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now telemux
sudo systemctl status telemux
```

View logs:

```bash
journalctl -u telemux -f
```

## Android Setup

Install `telemux-android-release.apk` from the latest GitHub Release.

If you downloaded the APK on a computer:

```bash
adb install telemux-android-release.apk
```

Or copy it to the phone and open it with Android's package installer.

In the Telemux app:

1. Set **Label** if you want a friendly server name.
2. Set **Host** to `SERVER_IP_OR_TAILSCALE_IP`.
3. Leave **Port** as `14441` unless you changed the server port.
4. Tap **Connect**.

The current mobile client uses blank auth. Keep the server behind a trusted tunnel and leave `TELEMUX_TOKEN` blank or start with `--no-auth`.

For Tailscale, use the server's Tailscale IP, for example:

```text
Host: 100.x.y.z
Port: 14441
```

The Android app enables cleartext HTTP for private-network/VPN use. For public internet exposure, put Telemux behind HTTPS and require a strong token.

## Development

```bash
npm install
npm run dev:server
npm run dev:client
```

The development server defaults to `127.0.0.1:14441`, controls the local tmux socket, and leaves bearer auth disabled when `TELEMUX_TOKEN` is blank.

Expo serves web, iOS, and Android from `apps/client`. The Android emulator uses host `10.0.2.2` and port `14441` by default so it can reach the host machine. Override the startup URL with:

```bash
EXPO_PUBLIC_TELEMUX_SERVER_URL=http://10.0.2.2:8800 npm --workspace @telemux/client run android
```

Use a blank `TELEMUX_TOKEN` while developing against the current mobile client.

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
