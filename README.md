# Telemux

Telemux is a self-hosted tmux controller for resuming terminal work from web, iOS, and Android clients.

## What You Need

- A server or laptop that can run `tmux`.
- Node.js 24 or newer on the server. The installer can set this up automatically on common Linux distributions.
- Network reachability from the phone to the server. Tailscale, WireGuard, or another private VPN is recommended.
- The Android APK and server CLI assets from the latest GitHub Release. iOS IPA assets are published when the repository has EAS credentials configured.

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

On the server or laptop where `tmux` runs, paste:

```bash
curl -fsSL https://raw.githubusercontent.com/bangnokia/telemux/main/web/install.sh | bash
```

The installer:

- Installs `tmux`, `curl`, `tar`, and Node.js 24 where possible.
- Downloads the latest `telemux-server-node24.tar.gz` release asset.
- Verifies the release SHA-256 checksum.
- Installs the CLI into `~/telemux`.
- Adds a `~/.local/bin/telemux-server` symlink.
- Creates and starts a `telemux` systemd service when systemd is available.

It may ask for your sudo password when packages or the systemd service need root access.

The default service binds to `0.0.0.0:14441` with blank auth because the current mobile app sends blank auth. Keep it behind Tailscale, WireGuard, or another trusted private network. Do not expose a blank-auth Telemux server on the public internet.

Non-interactive install:

```bash
curl -fsSL https://raw.githubusercontent.com/bangnokia/telemux/main/web/install.sh | bash -s -- --yes
```

Custom port:

```bash
curl -fsSL https://raw.githubusercontent.com/bangnokia/telemux/main/web/install.sh | bash -s -- --port 14441 --no-auth
```

Install without creating a systemd service:

```bash
curl -fsSL https://raw.githubusercontent.com/bangnokia/telemux/main/web/install.sh | bash -s -- --no-service
```

The installer prints the values to enter in the app:

```text
Host: SERVER_IP_OR_TAILSCALE_IP
Port: 14441
Auth: blank
```

### Server Options

The standalone CLI accepts these options:

```text
--host <host>          Host to bind. Default: 127.0.0.1
--port <port>          Port to listen on. Default: 14441
--token <token>        Bearer token required by clients.
--no-auth              Disable bearer auth. Only use behind a trusted tunnel.
--db-path <path>       Metadata database path. Default: ~/.telemux/telemux.db
--tmux-socket <name>   tmux socket name, passed as tmux -L <name>.
--version              Show CLI version.
--help                 Show CLI help.
```

The CLI also supports a self-update command:

```bash
~/telemux/telemux-server.mjs update
```

`update` checks the latest GitHub Release, downloads `telemux-server-node24.tar.gz`, and replaces the current `telemux-server.mjs` file when a newer version exists. Restart the service after updating if Telemux is running under systemd.

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

### Service Management

When systemd is available, the installer creates `/etc/systemd/system/telemux.service` and starts it automatically. Check it with:

```bash
sudo systemctl status telemux
```

View logs or restart after changing config:

```bash
journalctl -u telemux -f
sudo systemctl restart telemux
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
