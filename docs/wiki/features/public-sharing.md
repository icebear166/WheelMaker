> 摘要：本页维护项目文档、聊天回答与完整会话公共分享的来源、快照、管理、生命周期和匿名访问边界。

# Public sharing

WheelMaker can publish a supported project document, one assistant response, or a
complete clean conversation as an immutable, single-file HTML snapshot. The feature
is managed from the authenticated Workspace, while recipients use a bearer link on
the separate Share origin without logging in.

## Sources

Share metadata distinguishes three source types:

- `project_document` stores the project ID, relative path, and Markdown/HTML kind.
  Omitting `sourceType` in an authenticated `share.create` request keeps this legacy
  behavior.
- `chat_response` stores the project ID, Session ID, and positive terminal turn index.
- `chat_session` stores the project ID and Session ID.

New records use schema 2. Registry continues reading schema 1 project-document
records and projects them to `project_document` in memory without rewriting them.
Field combinations that do not match their declared source fail closed. The method
names, Share route, Registry protocol version, bearer token, and public URL shape do
not change.

## Snapshot behavior

- Markdown uses the existing standalone Markdown HTML export surface, including the
  current theme, code rendering, formula/Mermaid readiness, and best-effort image
  embedding. An image that cannot be embedded remains a link and is shown as a warning.
- HTML stores the source exactly as read when the share is created. The recipient's
  browser executes its scripts and resolves external dependencies at runtime; the
  executed iframe DOM or interaction state is never uploaded.
- Chat responses and sessions use the shared chat document renderer described in
  [`chat-sharing.md`](chat-sharing.md). The source is frozen when the user chooses
  Public URL, so later Session changes do not affect the dialog or created HTML.
  User attachments remain name-only and never become public files or authenticated
  attachment links.
- Each create operation gets a new 32-byte cryptographically random base64url token.
  A share is never overwritten by later edits to its source file or Session.

## Management

The App Menu opens the top-level **Public shares** management screen. Preview file
actions and project-file context menus offer **Create public share** for supported
documents. Each completed chat response exposes Public URL for that response and the
current full Session through its unified Share menu. All sources open the same compact
create dialog instead of navigating to the management screen. The dialog shows the
configured Share origin and whether it is enabled, identifies the frozen source,
pre-fills an editable share name, and keeps the expiry selector visible. After
creation it displays the returned link, attempts to copy it automatically, and keeps
explicit open-in-new-tab and copy actions available. Clipboard failure does not hide
or invalidate the created link.

The management screen uses a 50-item default cursor page (100 maximum), shows active
records newest first, labels project documents, chat responses, and full sessions by
their applicable source context, and exposes compact Open, Copy, and Delete icon
actions. Open launches a new browser tab; Open and Copy are disabled when a record
has no valid public URL. Delete remains available, uses a red trash action, and asks
for confirmation that the public URL will immediately stop working while its source
document or Session remains untouched. Management remains token-owned: deleting,
archiving, renaming, or continuing a source Session does not update or revoke an
existing share.

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

Registry reads `~/.wheelmaker/config.json.registry.share.publicUrl` at each
`share.create/list` request boundary and uses it to generate the public link. Gateway reads the
same Hub field because `wm_sites.share.urlMode` is `sync_hub`; Share 与 Registry、Release
共用 Gateway schema 2 的 `wm_sites.tls`，不再有 Share 专属 TLS，也不创建单独站点文件。
Exact
`GET`/`HEAD /s/<43-character-token>` requests are served directly from
`shares/public`, with forced HTML/inline/no-store/robots/referrer/nosniff headers.
There is no index, fallback, Registry lookup, authentication, or CSP added by the
Share route. Invalid or conflicting Hub-derived Share configuration disables only this route;
Registry and Release routes continue serving. Gateway hot-loads valid changes to the Hub and
Gateway config files; Registry does not watch config files, while its request-boundary read
continues to reflect the next `share.create/list` request.

See the [approved public document sharing spec](../../scope/2026-08-10-public-document-sharing.md)
for the complete decision record.
