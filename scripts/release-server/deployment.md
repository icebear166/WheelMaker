# WheelMaker Release Server deployment

The Release Server is deployed independently from product releases. It runs as
the SSH login user, listens on `127.0.0.1:9680`, and serves both the publishing
API and all anonymous public files. Nginx or the built-in Gateway only needs to
reverse proxy the complete public origin to that loopback listener.

## Boundaries and paths

- The SSH configuration chooses the remote login user. Workspace and Release
  Server must use the same user when they share a machine and should contribute
  sites to one Gateway Home.
- The deployment uses the login user's Home. It does not require `/srv`,
  `www-data`, ACL tools, or access to a legacy service.
- It manages the Release Server user-level systemd unit, but does not install,
  stop, reload, or configure Nginx, Caddy, DNS, certificates, or firewalls.

```text
~/.wheelmaker/release-server/config.json
~/.wheelmaker/release-server/versions/<source-sha>/wheelmaker-release-server
~/.wheelmaker/release-server/current
~/.wheelmaker/release-server/data/public
~/.wheelmaker/release-server/data/staging
~/.config/systemd/user/wheelmaker-release-server.service

~/.wheelmaker/gateway/sites/release-server.json
```

`config.json` owns `publicUrl`, `listen`, `dataRoot`, and the publishing Token
digest. The public URL comes from `scripts/release/channel.json`. Every deploy
preserves the Token and data path, updates `publicUrl`, and regenerates the
Gateway site declaration. That declaration has a fixed
`http://127.0.0.1:9680` upstream and no static `publicRoot`.

Writing the site declaration does not imply that Gateway is installed. Existing
Nginx deployments can ignore it.

## Deployment command

Run from a clean source tree:

```text
deploy-release-server.bat
```

The command takes no Gateway selector. It reads the HTTPS origin and SSH host
from `scripts/release/channel.json`, cross-compiles the Linux/amd64 binary,
uploads a short-lived staging directory, and invokes the remote transaction.
SSH aliases and `User` settings determine the actual login name; no
`root@...` target is embedded in the script.

The remote transaction installs the version, upgrades the configuration,
starts the user service, checks loopback health, writes the site declaration,
and removes the upload. A failure before commit retains the previous installed
version.

## Reverse proxy contract

Release Server itself provides `/`, top-level deployment scripts, release
metadata, version assets, `/healthz`, and `/api/*`. Proxy the entire host:

```nginx
server {
    listen 443 ssl;
    server_name release.example.com;

    # Configure ssl_certificate and ssl_certificate_key here.
    location / {
        proxy_pass http://127.0.0.1:9680;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Nginx workers do not need permission to read `~/.wheelmaker`. Public files
support GET, HEAD, CORS, and byte ranges. API authentication remains unchanged.

To use the built-in Caddy-based entry point, run the independent command from
the public homepage:

```text
node ~/.wheelmaker/deploy.mjs gateway
```

It idempotently installs or upgrades Gateway, registers its startup service,
and ensures it is running. Workspace and Release Server deployments never
invoke this lifecycle command.

## TLS and external ports

Gateway interprets an `https://` `publicUrl` as automatic certificate
management. DNS and the required public ports must already route to the host.
An explicit external port in `publicUrl` is retained in HTTP-to-HTTPS
redirects. Release Server deployment does not manage those prerequisites.

## Publisher Token and publication recovery

The first local public publish creates
`~/.wheelmaker/release-server.json` locally and sends only its SHA-256 digest to
the remote `configure-token` command. The raw Token never appears in a URL,
public file, or site declaration.

During a publish, `stable.json` is made visible last. The server then downloads
the new public metadata, deployment scripts, manifests, and ranged assets
through `config.json.publicUrl`. If that public verification fails, it restores
the previous stable pointer and all derived public files before returning the
failure.

Old `/srv` or system-service installations are outside normal deployment. Move
their data and disable the old service as a separate, one-time operator action
before reusing port `9680`.
