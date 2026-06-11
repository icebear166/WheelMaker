# Chat Sent Attachment Preview Design

Date: 2026-06-11
Status: Draft for review

## Background

The chat composer uploads attachments only when the user sends a message. Uploaded files are stored as session-scoped artifacts and sent to the agent as ACP-shaped content blocks. For uploaded images, the current sent-message history keeps a `file://` resource link rather than browser-readable image data. The browser cannot safely render that path directly, so sent image attachments collapse to metadata chips after the composer state is cleared.

The goal is to make sent image attachments visible in chat history without changing the agent-facing prompt semantics. The agent should continue to receive and read the original attachment file through the existing resource-link flow.

## Current State

Attachment artifacts are stored under:

```text
~/.wheelmaker/db/session/<project>/<session>/attachments/
```

The original file name on disk is content-addressed:

```text
sha256-<hex><ext>
```

Each completed attachment has a sidecar JSON file:

```text
sha256-<hex>.json
```

The sidecar currently tracks the attachment id, project, session, display name, MIME type, size, hash, file name, URI, creation time, and whether the attachment has been sent.

## Goals

1. Show thumbnails for image attachments after send, refresh, and session switch.
2. Keep agent input unchanged: sent blocks still point to the original uploaded artifact.
3. Generate thumbnails on the Go server as part of attachment completion.
4. Let users click image thumbnails to open the original image in the existing side preview surface.
5. Keep non-image attachments compatible and clickable, but do not implement generic file preview yet.
6. Keep archive storage minimal by dropping all attachment binary content and attachment metadata from archived sessions.

## Non-goals

1. No direct browser use of `file://` attachment URIs.
2. No HTTP static file server for attachments in this iteration.
3. No generic non-image file preview or download support.
4. No preservation of attachment images, thumbnails, or metadata in archived sessions.
5. No blocking of send when thumbnail generation fails.

## Chosen Approach

Generate a small JPEG thumbnail immediately after `session.attachment.finish` verifies and stores the original file. The original attachment remains the source used by the agent. The thumbnail is a UI projection stored next to the original artifact and referenced by the sidecar.

The frontend reads thumbnails and originals through new registry methods. The methods validate that the requested artifact belongs to the current project and session before returning base64 content.

```text
Browser File
  -> session.attachment.* upload
  -> original artifact
  -> thumbnail artifact, when image decoding succeeds
  -> session.send uses original resource link
  -> chat history reads thumbnail through Hub
  -> click image reads original through Hub
```

## Server Storage

For image attachments, `session.attachment.finish` writes:

```text
sha256-<hex><ext>
sha256-<hex>.thumb.jpg
sha256-<hex>.json
```

Thumbnail rules:

1. Longest edge is 128 px.
2. Output MIME type is `image/jpeg`.
3. JPEG quality is approximately 75.
4. Transparent pixels are composited over a light background.
5. GIF uses the first frame.
6. PNG and JPEG use Go standard library decoders.
7. Unsupported or corrupt images keep the original attachment but record a thumbnail error.

Sidecar shape is extended with optional thumbnail data:

```json
{
  "attachmentId": "sha256-...",
  "projectName": "proj",
  "sessionId": "sess",
  "name": "image.png",
  "mimeType": "image/png",
  "size": 123456,
  "sha256": "...",
  "fileName": "sha256-....png",
  "uri": "file:///.../attachments/sha256-....png",
  "sent": true,
  "kind": "image",
  "thumbnail": {
    "fileName": "sha256-....thumb.jpg",
    "mimeType": "image/jpeg",
    "width": 128,
    "height": 96,
    "size": 12345,
    "sha256": "..."
  },
  "thumbnailError": ""
}
```

For non-image attachments:

1. `kind` is `file`.
2. `thumbnail` is omitted.
3. `thumbnailError` is optional and normally empty.

## Read APIs

Add two registry methods routed to the owning Hub.

### `session.attachment.thumbnail`

Request:

```json
{
  "sessionId": "sess-1",
  "attachmentId": "sha256-...",
  "uri": "file:///.../attachments/sha256-....png"
}
```

Rules:

1. `sessionId` is required.
2. The request may identify the attachment by `attachmentId` or by the historical block `uri`.
3. The resolved artifact must be inside the session `attachments/` directory.
4. The sidecar project, session, and file name must match.
5. Non-image attachments return a structured `not_image` error.
6. Missing thumbnails return a structured error and do not read the original file as a fallback.

Response:

