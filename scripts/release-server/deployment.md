# WheelMaker deployment guide for an SSH-capable AI

This is an execution runbook for deploying a new WheelMaker Registry entry machine. Read it before running commands. The caller supplies the server IP, the public domain, and a usable SSH login. The AI may execute normal installation steps over SSH, but must stop and ask at the explicit gates below.

This guide deploys WheelMaker at the HTTPS root URL:

```text
https://<domain>/
```

It does not deploy the WheelMaker release server, clone a project, install an external coding agent, or configure model-provider API keys.

## Operating rules

- Do not ask the caller to paste a private SSH key or password into chat. Use the SSH agent, an existing key path, or the platform's secure SSH connector.
- Treat the caller's server as production data. Do not run `git clone`, source builds, `rm -rf` against broad paths, firewall flushes, or blind Nginx replacements.
- Standard package installation, service setup, Nginx backup, and firewall additions may run automatically.
- Stop and ask the caller before choosing the WheelMaker OS user, accepting the Registry Token, replacing an existing same-domain Nginx site, or proceeding after a safety check fails.
- Never claim success until the final HTTPS, WebSocket, service, and listener checks pass.
- Never put a Registry Token or provider key in a command line, Nginx file, log, public document, or diagnostic output.

## Required caller inputs

Collect these values before connecting:

| Input | Requirement |
| --- | --- |
| `SERVER_IP` | IPv4 or IPv6 address used for SSH and DNS verification. |
| `DOMAIN` | A real DNS name, without `https://`, a path, or a port. |
| `SSH_LOGIN` | SSH username plus the secure key/agent/connector needed to log in. |

The domain's A/AAAA record must already point to `SERVER_IP`. The AI may verify DNS, but it does not edit the caller's DNS provider. Port 80 and port 443 must be reachable from the public Internet for certificate issuance and HTTPS access.

## Supported target

The current public release contains a prebuilt Linux AMD64 Hub. Before changing anything, check:

```bash
uname -s
uname -m
node --version 2>/dev/null || true
systemctl --user --version
```

Continue only when all of these are true:

- the operating system is Linux;
- the machine architecture is `x86_64`/`amd64`;
- `systemd --user` is available and can be kept alive after logout;
- Node.js is `22.15.0` or newer, or can be installed from a trusted system source.

Stop with a clear explanation for ARM64, another CPU architecture, a container without a usable systemd user manager, or a target that would require compiling WheelMaker from source. Do not work around this by downloading an unverified binary.

## 1. Inspect the server before installing

Run read-only checks first:

```bash
id
cat /etc/os-release
command -v apt-get dnf yum apk pacman zypper || true
getent ahosts "$DOMAIN" || true
ss -ltnp
nginx -T 2>/dev/null || true
systemctl --user show-environment
```

Record:

- the detected distribution and package manager;
- the current SSH port and active firewall manager;
- whether Nginx is already installed;
- whether `DOMAIN` is already used by an active Nginx server block;
- whether `127.0.0.1:9630` is already occupied;
- whether `/var/www/wheelmaker` or the selected state directory already exists.

If another Nginx server block already claims `DOMAIN`, stop and ask the caller. Do not replace it. If Nginx is absent, install it using the distribution's trusted package manager.

Back up only the files that will be changed. A backup must be recoverable before any Nginx reload:

```bash
backup_dir="/root/wheelmaker-deploy-backup-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$backup_dir"
```

Do not delete an existing backup or existing application data.

## 2. Install runtime dependencies

Install only the dependencies needed by this runbook and the chosen distribution's normal security updates:

- Node.js `22.15.0+`;
- Nginx;
- Certbot;
- `curl` and a current CA certificate bundle;
- `openssl` for certificate verification;
- `sudo`/`runuser` if the selected operating user requires it;
- the distribution's firewall tool, if one is already in use.

Use the distribution's trusted package source or the official Node.js distribution channel. Do not install Go, npm dependencies, the WheelMaker source tree, or a compiler toolchain. Verify the final runtime:

```bash
node --version
nginx -v
certbot --version
```

If Node.js is below `22.15.0`, do not run the WheelMaker installer yet.

## 3. Choose the WheelMaker operating user

