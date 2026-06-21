#!/usr/bin/env bash
set -euo pipefail

REPO="${TELEMUX_REPO:-bangnokia/telemux}"
ASSET_NAME="telemux-server-node24.tar.gz"
SERVICE_NAME="${TELEMUX_SERVICE_NAME:-telemux}"
SERVICE_HOST="${TELEMUX_HOST:-0.0.0.0}"
SERVICE_PORT="${TELEMUX_PORT:-14441}"
INSTALL_DIR="${TELEMUX_INSTALL_DIR:-}"
BIN_DIR="${TELEMUX_BIN_DIR:-}"
TOKEN="${TELEMUX_TOKEN:-}"
AUTH_MODE="no-auth"
INSTALL_SERVICE=1
START_SERVICE=1
ASSUME_YES="${TELEMUX_YES:-0}"
NODE_BIN=""
SERVICE_NODE_BIN=""

if [ -n "$TOKEN" ]; then
  AUTH_MODE="token"
fi

usage() {
  cat <<'EOF'
Telemux server installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/bangnokia/telemux/main/web/install.sh | bash

Options:
  -y, --yes                Accept defaults for installer prompts.
  --repo <owner/repo>      GitHub repo to download from. Default: bangnokia/telemux
  --install-dir <path>     Install directory. Default: ~/.telemux
  --bin-dir <path>         Command directory. Default: ~/.local/bin
  --host <host>            Host for the service to bind. Default: 0.0.0.0
  --port <port>            Port for the service to bind. Default: 14441
  --token <token>          Require bearer auth with this token.
  --no-auth                Disable bearer auth. Default for current mobile app.
  --no-service             Install only; do not create a systemd service.
  --no-start               Create/update the service but do not start it.
  -h, --help               Show this help.

Examples:
  curl -fsSL https://raw.githubusercontent.com/bangnokia/telemux/main/web/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/bangnokia/telemux/main/web/install.sh | bash -s -- --yes
  curl -fsSL https://raw.githubusercontent.com/bangnokia/telemux/main/web/install.sh | bash -s -- --port 14441 --no-auth
EOF
}

missing_option_arg() {
  printf 'telemux install: missing value for %s\n' "$1" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -y|--yes)
      ASSUME_YES=1
      shift
      ;;
    --repo)
      [ "$#" -ge 2 ] || missing_option_arg "$1"
      REPO="${2:-}"
      shift 2
      ;;
    --install-dir)
      [ "$#" -ge 2 ] || missing_option_arg "$1"
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    --bin-dir)
      [ "$#" -ge 2 ] || missing_option_arg "$1"
      BIN_DIR="${2:-}"
      shift 2
      ;;
    --host)
      [ "$#" -ge 2 ] || missing_option_arg "$1"
      SERVICE_HOST="${2:-}"
      shift 2
      ;;
    --port)
      [ "$#" -ge 2 ] || missing_option_arg "$1"
      SERVICE_PORT="${2:-}"
      shift 2
      ;;
    --token)
      [ "$#" -ge 2 ] || missing_option_arg "$1"
      TOKEN="${2:-}"
      AUTH_MODE="token"
      shift 2
      ;;
    --no-auth)
      TOKEN=""
      AUTH_MODE="no-auth"
      shift
      ;;
    --no-service)
      INSTALL_SERVICE=0
      START_SERVICE=0
      shift
      ;;
    --no-start)
      START_SERVICE=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'telemux install: unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ -t 2 ]; then
  BOLD="$(printf '\033[1m')"
  GREEN="$(printf '\033[32m')"
  YELLOW="$(printf '\033[33m')"
  RESET="$(printf '\033[0m')"
else
  BOLD=""
  GREEN=""
  YELLOW=""
  RESET=""
fi

fail() {
  printf 'telemux install: %s\n' "$1" >&2
  exit 1
}

log() {
  printf '%s==>%s %s\n' "$GREEN" "$RESET" "$1" >&2
}

warn() {
  printf '%swarning:%s %s\n' "$YELLOW" "$RESET" "$1" >&2
}