```json
{
  "ok": true,
  "sessionId": "sess-1",
  "attachmentId": "sha256-...",
  "mimeType": "image/jpeg",
  "encoding": "base64",
  "content": "...",
  "width": 128,
  "height": 96,
  "size": 12345,
  "hash": "..."
}
```

### `session.attachment.read`

Request:

```json
{
  "sessionId": "sess-1",
  "attachmentId": "sha256-...",
  "uri": "file:///.../attachments/sha256-....png"
}
```

Rules:

1. Validation matches `session.attachment.thumbnail`.
2. The method reads the original attachment artifact.
3. The first frontend use is image original preview only.
4. Archived sessions do not expose original attachment content.

Response:

```json
{
  "ok": true,
  "sessionId": "sess-1",
  "attachmentId": "sha256-...",
  "mimeType": "image/png",
  "encoding": "base64",
  "content": "...",
  "size": 123456,
  "hash": "..."
}
```

## Frontend Behavior

Sent prompt rendering distinguishes image and non-image attachments from prompt content blocks.

For image attachments:

1. Render a fixed-size thumbnail placeholder in the prompt group.
2. Request `session.attachment.thumbnail` for visible sent prompt items.
3. Convert returned base64 to a data URL or Blob URL for display.
4. On click, open the existing chat side preview surface.
5. In the side preview, request `session.attachment.read` and render the original image.
6. If original read fails, show an unavailable state.

For non-image attachments:

1. Keep the existing compact file chip style.
2. Make the chip clickable.
3. Open the same side preview surface.
4. Show file name, MIME type, size, and a "Preview is being implemented" state.
5. Do not read file content and do not offer download in this iteration.

The side preview treats chat attachments as session artifacts, not workspace files. It should not offer "Open in File tab" or copy a workspace path for these attachments.

## Archive Behavior

Archiving a session keeps only the conversation content needed for archived chat review. Attachment binaries and metadata are removed.

Rules:

1. Do not write original attachment files into the archive pack.
2. Do not write thumbnail files into the archive pack.
3. Do not preserve attachment names, MIME types, sizes, attachment ids, or file URIs in archived turn content.
4. Strip uploaded attachment content blocks from archived prompt requests.
5. Strip legacy `image.data` blocks before writing archived turns so base64 image data is not retained.
6. If a prompt request becomes empty after stripping attachments, write a generic text placeholder:

```text
Attachment removed during archive
```

This keeps archived prompt turns visible without retaining attachment details.

## Deletion Semantics

Normal active-session behavior:

1. Upload cancel removes the `.part` file.
2. Upload idle timeout removes expired `.part` files.
3. Completed but unsent attachment deletion removes original file, thumbnail file, and sidecar.
4. Sent attachments cannot be deleted individually.
5. Deleting a session removes the whole session artifact directory, including originals, thumbnails, and sidecars.

Archive behavior:

1. Archive sanitizes turn content.
2. Archive writes the sanitized conversation pack.
3. Archive deletes the active session, which removes original files, thumbnails, and sidecars.

## Error Handling

Thumbnail generation failure does not fail upload or send. The sidecar records `thumbnailError`, and the frontend displays the normal attachment chip or a thumbnail unavailable placeholder.

Thumbnail/read API failures are user-visible only in the affected attachment UI. They should not fail chat session rendering.

## Testing Strategy

Server tests:

1. `session.attachment.finish` creates a JPEG thumbnail for a valid PNG/JPEG/GIF image.
2. Thumbnail generation failure still completes the upload.
3. Non-image upload omits thumbnail metadata.
4. `session.attachment.thumbnail` validates session ownership and returns base64 JPEG content.
5. `session.attachment.read` validates session ownership and returns original image content.
6. Completed unsent delete removes original, thumbnail, and sidecar.
7. Sent attachment delete remains rejected.
8. Session delete removes original, thumbnail, and sidecar.
9. Archive strips uploaded attachment blocks and legacy `image.data` blocks.
10. Archive inserts the generic placeholder for attachment-only prompts.

Frontend tests:

1. Sent image attachments request and render thumbnails.
2. Sent image thumbnail click opens the side preview and reads the original.
3. Thumbnail/read failures show unavailable states without breaking the turn.
4. Non-image chips are clickable and show the "Preview is being implemented" side preview state.
5. Archived sessions do not render attachment chips from stripped prompt requests.

Validation commands after implementation:

```bash
cd server && go test ./...
cd app && npm test -- --runInBand
cd app && npm run tsc:web
```
