# WheelMaker First-Time Deploy Runbook

This document is written for an AI operator. Follow it as a decision tree. Do not skip checks, do not guess machine-specific paths, and do not install duplicate toolchains.

## 0. Deployment Role

Ask first:

```text
Is this machine the Registry entry machine?
```

If yes, this machine:

- runs the Registry listener with `registry.listen: true`
- publishes the Workspace Web UI to `~/.wheelmaker/web`
- exposes HTTPS entrypoint `https://<host>:28800/`
- exposes Registry WebSocket `wss://<host>:28800/ws`
- installs and configures Nginx

If no, this machine is a Worker:

- runs a Hub for local projects and agents
- uses `registry.listen: false`
- connects to the Registry entry machine through `https://<host>:28800`
- does not install or configure Nginx
- does not expose Monitor

Monitor is not exposed by default. Do not ask about exposing Monitor during the main deploy flow. Only add Monitor reverse proxy configuration if the user explicitly asks for it later.

## 1. Required Versions

Required on every machine:

- Git: installed and available in `PATH`
- Go: `1.26+`
- Node.js: `22.11+`
- npm: available with Node.js

Required only on the Registry entry machine:

- Nginx: installed and available, or a known absolute `nginx` path
- TLS certificate and private key

Rules:

- Detect before installing.
- If a tool exists and the version satisfies the requirement, skip it.
- If a tool exists but the version is too old, try to upgrade it with the package manager already in use.
- If upgrade fails, ask the user to confirm the next install or upgrade method.
- Do not install duplicate toolchains for the same dependency.
- Do not install Scoop automatically.
- On Windows, if Scoop already exists, use Scoop. If Scoop does not exist, use winget.
- On Linux, use distro packages only when they satisfy the required versions. If they do not, propose a versioned upgrade plan and ask the user before changing system tooling.

## 2. Environment Checks

### Windows

Run:

```powershell
git --version
go version
node --version
npm --version
scoop --version
winget --version
```

On a Registry entry machine, also run:

```powershell
nginx -v
where nginx
```

If Scoop exists, use it for missing or outdated dependencies:

```powershell
scoop update
scoop install git
scoop install go
scoop install nodejs-lts
```

Registry entry machine only:

```powershell
scoop install nginx
```

If Scoop does not exist, use winget:

```powershell
winget install --id Git.Git
winget install --id GoLang.Go
winget install --id OpenJS.NodeJS.LTS
```

Registry entry machine only:

```powershell
winget install --id Nginx.Nginx
```

If a dependency already exists but is outdated, try the matching package manager's upgrade command first:

```powershell
scoop update git go nodejs-lts nginx
```

or:

```powershell
winget upgrade --id Git.Git
winget upgrade --id GoLang.Go
winget upgrade --id OpenJS.NodeJS.LTS
winget upgrade --id Nginx.Nginx
```

If the upgrade fails, stop and ask the user how to proceed.

### macOS

Run:

```bash
git --version
go version
node --version
npm --version
brew --version
```

On a Registry entry machine, also run:

```bash
nginx -v
which nginx
```

Install or upgrade with Homebrew:

```bash
brew update
brew install git go node
brew upgrade git go node
```

Registry entry machine only:

```bash
brew install nginx
brew upgrade nginx
```

If Homebrew is missing or cannot provide Go `1.26+` and Node.js `22.11+`, stop and ask the user to confirm an alternative install plan.

### Linux

Run:

```bash
git --version
go version
node --version
npm --version
systemctl --user status
loginctl show-user "$USER" -p Linger
```

On a Registry entry machine, also run:

```bash
nginx -v
which nginx
```

Enable lingering before service deployment:

```bash
sudo loginctl enable-linger "$USER"
```

For Ubuntu/Debian basics:

```bash
sudo apt update
sudo apt install -y git nginx
```

Only install `nginx` on the Registry entry machine.

Do not continue until Go is `1.26+` and Node.js is `22.11+`. If distro packages are too old, propose a concrete upgrade plan, such as official Go tarball plus NodeSource or nvm, and ask the user to confirm before changing system tooling.

## 3. Clone Repository

Prefer SSH if GitHub SSH access is configured:

```bash
ssh -T git@github.com
git clone git@github.com:swm8023/WheelMaker.git
cd WheelMaker
```

If SSH is unavailable and the user confirms HTTPS access:

```bash
git clone https://github.com/swm8023/WheelMaker.git
cd WheelMaker
```

Do not guess a different repository URL.

## 4. Generate Shared Token

Ask whether the user already has a shared Registry token.

If no token is provided, generate one.

Windows:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

macOS/Linux:

```bash
openssl rand -base64 32
```

