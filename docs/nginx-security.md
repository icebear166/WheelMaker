# WheelMaker Nginx Security Boundary

WheelMaker backend services must listen only on `127.0.0.1` or `::1`. Nginx is the sole public entry point and terminates TLS for browser and Android clients.

## Required topology

Use one public origin for the Web app, authentication endpoints, HTTP APIs, and Registry WebSocket. Registry derives the expected browser origin from the trusted request scheme and Host, so users do not configure an origin allowlist.

```json
{
  "registry": {
    "server": "127.0.0.1",
    "port": 9630
  }
}
```

Browser requests are accepted only when `Origin` exactly matches the effective scheme, Host, and port. Cross-origin requests, parent domains, HTTP/HTTPS mismatches, and different ports are rejected automatically.

## Nginx configuration

Define login rate limiting in the `http` block:

```nginx
limit_req_zone $binary_remote_addr zone=wheelmaker_login:10m rate=2r/m;
```

Inside the TLS-enabled `server` block, proxy login and Registry traffic to loopback:

```nginx
location = /registry/auth/login {
    limit_req zone=wheelmaker_login burst=5 nodelay;

    proxy_pass http://127.0.0.1:9630/auth/login;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
}

location /registry/ {
    proxy_pass http://127.0.0.1:9630/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

The public server must redirect HTTP to HTTPS, allow only TLS 1.2 or TLS 1.3, and send HSTS after HTTPS deployment is verified. Do not log request bodies or authentication headers. Default Nginx access logs do not include request bodies; custom log formats must preserve that property.

## Forwarded headers

WheelMaker accepts `X-Forwarded-Proto` and `X-Real-IP` only when the immediate TCP peer is loopback. Requests from any non-loopback peer cannot use forwarded headers to claim HTTPS or another client address.

Nginx must overwrite the forwarded headers as shown above rather than append client-supplied values. Public traffic must not have a direct route to Registry or Monitor ports.

## Verification

After deployment:

1. Confirm Registry and Monitor listen only on loopback with `Get-NetTCPConnection` on Windows or `ss -ltnp` on Linux.
2. Confirm HTTP redirects to HTTPS.
3. Confirm an unlisted `Origin` receives HTTP 403 for login and WebSocket requests.
4. Confirm repeated failed logins receive HTTP 429 from Nginx and from WheelMaker's application limiter.
5. Confirm successful login sets a host-only `HttpOnly; Secure; SameSite=Strict` session cookie.
