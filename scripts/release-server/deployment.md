# WheelMaker Release Server deployment

The Release Server deployment is independent of the product release version.
It builds and migrates the loopback Go service as the SSH login user. Gateway
configuration is optional data owned by the component; the deployment never
installs, starts, stops, reloads, validates, or renders Caddy or Nginx.

## Boundaries and paths

- The service listens only on `127.0.0.1:9680`.
- The SSH configuration chooses the remote login user. Workspace and Release
  Server must use the same user when they share a machine.
- The login user needs noninteractive `sudo` for `/srv/wheelmaker-release`, the
  legacy system-service state, ACL backup/restore, and login linger.
- The service runs as the login user's user-level systemd unit:

  ```text
  ~/.wheelmaker/release-server/config.json
  ~/.wheelmaker/release-server/versions/<source-sha>/wheelmaker-release-server
  ~/.wheelmaker/release-server/current
  ~/.config/systemd/user/wheelmaker-release-server.service
  /srv/wheelmaker-release
  ```

- `--gateway=none` does not create or modify Gateway files.
- `--gateway=caddy` atomically writes only
  `~/.wheelmaker/gateway/sites/release-server.json`; it does not require Caddy
  to be installed or running.
- The independent Gateway lifecycle remains available through the explicit
  Workspace `gateway`, `gateway-update`, `start`, and `stop` commands. The
  standalone `scripts/disable-nginx.sh` and `.ps1` helpers remain independent
  tools for stopping and disabling an old Nginx service.

## Deployment commands

Run from a clean source tree:

```text
deploy-release-server.bat --gateway=none
  Deploy/migrate the Release Server and do not touch Gateway files.

deploy-release-server.bat --gateway=caddy
  Perform the same deploy/migration and atomically write
  ~/.wheelmaker/gateway/sites/release-server.json.
```

Omitting the option is equivalent to `none`. The option changes only whether
the Release Server semantic site file is written; it never changes the binary
download, staging, migration, health checks, or service lifecycle.

The local script reads the HTTPS origin from `scripts/release/channel.json`,
uses the SSH identity configured for the channel host, checks Linux/amd64,
cross-compiles with `CGO_ENABLED=0`, uploads a short-lived staging directory,
and invokes the remote transaction. SSH aliases and `User` settings determine
the actual login name; no `root@...` target is embedded in the script.

## Automatic migration from the old system service

The first deployment on an old Nginx machine performs a preflight before
stopping anything. It stages the binary, candidate config, user unit, and
homepage; validates the candidate with `validate-config`; verifies user
systemd, sudo, ACL, and platform prerequisites; copies the existing
`tokenSha256`; and records the old system/user service, linger, symlink, unit,
and data ACL state.

After the preflight it enables user linger, stops and disables only the old
system Release Server unit, grants the login user access to the stable data
root while retaining the `www-data` public group and setgid directory, then
atomically switches the user config, unit, and `current` link. It must pass
both `http://127.0.0.1:9680/healthz` and the public HTTPS `/healthz` check.
Any failure restores the previous service state, link, config, unit, ACLs,
assets, and linger setting. On success the old unit, files, and service user
remain present but disabled, so the existing Nginx configuration and upstream
continue to work unchanged. Caddy is not needed for this migration.

## Gateway TLS and routes

The `caddy` option writes a semantic site with the fixed loopback upstream and
empty certificate fields. An independently managed embedded Caddy interprets
an `https://` public URL as automatic ACME certificate management. The Release
Server deployment does not call a Caddy admin API, inspect generated Caddy
JSON, or change Nginx, DNS, firewall, or certificates.

## Publisher Token

The first local public publish creates the local
`~/.wheelmaker/release-server.json` Token document. It sends only the SHA-256
digest to the login user's
`$HOME/.wheelmaker/release-server/current/wheelmaker-release-server` with
`configure-token`, then restarts
`systemctl --user restart wheelmaker-release-server.service`. The raw Token
never appears in a command line, URL, public file, or site configuration.

## Updates and recovery

Normal Workspace updates and Release Server deployments do not inspect or
restart Gateway. A Gateway update is an explicit, separate operation. If a
deployment fails before the remote transaction commits, the temporary upload
is removed and the old Release Server/Nginx serving path remains available.
