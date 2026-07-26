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

Inside the TLS-enabled `server` block, keep the existing Registry `/ws` route and proxy it to loopback:

```nginx
location /ws {
    proxy_pass http://127.0.0.1:9630;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

Nginx forwards the query string unchanged when `proxy_pass` has no replacement URI. Therefore `/ws?auth=status`, `/ws?auth=login`, `/ws?auth=logout`, and the WebSocket Upgrade all share this single location. Root-path deployments with this existing route require no Nginx change. Registry applies the login rate limiter itself. For a subpath deployment, map that base path's existing endpoint (for example `location /wheelmaker/ws`) to the same upstream while preserving the request path and query.

`/ws/preview/` is an authenticated iframe POST endpoint carried by the same
`/ws` prefix location. Keep that proxy as a prefix location: an exact `/ws`
match would continue to route the Registry WebSocket but would break HTML
preview responses. For preview responses, pass the upstream Content-Security-Policy
through unchanged; the proxy must not add X-Frame-Options: DENY. The `DENY`
header below still applies to WheelMaker's static application responses.
Deployments using the documented prefix proxy need no additional Nginx location.

The public server must redirect HTTP to HTTPS, allow only TLS 1.2 or TLS 1.3, and send HSTS after HTTPS deployment is verified. Do not log request bodies or authentication headers. Default Nginx access logs do not include request bodies; custom log formats must preserve that property.

Every location that serves WheelMaker static content must also send these headers (Nginx does not inherit server-level `add_header` values into a location that defines its own `add_header`):

```nginx
add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; connect-src 'self' wss: https://release.wheelmaker.top https://codexradar.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests" always;
add_header Referrer-Policy "no-referrer" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
```

The production `index.html` repeats CSP and referrer protection as meta tags, so existing deployments receive partial protection before their Nginx configuration is updated. Meta tags cannot enforce every response-header directive (notably `frame-ancestors`) and do not protect non-HTML responses; update existing Nginx configurations before claiming full header acceptance. This change does not add or split authentication locations.

## Forwarded headers

WheelMaker accepts `X-Forwarded-Proto` and `X-Real-IP` only when the immediate TCP peer is loopback. Requests from any non-loopback peer cannot use forwarded headers to claim HTTPS or another client address.

Nginx must overwrite the forwarded headers as shown above rather than append client-supplied values. Public traffic must not have a direct route to the Registry port.

## Verification

After deployment:

1. Confirm Registry listens only on loopback with `Get-NetTCPConnection` on Windows or `ss -ltnp` on Linux.
2. Confirm HTTP redirects to HTTPS.
3. Confirm an unlisted `Origin` receives HTTP 403 for login and WebSocket requests.
4. Confirm repeated failed logins receive HTTP 429 from WheelMaker's application limiter.
5. Confirm successful login sets a host-only `HttpOnly; Secure; SameSite=Strict` session cookie.
6. Confirm `/`, `/index.html`, JavaScript, and CSS responses include the four static security headers above.
