#!/usr/bin/env bash
# tabcrew-chrome installer for macOS and Linux (current user). Same as: node install/install.mjs
#   ./install/install-unix.sh              install or update
#   ./install/install-unix.sh --uninstall  remove
set -euo pipefail
command -v node >/dev/null || { echo "Node.js 18+ is required (https://nodejs.org)" >&2; exit 1; }
exec node "$(cd "$(dirname "$0")" && pwd)/install.mjs" "$@"
