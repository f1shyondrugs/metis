#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/../../../.." && pwd)"
ENV="$ROOT/.runtime/social-video-downloader"
UV="$(command -v uv || true)"
if [[ -z "$UV" && -x "$HOME/.local/bin/uv" ]]; then UV="$HOME/.local/bin/uv"; fi
if [[ -z "$UV" ]]; then echo "uv is required; no system Python packages were changed." >&2; exit 1; fi
if [[ ! -x "$ENV/bin/python" ]]; then "$UV" venv --python 3.12 "$ENV"; fi
"$UV" pip install --python "$ENV/bin/python" -r "$HERE/../requirements.txt"
python3 "$HERE/download.py" --doctor