has_tty() {
  [ -r /dev/tty ] && [ -w /dev/tty ]
}

is_yes() {
  case "${1:-}" in
    1|y|Y|yes|YES|true|TRUE) return 0 ;;
    *) return 1 ;;
  esac
}

confirm() {
  local question="$1"
  local default="${2:-yes}"
  local prompt="[Y/n]"
  local answer=""

  if is_yes "$ASSUME_YES"; then
    return 0
  fi

  if [ "$default" = "no" ]; then
    prompt="[y/N]"
  fi

  if ! has_tty; then
    [ "$default" = "yes" ]
    return
  fi

  printf '%s %s ' "$question" "$prompt" > /dev/tty
  read -r answer < /dev/tty || answer=""

  if [ -z "$answer" ]; then
    [ "$default" = "yes" ]
    return
  fi

  is_yes "$answer"
}

require_value() {
  local name="$1"
  local value="$2"
  [ -n "$value" ] || fail "$name cannot be empty"
}

require_value "--repo" "$REPO"
require_value "--host" "$SERVICE_HOST"
require_value "--port" "$SERVICE_PORT"

case "$SERVICE_PORT" in
  ''|*[!0-9]*) fail "--port must be a number" ;;
esac
if [ "$SERVICE_PORT" -lt 1 ] || [ "$SERVICE_PORT" -gt 65535 ]; then
  fail "--port must be between 1 and 65535"
fi

user_home() {
  local user="$1"

  if command -v getent >/dev/null 2>&1; then
    getent passwd "$user" | awk -F: '{print $6}'
    return
  fi

  eval "printf '%s' ~$user"
}

if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER:-}" != "root" ]; then
  TARGET_USER="$SUDO_USER"
else
  TARGET_USER="$(id -un)"
fi

TARGET_HOME="$(user_home "$TARGET_USER")"
[ -n "$TARGET_HOME" ] || fail "unable to determine home directory for $TARGET_USER"
TARGET_GROUP="$(id -gn "$TARGET_USER" 2>/dev/null || printf '%s' "$TARGET_USER")"

if [ -z "$INSTALL_DIR" ]; then
  INSTALL_DIR="$TARGET_HOME/.telemux"
fi

if [ -z "$BIN_DIR" ]; then
  BIN_DIR="$TARGET_HOME/.local/bin"
fi

case "$INSTALL_DIR" in
  *[[:space:]]*) fail "--install-dir cannot contain whitespace" ;;
esac
case "$BIN_DIR" in
  *[[:space:]]*) fail "--bin-dir cannot contain whitespace" ;;
esac
case "$TARGET_HOME" in
  *[[:space:]]*) fail "target home directory cannot contain whitespace" ;;
esac

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi

  command -v sudo >/dev/null 2>&1 || fail "sudo is required for this step, but it is not installed"
  sudo "$@"
}

node_major_for_bin() {
  local bin="$1"

  if [ -z "$bin" ] || [ ! -x "$bin" ]; then
    printf '0'
    return
  fi

  "$bin" -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || printf '0'
}

node_major() {
  node_major_for_bin "$(command -v node 2>/dev/null || true)"
}

has_node24() {
  [ "$(node_major)" -ge 24 ]
}

has_node24_bin() {
  [ "$(node_major_for_bin "$1")" -ge 24 ]
}

