#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
server=""
token=""
permission_mode="user"
install_dir="${METIS_REMOTE_CLIENT_DIR:-${HOME:?HOME is required}/.metis-ai/remote-client}"
dry_run=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --server|--enrollment-token|--permission-mode|--install-dir)
      [[ $# -ge 2 && -n "$2" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      case "$1" in --server) server="$2";; --enrollment-token) token="$2";; --permission-mode) permission_mode="$2";; --install-dir) install_dir="$2";; esac
      shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    --help) printf '%s\n' 'Usage: remote-client.sh --server URL --enrollment-token CODE [--permission-mode user|admin] [--install-dir PATH] [--dry-run]'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done
[[ "$permission_mode" == user || "$permission_mode" == admin ]] || { printf 'Invalid permission mode\n' >&2; exit 2; }
case "$(uname -s)" in Darwin) platform=darwin; os_name=macos;; Linux) platform=linux; os_name=linux;; *) printf 'Only macOS and Linux are supported\n' >&2; exit 2;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64;; aarch64|arm64) arch=arm64;; *) printf 'Unsupported architecture: %s\n' "$(uname -m)" >&2; exit 2;; esac
[[ "$install_dir" == /* && "$install_dir" != / && "$install_dir" != "$HOME" && "$install_dir" != *$'\n'* && "$install_dir" != *$'\r'* ]] || { printf 'Use an absolute installation directory below your home directory\n' >&2; exit 2; }
[[ "$server" =~ ^https?://[^[:space:]\'\"\`\$]+$ && -n "$token" ]] || { printf '%s\n' '--server URL and --enrollment-token are required' >&2; exit 2; }
base_url="${server%/}"
if [[ "$dry_run" == true ]]; then
  printf 'platform: %s\narchitecture: %s\ninstall dir: %s\nmode: %s\n' "$os_name" "$arch" "$install_dir" "$permission_mode"
  exit 0
fi
command -v curl >/dev/null || { printf 'curl is required\n' >&2; exit 1; }
command -v tar >/dev/null || { printf 'tar is required\n' >&2; exit 1; }
mkdir -p "$install_dir/releases"
chmod 700 "$install_dir"
install_lock="$install_dir/.install.lock"
mkdir "$install_lock" 2>/dev/null || { printf 'Another installer is active (or a stale .install.lock needs inspection).\n' >&2; exit 1; }
stage=""
committed=false
cleanup() {
  if [[ "$committed" != true && -n "$stage" ]]; then rm -rf -- "$stage"; fi
  rmdir "$install_lock"
}
trap cleanup EXIT
stage="$(mktemp -d "$install_dir/releases/release.XXXXXX")"
download() { curl --fail --location --silent --show-error --connect-timeout 15 --max-time 180 --retry 3 "$1" -o "$2"; }
# A private, checksummed Node runtime removes Homebrew, PATH and global npm assumptions.
runtime_url="https://nodejs.org/dist/latest-v22.x"
download "$runtime_url/SHASUMS256.txt" "$stage/SHASUMS256.txt"
archive="$(awk -v suffix="-$platform-$arch.tar.gz" 'substr($2,length($2)-length(suffix)+1)==suffix { print $2; exit }' "$stage/SHASUMS256.txt")"
[[ "$archive" =~ ^node-v22\.[0-9]+\.[0-9]+-(darwin|linux)-(x64|arm64)\.tar\.gz$ ]] || { printf 'No compatible Node runtime found\n' >&2; exit 1; }
download "$runtime_url/$archive" "$stage/$archive"
expected="$(awk -v file="$archive" '$2==file {print $1}' "$stage/SHASUMS256.txt")"
if command -v sha256sum >/dev/null; then actual="$(sha256sum "$stage/$archive" | awk '{print $1}')"
else actual="$(shasum -a 256 "$stage/$archive" | awk '{print $1}')"; fi
[[ "$actual" == "$expected" ]] || { printf 'Node runtime checksum mismatch\n' >&2; exit 1; }
tar -xzf "$stage/$archive" -C "$stage"
mv "$stage/${archive%.tar.gz}" "$stage/runtime"
rm "$stage/$archive" "$stage/SHASUMS256.txt"
export PATH="$stage/runtime/bin:$PATH"
for file in release-retention.mjs remote-client.mjs file-edit.mjs computer-use.mjs computer-use-worker.mjs computer-use-unix.mjs desktop-preview.mjs desktop-preview-command.mjs metis-desktop-helper.swift remote-client-uninstall.sh; do
  download "$base_url/install/$file" "$stage/$file"
done
mv "$stage/remote-client.mjs" "$stage/client.mjs"
mv "$stage/remote-client-uninstall.sh" "$stage/uninstall.sh"
printf '{"private":true,"type":"module","dependencies":{"ws":"8.21.2"}}\n' > "$stage/package.json"
(cd "$stage" && npm install --omit=dev --no-audit --no-fund --ignore-scripts)
node --check "$stage/client.mjs"
node --check "$stage/computer-use.mjs"
if [[ "$platform" == darwin ]]; then
  if xcrun --find swiftc >/dev/null 2>&1; then
    xcrun swiftc -O "$stage/metis-desktop-helper.swift" -o "$stage/metis-desktop-helper"
  else
    printf 'File and terminal access will work. For desktop control without Apple developer tools, use the macOS desktop app.\n'
  fi
fi
response="$(curl --fail --silent --show-error --connect-timeout 15 --max-time 30 -X POST "$base_url/api/remote-clients/enroll" \
  -H 'Content-Type: application/json' \
  --data "$(node -e 'const os=require("node:os"); console.log(JSON.stringify({token:process.argv[1],permissionMode:process.argv[2],os:process.argv[3],name:os.hostname(),hostname:os.hostname(),architecture:process.arch,version:"1.4.0",capabilities:process.argv[2]==="admin"?["user_files","user_processes","user_directories","system_files","services","disks","admin_processes"]:["user_files","user_processes","user_directories"]}))' "$token" "$permission_mode" "$os_name")")"
node -e 'const fs=require("node:fs"),v=JSON.parse(process.argv[1]); if(!v.client?.id||!v.credential||v.client.permissionMode!==process.argv[4]) throw Error("Enrollment failed or access mode mismatch"); fs.writeFileSync(process.argv[2],JSON.stringify({server:process.argv[3],clientId:v.client.id,credential:v.credential,permissionMode:process.argv[4]})+"\n",{mode:0o600})' "$response" "$stage/config.json" "$base_url" "$permission_mode"
client_id="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1])).clientId' "$stage/config.json")"
# Config belongs to the release too: changing current switches code and pairing atomically.
previous="$(readlink "$install_dir/current" 2>/dev/null || true)"
ln -s "$stage" "$install_dir/current.new"
node -e 'require("node:fs").renameSync(process.argv[1],process.argv[2])' "$install_dir/current.new" "$install_dir/current"
committed=true
printf '#!/usr/bin/env bash\nset -eu\ncd -P %q\nexport PATH="$PWD/runtime/bin:$PATH"\nexec "$PWD/runtime/bin/node" "$PWD/client.mjs" --config "$PWD/config.json"\n' "$install_dir/current" > "$install_dir/run-client.sh"
chmod 700 "$install_dir/run-client.sh"
service_suffix="$(printf '%s' "$install_dir" | cksum | awk '{print $1}')"
service_name="metis-ai-remote-client-$service_suffix"
plist="$HOME/Library/LaunchAgents/com.metis-ai.remote-client-$service_suffix.plist"
: > "$stage/client.log"
start_service() {
  if [[ "$platform" == darwin ]]; then
    mkdir -p "$HOME/Library/LaunchAgents"
    node -e 'const fs=require("node:fs"),escape=s=>s.replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;","\"":"&quot;"}[c])); const dir=process.argv[1]; fs.writeFileSync(process.argv[2],`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>com.metis-ai.remote-client-${process.argv[3]}</string><key>ProgramArguments</key><array><string>${escape(dir+"/run-client.sh")}</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>StandardOutPath</key><string>${escape(dir+"/current/launcher.log")}</string><key>StandardErrorPath</key><string>${escape(dir+"/current/launcher-error.log")}</string></dict></plist>`)' "$install_dir" "$plist" "$service_suffix"
    launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$plist"
  elif command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
    mkdir -p "$HOME/.config/systemd/user"
    node -e 'const fs=require("node:fs"); const q=s=>"\""+s.replace(/[%\\"]/g,c=>c==="%"?"%%":"\\"+c)+"\""; fs.writeFileSync(process.argv[2],"[Unit]\nDescription=Metis AI remote client\n[Service]\nExecStart="+q(process.argv[1]+"/run-client.sh")+"\nRestart=always\nRestartSec=5\n[Install]\nWantedBy=default.target\n")' "$install_dir" "$HOME/.config/systemd/user/$service_name.service"
    for variable in DISPLAY XAUTHORITY DBUS_SESSION_BUS_ADDRESS XDG_SESSION_TYPE WAYLAND_DISPLAY; do
      if [[ -n "${!variable:-}" ]]; then systemctl --user import-environment "$variable"; fi
    done
    systemctl --user daemon-reload
    systemctl --user enable "$service_name.service"
    systemctl --user restart "$service_name.service"
  else
    printf 'No user service manager is available. Starting in this session; launch run-client.sh again after login.\n'
    nohup "$install_dir/run-client.sh" >"$stage/launcher.log" 2>&1 < /dev/null &
    printf '%s\n' "$!" > "$install_dir/client.pid"
  fi
}
if ! start_service; then
  if [[ -n "$previous" ]]; then ln -s "$previous" "$install_dir/current.rollback"; node -e 'require("node:fs").renameSync(process.argv[1],process.argv[2])' "$install_dir/current.rollback" "$install_dir/current"; start_service || true; fi
  printf 'Client startup failed. Previous release restored when available.\n' >&2
  exit 1
fi
connected=false
for ((attempt=0; attempt<30; attempt++)); do
  if awk -v client_id="$client_id" '$2=="authenticated" && $3==client_id { found=1 } END {exit !found}' "$stage/client.log" 2>/dev/null; then connected=true; break; fi
  sleep 1
done
if [[ "$connected" != true ]]; then
  tail -n 30 "$stage/client.log" "$stage/launcher-error.log" "$stage/launcher.log" 2>/dev/null >&2 || true
  if [[ -n "$previous" ]]; then ln -s "$previous" "$install_dir/current.rollback"; node -e 'require("node:fs").renameSync(process.argv[1],process.argv[2])' "$install_dir/current.rollback" "$install_dir/current"; start_service || true; fi
  printf 'No authenticated connection after 30 seconds. Check the server URL and network. Previous release restored when available.\n' >&2
  exit 1
fi
# Prune only after this exact new release authenticated. Preserve one rollback,
# recent/in-use releases, and unrelated directories. Cleanup failure is non-fatal.
node --input-type=module - "$stage/release-retention.mjs" "$install_dir/releases" "$stage" "$previous" <<'NODE' || printf 'Old-release cleanup deferred.\n' >&2
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";
const [moduleFile, root, active, previous] = process.argv.slice(2);
if (fs.realpathSync(path.join(root, "..", "current")) !== fs.realpathSync(active)) throw new Error("Active release changed");
const { pruneManagedReleases } = await import(pathToFileURL(moduleFile));
const result = pruneManagedReleases({
  root, active, previous: previous ? path.resolve(root, "..", previous) : undefined,
  pattern: /^release\.[A-Za-z0-9]{6}$/,
  requiredFiles: ["client.mjs", "config.json", "runtime/bin/node"],
});
console.log("Obsolete client releases removed: " + result.removed.length + (result.reason ? " (cleanup deferred: " + result.reason + ")" : ""));
NODE
printf 'Remote client authenticated: %s (%s)\n' "$client_id" "$os_name"
printf 'Start manually: %s/run-client.sh\nRemove this install: bash "%s/current/uninstall.sh" "%s"\n' "$install_dir" "$install_dir" "$install_dir"
