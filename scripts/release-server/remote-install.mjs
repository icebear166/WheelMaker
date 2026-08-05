export function buildRemoteInstallScript() {
  return String.raw`#!/usr/bin/env bash
set -Eeuo pipefail

source_sha="$1"
public_url="$2"
upload_dir="$3"
gateway_mode="$4"
legacy_unit="wheelmaker-release-server.service"
user_unit="wheelmaker-release-server.service"
deploy_user="$(id -un)"
deploy_group="$(id -gn)"
deploy_uid="$(id -u)"
deploy_home="$(getent passwd "$deploy_user" | awk -F: 'NR == 1 {print $6}')"
release_home="$deploy_home/.wheelmaker/release-server"
versions_home="$deploy_home/.wheelmaker/release-server/versions"
current_link="$release_home/current"
config_path="$release_home/config.json"
unit_home="$deploy_home/.config/systemd/user"
unit_path="$deploy_home/.config/systemd/user/wheelmaker-release-server.service"
data_root="/srv/wheelmaker-release"
public_root="$data_root/public"
legacy_config="/etc/wheelmaker-release-server/config.json"
preflight_complete=0
rollback_armed=$((0))
legacy_exists=0
legacy_active=inactive
legacy_enabled=disabled
user_active=inactive
user_enabled=disabled
linger_before=no
previous_current=""
unit_backup=""
unit_existed=0
config_backup=""
config_existed=0
acl_backup=""
acl_existed=0
asset_backup_dir=""
index_backup_exists=0
home_backup_exists=0
assets_changed=0
gateway_site_path=""
gateway_site_backup=""
gateway_site_existed=0
gateway_site_changed=0

root_command() {
  if [ "$deploy_uid" -eq 0 ]; then
    "$@"
  else
    sudo -n "$@"
  fi
}

user_systemctl() {
  XDG_RUNTIME_DIR="/run/user/$deploy_uid" systemctl --user "$@"
}

restore_boolean_service_state() {
  manager="$1"
  enabled="$2"
  active="$3"
  unit="$4"
  if [ "$manager" = root ]; then
    if [ "$enabled" = enabled ]; then root_command systemctl enable "$unit"; else root_command systemctl disable "$unit"; fi
    if [ "$active" = active ]; then root_command systemctl start "$unit"; else root_command systemctl stop "$unit"; fi
  else
    if [ "$enabled" = enabled ]; then user_systemctl enable "$unit"; else user_systemctl disable "$unit"; fi
    if [ "$active" = active ]; then user_systemctl start "$unit"; else user_systemctl stop "$unit"; fi
  fi
}

rollback() {
  status="$1"
  trap - ERR INT TERM
  set +e
  if [ "$rollback_armed" -eq 1 ]; then
    user_systemctl stop "$user_unit"
    if [ -n "$previous_current" ]; then
      ln -sfn "$previous_current" "$current_link.next"
      mv -Tf "$current_link.next" "$current_link"
    else
      rm -f "$current_link"
    fi
    if [ "$config_existed" -eq 1 ] && [ -f "$config_backup" ]; then
      cp -f "$config_backup" "$config_path"
    else
      rm -f "$config_path"
    fi
    if [ "$unit_existed" -eq 1 ] && [ -f "$unit_backup" ]; then
      cp -f "$unit_backup" "$unit_path"
    else
      rm -f "$unit_path"
    fi
    user_systemctl daemon-reload
    restore_boolean_service_state user "$user_enabled" "$user_active" "$user_unit"
    if [ "$assets_changed" -eq 1 ]; then
      if [ "$index_backup_exists" -eq 1 ]; then
        root_command cp -f "$asset_backup_dir/index.html" "$public_root/index.html"
      else
        root_command rm -f "$public_root/index.html"
      fi
      if [ "$home_backup_exists" -eq 1 ]; then
        root_command cp -f "$asset_backup_dir/release-home.js" "$public_root/release-home.js"
      else
        root_command rm -f "$public_root/release-home.js"
      fi
    fi
    if [ "$gateway_site_changed" -eq 1 ]; then
      if [ "$gateway_site_existed" -eq 1 ] && [ -f "$gateway_site_backup" ]; then
        cp -f "$gateway_site_backup" "$gateway_site_path"
      else
        rm -f "$gateway_site_path"
      fi
    fi
    if [ "$acl_existed" -eq 1 ] && [ -f "$acl_backup" ]; then
      root_command setfacl --restore="$acl_backup"
    fi
    if [ "$legacy_exists" -eq 1 ]; then
      if [ "$legacy_enabled" = enabled ]; then root_command systemctl enable "$legacy_unit"; else root_command systemctl disable "$legacy_unit"; fi
      if [ "$legacy_active" = active ]; then
        root_command systemctl start "$legacy_unit"
      else
        legacy_restore_action=stop
        root_command systemctl "$legacy_restore_action" "$legacy_unit"
      fi
    fi
    if [ "$linger_before" != yes ]; then
      root_command loginctl disable-linger "$deploy_user"
    fi
  fi
  exit "$status"
}

trap 'rollback $?' ERR INT TERM

case "$source_sha" in
  *[!0-9a-f]*|'') echo "invalid source SHA" >&2; exit 1 ;;
esac
[ "$(printf '%s' "$source_sha" | wc -c)" -eq 40 ] || { echo "invalid source SHA length" >&2; exit 1; }
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
[ "$upload_dir" = "/tmp/wheelmaker-release-server-$source_sha" ] || { echo "invalid upload directory" >&2; exit 1; }
case "$gateway_mode" in
  none|caddy) ;;
  *) echo "gateway mode must be none or caddy" >&2; exit 1 ;;
esac

[ "$(uname -s)" = "Linux" ] && [ "$(uname -m)" = "x86_64" ] || {
  echo "release server requires Linux/amd64" >&2
  exit 1
}

for command in curl getent systemctl loginctl getfacl setfacl; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "required remote command is missing: $command" >&2
    exit 1
  }
done

if [ "$deploy_uid" -ne 0 ]; then
  sudo -n true
fi
deploy_home="$(getent passwd "$deploy_user" | awk -F: 'NR == 1 {print $6}')"
case "$deploy_home" in
  /*) ;;
  *) echo "could not resolve an absolute login Home" >&2; exit 1 ;;
esac
[ -n "$deploy_home" ] || { echo "login Home is empty" >&2; exit 1; }
export XDG_RUNTIME_DIR="/run/user/$deploy_uid"
XDG_RUNTIME_DIR="/run/user/$deploy_uid" systemctl --user show-environment >/dev/null

[ -d "$upload_dir" ] || { echo "uploaded release directory is missing" >&2; exit 1; }
[ -f "$upload_dir/wheelmaker-release-server" ] || { echo "uploaded release binary is missing" >&2; exit 1; }
[ -x "$upload_dir/wheelmaker-release-server" ] || { echo "uploaded release binary is not executable" >&2; exit 1; }
[ -f "$upload_dir/wheelmaker-release-server.service" ] || { echo "uploaded user unit is missing" >&2; exit 1; }
[ -f "$upload_dir/index.html" ] || { echo "uploaded homepage is missing" >&2; exit 1; }
[ -f "$upload_dir/release-home.js" ] || { echo "uploaded homepage script is missing" >&2; exit 1; }

install -d -m 0700 "$release_home" "$versions_home" "$unit_home"
version_dir="$versions_home/$source_sha"
install -d -m 0700 "$version_dir"
stage_binary="$version_dir/wheelmaker-release-server"
config_candidate="$release_home/.config-$source_sha.candidate"
install -m 0755 "$upload_dir/wheelmaker-release-server" "$stage_binary"
install -m 0644 "$upload_dir/wheelmaker-release-server.service" "$unit_path.candidate"
install -m 0644 "$upload_dir/index.html" "$release_home/.index-$source_sha.candidate"
install -m 0644 "$upload_dir/release-home.js" "$release_home/.release-home-$source_sha.candidate"

if [ -f "$config_path" ]; then
  cp -f "$config_path" "$config_candidate"
elif root_command test -f "$legacy_config"; then
  root_command cat "$legacy_config" > "$config_candidate"
else
  printf '%s\n' '{"schema":1,"listen":"127.0.0.1:9680","dataRoot":"/srv/wheelmaker-release","tokenSha256":""}' > "$config_candidate"
fi
chmod 0640 "$config_candidate"
"$stage_binary" validate-config --config "$config_candidate"

if root_command systemctl cat "$legacy_unit" >/dev/null 2>&1; then
  legacy_exists=1
fi
legacy_active="$(root_command systemctl is-active "$legacy_unit" 2>/dev/null || true)"
[ -n "$legacy_active" ] || legacy_active=inactive
legacy_enabled="$(root_command systemctl is-enabled "$legacy_unit" 2>/dev/null || true)"
[ -n "$legacy_enabled" ] || legacy_enabled=disabled
user_active="$(user_systemctl is-active "$user_unit" 2>/dev/null || true)"
[ -n "$user_active" ] || user_active=inactive
user_enabled="$(user_systemctl is-enabled "$user_unit" 2>/dev/null || true)"
[ -n "$user_enabled" ] || user_enabled=disabled
linger_before="$(root_command loginctl show-user "$deploy_user" -p Linger --value 2>/dev/null || true)"
[ "$linger_before" = yes ] || linger_before=no
if [ -L "$current_link" ]; then
  previous_current="$(readlink "$current_link")"
fi
if [ -f "$unit_path" ]; then
  unit_existed=1
  unit_backup="$release_home/.service-$source_sha.backup"
  cp -f "$unit_path" "$unit_backup"
fi
if [ -f "$config_path" ]; then
  config_existed=1
  config_backup="$release_home/.config-$source_sha.backup"
  cp -f "$config_path" "$config_backup"
fi
if root_command test -d "$data_root"; then
  acl_backup="$release_home/.acl-$source_sha.backup"
  root_command getfacl -R -p "$data_root" > "$acl_backup"
  acl_existed=1
fi
preflight_complete=1

[ "$preflight_complete" -eq 1 ] || { echo "release server preflight did not complete" >&2; exit 1; }
rollback_armed=1
root_command loginctl enable-linger "$deploy_user"
if [ "$legacy_exists" -eq 1 ]; then
  root_command systemctl stop "$legacy_unit"
  root_command systemctl disable "$legacy_unit"
fi

root_command install -d -o "$deploy_user" -g www-data -m 2770 "$data_root"
root_command install -d -o "$deploy_user" -g www-data -m 2770 "$public_root"
root_command setfacl -m "u:$deploy_user:rwx,m::rwx" "$data_root"
root_command setfacl -R -m "u:$deploy_user:rwX" "$data_root"
root_command setfacl -m "u:$deploy_user:rwx,g:www-data:r-x,m::rwx" "$public_root"
root_command setfacl -d -m "u::rwx,u:$deploy_user:rwx,g::r-x,g:www-data:r-x,m::rwx" "$public_root"
root_command chgrp -R www-data "$public_root"
root_command setfacl -R -m "g:www-data:rX" "$public_root"
root_command chmod g+s "$public_root"

install -m 0640 "$config_candidate" "$config_path.next"
mv -Tf "$config_path.next" "$config_path"
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
    if curl --fail --silent --show-error "$health_url" >/dev/null; then
      health_ready=1
      break
    fi
    sleep 1
  done
  [ "$health_ready" -eq 1 ] || { echo "health check timed out: $health_url" >&2; return 1; }
}

poll_health http://127.0.0.1:9680/healthz
poll_health "$public_url/healthz"

asset_backup_dir="$release_home/.asset-backup-$source_sha"
install -d -m 0700 "$asset_backup_dir"
if root_command test -f "$public_root/index.html"; then
  root_command cp -p "$public_root/index.html" "$asset_backup_dir/index.html"
  index_backup_exists=1
fi
if root_command test -f "$public_root/release-home.js"; then
  root_command cp -p "$public_root/release-home.js" "$asset_backup_dir/release-home.js"
  home_backup_exists=1
fi
root_command install -o "$deploy_user" -g www-data -m 0640 "$release_home/.index-$source_sha.candidate" "$public_root/index.html"
root_command install -o "$deploy_user" -g www-data -m 0640 "$release_home/.release-home-$source_sha.candidate" "$public_root/release-home.js"
assets_changed=1

if [ "$gateway_mode" = "caddy" ]; then
  gateway_home="$deploy_home/.wheelmaker/gateway"
  gateway_sites="$deploy_home/.wheelmaker/gateway/sites"
  gateway_site_path="$deploy_home/.wheelmaker/gateway/sites/release-server.json"
  install -d -m 0700 "$gateway_sites"
  if [ -f "$gateway_site_path" ]; then
    gateway_site_existed=1
    gateway_site_backup="$gateway_sites/.release-server-$source_sha.backup"
    cp -f "$gateway_site_path" "$gateway_site_backup"
  fi
  gateway_site_tmp="$gateway_sites/.release-server-$source_sha.tmp"
  printf '{"schema":1,"kind":"release-server","publicUrl":"%s","publicRoot":"/srv/wheelmaker-release/public","upstream":"http://127.0.0.1:9680","tls":{"certificateFile":"","keyFile":""}}\n' "$public_url" > "$gateway_site_tmp"
  chmod 0600 "$gateway_site_tmp"
  mv -Tf "$gateway_site_tmp" "$gateway_site_path"
  gateway_site_changed=1
fi

rollback_armed=0
rm -f "$config_candidate" "$config_backup" "$unit_path.candidate" "$unit_backup"
rm -f "$release_home/.index-$source_sha.candidate" "$release_home/.release-home-$source_sha.candidate"
rm -rf -- "$asset_backup_dir"
if [ "$gateway_site_existed" -eq 1 ]; then
  rm -f "$gateway_site_backup"
fi
if [ "$acl_existed" -eq 1 ]; then
  rm -f "$acl_backup"
fi
rm -rf -- "$upload_dir"
`;
}
