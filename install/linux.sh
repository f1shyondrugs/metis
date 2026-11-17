#!/usr/bin/env bash
# Metis AI Linux installer. Run as a file, not via `curl | bash`.
# Prefer: /bin/bash -c "$(curl -fsSL https://github.com/f1shyondrugs/metis-ai/releases/latest/download/metis-install.sh)"
set -Eeuo pipefail

# systemd-run and other non-login environments omit HOME. `set -u` then
# dies on DEFAULT_DIR="$HOME/metis-ai" before --install-dir is parsed.
if [[ -z "${HOME:-}" ]]; then
  HOME="$(getent passwd "$(id -u)" 2>/dev/null | cut -d: -f6 || true)"
  if [[ -z "$HOME" ]]; then
    HOME="$(eval echo "~$(id -un)" 2>/dev/null || true)"
  fi
  if [[ -z "$HOME" ]]; then
    if [[ "$(id -u)" -eq 0 ]]; then
      HOME="/root"
    else
      HOME="/tmp"
    fi
  fi
  export HOME
fi

APP_NAME="Metis AI"
REPO_URL="${METIS_AI_REPO_URL:-https://github.com/f1shyondrugs/metis-ai.git}"
NODE_VERSION="${METIS_NODE_VERSION:-22.16.0}"
DEFAULT_DIR="${METIS_AI_INSTALL_DIR:-$HOME/metis-ai}"

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

confirm_install() {
  local name="$1" answer
  (( non_interactive )) && return 0

  if [[ -t 0 ]]; then
    IFS= read -r -p "$name is missing or too old. Install/update it automatically? [Y/n] " answer
  else
    IFS= read -r -p "$name is missing or too old. Install/update it automatically? [Y/n] " answer < /dev/tty
  fi
  [[ -z "$answer" || "$answer" =~ ^([Yy][Ee][Ss]|[Yy])$ ]]
}

run_privileged() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    command -v sudo >/dev/null 2>&1 || die "sudo is required to install system packages."
    sudo "$@"
  fi
}

install_system_package() {
  local package="$1"
  if command -v apt-get >/dev/null 2>&1; then
    run_privileged apt-get update && run_privileged apt-get install -y "$package"
  elif command -v dnf >/dev/null 2>&1; then
    run_privileged dnf install -y "$package"
  elif command -v yum >/dev/null 2>&1; then
    run_privileged yum install -y "$package"
  elif command -v pacman >/dev/null 2>&1; then
    run_privileged pacman -Sy --noconfirm "$package"
  else
    return 1
  fi
}

ensure_native_build_tools() {
  if command -v make >/dev/null 2>&1 && { command -v g++ >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1 || command -v c++ >/dev/null 2>&1; }; then
    return 0
  fi
  printf 'Installing C/C++ build tools required for native modules (node-pty)...\n'
  if command -v apt-get >/dev/null 2>&1; then
    run_privileged apt-get update
    run_privileged apt-get install -y build-essential python3
  elif command -v dnf >/dev/null 2>&1; then
    run_privileged dnf install -y gcc-c++ make python3
  elif command -v yum >/dev/null 2>&1; then
    run_privileged yum install -y gcc-c++ make python3
  elif command -v pacman >/dev/null 2>&1; then
    run_privileged pacman -Sy --noconfirm base-devel python
  else
    die "make and a C++ compiler are required. On Debian/Ubuntu run: apt-get install -y build-essential"
  fi
  command -v make >/dev/null 2>&1 || die "make is still missing after installing build tools."
}

write_env_line() {
  local key="$1" value="$2"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//\$/\\$}"
  printf '%s="%s"\n' "$key" "$value"
}

json_str() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