Ask the caller to choose one:

1. Run WheelMaker as the SSH login user.
2. Create/use a dedicated unprivileged user such as `wheelmaker`.

Use the selected user for `~/.wheelmaker`, the Hub process, and `systemd --user`. Run only privileged operations as root or through `sudo`.

Enable lingering for the selected user so the user services survive logout:

```bash
sudo loginctl enable-linger "$RUN_USER"
sudo -iu "$RUN_USER" systemctl --user show-environment
```

If this fails, stop. Do not replace the user service with an undocumented root daemon.

## 4. Install the prebuilt WheelMaker release

Run the following as `RUN_USER`, not as an unrelated root process. The command can run from any directory:

```bash
d="$HOME/.wheelmaker" && mkdir -p "$d" && curl --fail --location --progress-bar --proto '=https' --tlsv1.2 'https://release.wheelmaker.top/deploy.mjs' --output "$d/deploy.mjs" && node "$d/deploy.mjs" migrate-uninstall && node "$d/deploy.mjs"
```

The launcher verifies the public release metadata, the deployment scripts, the manifest, and the platform archive with the release SHA-256 chain. It installs the Hub and Web under:

```text
$HOME/.wheelmaker/
├── bin/wheelmaker
├── web/
├── staging/
├── deploy.mjs
├── deploy-core.mjs
├── release.json
└── config.json
```

The fresh installation must keep `projects` empty. Do not clone a repository or add a project path during this run.

## 5. Confirm the Registry Token

The installer creates a cryptographically random 32-byte default Token when no configuration exists. The AI must not silently choose a different value.

1. Generate or read the proposed Token on the server.
2. Show the proposed value only to the caller in the private deployment conversation.
3. Ask the caller to confirm it or provide a replacement.
4. Use the confirmed value for `registry.token`.

The default generation command is:

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
```

If the caller supplies a custom value, require it to be non-empty and warn that short Tokens are weaker. Never put the literal Token into a shell command, process argument, Nginx file, or log. Pass it through an in-memory environment value or secure prompt when updating the JSON.

The resulting `config.json` must contain this shape while preserving unrelated existing fields:

```json
{
  "projects": [],
  "registry": {
    "listen": true,
    "port": 9630,
    "server": "127.0.0.1",
    "token": "<caller-confirmed-token>",
    "hubId": "<stable-unique-hub-id>"
  },
  "log": {
    "level": "warn"
  }
}
```

Write the file atomically as `RUN_USER` and enforce mode `0600`. Restart the selected user's Hub after changing it:

```bash
sudo -iu "$RUN_USER" systemctl --user restart wheelmaker-hub.service
```

Provider API keys are not part of this deployment. After browser login, configure them from WheelMaker's **Settings → Server** page if needed.

## 6. Make the Web directory readable by Nginx

The current reference server keeps the private WheelMaker state in the selected user's home and bind-mounts the state directory at `/var/www/wheelmaker`. This avoids granting Nginx access to a private home directory while keeping `web/` and the Hub state in one installation root.

Use the selected user's actual home directory:

```bash
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
STATE_DIR="$RUN_HOME/.wheelmaker"
WEB_MOUNT=/var/www/wheelmaker

sudo install -d -o root -g root -m 0755 "$WEB_MOUNT"
sudo mount --bind "$STATE_DIR" "$WEB_MOUNT"
```

Before adding persistence, verify that `findmnt -T "$WEB_MOUNT"` reports the expected source. Then add this exact bind mount to `/etc/fstab` and run `mount -a`:

```text
<state-dir> /var/www/wheelmaker none bind 0 0
```

If the mount point is already mounted from another source, stop and ask the caller. Do not unmount an unrelated application.

## 7. Configure Nginx

The reference deployment uses two Nginx files:

1. An upgrade map, usually in `/etc/nginx/conf.d/wheelmaker-upgrade-map.conf`:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}
```

2. A dedicated site in `/etc/nginx/sites-available/<domain>`, linked into `sites-enabled`.

The following is the root-path configuration. Replace `<domain>` and the certificate paths only; keep `/ws` as a prefix location.

### Temporary HTTP configuration for Certbot

