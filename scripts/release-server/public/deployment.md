# WheelMaker deployment guide for an SSH-capable AI

This is an execution runbook for a new Linux/amd64 WheelMaker Registry entry machine. It deploys the Hub, Web UI, built-in Gateway, and optional anonymous Share route. Read the whole document before running commands.

The default public layout is:

~~~text
https://<registry-domain>/       WheelMaker Web UI and Registry
https://<share-domain>/s/<token> anonymous document share
~~~

Use the built-in Gateway by default. Enter the Nginx branch only when the caller explicitly says not to use the built-in Gateway. An existing Nginx installation is not an implicit refusal: if it owns ports 80 or 443, stop and ask whether the caller wants to hand those ports to Gateway or explicitly keep Nginx.

## Operating rules

- Never ask the caller to paste an SSH private key or password into chat. Use the SSH agent, an existing key path, or the platform's secure SSH connector.
- Treat the target as a production machine. Do not run git clone, build from source, flush firewall rules, expose loopback ports, or delete broad directories.
- Do not put a Registry Token in a command line, process argument, Nginx file, log, public document, or final report.
- The caller must explicitly choose the WheelMaker operating user and confirm the Registry Token before those decisions are applied.
- Do not replace an existing same-domain Nginx site or an old Gateway configuration without asking.
- Do not claim success until the final service, HTTPS, WebSocket, Share, and listener checks pass.

## Required caller inputs

Collect these values before connecting:

| Input | Requirement |
| --- | --- |
| SERVER_IP | IPv4 or IPv6 address used for SSH and DNS verification. |
| REGISTRY_DOMAIN | DNS name for the WheelMaker entrypoint, without scheme, path, or port. |
| SHARE_DOMAIN | Optional different DNS name for public shares; leave empty when Share is not needed. |
| SSH_LOGIN | SSH username plus the secure key, agent, or connector needed to log in. |

Each non-empty DNS name must point to SERVER_IP before Gateway requests certificates. Gateway uses public TCP ports 80 and 443. Do not use the old arbitrary 28800 entrypoint with the built-in Gateway.

## 1. Inspect the target before changing it

Run read-only checks first:

~~~bash
id
cat /etc/os-release
uname -s
uname -m
node --version 2>/dev/null || true
systemctl --user --version
systemctl --user show-environment
getent ahosts "$REGISTRY_DOMAIN" || true
[ -n "$SHARE_DOMAIN" ] && getent ahosts "$SHARE_DOMAIN" || true
ss -ltnp
command -v nginx && nginx -T 2>/dev/null || true
~~~

Continue only when the target is Linux/amd64 (Linux and x86_64), Node.js is 22.15.0 or newer, and a usable systemd --user manager exists. Stop for ARM64, another operating system, a container without a persistent user manager, or a target that would require compiling WheelMaker.

Record whether:

- another process already owns ports 80, 443, 9630, or 2019;
- Nginx already claims either requested hostname;
- $HOME/.wheelmaker or $HOME/.wheelmaker/gateway/config.json already exists;
- the selected user's systemd manager survives logout.

If an old Gateway config exists, inspect its schema before running the Gateway command. A schema 1 or legacy Gateway file is not automatically migrated or overwritten by v2. Stop and ask the caller for a separate migration decision.

## 2. Choose the operating user and enable lingering

Ask the caller to choose one:

1. the SSH login user; or
2. a dedicated unprivileged user such as wheelmaker.

Use the same user for the Hub, Gateway, $HOME/.wheelmaker, and all user services. Enable lingering for that user:

~~~bash
sudo loginctl enable-linger "$RUN_USER"
sudo -iu "$RUN_USER" systemctl --user show-environment
~~~

If the user manager check fails, stop. Do not replace the user services with an undocumented root daemon.

## 3. Install the prebuilt Hub and Web

Run this as the selected user, not as an unrelated root process. It may run from any directory:

~~~bash
d="$HOME/.wheelmaker" && mkdir -p "$d" && curl --fail --location --progress-bar --proto '=https' --tlsv1.2 'https://release.wheelmaker.top/deploy.mjs' --output "$d/deploy.mjs" && node "$d/deploy.mjs"
~~~