Use the same token on the Registry entry machine and every Worker machine.

## 5. First-Time Deploy

Run from the repository root.

Windows:

```bat
deploy.bat
```

macOS/Linux:

```bash
bash deploy.sh
```

The deploy wrapper builds a bootstrap `wheelmaker-deploy` CLI and runs the first-time deploy flow. The deploy flow builds binaries, publishes Web assets, writes helper scripts under `~/.wheelmaker`, installs services, and creates `~/.wheelmaker/config.json` only if it does not already exist.

Windows may request UAC elevation and may ask for the current account password when creating services.

## 6. Configure Registry Entry Machine

Edit `~/.wheelmaker/config.json`.

Use this shape:

```json
{
  "projects": [
    {
      "name": "WheelMaker",
      "path": "D:\\Code\\WheelMaker"
    }
  ],
  "registry": {
    "listen": true,
    "port": 9630,
    "server": "127.0.0.1",
    "token": "<shared-token>",
    "hubId": "hub-a"
  },
  "monitor": {
    "server": "127.0.0.1",
    "port": 9631
  },
  "log": {
    "level": "warn"
  }
}
```

Adjust `projects[].path` for the actual checkout path.

Rules:

- `registry.listen` must be `true`.
- `registry.server` should be `127.0.0.1` on the Registry entry machine.
- `registry.token` must be the shared token.
- `registry.hubId` must be stable and unique.
- `monitor.port` remains local. Do not expose it in Nginx by default.

Restart services after editing config.

Windows:

```powershell
~/.wheelmaker/restart.bat
```

macOS/Linux:

```bash
~/.wheelmaker/restart.sh
```

## 7. Configure Worker Machine

Edit `~/.wheelmaker/config.json`.

Use this shape:

```json
{
  "projects": [
    {
      "name": "Project-B",
      "path": "D:\\Code\\Project-B"
    }
  ],
  "registry": {
    "listen": false,
    "port": 9630,
    "server": "https://<registry-host>:28800",
    "token": "<shared-token>",
    "hubId": "hub-b"
  },
  "monitor": {
    "server": "127.0.0.1",
    "port": 9631
  },
  "log": {
    "level": "warn"
  }
}
```

Rules:

- `registry.listen` must be `false`.
- `registry.server` must point to the Registry entry machine HTTPS origin, not `/ws`.
- WheelMaker converts the HTTPS origin to the WebSocket endpoint internally.
- `registry.token` must match the Registry entry machine.
- `registry.hubId` must be unique per machine.
- Do not configure Nginx on Worker machines.

Restart services after editing config.

## 8. Nginx on Registry Entry Machine

Before writing Nginx configuration, ask the user for:

- host name or public IP
- external HTTPS port, default `28800`
- TLS certificate path
- TLS private key path
- Nginx config directory or target config file path

Do not ask about Monitor. It is not exposed by default.

Use this server block as the default template:

```nginx
server {
    listen 28800 ssl;
    server_name _;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;

    root /home/<user>/.wheelmaker/web;

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
        index index.html;
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, must-revalidate" always;
    }

    location /ws {
        proxy_pass http://127.0.0.1:9630;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
```

For Windows, use Windows paths:

```nginx
root C:/Users/<User>/.wheelmaker/web;
ssl_certificate     C:/path/to/fullchain.pem;
ssl_certificate_key C:/path/to/privkey.pem;
```

Safe Nginx workflow:

1. Generate the config.
2. Show it to the user for confirmation.
3. Write the config only after confirmation.
4. Run `nginx -t`.
5. Reload Nginx only if `nginx -t` passes.

Common reload commands:

Windows:

```powershell
nginx -t
nginx -s reload
```

macOS/Linux:

```bash
sudo nginx -t
sudo nginx -s reload
```

## 9. Verification

On the Registry entry machine:

```bash
curl -k https://<registry-host>:28800/
```

Confirm the Web UI loads in a browser:

```text
https://<registry-host>:28800/
```

Confirm services are running.

Windows:

```powershell
~/.wheelmaker/status.bat
```

macOS/Linux:

```bash
~/.wheelmaker/status.sh
```

On each Worker machine, confirm its Hub connects to the Registry entry machine after restart. If it does not, check:

- `registry.server`
- shared token
- Nginx `/ws` WebSocket proxy
- firewall for the external HTTPS port
- Registry entry machine service status

## 10. Do Not Use for First-Time Deploy

Do not use `update-publish.bat` or `update-publish.sh` for first-time deployment. Those scripts only request updater-driven update and Web publish after services already exist.

For first-time deployment, always use:

```bat
deploy.bat
```

or:

```bash
bash deploy.sh
```
