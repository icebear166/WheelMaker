> 摘要：本页维护项目内 Markdown/HTML 公共分享的快照语义、管理入口、生命周期和匿名访问边界。

# Public document sharing

WheelMaker can publish a project `.md`, `.markdown`, `.html`, or `.htm` file as an
immutable, single-file HTML snapshot. The feature is managed from the authenticated
Workspace, while recipients use a bearer link on the separate Share origin without
logging in.

## Snapshot behavior

- Markdown uses the existing standalone Markdown HTML export surface, including the
  current theme, code rendering, formula/Mermaid readiness, and best-effort image
  embedding. An image that cannot be embedded remains a link and is shown as a warning.
- HTML stores the source exactly as read when the share is created. The recipient's
  browser executes its scripts and resolves external dependencies at runtime; the
  executed iframe DOM or interaction state is never uploaded.
- Each create operation gets a new 32-byte cryptographically random base64url token.
  A share is never overwritten by later edits to its source file.

## Management

The App Menu opens the top-level **Public shares** screen. Preview file actions and
project-file context menus offer **Create public share** only for supported project
files. The screen uses a 50-item default cursor page (100 maximum), shows active
records newest first, copies an enabled link, and stops a share by removing it.

New links default to one day and may use one hour, one day, seven days, 30 days, or
permanent expiry. Relative HTML dependencies are warned about before creation; the
user may continue. Existing records remain manageable when the Share URL is disabled
or temporarily invalid.

## Storage and expiry

The Registry stores no share rows in the application database. It keeps compressed
payloads decoded to UTF-8 HTML under the state directory:

```text
~/.wheelmaker/shares/
├─ records/<token>.json
└─ public/s/<token>
```

The decoded HTML is limited to 16 MiB and the complete gzip/base64 Registry envelope
must fit the existing 16 MiB message limit. Registry startup repairs partial,
corrupt, orphaned, and expired files; a nearest-deadline timer removes later-expired
files. Manual stop and expiry remove the public file and metadata, with no tombstone,
history, statistics, IP/User-Agent data, or quota model.

## Anonymous access boundary

Gateway derives the Share site from `config.json.share.publicUrl` and the existing
Gateway `--home`; it does not create `gateway/sites/share.json`. Exact
`GET`/`HEAD /s/<43-character-token>` requests are served directly from
`shares/public`, with forced HTML/inline/no-store/robots/referrer/nosniff headers.
There is no index, fallback, Registry lookup, authentication, or CSP added by the
Share route. Invalid or conflicting Share configuration disables only this site;
Workspace and Release sites continue serving, and valid configuration hot-loads in
the running Gateway.

See the [approved public document sharing spec](../../scope/2026-08-10-public-document-sharing.md)
for the complete decision record.
