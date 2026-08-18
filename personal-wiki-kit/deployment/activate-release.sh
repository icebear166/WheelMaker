#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="{{INSTALL_ROOT}}"
SERVICE_USER="{{SERVICE_USER}}"
ARCHIVE="${1:-}"
EXPECTED_SHA256="${2:-}"
RELEASE_ID="${3:-}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "activation must run as root" >&2
  exit 1
fi
if [[ "$(basename "${ARCHIVE}")" != personal-wiki-release-*.tar.gz ]]; then
  echo "archive must match personal-wiki-release-*.tar.gz" >&2
  exit 1
fi
if [[ "${ARCHIVE}" != "${INSTALL_ROOT}/incoming/$(basename "${ARCHIVE}")" || ! "${EXPECTED_SHA256}" =~ ^[a-f0-9]{64}$ || ! "${RELEASE_ID}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "invalid activation arguments" >&2
  exit 1
fi

exec 9>"${INSTALL_ROOT}/activate.lock"
flock -x 9
printf '%s  %s\n' "${EXPECTED_SHA256}" "${ARCHIVE}" | sha256sum --check --strict

CANDIDATE="${INSTALL_ROOT}/releases/.candidate-${RELEASE_ID}"
RELEASE="${INSTALL_ROOT}/releases/${RELEASE_ID}"
CURRENT="${INSTALL_ROOT}/current"
NEXT="${INSTALL_ROOT}/.current-next"
[[ ! -e "${CANDIDATE}" && ! -e "${RELEASE}" ]]
mkdir -m 0750 "${CANDIDATE}"
trap 'rm -rf -- "${CANDIDATE}" "${NEXT}"' EXIT
if tar -tzf "${ARCHIVE}" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "archive contains an unsafe path" >&2
  exit 1
fi
tar -xzf "${ARCHIVE}" -C "${CANDIDATE}" --no-same-owner --no-same-permissions
chown -R root:"${SERVICE_USER}" "${CANDIDATE}"
chmod -R o-rwx "${CANDIDATE}"
[[ -x "${CANDIDATE}/kit/bin/wiki-server" ]]
"${CANDIDATE}/kit/bin/wiki-server" verify-root --root "${CANDIDATE}/site"

mv "${CANDIDATE}" "${RELEASE}"
OLD_TARGET="$(readlink "${CURRENT}" 2>/dev/null || true)"
SWITCHED=0
rollback() {
  if [[ "${SWITCHED}" -eq 1 ]]; then
    if [[ -n "${OLD_TARGET}" ]]; then
      ln -sfn "${OLD_TARGET}" "${NEXT}"
      mv -Tf "${NEXT}" "${CURRENT}"
      systemctl restart personal-wiki.service || true
    else
      rm -f -- "${CURRENT}"
      systemctl stop personal-wiki.service || true
    fi
  fi
  rm -rf -- "${RELEASE}"
}
trap 'status=$?; if [[ $status -ne 0 ]]; then rollback; fi; rm -rf -- "${CANDIDATE}" "${NEXT}"; exit $status' EXIT
ln -sfn "${RELEASE}" "${NEXT}"
mv -Tf "${NEXT}" "${CURRENT}"
SWITCHED=1
systemctl restart personal-wiki.service
for _attempt in $(seq 1 30); do
  if curl --fail --silent --show-error http://127.0.0.1:{{LISTEN_PORT}}/healthz >/dev/null; then
    SWITCHED=0
    rm -f -- "${ARCHIVE}"
    exit 0
  fi
  sleep 1
done
echo "candidate health check failed" >&2
exit 1
