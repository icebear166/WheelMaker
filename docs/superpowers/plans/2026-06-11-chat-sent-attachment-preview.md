# Chat Sent Attachment Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show sent image attachments as server-generated 128px thumbnails, open originals in the chat side preview, keep non-image attachment chips clickable, and strip all attachment content from archives.

**Architecture:** The Hub owns attachment binary access. `session.attachment.finish` writes thumbnails beside existing session attachment artifacts and records them in the existing sidecar JSON. The App renders sent prompt attachment blocks through new registry methods instead of using `file://` paths, while archive sanitization removes all attachment blocks before packing turns.

**Tech Stack:** Go 1.26 standard image packages, existing registry session methods, React/TypeScript Workspace App, Jest source/behavior tests.

---

## Files

- Modify: `server/internal/protocol/registry_methods.go` for `session.attachment.thumbnail` and `session.attachment.read`.
- Modify: `server/internal/hub/client/session_attachments.go` for thumbnail generation, sidecar fields, read handlers, and delete cleanup.
- Modify: `server/internal/hub/client/client.go` to route the new methods.
- Modify: `server/internal/hub/client/session_archive.go` or nearby archive helpers to sanitize attachment blocks before packing turns.
- Modify: `server/internal/hub/client/client_test.go` for attachment thumbnail/read/delete/archive coverage.
- Modify: `app/web/src/registry/registryMethods.ts`, `app/web/src/registry/registryTypes.ts`, `app/web/src/registry/RegistryRepository.ts`, and `app/web/src/registry/RegistryWorkspaceService.ts` for client methods and response types.
- Modify: `app/web/src/chat/ChatTurnView.tsx` to render clickable sent attachments with async thumbnails.
- Modify: `app/web/src/app/WorkspaceApp.tsx` to pass attachment handlers into chat turns and reuse the side preview surface.
- Modify: `app/web/src/styles/chat.css` for thumbnail/chip/button/side preview states.
- Modify or add focused tests under `app/__tests__/`.

## Task 1: Server Thumbnail Sidecar

**Files:**
- Modify: `server/internal/hub/client/session_attachments.go`
- Test: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: Write failing server tests**

Add tests that upload a valid 2x1 PNG and assert:

```go
sidecar, err := readAttachmentSidecar(attachmentSidecarPathForTest(path))
if err != nil { t.Fatalf("read sidecar: %v", err) }
if sidecar.Kind != "image" { t.Fatalf("kind=%q, want image", sidecar.Kind) }
if sidecar.Thumbnail.FileName == "" { t.Fatal("thumbnail file name empty") }
if sidecar.Thumbnail.MimeType != "image/jpeg" { t.Fatalf("thumbnail mime=%q", sidecar.Thumbnail.MimeType) }
if sidecar.Thumbnail.Width <= 0 || sidecar.Thumbnail.Width > 128 { t.Fatalf("thumbnail width=%d", sidecar.Thumbnail.Width) }
if _, err := os.Stat(filepath.Join(filepath.Dir(path), sidecar.Thumbnail.FileName)); err != nil {
    t.Fatalf("thumbnail stat: %v", err)
}
```

Add a PDF upload assertion:

```go
if sidecar.Kind != "file" { t.Fatalf("kind=%q, want file", sidecar.Kind) }
if sidecar.Thumbnail.FileName != "" { t.Fatalf("thumbnail=%#v, want empty", sidecar.Thumbnail) }
```

- [ ] **Step 2: Run red test**

Run: `cd server && go test ./internal/hub/client -run "Attachment.*Thumbnail|Upload.*NonImage" -count=1`

Expected: fail because `attachmentSidecar` has no `Kind` or `Thumbnail`.

- [ ] **Step 3: Implement thumbnail metadata and generation**

Add:

```go
type attachmentThumbnail struct {
    FileName string `json:"fileName,omitempty"`
    MimeType string `json:"mimeType,omitempty"`
    Width    int    `json:"width,omitempty"`
    Height   int    `json:"height,omitempty"`
    Size     int64  `json:"size,omitempty"`
    SHA256   string `json:"sha256,omitempty"`
}
```

Extend `attachmentSidecar` with `Kind string`, `Thumbnail attachmentThumbnail`, and `ThumbnailError string`.

After the original file is written in `finish`, call `buildAttachmentThumbnail(finalPath, upload.MimeType, upload.Name, attachmentID)` for image MIME types. Use standard `image/png`, `image/jpeg`, and `image/gif` decoders, nearest-neighbor resize to longest edge 128, composite onto a light background, encode JPEG quality 75, and write `sha256-<hash>.thumb.jpg`.