The launcher verifies the public metadata, deployment scripts, manifest, and Linux/amd64 package through their SHA-256 chain. A fresh install creates the Hub and Web under $HOME/.wheelmaker/ and does not require the source repository, Git, Go, npm, or a compiler.

For an existing installation, use the installed node $HOME/.wheelmaker/deploy.mjs update command for a normal Hub/Web update. Do not run migrate-uninstall unless an old runtime or old updater was detected and the caller approved the cleanup.

## 4. Configure the Hub once

The Hub configuration is the only user-facing source for the Registry and Share public addresses. Edit $HOME/.wheelmaker/config.json atomically as the selected user and preserve unrelated existing fields. The relevant entry-machine shape is:

~~~json
{
  "publicUrl": "https://registry.example.com",
  "projects": [],
  "token": "<caller-confirmed-token>",
  "hubId": "hub-a",
  "registry": {
    "listen": true,
    "port": 9630,
    "share": {
      "publicUrl": "https://share.example.com"
    }
  },
  "log": {
    "level": "warn"
  }
}
~~~

If the caller does not want public sharing, keep registry.share.publicUrl empty or omit the share object. Do not put share at the top level. If Share is enabled, use a hostname different from publicUrl; Gateway rejects two routes that use the same hostname.

The Token is shared by the entry machine and trusted Workers. Generate a proposal privately, show it only to the caller, and ask for confirmation:

~~~bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
~~~

Never print the final Token in a deployment transcript. Keep config.json mode 0600.

After changing Hub configuration, restart the Hub using the generated wrapper:

~~~bash
"$HOME/.wheelmaker/stop.sh"
"$HOME/.wheelmaker/start.sh"
~~~

Gateway reads the parent Hub configuration and hot-loads valid changes. The Gateway file does not contain a second Registry or Share publicUrl.

### Optional fixed Relay port

Only configure this when the caller explicitly needs the fixed Relay data path for trusted Workers:

~~~json
{
  "registry": {
    "listen": true,
    "port": 9630,
    "relayPort": 28810
  }
}
~~~

The port must be reachable only according to the caller's intended network policy and must not be 80, 443, 2019, 9630, or 9680. Do not expose it by default.

## 5. Install the built-in Gateway first

Unless the caller explicitly rejected Gateway, run:

~~~bash
node "$HOME/.wheelmaker/deploy.mjs" gateway
~~~

Run it as the same user that owns the Hub. The command independently installs or upgrades Gateway, creates its user service, and starts it. Normal Hub deployment does not install, stop, or restart Gateway.

Gateway v2 creates $HOME/.wheelmaker/gateway/config.json with schema 2 and a wm_sites object. The relevant fields are:

~~~json
{
  "schema": 2,
  "wm_sites": {
    "tls": {
      "certificateFile": "",
      "keyFile": ""
    },
    "registry": {
      "urlMode": "sync_hub"
    },
    "share": {
      "urlMode": "sync_hub"
    }
  }
}
~~~

This is only a relevant fragment; do not replace the generated file with a shortened example. Do not add publicUrl under wm_sites.registry or wm_sites.share. sync_hub tells Gateway to read the addresses from the Hub config above. Do not create a second Share service or a second Share URL setting.

### Gateway TLS

The preferred path is automatic public HTTPS:

- DNS for every enabled hostname points to this machine;
- TCP 80 and 443 reach this machine;
- wm_sites.tls.certificateFile and keyFile remain empty;
- Gateway obtains and renews certificates through its embedded Caddy runtime.

If the caller supplies an existing certificate, set both paths in the single shared wm_sites.tls object. The certificate must cover the Registry and Share hostnames. Never set only one path.

Check the service without printing secrets:

~~~bash
systemctl --user is-active wheelmaker-gateway.service
systemctl --user is-enabled wheelmaker-gateway.service
ss -ltnp | grep -E ':(80|443|2019|9630)\b'
~~~

Gateway's public listeners are 80 and 443. Its admin listener is loopback-only at 2019; the Hub listener is loopback-only at 9630.

## 6. Share behavior and verification

Share is provided by the Hub and the built-in Gateway together:

~~~text
$HOME/.wheelmaker/config.json.registry.share.publicUrl  address source
$HOME/.wheelmaker/shares/records/                    metadata
$HOME/.wheelmaker/shares/public/s/<token>             published HTML
Gateway <share-domain>/s/<token>                      anonymous route
~~~

The caller creates a share from the authenticated Workspace. The returned link must use SHARE_DOMAIN; recipients do not log in. A blank or invalid Share URL disables only the Share route and does not delete existing share records. The route serves only the exact token path and has no SPA fallback.

After creating one test share, verify it from outside the machine if possible:

~~~bash
curl --fail --silent --show-error --head "https://$SHARE_DOMAIN/s/<token>"
~~~

Do not put a real share token in the final deployment report.

## 7. If the caller explicitly rejects Gateway: Nginx branch

Do not enter this section merely because Nginx is already installed. Enter it only after the caller explicitly chooses Nginx instead of Gateway.

In this branch, do not run node $HOME/.wheelmaker/deploy.mjs gateway. Nginx must expose both origins when Share is enabled:

- Registry origin: static files from $HOME/.wheelmaker/web, /ws proxied to 127.0.0.1:9630 with WebSocket upgrade;
- Share origin: static files from $HOME/.wheelmaker/shares/public, with only /s/<43-character-token> served;
- 9630 remains loopback-only.

If Nginx cannot read the selected user's Home, bind-mount only the public roots and verify each mount before adding persistence:

~~~bash
sudo install -d -m 0755 /var/www/wheelmaker/web /var/www/wheelmaker/shares/public
sudo mount --bind "$HOME/.wheelmaker/web" /var/www/wheelmaker/web
sudo mount --bind "$HOME/.wheelmaker/shares/public" /var/www/wheelmaker/shares/public
findmnt -T /var/www/wheelmaker/web
findmnt -T /var/www/wheelmaker/shares/public
~~~

Use a dedicated Nginx server block for each hostname. The Registry block must keep /ws as a prefix location:

~~~nginx
location ^~ /ws {
    proxy_pass http://127.0.0.1:9630;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 3600s;
    proxy_buffering off;
}

location / {
    try_files $uri $uri/ /index.html;
}
~~~

The Share block must not provide SPA fallback:

~~~nginx
root /var/www/wheelmaker/shares/public;
default_type text/html;

location ~ ^/s/[A-Za-z0-9_-]{43}$ {
    try_files $uri =404;
    add_header Content-Disposition inline always;
    add_header Cache-Control "no-store" always;
    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
    add_header Referrer-Policy no-referrer always;
    add_header X-Content-Type-Options nosniff always;
}

location / {
    return 404;
}
~~~

Use the caller's existing trusted certificate process, test with nginx -t, and reload only after the test passes. Do not change unrelated server blocks.

## 8. Firewall and final acceptance

For the Gateway branch, allow TCP 80 and 443. Keep 9630 and 2019 inaccessible from the public network. Allow relayPort only when the caller explicitly enabled it and approved its network scope. Preserve the current SSH rule and do not flush unknown firewall policy.

Run the relevant final checks:

~~~bash
systemctl --user is-active wheelmaker-hub.service
systemctl --user is-active wheelmaker-gateway.service
ss -ltnp | grep ':9630'
curl --fail --silent --show-error --head "https://$REGISTRY_DOMAIN/"
curl --silent --show-error --head "http://$REGISTRY_DOMAIN/"
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' "https://$REGISTRY_DOMAIN/ws?auth=status"
openssl s_client -connect "$REGISTRY_DOMAIN:443" -servername "$REGISTRY_DOMAIN" </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates
~~~

Accept deployment only when:

- the HTTPS Registry origin returns the WheelMaker page;
- HTTP redirects to HTTPS in the Gateway branch;
- /ws?auth=status reaches the Hub instead of a proxy 404/502;
- the Gateway branch has active/enabled Hub and Gateway user services;
- 9630 and 2019 are loopback-only;
- a created Share link returns the expected HTML from the separate Share origin;
- no public firewall rule exposes an internal port.

If any preflight, configuration, service, certificate, proxy, Share, or listener check fails: stop, do not claim success, preserve backups, report the exact failed check, and ask only for the smallest next decision. Never recover by overwriting an old Gateway config or exposing 9630.
