export function buildRemoteInstallScript() {
  return String.raw`#!/usr/bin/env bash
set -Eeuo pipefail

source_sha="$1"
public_url="$2"
upload_dir="$3"
user_unit="wheelmaker-release-server.service"
deploy_user="$(id -un)"
deploy_uid="$(id -u)"
deploy_home="$HOME"
case "$deploy_home" in
  /*) ;;
  *) echo "login Home is not absolute" >&2; exit 1 ;;
esac
release_home="$deploy_home/.wheelmaker/release-server"
gateway_home="$deploy_home/.wheelmaker/gateway"
legacy_config_path="$release_home/config.json"
versions_home="$release_home/versions"
data_root="$release_home/data"
public_root="$data_root/public"
staging_root="$data_root/staging"
gateway_config_path="$gateway_home/config.json"
current_link="$release_home/current"
unit_home="$deploy_home/.config/systemd/user"
unit_path="$unit_home/$user_unit"

rollback_armed=0
release_home_existed=0
data_root_existed=0
previous_current=""
unit_existed=0
unit_backup=""
config_existed=0
config_backup=""
legacy_config_existed=0
legacy_config_backup=""
legacy_config_removed=0
user_active=inactive
user_enabled=disabled
linger_before=no
linger_changed=0
asset_backup_dir=""
index_backup_exists=0
home_backup_exists=0
deployment_backup_exists=0
deployment_zh_backup_exists=0
assets_changed=0

user_systemctl() {
  XDG_RUNTIME_DIR="/run/user/$deploy_uid" systemctl --user "$@"
}

enable_linger() {
  if [ "$deploy_uid" -eq 0 ]; then
    loginctl enable-linger "$deploy_user"
  else
    sudo -n loginctl enable-linger "$deploy_user"
  fi
}

disable_linger() {
  if [ "$deploy_uid" -eq 0 ]; then
    loginctl disable-linger "$deploy_user"
  else
    sudo -n loginctl disable-linger "$deploy_user"
  fi
}

restore_user_service_state() {
  if [ "$user_enabled" = enabled ]; then
    user_systemctl enable "$user_unit" || true
  else
    user_systemctl disable "$user_unit" || true
  fi
  if [ "$user_active" = active ]; then
    user_systemctl start "$user_unit" || true
  else
    user_systemctl stop "$user_unit" || true
  fi
}

rollback() {
  status="$1"
  trap - ERR INT TERM
  set +e
  if [ "$rollback_armed" -eq 1 ]; then
    user_systemctl stop "$user_unit" || true
    if [ -n "$previous_current" ]; then
      ln -sfn "$previous_current" "$current_link.next"
      mv -Tf "$current_link.next" "$current_link"
    else
      rm -f "$current_link"
    fi
    if [ "$config_existed" -eq 1 ] && [ -f "$config_backup" ]; then
      cp -f "$config_backup" "$gateway_config_path"
    else
      rm -f "$gateway_config_path"
    fi
    if [ "$legacy_config_removed" -eq 1 ]; then
      if [ "$legacy_config_existed" -eq 1 ] && [ -f "$legacy_config_backup" ]; then
        cp -f "$legacy_config_backup" "$legacy_config_path"
      else
        rm -f "$legacy_config_path"
      fi
    fi
    if [ "$unit_existed" -eq 1 ] && [ -f "$unit_backup" ]; then
      cp -f "$unit_backup" "$unit_path"
    else
      rm -f "$unit_path"
    fi
    user_systemctl daemon-reload || true
    restore_user_service_state
    if [ "$assets_changed" -eq 1 ]; then
      if [ "$index_backup_exists" -eq 1 ]; then
        cp -f "$asset_backup_dir/index.html" "$public_root/index.html"
      else
        rm -f "$public_root/index.html"
      fi
      if [ "$home_backup_exists" -eq 1 ]; then
        cp -f "$asset_backup_dir/release-home.js" "$public_root/release-home.js"
      else
        rm -f "$public_root/release-home.js"
      fi
      if [ "$deployment_backup_exists" -eq 1 ]; then
        cp -f "$asset_backup_dir/deployment.md" "$public_root/deployment.md"
      else
        rm -f "$public_root/deployment.md"
      fi
      if [ "$deployment_zh_backup_exists" -eq 1 ]; then
        cp -f "$asset_backup_dir/deployment.zh-CN.md" "$public_root/deployment.zh-CN.md"
      else
        rm -f "$public_root/deployment.zh-CN.md"
      fi
    fi
    if [ "$linger_changed" -eq 1 ]; then
      disable_linger || true
    fi
    if [ "$data_root_existed" -eq 0 ]; then
      rm -rf -- "$data_root"
    fi
    if [ "$release_home_existed" -eq 0 ]; then
      rm -rf -- "$release_home"
    fi
  fi
  rm -f "$gateway_home/.config-$source_sha.candidate" \
    "$release_home/.index-$source_sha.candidate" \
    "$release_home/.release-home-$source_sha.candidate" \
    "$release_home/.deployment-$source_sha.candidate" \
    "$release_home/.deployment-zh-CN-$source_sha.candidate" \
    "$unit_path.candidate" "$unit_path.next" "$gateway_config_path.next" "$current_link.next"
  rm -f "$unit_backup" "$config_backup"
  rm -f "$legacy_config_backup"
  rm -rf -- "$asset_backup_dir"
  rm -rf -- "$upload_dir"
  exit "$status"
}

trap 'rollback $?' ERR INT TERM

case "$source_sha" in
  *[!0-9a-f]*|'') echo "invalid source SHA" >&2; exit 1 ;;
esac
[ "$(printf '%s' "$source_sha" | wc -c)" -eq 40 ] || {
  echo "invalid source SHA length" >&2
  exit 1
}
case "$public_url" in
  https://?*) ;;
  *) echo "release server public URL must use HTTPS" >&2; exit 1 ;;
esac
public_authority="$(printf '%s' "$public_url" | sed 's#^https://##')"
case "$public_authority" in
  ''|*[!A-Za-z0-9.:-]*)
    echo "release server public URL must be a clean HTTPS origin" >&2
    exit 1
    ;;
esac
[ "$upload_dir" = "/tmp/wheelmaker-release-server-$source_sha" ] || {
  echo "invalid upload directory" >&2
  exit 1
}
[ "$(uname -s)" = "Linux" ] && [ "$(uname -m)" = "x86_64" ] || {
  echo "release server requires Linux/amd64" >&2
  exit 1
}

for command in curl systemctl loginctl; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "required remote command is missing: $command" >&2
    exit 1
  }
done

export XDG_RUNTIME_DIR="/run/user/$deploy_uid"
XDG_RUNTIME_DIR="/run/user/$deploy_uid" systemctl --user show-environment >/dev/null

[ -d "$upload_dir" ] || { echo "uploaded release directory is missing" >&2; exit 1; }
[ -f "$upload_dir/wheelmaker-release-server" ] || { echo "uploaded release binary is missing" >&2; exit 1; }
[ -f "$upload_dir/wheelmaker-release-server.service" ] || { echo "uploaded user unit is missing" >&2; exit 1; }
[ -f "$upload_dir/index.html" ] || { echo "uploaded homepage is missing" >&2; exit 1; }
[ -f "$upload_dir/release-home.js" ] || { echo "uploaded homepage script is missing" >&2; exit 1; }
[ -f "$upload_dir/deployment.md" ] || { echo "uploaded English deployment guide is missing" >&2; exit 1; }
[ -f "$upload_dir/deployment.zh-CN.md" ] || { echo "uploaded Chinese deployment guide is missing" >&2; exit 1; }

if [ -d "$release_home" ]; then release_home_existed=1; fi
if [ -d "$data_root" ]; then data_root_existed=1; fi
if [ -L "$current_link" ]; then previous_current="$(readlink "$current_link")"; fi
user_active="$(user_systemctl is-active "$user_unit" 2>/dev/null || true)"
[ -n "$user_active" ] || user_active=inactive
user_enabled="$(user_systemctl is-enabled "$user_unit" 2>/dev/null || true)"
[ -n "$user_enabled" ] || user_enabled=disabled
linger_before="$(loginctl show-user "$deploy_user" -p Linger --value 2>/dev/null || true)"
[ "$linger_before" = yes ] || linger_before=no

install -d -m 0700 "$release_home" "$gateway_home" "$versions_home" "$data_root" "$public_root" "$staging_root" "$unit_home"
version_dir="$versions_home/$source_sha"
install -d -m 0700 "$version_dir"
stage_binary="$version_dir/wheelmaker-release-server"
gateway_config_candidate="$gateway_home/.config-$source_sha.candidate"
install -m 0755 "$upload_dir/wheelmaker-release-server" "$stage_binary"
install -m 0644 "$upload_dir/wheelmaker-release-server.service" "$unit_path.candidate"
install -m 0644 "$upload_dir/index.html" "$release_home/.index-$source_sha.candidate"
install -m 0644 "$upload_dir/release-home.js" "$release_home/.release-home-$source_sha.candidate"
install -m 0644 "$upload_dir/deployment.md" "$release_home/.deployment-$source_sha.candidate"
install -m 0644 "$upload_dir/deployment.zh-CN.md" "$release_home/.deployment-zh-CN-$source_sha.candidate"

if [ -f "$legacy_config_path" ]; then
  legacy_config_existed=1
  legacy_config_backup="$release_home/.legacy-config-$source_sha.backup"
  cp -f "$legacy_config_path" "$legacy_config_backup"
fi
if [ -f "$gateway_config_path" ]; then
  cp -f "$gateway_config_path" "$gateway_config_candidate"
elif [ -f "$legacy_config_path" ]; then
  "$stage_binary" migrate-config --legacy-config "$legacy_config_path" --gateway-config "$gateway_config_candidate" --data-root "$data_root"
else
  printf '{"schema":2,"acme":{"email":""},"wm_sites":{"tls":{"certificateFile":"","keyFile":""},"registry":{"urlMode":"sync_hub"},"release":{"publicUrl":"","listen":"127.0.0.1:9680","dataRoot":"%s","tokenSha256":""},"share":{"urlMode":"sync_hub"}}}\n' "$data_root" > "$gateway_config_candidate"
fi
chmod 0600 "$gateway_config_candidate"
"$stage_binary" configure-public-url --config "$gateway_config_candidate" --public-url "$public_url" --data-root "$data_root"
"$stage_binary" validate-config --config "$gateway_config_candidate"

if [ -f "$unit_path" ]; then
  unit_existed=1
  unit_backup="$release_home/.service-$source_sha.backup"
  cp -f "$unit_path" "$unit_backup"
fi
if [ -f "$gateway_config_path" ]; then
  config_existed=1
  config_backup="$release_home/.config-$source_sha.backup"
  cp -f "$gateway_config_path" "$config_backup"
fi
rollback_armed=1

if [ "$linger_before" != yes ]; then
  enable_linger
  linger_changed=1
fi

install -m 0600 "$gateway_config_candidate" "$gateway_config_path.next"
mv -Tf "$gateway_config_path.next" "$gateway_config_path"
install -m 0644 "$unit_path.candidate" "$unit_path.next"
mv -Tf "$unit_path.next" "$unit_path"
ln -sfn "versions/$source_sha" "$current_link.next"
mv -Tf "$current_link.next" "$current_link"
user_systemctl daemon-reload
user_systemctl enable "$user_unit"
user_systemctl restart "$user_unit"

poll_health() {
  health_url="$1"
  health_ready=0
  for attempt in $(seq 1 30); do
    if curl --fail --silent "$health_url" >/dev/null 2>&1; then
      health_ready=1
      break
    fi
    sleep 1
  done
  [ "$health_ready" -eq 1 ] || {
    echo "health check timed out: $health_url" >&2
    return 1
  }
}

poll_health http://127.0.0.1:9680/healthz

asset_backup_dir="$release_home/.asset-backup-$source_sha"
install -d -m 0700 "$asset_backup_dir"
if [ -f "$public_root/index.html" ]; then
  cp -p "$public_root/index.html" "$asset_backup_dir/index.html"
  index_backup_exists=1
fi
if [ -f "$public_root/release-home.js" ]; then
  cp -p "$public_root/release-home.js" "$asset_backup_dir/release-home.js"
  home_backup_exists=1
fi
if [ -f "$public_root/deployment.md" ]; then
  cp -p "$public_root/deployment.md" "$asset_backup_dir/deployment.md"
  deployment_backup_exists=1
fi
if [ -f "$public_root/deployment.zh-CN.md" ]; then
  cp -p "$public_root/deployment.zh-CN.md" "$asset_backup_dir/deployment.zh-CN.md"
  deployment_zh_backup_exists=1
fi
assets_changed=1
install -m 0640 "$release_home/.index-$source_sha.candidate" "$public_root/index.html"
install -m 0640 "$release_home/.release-home-$source_sha.candidate" "$public_root/release-home.js"
install -m 0640 "$release_home/.deployment-$source_sha.candidate" "$public_root/deployment.md"
install -m 0640 "$release_home/.deployment-zh-CN-$source_sha.candidate" "$public_root/deployment.zh-CN.md"

if [ -f "$legacy_config_path" ]; then
  rm -f "$legacy_config_path"
  legacy_config_removed=1
fi

rollback_armed=0
trap - ERR INT TERM
rm -f "$gateway_config_candidate" "$config_backup" "$unit_path.candidate" "$unit_backup"
rm -f "$release_home/.index-$source_sha.candidate" "$release_home/.release-home-$source_sha.candidate" \
  "$release_home/.deployment-$source_sha.candidate" "$release_home/.deployment-zh-CN-$source_sha.candidate"
rm -rf -- "$asset_backup_dir"
rm -f "$legacy_config_backup"
rm -rf -- "$upload_dir"
`;
}
