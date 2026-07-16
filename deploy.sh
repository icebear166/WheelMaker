#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
repo_root="$(pwd)"
install_dir="${HOME}/.wheelmaker"
source_deploy="${repo_root}/scripts/deploy/deploy.mjs"
deploy_script="${install_dir}/deploy.mjs"

cat <<'BANNER'
============================================
  WheelMaker All-in-One Deploy
============================================

  migrate legacy runtime, then install the signed stable release
  supports macOS and Linux

============================================
BANNER

case "$(uname -s)" in
  Darwin|Linux)
    ;;
  MINGW*|MSYS*|CYGWIN*)
    echo "[FAILED] deploy.sh supports macOS and Linux. Use deploy.bat on Windows." >&2
    exit 1
    ;;
  *)
    echo "[FAILED] deploy.sh supports macOS and Linux only. Use deploy.bat on Windows." >&2
    exit 1
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "[FAILED] Node.js 22 or newer is required" >&2
  exit 1
fi
node_major="$(node -p "process.versions.node.split('.')[0]")"
if [ "$node_major" -lt 22 ]; then
  echo "[FAILED] Node.js 22 or newer is required; found $(node --version)" >&2
  exit 1
fi
if [ ! -f "$source_deploy" ]; then
  echo "[FAILED] Deployment launcher is missing: $source_deploy" >&2
  exit 1
fi

mkdir -p "$install_dir"
cp "$source_deploy" "$deploy_script"

echo "[INFO] Removing the legacy runtime..."
node "$deploy_script" migrate-uninstall
echo "[INFO] Installing the signed stable release..."
node "$deploy_script"

echo
echo "[OK] deploy complete"