Install this first, test it, and reload Nginx. It exposes only the ACME challenge and does not expose the application over HTTP:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name <domain>;
    root /var/www/wheelmaker/web;

    location ^~ /.well-known/acme-challenge/ {
        try_files $uri =404;
    }

    location / {
        return 404;
    }
}
```

Run `nginx -t` before `systemctl reload nginx`. If the test fails, restore the backup and stop.

### Request the trusted HTTPS certificate

After DNS and port 80 are verified, request a publicly trusted certificate. If the caller gives an email address, pass it to Certbot; otherwise use the no-email registration flag and report that choice:

```bash
sudo certbot certonly --webroot --non-interactive --agree-tos --register-unsafely-without-email --webroot-path /var/www/wheelmaker/web --domain "$DOMAIN"
```

Do not use a self-signed certificate, do not ignore certificate errors, and do not continue with HTTP if this fails.

### Final HTTPS configuration

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name <domain>;
    root /var/www/wheelmaker/web;

    location ^~ /.well-known/acme-challenge/ {
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name <domain>;
    root /var/www/wheelmaker/web;
    index index.html;
    autoindex off;

    ssl_certificate /etc/letsencrypt/live/<domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<domain>/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;

    location /ws {
        proxy_pass http://127.0.0.1:9630;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }

    location = / {
        try_files /index.html =404;
        add_header Cache-Control "no-cache, must-revalidate" always;
    }

    location = /index.html {
        try_files /index.html =404;
        add_header Cache-Control "no-cache, must-revalidate" always;
    }

    location = /service-worker.js {
        try_files /service-worker.js =404;
        add_header Cache-Control "no-cache, must-revalidate" always;
    }

    location = /manifest.webmanifest {
        try_files /manifest.webmanifest =404;
        add_header Cache-Control "no-cache, must-revalidate" always;
    }

    location ~* \.[a-z0-9]+$ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, must-revalidate" always;
    }
}
```

The `/ws` rule must remain a prefix location. It carries login/status/logout HTTP requests, WebSocket upgrades, and `/ws/preview/`; an exact `location = /ws` breaks preview responses. Do not add the retired `/monitor/` route from an old server configuration.

Run:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

If `nginx -t` fails, restore the backed-up site file and do not reload the broken configuration.

## 8. Configure the host firewall

Detect the active firewall manager and make the smallest safe change:

- preserve the current SSH port before changing anything;
- allow TCP 80 and TCP 443;
- do not allow TCP 9630 from the public network;
- do not flush, reset, or replace unknown firewall rules;
- if the cloud provider firewall cannot be changed through this SSH session, report that the caller must allow 80/443 there.

For UFW or firewalld, use their native service/port commands. For nftables or an unknown policy, inspect and ask before adding rules that could affect existing services.

## 9. Final verification

Run all checks as appropriate for the selected user:

```bash
sudo nginx -t
sudo -iu "$RUN_USER" systemctl --user is-active wheelmaker-hub.service
sudo -iu "$RUN_USER" systemctl --user is-enabled wheelmaker-updater.timer
ss -ltnp | grep ':9630'
curl --fail --silent --show-error --head "https://$DOMAIN/"
curl --silent --show-error --head "http://$DOMAIN/"
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' "https://$DOMAIN/ws?auth=status"
openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates
```

Accept only when:

- `https://$DOMAIN/` returns the WheelMaker page;
- HTTP redirects to HTTPS;
- the certificate is valid and trusted;
- `/ws?auth=status` reaches WheelMaker rather than returning a proxy 404/502;
- the Hub and updater timer are active/enabled;
- `9630` is bound only to loopback;
- no public firewall rule exposes 9630.

The caller can now open the page and log in with the confirmed Registry Token. Do not include the Token in the final deployment summary; identify only its protected file path.

## Failure behavior

On any failed preflight, unsupported platform check, Token decision, DNS check, certificate request, Nginx test, firewall safety check, service check, or HTTPS check:

1. stop the deployment;
2. do not claim success;
3. keep the protected backup and report its path;
4. report the exact failed check and the smallest next action;
5. never remove unrelated applications or expose the loopback Registry port to recover automatically.