- [ ] **Step 4: Run green test**

Run: `cd server && go test ./internal/hub/client -run "Attachment.*Thumbnail|Upload.*NonImage" -count=1`

Expected: pass.

## Task 2: Server Attachment Read APIs

**Files:**
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/hub/client/client.go`
- Modify: `server/internal/hub/client/session_attachments.go`
- Test: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: Write failing tests**

Add tests for:

```go
resp, err := c.HandleSessionRequest(context.Background(), "session.attachment.thumbnail", "proj1", payload)
if err != nil { t.Fatalf("thumbnail: %v", err) }
body := resp.(map[string]any)
if body["mimeType"] != "image/jpeg" || body["encoding"] != "base64" { t.Fatalf("bad thumbnail response: %#v", body) }
if body["content"] == "" { t.Fatal("thumbnail content empty") }
```

and original read:

```go
resp, err := c.HandleSessionRequest(context.Background(), "session.attachment.read", "proj1", payload)
if err != nil { t.Fatalf("read: %v", err) }
body := resp.(map[string]any)
if body["mimeType"] != "image/png" || body["encoding"] != "base64" { t.Fatalf("bad read response: %#v", body) }
if body["content"] != base64ForTest(imageBytes) { t.Fatalf("content mismatch") }
```

Add a non-image thumbnail test expecting an error containing `not_image`.

- [ ] **Step 2: Run red test**

Run: `cd server && go test ./internal/hub/client -run "SessionAttachment(Read|Thumbnail)" -count=1`

Expected: fail because methods are unsupported.

- [ ] **Step 3: Implement routing and validation**

Add method constants and route both methods in `HandleSessionRequest`.

Implement a shared resolver that accepts `sessionId` plus `attachmentId` or `uri`, resolves the current session attachment root, validates containment, reads sidecar, and checks project/session/file name match.

`session.attachment.thumbnail` reads only `sidecar.Thumbnail.FileName`; non-image or missing thumbnail returns an error with `not_image` or `thumbnail not found`.

`session.attachment.read` reads only `sidecar.FileName`.

- [ ] **Step 4: Run green test**

Run: `cd server && go test ./internal/hub/client -run "SessionAttachment(Read|Thumbnail)" -count=1`

Expected: pass.

## Task 3: Delete Cleanup and Archive Sanitization

**Files:**
- Modify: `server/internal/hub/client/session_attachments.go`
- Modify: `server/internal/hub/client/session_archive.go`
- Test: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: Write failing tests**

Add delete cleanup assertion:

```go
thumbPath := filepath.Join(filepath.Dir(path), sidecar.Thumbnail.FileName)
if err := c.HandleSessionRequest(... "session.attachment.delete" ...); err != nil { t.Fatalf("delete: %v", err) }
if _, err := os.Stat(thumbPath); !os.IsNotExist(err) { t.Fatalf("thumbnail stat err=%v, want removed", err) }
```

Add archive sanitization tests for uploaded resource links and legacy `image.data`:

```go
contents := decodeWMT2ContentsForTest(t, rawWMT2, entry.TurnCount)
if strings.Contains(contents[0], "resource_link") || strings.Contains(contents[0], "image/png") || strings.Contains(contents[0], "file://") {
    t.Fatalf("archive retained attachment data: %s", contents[0])
}
if !strings.Contains(contents[0], "Attachment removed during archive") {
    t.Fatalf("archive prompt=%s, want placeholder", contents[0])
}
```

- [ ] **Step 2: Run red test**

Run: `cd server && go test ./internal/hub/client -run "Attachment.*Delete|Archive.*Attachment|Archive.*ImageData" -count=1`

Expected: fail because thumbnails are not deleted and archive does not sanitize attachment blocks.

- [ ] **Step 3: Implement cleanup and archive sanitizer**

Delete thumbnail file when deleting completed unsent attachments. Add an archive sanitizer that parses each turn JSON, removes prompt `contentBlocks` whose type is `image` or attachment `resource_link` with file URI under session attachments, and inserts a text block with `Attachment removed during archive` when no text remains.

- [ ] **Step 4: Run green test**

Run: `cd server && go test ./internal/hub/client -run "Attachment.*Delete|Archive.*Attachment|Archive.*ImageData" -count=1`

Expected: pass.

## Task 4: Registry App Client Methods

**Files:**
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Test: `app/__tests__/web-chat-attachment-preview.test.ts`

- [ ] **Step 1: Write failing source tests**

Add tests asserting the new method names and service methods exist:

```ts
expect(methods).toContain("SessionAttachmentThumbnail: 'session.attachment.thumbnail'");
expect(methods).toContain("SessionAttachmentRead: 'session.attachment.read'");
expect(repository).toContain('async readSessionAttachmentThumbnail');
expect(repository).toContain('async readSessionAttachmentOriginal');
expect(service).toContain('async readProjectSessionAttachmentThumbnail');
expect(service).toContain('async readProjectSessionAttachmentOriginal');
```

- [ ] **Step 2: Run red test**

Run: `cd app && npm test -- --runInBand web-chat-attachment-preview.test.ts`

Expected: fail because methods are missing.

- [ ] **Step 3: Implement types and repository methods**

Add request/response types with `sessionId`, `attachmentId`, `uri`, `mimeType`, `encoding`, `content`, `width`, `height`, `size`, and `hash`. Add repository/service wrappers that call the two new registry methods.

- [ ] **Step 4: Run green test**

Run: `cd app && npm test -- --runInBand web-chat-attachment-preview.test.ts`

Expected: pass.

## Task 5: Chat Turn Thumbnail UI

**Files:**
- Modify: `app/web/src/chat/ChatTurnView.tsx`
- Modify: `app/web/src/chat/turns/chatDisplayIndex.ts`
- Modify: `app/web/src/styles/chat.css`
- Test: `app/__tests__/web-chat-attachment-preview.test.ts`

- [ ] **Step 1: Write failing source/UI tests**

Assert `ChatTurnView` exposes attachment callbacks and renders image attachment buttons:

```ts
expect(turnView).toContain('onOpenAttachment');
expect(turnView).toContain('chat-prompt-attachment-thumb-button');
expect(turnView).toContain('chat-prompt-attachment-image-thumb');
expect(displayIndex).toContain('attachmentThumbnailHeight');
```

- [ ] **Step 2: Run red test**

Run: `cd app && npm test -- --runInBand web-chat-attachment-preview.test.ts`

Expected: fail on missing UI symbols.

- [ ] **Step 3: Implement prompt attachment rendering**

Add a callback prop that receives the block and display metadata. Render image attachments as stable 128px thumbnail buttons with placeholder/loading/error states. Render non-image attachments as clickable file chips. Keep the prompt row dimensions stable.

- [ ] **Step 4: Run green test**

Run: `cd app && npm test -- --runInBand web-chat-attachment-preview.test.ts`

Expected: pass.

## Task 6: Workspace Attachment Preview State

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`
- Test: `app/__tests__/web-chat-attachment-preview.test.ts`