resolve_node_bin() {
  NODE_BIN="$(command -v node 2>/dev/null || true)"
  [ -n "$NODE_BIN" ] || fail "node is required"

  case "$NODE_BIN" in
    /*) ;;
    *) fail "node path is not absolute: $NODE_BIN" ;;
  esac
}

path_is_under_target_home() {
  case "$1" in
    "$TARGET_HOME"|"$TARGET_HOME"/*) return 0 ;;
    *) return 1 ;;
  esac
}

find_service_node_bin() {
  local candidate=""
  local command_node=""

  command_node="$(command -v node 2>/dev/null || true)"

  for candidate in /usr/bin/node /usr/local/bin/node /opt/homebrew/bin/node "$command_node"; do
    [ -n "$candidate" ] || continue
    [ -x "$candidate" ] || continue
    path_is_under_target_home "$candidate" && continue

    if has_node24_bin "$candidate"; then
      SERVICE_NODE_BIN="$candidate"
      return 0
    fi
  done

  return 1
}

install_system_node24() {
  if command -v apt-get >/dev/null 2>&1; then
    log "Installing system Node.js 24 from NodeSource"
    curl -fsSL https://deb.nodesource.com/setup_24.x -o "$TMP_DIR/nodesource_setup.sh"
    run_root bash "$TMP_DIR/nodesource_setup.sh"
    run_root apt-get install -y nodejs
    return
  fi

  if command -v dnf >/dev/null 2>&1; then
    log "Installing system Node.js 24 from NodeSource"
    curl -fsSL https://rpm.nodesource.com/setup_24.x -o "$TMP_DIR/nodesource_setup.sh"
    run_root bash "$TMP_DIR/nodesource_setup.sh"
    run_root dnf install -y nodejs
    return
  fi

  if command -v yum >/dev/null 2>&1; then
    log "Installing system Node.js 24 from NodeSource"
    curl -fsSL https://rpm.nodesource.com/setup_24.x -o "$TMP_DIR/nodesource_setup.sh"
    run_root bash "$TMP_DIR/nodesource_setup.sh"
    run_root yum install -y nodejs
    return
  fi

  if command -v apk >/dev/null 2>&1; then
    log "Installing system Node.js with apk"
    run_root apk add --no-cache nodejs npm
    return
  fi

  if command -v pacman >/dev/null 2>&1; then
    log "Installing system Node.js with pacman"
    run_root pacman -Sy --needed --noconfirm nodejs npm
    return
  fi

  if command -v zypper >/dev/null 2>&1; then
    log "Installing system Node.js 24 with zypper"
    run_root zypper --non-interactive install nodejs24
    return
  fi

  fail "unable to install a system Node.js automatically. Install Node.js 24 outside your home directory, then rerun this installer."
}

install_prerequisites() {
  if command -v apt-get >/dev/null 2>&1; then
    log "Installing base packages with apt"
    run_root apt-get update
    run_root apt-get install -y ca-certificates curl tar gzip tmux

    if ! has_node24; then
      log "Installing Node.js 24 from NodeSource"
      curl -fsSL https://deb.nodesource.com/setup_24.x -o "$TMP_DIR/nodesource_setup.sh"
      run_root bash "$TMP_DIR/nodesource_setup.sh"
      run_root apt-get install -y nodejs
    fi
    return
  fi

  if command -v dnf >/dev/null 2>&1; then
    log "Installing base packages with dnf"
    run_root dnf install -y ca-certificates curl tar gzip tmux

    if ! has_node24; then
      log "Installing Node.js 24 from NodeSource"
      curl -fsSL https://rpm.nodesource.com/setup_24.x -o "$TMP_DIR/nodesource_setup.sh"
      run_root bash "$TMP_DIR/nodesource_setup.sh"
      run_root dnf install -y nodejs
    fi
    return
  fi

  if command -v yum >/dev/null 2>&1; then
    log "Installing base packages with yum"
    run_root yum install -y ca-certificates curl tar gzip tmux

    if ! has_node24; then
      log "Installing Node.js 24 from NodeSource"
      curl -fsSL https://rpm.nodesource.com/setup_24.x -o "$TMP_DIR/nodesource_setup.sh"
      run_root bash "$TMP_DIR/nodesource_setup.sh"
      run_root yum install -y nodejs
    fi
    return
  fi

  if command -v apk >/dev/null 2>&1; then
    log "Installing base packages with apk"
    run_root apk add --no-cache ca-certificates curl tar gzip tmux nodejs npm
    return
  fi

  if command -v pacman >/dev/null 2>&1; then
    log "Installing base packages with pacman"
    run_root pacman -Sy --needed --noconfirm ca-certificates curl tar gzip tmux nodejs npm
    return
  fi

  if command -v zypper >/dev/null 2>&1; then
    log "Installing base packages with zypper"
    run_root zypper --non-interactive install ca-certificates curl tar gzip tmux nodejs24
    return
  fi

  if command -v brew >/dev/null 2>&1; then
    log "Installing base packages with Homebrew"
    brew install curl tmux node
    return
  fi

  fail "unsupported OS package manager. Install curl, tar, tmux, and Node.js 24 manually, then rerun this installer."
}

ensure_prerequisites() {
  local missing=""

  command -v curl >/dev/null 2>&1 || missing="$missing curl"
  command -v tar >/dev/null 2>&1 || missing="$missing tar"
  command -v tmux >/dev/null 2>&1 || missing="$missing tmux"
  has_node24 || missing="$missing nodejs24"

  if [ -n "$missing" ]; then
    warn "missing prerequisites:$missing"
    if confirm "Install missing prerequisites now? sudo may ask for your password." "yes"; then
      install_prerequisites
    else
      fail "missing prerequisites:$missing"
    fi
  fi

  command -v curl >/dev/null 2>&1 || fail "curl is required"
  command -v tar >/dev/null 2>&1 || fail "tar is required"
  command -v tmux >/dev/null 2>&1 || fail "tmux is required"
  has_node24 || fail "Node.js 24 or newer is required. Current version: $(node --version 2>/dev/null || printf 'not installed')"
  resolve_node_bin

  if [ "$INSTALL_SERVICE" -eq 1 ] && supports_systemd; then
    if ! find_service_node_bin; then
      warn "Node.js 24 is available only from a user-home path: $NODE_BIN"
      warn "Fedora systemd/SELinux may refuse to execute binaries from user-home paths."
      if confirm "Install a system Node.js 24 for the Telemux service? sudo may ask for your password." "yes"; then
        install_system_node24
      else
        fail "systemd needs Node.js 24 installed outside $TARGET_HOME"
      fi
    fi

    find_service_node_bin || fail "unable to find a system Node.js 24 outside $TARGET_HOME"
    NODE_BIN="$SERVICE_NODE_BIN"
  fi
}

sha256_file() {
  local file="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return
  fi

  return 1
}

verify_checksum() {
  local archive="$1"
  local checksum_file="$2"
  local expected=""
  local actual=""

  if ! expected="$(awk '{print $1; exit}' "$checksum_file")" || [ -z "$expected" ]; then
    fail "unable to read checksum file"
  fi

  if ! actual="$(sha256_file "$archive")"; then
    warn "no SHA-256 tool found; skipping checksum verification"
    return
  fi

  if [ "$expected" != "$actual" ]; then
    fail "checksum mismatch for $ASSET_NAME"
  fi
}

install_server_cli() {
  local asset_url="https://github.com/${REPO}/releases/latest/download/${ASSET_NAME}"
  local checksum_url="${asset_url}.sha256"
  local archive="$TMP_DIR/$ASSET_NAME"
  local checksum_file="$TMP_DIR/${ASSET_NAME}.sha256"

  log "Downloading latest Telemux server"
  curl -fsSL "$asset_url" -o "$archive"
  curl -fsSL "$checksum_url" -o "$checksum_file"
  verify_checksum "$archive" "$checksum_file"

  log "Installing into $INSTALL_DIR"
  if [ "$(id -u)" -eq 0 ]; then
    install -d -m 0755 -o "$TARGET_USER" -g "$TARGET_GROUP" "$INSTALL_DIR"
    tar -xzf "$archive" -C "$INSTALL_DIR"
    chmod +x "$INSTALL_DIR/telemux-server.mjs"
    chown -R "$TARGET_USER:$TARGET_GROUP" "$INSTALL_DIR"
  else
    mkdir -p "$INSTALL_DIR"
    tar -xzf "$archive" -C "$INSTALL_DIR"
    chmod +x "$INSTALL_DIR/telemux-server.mjs"
  fi

  install_command_wrappers
}

install_command_wrappers() {
  if [ "$(id -u)" -eq 0 ]; then
    install -d -m 0755 -o "$TARGET_USER" -g "$TARGET_GROUP" "$BIN_DIR"
  else
    mkdir -p "$BIN_DIR"
  fi

  write_command_wrapper "telemux"
  write_command_wrapper "telemux-server"
}

write_command_wrapper() {
  local name="$1"
  local destination="$BIN_DIR/$name"
  local wrapper="$TMP_DIR/$name"

  cat > "$wrapper" <<EOF
#!/usr/bin/env sh
exec $(shell_quote "$NODE_BIN") $(shell_quote "$INSTALL_DIR/telemux-server.mjs") "\$@"
EOF

  if [ "$(id -u)" -eq 0 ]; then
    rm -f "$destination"
    install -m 0755 -o "$TARGET_USER" -g "$TARGET_GROUP" "$wrapper" "$destination"
  else
    rm -f "$destination"
    install -m 0755 "$wrapper" "$destination"
  fi
}

escape_systemd_env() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/%/%%/g'
}

quote_systemd_arg() {
  printf '"%s"' "$(escape_systemd_env "$1")"
}

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

supports_systemd() {
  [ "$(uname -s)" = "Linux" ] && command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]
}

path_includes_bin_dir() {
  case ":$PATH:" in
    *":$BIN_DIR:"*) return 0 ;;
    *) return 1 ;;
  esac
}

write_systemd_service() {
  local service_file="$TMP_DIR/${SERVICE_NAME}.service"
  local escaped_host=""
  local escaped_port=""
  local escaped_token=""
  local quoted_node_bin=""
  local quoted_server_path=""

  escaped_host="$(escape_systemd_env "$SERVICE_HOST")"
  escaped_port="$(escape_systemd_env "$SERVICE_PORT")"
  escaped_token="$(escape_systemd_env "$TOKEN")"
  quoted_node_bin="$(quote_systemd_arg "$NODE_BIN")"
  quoted_server_path="$(quote_systemd_arg "$INSTALL_DIR/telemux-server.mjs")"

  cat > "$service_file" <<EOF
[Unit]
Description=Telemux tmux server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$TARGET_USER
WorkingDirectory=$TARGET_HOME
Environment="TELEMUX_HOST=$escaped_host"
Environment="TELEMUX_PORT=$escaped_port"
Environment="TELEMUX_TOKEN=$escaped_token"
ExecStart=$quoted_node_bin $quoted_server_path
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  log "Installing systemd service $SERVICE_NAME"
  run_root cp "$service_file" "/etc/systemd/system/${SERVICE_NAME}.service"
  run_root systemctl daemon-reload
  run_root systemctl enable "$SERVICE_NAME"

  if [ "$START_SERVICE" -eq 1 ]; then
    run_root systemctl restart "$SERVICE_NAME"
  fi
}

check_health() {
  local check_host="127.0.0.1"
  local url=""
  local attempt=0
  local curl_args=(-fsS)

  if [ "$SERVICE_HOST" != "0.0.0.0" ] && [ "$SERVICE_HOST" != "::" ]; then
    check_host="$SERVICE_HOST"
  fi

  url="http://${check_host}:${SERVICE_PORT}/api/health"

  if [ "$AUTH_MODE" = "token" ]; then
    curl_args+=(-H "Authorization: Bearer $TOKEN")
  fi

  while [ "$attempt" -lt 20 ]; do
    if curl "${curl_args[@]}" "$url" >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  return 1
}

detect_connection_host() {
  local detected=""

  if command -v tailscale >/dev/null 2>&1; then
    detected="$(tailscale ip -4 2>/dev/null | awk 'NF {print; exit}' || true)"
    if [ -n "$detected" ]; then
      printf '%s' "$detected"
      return
    fi
  fi

  if command -v ip >/dev/null 2>&1; then
    detected="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1; i<=NF; i++) if ($i == "src") {print $(i+1); exit}}' || true)"
    if [ -n "$detected" ]; then
      printf '%s' "$detected"
      return
    fi
  fi

  if command -v hostname >/dev/null 2>&1; then
    detected="$(hostname -I 2>/dev/null | awk '{print $1; exit}' || true)"
    if [ -n "$detected" ]; then
      printf '%s' "$detected"
      return
    fi
  fi

  printf 'SERVER_IP_OR_TAILSCALE_IP'
}

print_summary() {
  local version="$1"
  local connection_host="$2"
  local service_state="not installed"
  local auth_line="Auth: blank"
  local manual_start_command=""
  local quoted_telemux_command=""
  local useful_commands=""

  quoted_telemux_command="$(shell_quote "$BIN_DIR/telemux")"

  if [ "$INSTALL_SERVICE" -eq 1 ] && supports_systemd; then
    if [ "$START_SERVICE" -eq 1 ]; then
      service_state="installed and started"
    else
      service_state="installed, not started"
    fi
  fi

  if [ "$AUTH_MODE" = "token" ]; then
    auth_line="Auth token: configured on server"
    manual_start_command="TELEMUX_TOKEN=your-token $quoted_telemux_command --host $SERVICE_HOST --port $SERVICE_PORT"
  else
    manual_start_command="$quoted_telemux_command --host $SERVICE_HOST --port $SERVICE_PORT --no-auth"
  fi

  if [ "$INSTALL_SERVICE" -eq 1 ] && supports_systemd; then
    useful_commands="  sudo systemctl status $SERVICE_NAME
  journalctl -u $SERVICE_NAME -f
  telemux update"
  else
    useful_commands="  $manual_start_command
  telemux update"
  fi

  cat <<EOF

${BOLD}Telemux server ${version} is ready.${RESET}

Installed:
  $INSTALL_DIR/telemux-server.mjs
  $BIN_DIR/telemux
  $BIN_DIR/telemux-server

Service:
  $service_state

Use these values in the Telemux app:
  Host: ${connection_host:-SERVER_IP_OR_TAILSCALE_IP}
  Port: $SERVICE_PORT
  $auth_line

Useful commands:
$useful_commands

EOF

  if [ "$AUTH_MODE" = "no-auth" ]; then
    cat <<'EOF'
The current mobile app uses blank auth, so this installer defaults to no auth.
Keep Telemux behind Tailscale, WireGuard, or another trusted private network.
Do not expose this service directly on the public internet.

EOF
  fi

  if ! path_includes_bin_dir; then
    cat <<EOF
If your shell cannot find "telemux", add this command directory to PATH:
  export PATH="$BIN_DIR:\$PATH"

EOF
  fi
}

main() {
  local version=""
  local connection_host=""

  if [ "$AUTH_MODE" = "token" ] && [ -z "$TOKEN" ]; then
    fail "--token cannot be empty"
  fi

  log "Preparing Telemux for user $TARGET_USER"
  ensure_prerequisites
  install_server_cli
  version="$("$NODE_BIN" "$INSTALL_DIR/telemux-server.mjs" --version)"

  if [ "$INSTALL_SERVICE" -eq 1 ]; then
    if supports_systemd; then
      if confirm "Install and configure a systemd service? sudo may ask for your password." "yes"; then
        write_systemd_service
        if [ "$START_SERVICE" -eq 1 ]; then
          if check_health; then
            log "Telemux health check passed"
          else
            warn "Telemux service did not pass the local health check yet"
            warn "Run: sudo systemctl status $SERVICE_NAME"
          fi
        fi
      else
        INSTALL_SERVICE=0
      fi
    else
      INSTALL_SERVICE=0
      warn "systemd was not detected; installed the CLI without a service"
      warn "Start manually with: $(shell_quote "$BIN_DIR/telemux") --host $SERVICE_HOST --port $SERVICE_PORT --no-auth"
    fi
  fi

  connection_host="$(detect_connection_host)"
  print_summary "$version" "$connection_host"
}

main
