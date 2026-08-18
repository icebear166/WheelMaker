#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="{{INSTALL_ROOT}}"
SERVICE_USER="{{SERVICE_USER}}"
SSH_USER="{{SSH_USER}}"
PASSWORD_HASH_SOURCE="${1:-}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "provision.sh must run as root" >&2
  exit 1
fi
if [[ -z "${PASSWORD_HASH_SOURCE}" || ! -f "${PASSWORD_HASH_SOURCE}" ]]; then
  echo "usage: provision.sh /path/to/password.argon2id" >&2
  exit 1
fi
if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${INSTALL_ROOT}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi
if ! id "${SSH_USER}" >/dev/null 2>&1; then
  echo "SSH deployment user does not exist: ${SSH_USER}" >&2
  exit 1
fi
usermod --append --groups "${SERVICE_USER}" "${SSH_USER}"

install -d -m 0750 -o root -g "${SERVICE_USER}" "${INSTALL_ROOT}" "${INSTALL_ROOT}/releases" "${INSTALL_ROOT}/shared"
install -d -m 0770 -o root -g "${SERVICE_USER}" "${INSTALL_ROOT}/incoming"
install -m 0600 -o root -g root "${PASSWORD_HASH_SOURCE}" "${INSTALL_ROOT}/shared/password.argon2id"
install -m 0750 -o root -g root "$(dirname "$0")/activate-release.sh" "${INSTALL_ROOT}/activate-release.sh"
install -m 0644 -o root -g root "$(dirname "$0")/personal-wiki.service" /etc/systemd/system/personal-wiki.service
install -m 0644 -o root -g root "$(dirname "$0")/Caddyfile" /etc/caddy/Caddyfile
printf '%s ALL=(root) NOPASSWD: %s/activate-release.sh\n' "${SSH_USER}" "${INSTALL_ROOT}" > /etc/sudoers.d/personal-wiki-deploy
chmod 0440 /etc/sudoers.d/personal-wiki-deploy
visudo --check --file=/etc/sudoers.d/personal-wiki-deploy
systemctl daemon-reload
systemctl enable personal-wiki.service caddy.service
systemctl reload caddy.service

echo "Provisioned ${INSTALL_ROOT}. Upload and activate a signed release before starting personal-wiki.service."