wait_for_health() {
  local url="$1" max="${2:-30}" attempt body
  for attempt in $(seq 1 "$max"); do
    body="$(curl --fail --silent --max-time 2 "$url" 2>/dev/null || true)"
    if [[ "$url" == */api/status ]]; then
      if [[ "$body" == *'"authenticated":'* && "$body" == *'"worker":'* && "$body" == *'"mcp":'* ]]; then return 0; fi
    elif [[ "$body" == *'Universal MCP Gateway'* && "$body" == *'"endpoint":"/mcp"'* && "$body" == *'"ok":true'* ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_frontend_assets() {
  local base_url="$1" html asset attempt
  for attempt in $(seq 1 30); do
    html="$(curl --fail --silent --max-time 2 "${base_url%/}/" 2>/dev/null || true)"
    asset="$(printf '%s' "$html" | grep -oE '/_next/static/[^[:space:]"<>]+\.js' | head -n 1 || true)"
    if [[ -n "$asset" ]] && curl --fail --silent --max-time 2 "${base_url%/}${asset}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

port_in_use() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -qE ":${p}[[:space:]]"
  else
    (echo >/dev/tcp/127.0.0.1/"$p") >/dev/null 2>&1
  fi
}

assert_available_ports() {
  local web="$1" gateway="$2" p owners pid command process_name owned_ports
  [[ "$web" != "$gateway" ]] || die "Web and MCP ports must be different."
  for p in "$web" "$gateway"; do
    [[ "$p" =~ ^[0-9]+$ && "$p" -ge 1 && "$p" -le 65535 ]] ||
      die "Port must be a number between 1 and 65535: $p"
    if command -v docker >/dev/null 2>&1; then
      owned_ports="$(docker ps --filter "label=com.docker.compose.project.working_dir=$install_dir" --format '{{.Ports}}' 2>/dev/null || true)"
      if [[ "$owned_ports" == *":$p->"* ]]; then
        if (( ${force_native:-0} )); then die "This installation is running in Docker. Stop its Compose stack before migrating with --native."; fi
        continue
      fi
    fi
    if port_in_use "$p"; then
      owners=""
      if command -v ss >/dev/null 2>&1; then
        owners="$(ss -ltnpH "sport = :$p" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
      elif command -v lsof >/dev/null 2>&1; then
        owners="$(lsof -nP -iTCP:"$p" -sTCP:LISTEN -t 2>/dev/null || true)"
      fi
      [[ -n "$owners" ]] || die "Port $p is occupied. Choose a free --port / --mcp-port. Run ss -ltnp to identify the conflicting process."
      for pid in $owners; do
        command="$(ps -p "$pid" -o args= 2>/dev/null || true)"
        if [[ "$command" != *"$install_dir/"* || ( "$command" != *server.mjs* && "$command" != *gateway-core.mjs* ) ]]; then
          process_name="$(ps -p "$pid" -o comm= 2>/dev/null || true)"
          die "Port $p is already occupied by PID $pid: ${process_name:-unknown}. Choose a free --port / --mcp-port or close the conflicting application (for example OpenWebUI)."
        fi
      done
    fi
  done
}

usage() {
  cat <<'EOF'
Usage:
  linux.sh                                  Install Metis AI without account prompts
  linux.sh --non-interactive Install without prompts (default)
  linux.sh uninstall [options]              Uninstall Metis AI (same flags as uninstall.sh)

Options:
  --install-dir DIR       Application checkout (default: ~/metis-ai)
  --data-dir DIR          Runtime data directory (default: INSTALL_DIR/data)
  --agent-cwd DIR         Agent workspace (default: $HOME)
  --port PORT             Web port (default: 3100)
  --host HOST             Bind address (default: 127.0.0.1)
  --mcp-port PORT         MCP gateway port (default: 8787)
     --service-name NAME     systemd service prefix (default: metis-ai)
  --public-url URL        URL shown to users
  --version TAG          Checkout a release tag such as v1.0.0 after fetch
  --commit SHA           Checkout a master commit SHA after fetch
  --native                Install with Node.js + systemd (default)
  --replace-existing     Uninstall a detected existing install (keeps data), then continue
  --non-interactive       Never read prompts; all values come from arguments/defaults
  --allow-root-agents     Permit root agents (default: true)
  --deny-root-agents      Disable root agents, including on an existing install
  --dry-run               Collect configuration and print the plan, then exit
  -h, --help              Show this help

Security: use a dedicated unprivileged service user. For multiuser deployments,
use separate OS users for agent isolation; application accounts alone do not
separate operating-system permissions. Root agents are enabled by default for Host-Admins; use --deny-root-agents to disable them.
EOF
}

non_interactive=0
dry_run=0
allow_root_agents=true
root_agents_set=0
install_dir="$DEFAULT_DIR"
data_dir=""
data_dir_set=0
agent_cwd="$HOME"
port="3100"
ai_chat_host=""
mcp_port="8787"
service_name="metis-ai"
public_url=""
force_native=1
replace_existing=0
REPLACE_DATA_STASH=""
release_version=""
commit_sha=""

if [[ "${1:-}" == "uninstall" ]]; then
  shift
  uninstall_dir=""
  uninstall_svc="$service_name"
  args=("$@")
  i=0
  uninstall_help=0
  while [[ $i -lt ${#args[@]} ]]; do
    case "${args[$i]}" in
      --install-dir)
        uninstall_dir="${args[$((i+1))]:-}"
        i=$((i+2))
        ;;
      --service-name)
        uninstall_svc="${args[$((i+1))]:-$uninstall_svc}"
        i=$((i+2))
        ;;
      -h|--help)
        uninstall_help=1
        i=$((i+1))
        ;;
      *)
        i=$((i+1))
        ;;
    esac
  done
  if (( uninstall_help == 0 )); then
    if [[ -z "$uninstall_dir" ]]; then
      if ! command -v systemctl >/dev/null 2>&1 || ! systemctl cat "${uninstall_svc}.service" >/dev/null 2>&1; then
        die "Metis AI is not installed as ${uninstall_svc}.service. Nothing to uninstall."
      fi
    elif [[ ! -e "$uninstall_dir/.metis-ai-install.json" && ! -e "$uninstall_dir/.env" && ! -e "$uninstall_dir/server.mjs" ]]; then
      die "No Metis AI install found at $uninstall_dir. Nothing to uninstall."
    fi
  fi
  self_dir="$(cd "$(dirname "$0")" && pwd)"
  uninstall_script=""
  if [[ -f "$self_dir/uninstall.sh" ]]; then
    uninstall_script="$self_dir/uninstall.sh"
  elif [[ -f "$self_dir/install/uninstall.sh" ]]; then
    uninstall_script="$self_dir/install/uninstall.sh"
  else
    base="${METIS_AI_INSTALL_BASE:-https://raw.githubusercontent.com/f1shyondrugs/metis-ai/master}"
    base="${base%/}"
    uninstall_script="$(mktemp "${TMPDIR:-/tmp}/metis-ai-uninstall.XXXXXX")"
    curl -fsSL "$base/install/uninstall.sh" -o "$uninstall_script" || die "failed to download the Metis AI uninstaller."
    chmod u+x "$uninstall_script"
  fi
  exec /bin/bash "$uninstall_script" "$@"
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) [[ $# -ge 2 ]] || die "--install-dir requires a value"; install_dir="$2"; shift 2 ;;
    --data-dir) [[ $# -ge 2 ]] || die "--data-dir requires a value"; data_dir="$2"; data_dir_set=1; shift 2 ;;
    --agent-cwd) [[ $# -ge 2 ]] || die "--agent-cwd requires a value"; agent_cwd="$2"; shift 2 ;;
    --port) [[ $# -ge 2 ]] || die "--port requires a value"; port="$2"; shift 2 ;;
    --host) [[ $# -ge 2 ]] || die "--host requires a value"; ai_chat_host="$2"; shift 2 ;;
    --mcp-port) [[ $# -ge 2 ]] || die "--mcp-port requires a value"; mcp_port="$2"; shift 2 ;;
             --service-name) [[ $# -ge 2 ]] || die "--service-name requires a value"; service_name="$2"; shift 2 ;;
    --public-url) [[ $# -ge 2 ]] || die "--public-url requires a value"; public_url="$2"; shift 2 ;;
    --version) [[ $# -ge 2 ]] || die "--version requires a value"; release_version="$2"; shift 2 ;;
    --commit) [[ $# -ge 2 ]] || die "--commit requires a value"; commit_sha="$2"; shift 2 ;;
    --native) force_native=1; shift ;;
    --docker) die "Docker installation is no longer available. Use the native installer." ;;
    --replace-existing) replace_existing=1; shift ;;
    --non-interactive) non_interactive=1; shift ;;
    --allow-root-agents) allow_root_agents=true; root_agents_set=1; shift ;;
    --deny-root-agents) allow_root_agents=false; root_agents_set=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (use --help for usage)" ;;
  esac
done


read_tty_line() {
  local prompt="$1"
  if [[ -t 0 ]]; then
    IFS= read -r -p "$prompt" REPLY
  elif [[ -r /dev/tty ]] && { : 2>/dev/null < /dev/tty; }; then
    IFS= read -r -p "$prompt" REPLY < /dev/tty
  else
    REPLY=""
  fi
}

if (( non_interactive == 0 )); then
  read_tty_line "Installation directory [$install_dir]: "
  if [[ -n "$REPLY" ]]; then
    install_dir="$REPLY"
  fi
fi

install_dir="${install_dir/#\~/$HOME}"
if [[ -f "$install_dir/.metis-ai-install.json" ]] && grep -Eq '"installMethod"[[:space:]]*:[[:space:]]*"docker"' "$install_dir/.metis-ai-install.json"; then
  die "This directory contains a legacy Docker installation. Choose a separate directory for native installation; migrate data separately."
fi
agent_cwd="${agent_cwd/#\~/$HOME}"
data_dir="${data_dir/#\~/$HOME}"


configure_root_agents() {
  local previous=""
  (( root_agents_set )) && return 0
  if [[ -f "$install_dir/.env" ]]; then
    previous="$(awk -F= '/^AI_CHAT_ALLOW_ROOT_AGENTS=/{sub(/^[^=]*=/, ""); gsub(/^"|"$/, ""); print; exit}' "$install_dir/.env")"
    case "$previous" in true|1|yes) allow_root_agents=true ;; false|0|no) allow_root_agents=false ;; esac
  fi
}

configure_root_agents

default_public_host() {
  local host
  host="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf '%s' "${host:-127.0.0.1}"
}

ai_chat_host="${ai_chat_host:-127.0.0.1}"
data_dir="${data_dir:-$install_dir/data}"

data_dir="${data_dir:-$install_dir/data}"
if [[ "$ai_chat_host" == "0.0.0.0" ]]; then
  public_host="$(default_public_host)"
else
  public_host="127.0.0.1"
fi
public_url="${public_url:-http://${public_host}:${port}}"

[[ "$port" =~ ^[0-9]+$ && "$port" -ge 1 && "$port" -le 65535 ]] || die "Web port must be a number between 1 and 65535."
[[ "$mcp_port" =~ ^[0-9]+$ && "$mcp_port" -ge 1 && "$mcp_port" -le 65535 ]] || die "MCP port must be a number between 1 and 65535."
[[ "$service_name" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || die "Service name may contain letters, numbers, underscores and hyphens."
if [[ -n "$release_version" && -n "$commit_sha" ]]; then
  die "Use either --version or --commit, not both."
fi
if [[ -n "$commit_sha" ]]; then
  [[ "$commit_sha" =~ ^[0-9a-fA-F]{7,40}$ ]] || die "Commit must be a git SHA."
else
  if [[ -z "$release_version" || "$release_version" == "latest" ]]; then
    command -v curl >/dev/null 2>&1 || die "curl is required to resolve the latest stable Metis AI release."
    release_api="$(curl -fsSL -H 'Accept: application/vnd.github+json' 'https://api.github.com/repos/f1shyondrugs/metis-ai/releases/latest')" ||
      die "Could not resolve the latest stable Metis AI release."
    release_version="$(printf '%s' "$release_api" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\(v[0-9][0-9A-Za-z.-]*\)".*/\1/p' | head -n 1)"
  fi
  [[ "$release_version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] ||
    die "The selected stable release tag is invalid or unavailable: ${release_version:-empty}."
fi

# Validate releases before changing an existing installation; Git need not be installed yet.
if [[ "$REPO_URL" == https://github.com/* ]]; then
  repo_slug="${REPO_URL#https://github.com/}"; repo_slug="${repo_slug%.git}"
  command -v curl >/dev/null 2>&1 || die "curl is required to validate the selected release."
  if [[ -n "$commit_sha" ]]; then
    commit_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$repo_slug/commits/$commit_sha")" ||
      die "The selected commit is unavailable: $commit_sha"
    commit_sha="$(printf '%s' "$commit_json" | sed -n 's/^[[:space:]]*"sha"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{40\}\)".*/\1/p' | head -n 1)"
    [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || die "GitHub returned no valid commit."
  else
    selected_release="${release_api:-}"
    if [[ -z "$selected_release" ]]; then
      selected_release="$(curl -fsSL -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$repo_slug/releases/tags/$release_version")" ||
        die "The selected published release is unavailable: $release_version"
    fi
    printf '%s' "$selected_release" | grep -q '"name"[[:space:]]*:[[:space:]]*"SHA256SUMS"' ||
      die "The selected release has no installer checksum asset."
  fi
else
  # Private/local Git mirrors are an explicit developer transport override.
  command -v git >/dev/null 2>&1 || die "git is required for a custom repository."
  if [[ -n "$commit_sha" ]]; then
    ref_check_dir="$(mktemp -d "${TMPDIR:-/tmp}/metis-ref-check.XXXXXX")"
    git -C "$ref_check_dir" init -q
    if ! git -C "$ref_check_dir" fetch --depth=1 "$REPO_URL" "$commit_sha" >/dev/null 2>&1; then
      rm -rf "$ref_check_dir"; die "The selected commit is unavailable: $commit_sha"
    fi
    commit_sha="$(git -C "$ref_check_dir" rev-parse FETCH_HEAD)"
    rm -rf "$ref_check_dir"
  else
    git ls-remote --exit-code --tags "$REPO_URL" "refs/tags/$release_version" >/dev/null 2>&1 ||
      die "The selected release tag is unavailable: $release_version"
  fi
fi
export METIS_AI_INSTALL_BASE="${METIS_AI_INSTALL_BASE:-https://raw.githubusercontent.com/f1shyondrugs/metis-ai/${commit_sha:-$release_version}}"

existing_service_state=""
existing_service_dir=""
if command -v systemctl >/dev/null 2>&1 && systemctl cat "${service_name}.service" >/dev/null 2>&1; then
  existing_service_state="$(systemctl is-active "${service_name}.service" 2>/dev/null || true)"
  existing_service_dir="$(systemctl show -p WorkingDirectory --value "${service_name}.service" 2>/dev/null || true)"
fi

if (( dry_run )); then
  cat <<EOF
Dry run; no files or services will be changed.
  os:            linux
  install dir:   $install_dir
  data dir:      $data_dir
  agent cwd:     $agent_cwd
  root agents:   $allow_root_agents
  bind:          $ai_chat_host:$port
  mcp port:      $mcp_port
  service name:  $service_name
  public url:    $public_url
  version:       ${release_version:-current branch}
  native:        $force_native
  existing:      ${existing_service_state:-none}${existing_service_dir:+ at $existing_service_dir}
EOF
  exit 0
fi

read_existing_data_dir() {
  local dir="$1" value=""
  if [[ -f "$dir/.env" ]]; then
    value="$(awk -F= '/^CHAT_DATA_DIR=/{sub(/^CHAT_DATA_DIR=/, ""); gsub(/^"|"$/, ""); print; exit}' "$dir/.env")"
  fi
  if [[ -z "$value" && -f "$dir/.metis-ai-install.json" ]] && command -v python3 >/dev/null 2>&1; then
    value="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("dataDir",""))' "$dir/.metis-ai-install.json" 2>/dev/null || true)"
  fi
  if [[ -z "$value" && -d "$dir/data" ]]; then
    value="$dir/data"
  fi
  printf '%s' "$value"
}

path_is_inside() {
  local inner outer
  inner="$(realpath -m "$1")"
  outer="$(realpath -m "$2")"
  [[ "$inner" == "$outer" || "$inner" == "$outer"/* ]]
}

stop_linux_units() {
  local name="$1" unit
  command -v systemctl >/dev/null 2>&1 || return 0
  for unit in "${name}.service" "${name}-worker.service" "${name}-mcp.service"; do
    run_privileged systemctl disable --now "$unit" >/dev/null 2>&1 || true
    run_privileged rm -f "/etc/systemd/system/$unit" || true
  done
  run_privileged systemctl daemon-reload
}

stash_nested_data() {
  local dir="$1" data="$2"
  REPLACE_DATA_STASH=""
  [[ -n "$data" && -e "$data" ]] || return 0
  if path_is_inside "$data" "$dir"; then
    REPLACE_DATA_STASH="$(dirname "$(realpath -m "$dir")")/.$(basename "$dir").metis-keep-data"
    rm -rf -- "$REPLACE_DATA_STASH"
    mv -- "$data" "$REPLACE_DATA_STASH"
    printf 'Kept nested data at %s\n' "$REPLACE_DATA_STASH"
  fi
}

restore_stashed_data() {
  local dest="$1"
  [[ -n "${REPLACE_DATA_STASH:-}" && -e "$REPLACE_DATA_STASH" ]] || return 0
  mkdir -p "$(dirname "$dest")"
  if [[ -e "$dest" ]]; then
    rm -rf -- "$dest"
  fi
  mv -- "$REPLACE_DATA_STASH" "$dest"
  REPLACE_DATA_STASH=""
  printf 'Restored kept data to %s\n' "$dest"
}

REPLACE_ENV_STASH=""

env_stash_path() {
  local dir="$1" resolved
  resolved="$(realpath -m "$dir")"
  printf '%s/.%s.metis-keep-env' "$(dirname "$resolved")" "$(basename "$resolved")"
}

preserve_existing_env() {
  local dir="$1" src="$dir/.env"
  [[ -f "$src" ]] || return 0
  REPLACE_ENV_STASH="$(env_stash_path "$dir")"
  cp -a -- "$src" "$REPLACE_ENV_STASH"
  chmod 600 "$REPLACE_ENV_STASH"
  printf 'Kept previous .env at %s\n' "$REPLACE_ENV_STASH"
}

adopt_env_stash() {
  local dir="$1" candidate
  [[ -n "${REPLACE_ENV_STASH:-}" && -f "$REPLACE_ENV_STASH" ]] && return 0
  candidate="$(env_stash_path "$dir")"
  if [[ -f "$candidate" ]]; then
    REPLACE_ENV_STASH="$candidate"
    return 0
  fi
  preserve_existing_env "$dir"
}

merge_preserved_env() {
  local dest="$1" preserved="${REPLACE_ENV_STASH:-}" tmp
  [[ -n "$preserved" && -f "$preserved" && -f "$dest" ]] || return 0
  tmp="$dest.tmp"
  # METIS_ENV_MERGE_BEGIN
  awk -v preserved="$preserved" -v root_agents_set="${root_agents_set:-0}" '
    function key_of(line,   k) {
      if (line ~ /^[ \t]*#/ || line ~ /^[ \t]*$/) return ""
      k = line
      sub(/\r$/, "", k)
      if (index(k, "=") == 0) return ""
      sub(/=.*/, "", k)
      return k
    }
    function is_structural(k) {
      if (k == "AI_CHAT_ALLOW_ROOT_AGENTS" && root_agents_set == 1) return 1
      return (k == "AI_CHAT_ROOT" || k == "AI_CHAT_INSTALL_DIR" || k == "METIS_NODE_BIN" || k == "METIS_NODE_HOME" || k == "METIS_PNPM_HOME" || k == "CHAT_DATA_DIR" || k == "METIS_DATA_DIR" || k == "AGENT_CWD" || k == "METIS_WORKSPACE" || k == "AI_CHAT_MCP_STATE_DIR" || k == "METIS_DOCKER" || k == "AI_CHAT_SERVICE_NAME")
    }
    BEGIN {
      while ((getline line < preserved) > 0) {
        k = key_of(line)
        if (k != "") {
          old[k] = line
          if (!(k in seen_old)) {
            seen_old[k] = 1
            old_order[++n] = k
          }
        }
      }
      close(preserved)
    }
    {
      k = key_of($0)
      if (k != "" && !is_structural(k) && (k in old)) {
        print old[k]
        used[k] = 1
      } else {
        print $0
        if (k != "") used[k] = 1
      }
    }
    END {
      for (i = 1; i <= n; i++) {
        k = old_order[i]
        if (!(k in used) && !is_structural(k)) print old[k]
      }
    }
  ' "$dest" > "$tmp"
  # METIS_ENV_MERGE_END
  mv "$tmp" "$dest"
  chmod 600 "$dest"
  rm -f -- "$preserved"
  REPLACE_ENV_STASH=""
  printf 'Merged previous .env into %s (old values kept, new keys added).\n' "$dest"
}

read_env_key() {
  local file="$1" key="$2"
  awk -v key="$key" '
    index($0, key "=") == 1 {
      val = substr($0, length(key) + 2)
      gsub(/\r/, "", val)
      gsub(/^"/, "", val)
      gsub(/"$/, "", val)
      print val
      exit
    }
  ' "$file"
}

upsert_env_key() {
  local dest="$1" key="$2" value="$3" tmp line
  line="$(write_env_line "$key" "$value" | tr -d '\n')"
  tmp="$dest.tmp"
  awk -v key="$key" -v line="$line" '
    BEGIN { replaced = 0 }
    $0 ~ "^" key "=" { print line; replaced = 1; next }
    { print }
    END { if (!replaced) print line }
  ' "$dest" > "$tmp"
  mv "$tmp" "$dest"
  chmod 600 "$dest"
}

apply_merged_runtime_ports() {
  local dest="$1" value
  [[ -f "$dest" ]] || return 0
  value="$(read_env_key "$dest" PORT)"
  if [[ "$value" =~ ^[0-9]+$ ]]; then port="$value"; fi
  value="$(read_env_key "$dest" MCP_PORT)"
  if [[ "$value" =~ ^[0-9]+$ ]]; then mcp_port="$value"; fi
  assert_available_ports "$port" "$mcp_port"
}

uninstall_detected_install() {
  local dir="$1" data=""
  [[ -n "$dir" && "$dir" != "/" && "$dir" != "$HOME" ]] || die "Refusing to uninstall an unsafe install directory: ${dir:-unknown}"
  printf 'Uninstalling existing Metis AI at %s (data kept).\n' "$dir"
  data="$(read_existing_data_dir "$dir")"
  stop_linux_units "$service_name"
  preserve_existing_env "$dir"
  stash_nested_data "$dir" "$data"
  rm -rf -- "$dir"
}

if [[ -n "$existing_service_state" ]]; then
  existing_path="$(realpath -m "${existing_service_dir:-/nonexistent}")"
  install_path="$(realpath -m "$install_dir")"
  same=0
  [[ -n "$existing_service_dir" && "$existing_path" == "$install_path" ]] && same=1
  choice=""
  if (( replace_existing )); then
    choice=r
  elif (( non_interactive )); then
    if (( same )); then choice=u; fi
  else
    printf 'Existing Metis AI detected.\n'
    printf '  service:   %s.service (%s)\n' "$service_name" "$existing_service_state"
    printf '  directory: %s\n' "${existing_service_dir:-unknown}"
    printf '[u] Upgrade that install\n[r] Replace it (uninstall, keep data, then continue)\n[n] Uninstall and exit (keeps data)\n[a] Abort\n'
    read_tty_line "Choice [u/r/n/a]: "
    choice="$REPLY"
  fi
  case "$choice" in
    r|R)
      install_dir="${existing_service_dir:-$install_dir}"
      if (( data_dir_set == 0 )); then
        data_dir="$install_dir/data"
      fi
      uninstall_detected_install "$install_dir"
      existing_service_state=""
      existing_service_dir=""
      ;;
    u|U)
      if [[ -n "$existing_service_dir" ]]; then
        install_dir="$existing_service_dir"
      fi
      printf 'Existing Metis AI install detected: %s.service is %s in %s. Upgrading in place.\n' \
        "$service_name" "$existing_service_state" "$install_dir"
      ;;
    a|A)
      printf 'Aborted.\n'
      exit 0
      ;;
    n|N)
      install_dir="${existing_service_dir:-$install_dir}"
      [[ -n "$install_dir" && "$install_dir" != "/" && "$install_dir" != "$HOME" ]] || die "Could not resolve the install directory to uninstall."
      if (( dry_run )); then
        printf 'Would uninstall Metis AI at %s (data kept) and exit.\n' "$install_dir"
        exit 0
      fi
      exec /bin/bash "$0" uninstall --install-dir "$install_dir" --service-name "$service_name" --yes --keep-data
      ;;
    *)
      die "Metis AI is already installed as ${service_name}.service (${existing_service_state}) in ${existing_service_dir:-an unknown directory}. Re-run and choose upgrade/replace/uninstall, or pass --replace-existing."
      ;;
  esac
fi

assert_available_ports "$port" "$mcp_port"

version_at_least_22() {
  command -v "$1" >/dev/null 2>&1 || return 1
  [[ "$("$1" -p 'process.versions.node.split(".")[0]')" -ge 22 ]]
}

install_node() {
  local dir="$1/.runtime" arch url archive saved_node bundled_node candidate
  if version_at_least_22 node && command -v npm >/dev/null 2>&1; then
    printf '%s' "$(command -v node)"
    return 0
  fi
  # An update can run outside the user's login shell. Reuse the executable
  # recorded by the previous install before downloading another Node runtime.
  saved_node=""
  if [[ -f "$1/.env" ]]; then
    saved_node="$(read_env_key "$1/.env" METIS_NODE_BIN)"
  fi
  bundled_node="$dir/node/bin/node"
  for candidate in "$saved_node" "$bundled_node"; do
    if [[ -n "$candidate" && -x "$candidate" && -x "$(dirname "$candidate")/npm" ]] && version_at_least_22 "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  confirm_install "Node.js 22 or newer" || die "Node.js 22 or newer is required."
  mkdir -p "$dir"
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    armv7l) arch=armv7l ;;
    *) die "Unsupported Linux architecture: $(uname -m)" ;;
  esac
  url="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz"
  archive="$dir/node.tar.xz"
  if ! command -v curl >/dev/null 2>&1; then
    confirm_install "curl" && install_system_package curl ||
      die "curl is required to install Node.js automatically."
  fi
  curl -fsSL "$url" -o "$archive"
  tar -xJf "$archive" -C "$dir"
  rm -rf "$dir/node"
  mv "$dir/node-v${NODE_VERSION}-linux-${arch}" "$dir/node"
  rm -f "$archive"
  printf '%s' "$dir/node/bin/node"
}

if ! command -v git >/dev/null 2>&1; then
  confirm_install "git" && install_system_package git ||
    die "git is required."
fi
if [[ -e "$install_dir/.git" ]]; then
  git -C "$install_dir" fetch origin
  git -C "$install_dir" fetch --tags --force
elif [[ -e "$install_dir" && -n "$(ls -A "$install_dir" 2>/dev/null)" ]]; then
  die "Installation directory exists and is not an existing Metis AI checkout: $install_dir"
else
  mkdir -p "$(dirname "$install_dir")"
  git clone "$REPO_URL" "$install_dir"
fi
if [[ -n "$commit_sha" ]]; then
  update_ref="$commit_sha"
  git -C "$install_dir" fetch origin "$commit_sha"
  git -C "$install_dir" checkout --force --detach "$update_ref"
else
  update_ref="$release_version"
  git -C "$install_dir" checkout --force "$update_ref"
fi
# Installer updates replace tracked local edits and divergent commits with the
# selected upstream ref. Ignored install state (including .env and data) stays.
git -C "$install_dir" reset --hard "$update_ref"

restore_stashed_data "$data_dir"


node_bin=""
node_home=""
pnpm_home=""
{
  node_bin="$(install_node "$install_dir")"
  node_home="$(dirname "$(dirname "$node_bin")")"
  export PATH="$node_home/bin:$install_dir/node_modules/.bin:$PATH"
  npm_bin="$(command -v npm)" || die "npm is required to install pnpm."
  pnpm_prefix="$install_dir/.runtime/pnpm"
  "$npm_bin" install --global --prefix "$pnpm_prefix" pnpm@9
  pnpm_home="$pnpm_prefix/bin"
  export PATH="$pnpm_home:$PATH"
  [[ -x "$pnpm_home/pnpm" ]] || die "pnpm installation did not create an executable at $pnpm_home/pnpm."
}

rand_hex() {
  openssl rand -hex 32 2>/dev/null || {
    if [[ -n "$node_home" ]]; then
      "$node_home/bin/node" -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
    else
      die "openssl is required to generate secrets for installation."
    fi
  }
}
secrets_key="$(rand_hex)"
mcp_token="$(rand_hex)"

mkdir -p "$data_dir" "$agent_cwd"
adopt_env_stash "$install_dir"
{
  write_env_line APP_NAME "Metis AI"
  write_env_line PORT "$port"
  write_env_line AI_CHAT_HOST "$ai_chat_host"
  write_env_line CHAT_DATA_DIR "$data_dir"
  write_env_line AGENT_CWD "$agent_cwd"
  write_env_line AI_CHAT_ROOT "$install_dir"
  write_env_line AI_CHAT_INSTALL_DIR "$install_dir"
  write_env_line AI_CHAT_PUBLIC_URL "$public_url"
  write_env_line AI_CHAT_SERVICE_NAME "$service_name"
  write_env_line AI_CHAT_WORKER_CONCURRENCY "25"
  write_env_line AI_CHAT_MCP_STATE_DIR "$data_dir/mcp-state"
  write_env_line AI_CHAT_INTERNAL_URL "http://127.0.0.1:$port/api/internal/mcp-question"
  write_env_line AI_CHAT_SECRETS_KEY "$secrets_key"
  write_env_line MCP_PORT "$mcp_port"
  write_env_line MCP_PUBLIC_URL "http://127.0.0.1:$mcp_port"
  write_env_line MCP_BEARER_TOKEN "$mcp_token"
  printf 'MCP_ALLOW_REMOTE_ADMIN=false\n'
  printf 'MCP_ENABLE_REMOTE_SERVERS=false\n'
  printf 'MCP_ENABLE_OPTIONAL_SERVERS=false\n'
  write_env_line METIS_WORKSPACE "$agent_cwd"
  write_env_line METIS_DATA_DIR "$data_dir"
  write_env_line AI_CHAT_BIND "$ai_chat_host"
  write_env_line AI_CHAT_ALLOW_ROOT_AGENTS "$allow_root_agents"
  write_env_line METIS_NODE_BIN "$node_bin"
  write_env_line METIS_NODE_HOME "$node_home"
  write_env_line METIS_PNPM_HOME "$pnpm_home"
} > "$install_dir/.env"
chmod 600 "$install_dir/.env"
merge_preserved_env "$install_dir/.env"
upsert_env_key "$install_dir/.env" NODE_ENV "production"
apply_merged_runtime_ports "$install_dir/.env"

cat > "$install_dir/run-service.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
set +a
export PATH="${METIS_PNPM_HOME:+$METIS_PNPM_HOME:}${METIS_NODE_HOME:+$METIS_NODE_HOME/bin:}$ROOT/node_modules/.bin:/usr/local/bin:/usr/bin:/bin${PATH:+:$PATH}"
cd "$ROOT"
exec "${METIS_NODE_BIN:?METIS_NODE_BIN is missing from .env}" "$@"
EOF
chmod 700 "$install_dir/run-service.sh"

ensure_native_build_tools
(
  unset NODE_ENV
  set -a
  # shellcheck disable=SC1091
  . "$install_dir/.env"
  set +a
  export PATH="${METIS_PNPM_HOME:+$METIS_PNPM_HOME:}${METIS_NODE_HOME:+$METIS_NODE_HOME/bin:}$PATH"
  cd "$install_dir"
  "$METIS_PNPM_HOME/pnpm" install --frozen-lockfile
  node scripts/sync-provider-clis.mjs
  # Minimal Linux hosts also need the shared libraries used by Chromium.
  pnpm exec playwright install --with-deps chromium
  current_build_slot="${NEXT_DIST_DIR:-}"
  if [[ "$current_build_slot" == ".next-a" ]]; then
    next_build_slot=".next-b"
  else
    next_build_slot=".next-a"
  fi
  bash scripts/build-production-slot.sh "$next_build_slot"
  upsert_env_key "$install_dir/.env" NEXT_DIST_DIR "$next_build_slot"
)

if command -v systemctl >/dev/null 2>&1; then
  service_dir="/etc/systemd/system"
  write_unit() {
    local unit="$1" description="$2" protect_system="$3" no_new_privileges="$4" exec_start arg read_write_paths=""
    shift 4
    exec_start="\"$install_dir/run-service.sh\""
    for arg in "$@"; do
      exec_start="$exec_start \"$arg\""
    done
    if [[ "$protect_system" == "full" ]]; then
      read_write_paths="ReadWritePaths=\"$data_dir\""
      case "$install_dir" in
        /etc|/etc/*|/usr|/usr/*|/boot|/boot/*)
          if [[ "$install_dir" != "$data_dir" ]]; then
            read_write_paths+=$'\n'"ReadWritePaths=\"$install_dir\""
          fi
          ;;
      esac
    fi
    run_privileged tee "$service_dir/$unit" >/dev/null <<EOF
[Unit]
Description=$description
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
Group=$(id -gn)
WorkingDirectory=$install_dir
Environment=HOME=$HOME
Environment=NODE_ENV=production
ExecStart=$exec_start
Restart=always
RestartSec=5
UMask=0077
NoNewPrivileges=$no_new_privileges
PrivateTmp=true
ProtectSystem=$protect_system
$read_write_paths
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ProtectKernelLogs=true
ProtectClock=true
ProtectHostname=true
LockPersonality=true
RestrictSUIDSGID=true
RestrictRealtime=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
EOF
  }
  write_unit "${service_name}.service" "Metis AI" full true "$install_dir/scripts/run-installed-service.cjs" app
  write_unit "${service_name}-worker.service" "Metis AI worker" full true "$install_dir/scripts/run-installed-service.cjs" worker
  # The MCP gateway is the explicit host-administration boundary. It keeps
  # system writes and privilege transitions available, while app/worker agents
  # run with a read-only system tree and no-new-privileges.
  write_unit "${service_name}-mcp.service" "Metis AI MCP gateway" false false "$install_dir/scripts/run-installed-service.cjs" mcp
  run_privileged systemctl daemon-reload
  run_privileged systemctl enable "${service_name}.service" "${service_name}-worker.service" "${service_name}-mcp.service"
  run_privileged systemctl restart "${service_name}.service" "${service_name}-worker.service" "${service_name}-mcp.service"
fi
if command -v curl >/dev/null 2>&1; then
  health_tries=30
  wait_for_health "http://127.0.0.1:$port/api/status" "$health_tries" ||
    die "The application did not become healthy. Check systemctl status ${service_name}.service."
  wait_for_frontend_assets "http://127.0.0.1:$port" ||
    die "The application started, but its browser assets are not available. Check systemctl status ${service_name}.service."
  wait_for_health "http://127.0.0.1:$mcp_port/health" "$health_tries" ||
    die "The MCP gateway did not become healthy on port $mcp_port."
fi

printf '1\n' > "$install_dir/.metis-package-updates-v1"
install_method="native"
{
  printf '{'
  printf '"installDir":%s,' "$(json_str "$install_dir")"
  printf '"dataDir":%s,' "$(json_str "$data_dir")"
  printf '"agentCwd":%s,' "$(json_str "$agent_cwd")"
  printf '"serviceName":%s,' "$(json_str "$service_name")"
  printf '"host":%s,' "$(json_str "$ai_chat_host")"
  printf '"os":"linux",'
  printf '"installMethod":%s,' "$(json_str "$install_method")"
  printf '"createdAt":%s' "$(json_str "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
  printf '}\n'
} > "$install_dir/.metis-ai-install.json"
chmod 600 "$install_dir/.metis-ai-install.json"
cp "$install_dir/install/uninstall.sh" "$install_dir/uninstall.sh"
chmod 700 "$install_dir/uninstall.sh"
if [[ "$ai_chat_host" == "0.0.0.0" ]]; then
  printf 'Warning: the web application is reachable on the local network. Use strong credentials and a firewall or trusted TLS reverse proxy.\n'
fi
printf '\n%s installed successfully.\nOpen: %s\nYou can change this. Add: %s\n' \
  "$APP_NAME" "$public_url" "$install_dir/.env"
printf 'Security: prefer a dedicated unprivileged service user and separate OS users for multiuser agent isolation.\n'
printf 'First setup requires the setup token from the local file: %s\nRead it locally; do not publish it or copy it into logs.\n' "$data_dir/setup-token"
printf 'Uninstall: %s --install-dir %q --keep-data\n' "$install_dir/uninstall.sh" "$install_dir"
