# WheelMaker Release Server deployment

The Release Server deployment is independent of the product release version.
It installs the loopback Go service as the SSH login user. Gateway
configuration is optional data owned by the component; the deployment never
installs, starts, stops, reloads, validates, or renders Caddy or Nginx.

## Boundaries and paths

- The service listens only on `127.0.0.1:9680`.
- The SSH configuration chooses the remote login user. Workspace and Release
  Server must use the same user when they share a machine.
- The login user owns the installation. The transaction only requires the user
  systemd manager and the ability to enable linger when it is not already
  enabled; it never requires `/srv`, `www-data`, ACL tools, or legacy service
  access.
- The service runs as the login user's user-level systemd unit:

  ```text
  ~/.wheelmaker/release-server/config.json
  ~/.wheelmaker/release-server/versions/<source-sha>/wheelmaker-release-server
  ~/.wheelmaker/release-server/current
  ~/.wheelmaker/release-server/data/public
  ~/.wheelmaker/release-server/data/staging
  ~/.config/systemd/user/wheelmaker-release-server.service
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
  Install the Release Server and do not touch Gateway files.

deploy-release-server.bat --gateway=caddy
  Perform the same install and atomically write
  ~/.wheelmaker/gateway/sites/release-server.json.
```

Omitting the option is equivalent to `none`. The option changes only whether
the Release Server semantic site file is written; it never changes the binary
download, staging, health checks, or Gateway lifecycle.

The local script reads the HTTPS origin from `scripts/release/channel.json`,
uses the SSH identity configured for the channel host, checks Linux/amd64,
cross-compiles with `CGO_ENABLED=0`, uploads a short-lived staging directory,
and invokes the remote transaction. SSH aliases and `User` settings determine
the actual login name; no `root@...` target is embedded in the script.

## One-time migration from an old Nginx host

Normal deployment does not inspect, stop, disable, or migrate an old system
service. If the host still serves Release Server from `/srv/wheelmaker-release`,
perform a manual SSH migration after a normal Home installation is ready:

1. Back up `/etc/wheelmaker-release-server/config.json`, the old data tree,
   the old unit, and the matching Release Server Nginx configuration to a
   timestamped directory in the login user's Home.
2. Copy the token digest, release data, and public assets into
   `~/.wheelmaker/release-server/data`; write `config.json` with that absolute
   Home `dataRoot` and retain the old files for rollback.
3. Start and check the user unit's loopback `http://127.0.0.1:9680/healthz`,
   then adjust only the Release Server Nginx static root to
   `~/.wheelmaker/release-server/data/public`. Leave other Nginx sites,
   certificates, and entry points unchanged.
4. After both loopback and external HTTPS `/healthz` checks pass, stop and
   disable the old system unit without deleting it. If either check fails,
   stop the user unit, restore the Nginx backup, and start the old unit.

This migration is an operator procedure, not part of the Node installer and
not a Gateway lifecycle operation.

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
is removed and the previous Home service state remains available.