- [ ] **Step 1: Write failing source tests**

Assert `WorkspaceApp` contains attachment preview state and calls new service methods:

```ts
expect(main).toContain('chatAttachmentPreview');
expect(main).toContain('readProjectSessionAttachmentThumbnail');
expect(main).toContain('readProjectSessionAttachmentOriginal');
expect(main).toContain('Preview is being implemented');
expect(main).not.toContain('Open in File tab');
```

The last assertion should target the attachment preview block, not the existing file peek block.

- [ ] **Step 2: Run red test**

Run: `cd app && npm test -- --runInBand web-chat-attachment-preview.test.ts`

Expected: fail on missing preview state and service calls.

- [ ] **Step 3: Implement attachment preview state**

Cache thumbnail data URLs by runtime key and attachment id. Pass thumbnail state and `onOpenAttachment` into `ChatTurnView`. On image click, open a chat attachment side preview and load original image. On non-image click, open the same side preview with metadata and "Preview is being implemented". Do not offer file-tab actions for chat attachments.

- [ ] **Step 4: Run green test**

Run: `cd app && npm test -- --runInBand web-chat-attachment-preview.test.ts`

Expected: pass.

## Task 7: Full Verification

**Files:**
- All touched files.

- [ ] **Step 1: Run server tests**

Run: `cd server && go test ./...`

Expected: pass.

- [ ] **Step 2: Run app tests**

Run: `cd app && npm test -- --runInBand`

Expected: pass.

- [ ] **Step 3: Run TypeScript check**

Run: `cd app && npm run tsc:web`

Expected: pass.

- [ ] **Step 4: Inspect diff**

Run: `git diff --stat` and `git diff --check`

Expected: focused changes, no whitespace errors.
