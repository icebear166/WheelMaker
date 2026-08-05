# WheelMaker Release Server deployment

This document describes the current hard-migrated deployment flow. It does not
install or manage an external reverse proxy.

## Boundaries

- The Go `wheelmaker-release-server` process runs as the non-root
  `wheelmaker-release` user and listens only on `127.0.0.1:9680`.
- `wheelmaker-gateway` is a separate host service with embedded Caddy. Install
  it first with the explicit Gateway deployment mode (`node deploy.mjs gateway`).
- This deployment never installs, upgrades, starts, stops, disables, or removes
  Nginx/Caddy, and never changes DNS, firewall, cloud security groups, or TLS
  certificates. To disable an old Nginx service, run the standalone
  `scripts/disable-nginx.sh` or `.ps1` helper.
- `~/.wheelmaker/release-server.json` remains the publisher token file; the
  token is never put in a command line, URL, public file, or site configuration.

## Preconditions

1. Confirm the channel in `scripts/release/channel.json` is the intended HTTPS
   origin and that DNS plus public ports 80/443 point to the host.
2. Confirm the host is Linux/amd64 and has `go`, `ssh`, `scp`, `systemd`, and
   `curl`. The release service owns its data under `/srv/wheelmaker-release`.
3. Install Gateway separately as the intended non-root user. Its installer
   records the absolute Home in `/etc/wheelmaker-gateway/home` and creates the
   `start.sh`/`stop.sh` wrappers.

If `/etc/wheelmaker-gateway/home` or the Gateway binary is missing, the Release
Server deployment stops with an actionable instruction to run the explicit
Gateway deployment. It verifies the recorded Home with `wheelmaker-gateway
paths --home` and never guesses another user's Home.

## Automated deployment

Run `deploy-release-server.bat` from a clean source tree. The script:

1. reads the channel URL and uses the fixed root SSH identity;
2. checks the remote Linux/amd64 architecture;
3. cross-compiles the Go service with `CGO_ENABLED=0`;
4. uploads only the service binary, systemd unit, and public homepage assets;
5. atomically switches `/opt/wheelmaker-release-server/current` and restarts
   only `wheelmaker-release-server.service`;
6. writes and validates the Gateway-owned semantic site file:

   ```json
   {
     "schema": 1,
     "kind": "release-server",
     "publicUrl": "https://release.wheelmaker.top",
     "publicRoot": "/srv/wheelmaker-release/public",
     "upstream": "http://127.0.0.1:9680",
     "tls": {"certificateFile": "", "keyFile": ""}
   }
   ```

   The site is written atomically to
   `<gateway-home>/sites/release-server.json`. The Release Server user keeps
   write access to its data; the Gateway user receives only read/traverse ACLs
   for the public tree.

7. runs `wheelmaker-gateway validate --home <gateway-home>` and
   `render --home <gateway-home>`;
8. checks `http://127.0.0.1:9680/healthz`. If the Gateway admin endpoint is
   available, it hot-loads the generated JSON. If Gateway is stopped, it stays
   stopped and the site applies on the next manual Gateway `start`.

Public HTTPS health is informational in this flow: a stopped Gateway or DNS
cutover must not be reported as a failed Go service deployment.

## Gateway TLS and routes

The semantic site owns no raw Caddyfile or arbitrary Caddy JSON. For an
`https://` URL with empty certificate fields, embedded Caddy obtains and renews
ACME certificates under Gateway Home. A complete certificate/key pair uses
those files; `http://` explicitly disables TLS. ACME/DNS/port failures are
reported and never silently downgraded to HTTP or a self-signed certificate.

Gateway serves anonymous `GET`/`HEAD`/Range files from `publicRoot`, proxies
`/api/*` and `/healthz` to loopback, and keeps upload validation in the Go
service. The Release Server deployment does not edit `config.json`,
`workspace.json`, or generated Caddy JSON directly.

## Failure and recovery

- A dirty source tree, unsupported remote architecture, missing Gateway metadata,
  invalid semantic site, or failed loopback health check aborts before reporting
  success.
- Existing release data and Gateway configuration are not deleted on failure.
- The Gateway service lifecycle is independent: ordinary `node deploy.mjs
  update` does not inspect or restart it.
