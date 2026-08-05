#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' 'Usage: disable-nginx.sh [--dry-run]'
}

dry_run=0
if [ "$#" -gt 1 ]; then
  usage >&2
  exit 2
fi
if [ "$#" -eq 1 ]; then
  case "$1" in
    --dry-run) dry_run=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
fi

if ! command -v systemctl >/dev/null 2>&1; then
  printf '%s\n' 'Could not find systemctl. Stop and disable the known nginx service manually.' >&2
  exit 2
fi

unit=''
for candidate in nginx.service nginx; do
  if systemctl list-unit-files "$candidate" --no-legend 2>/dev/null | awk '{print $1}' | grep -Fxq "$candidate"; then
    unit="$candidate"
    break
  fi
done

if [ -z "$unit" ]; then
  printf '%s\n' 'No known nginx service was detected. No changes were made; inspect the service manager manually.' >&2
  exit 2
fi

if [ "$dry_run" -eq 1 ]; then
  printf 'Would stop and disable %s\n' "$unit"
  exit 0
fi

systemctl stop "$unit" || true
systemctl disable "$unit"
printf 'Stopped and disabled %s. Package, configuration, and certificates were left untouched.\n' "$unit"
