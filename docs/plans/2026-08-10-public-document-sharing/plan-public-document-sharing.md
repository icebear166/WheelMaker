# Public Document Sharing Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Invoke git-workflow-preferences through prepare/checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement authenticated creation and management of immutable Markdown/HTML public snapshots served anonymously by the existing embedded Gateway.

**Scope Source:** [Approved public document sharing spec](../../scope/2026-08-10-public-document-sharing.md)

**Architecture:** The App renders or reads a single HTML snapshot, gzip/base64 encodes it, and sends it through three new client-only Registry methods. Registry persists one metadata JSON plus one public file per random token under the WheelMaker state directory, owns expiry cleanup, and never handles anonymous reads. Gateway derives the sibling WheelMaker state directory from its existing `--home`, synthesizes a Share site in memory, and serves exact token paths directly from the public directory while preserving Workspace/Release sites.

**Tech Stack:** Go 1.26, Gorilla WebSocket, embedded Caddy, React 19, TypeScript, Jest/jsdom, existing React Markdown/rehype/Shiki/Mermaid export pipeline.

**Verification:** Focused Go package tests, focused Jest tests, `go test ./...`, `npm test -- --runInBand`, `npm run tsc:web`, and `npm run build:web`.

---

### Task 1: Add shared configuration and Registry method contracts

**Files:**
- Modify: `server/internal/shared/config.go`
- Test: `server/internal/shared/shared_test.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Test: `server/internal/protocol/registry_methods_test.go`
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Test: `app/__tests__/web-registry-share-contract.test.ts`
- Modify: `scripts/deploy/deploy-core.test.mjs`

**Acceptance:** The strict main config accepts optional `share.publicUrl` without changing the protocol version; Go and TypeScript expose `share.create`, `share.list`, and `share.delete` as client-only methods with matching payload/response shapes; deployment config rewrites preserve the nested share object.

- [x] **Step 1: Write failing tests** for loading the nested share config, method descriptor route/role, TypeScript method names and share payload shape, and deployment preservation of an existing `share` object.
- [x] **Step 2: Run focused tests** and verify they fail because the field and methods do not exist.
- [x] **Step 3: Implement the minimum shared field, `RegistryRouteShare`, method descriptors, TypeScript constants/types, and preservation assertion.** Keep protocol version unchanged and keep `share` optional.
- [x] **Step 4: Run focused Go, Jest, and Node tests** and verify they pass.
- [x] **Step 5: Checkpoint** only the task files with `git-workflow-preferences checkpoint`.

### Task 2: Implement Registry Share storage, lifecycle, and WebSocket handlers

**Files:**
- Create: `server/internal/registry/share_store.go`
- Test: `server/internal/registry/share_store_test.go`
- Create: `server/internal/registry/share.go`
- Test: `server/internal/registry/share_test.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`
- Modify: `server/cmd/wheelmaker/main.go`
- Test: `server/cmd/wheelmaker/main_test.go`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`

**Acceptance:** Authenticated clients can create, list, and idempotently delete records; content is bounded/decompressed and atomically published under `shares`; startup and nearest-deadline cleanup remove expired/corrupt/orphan data; public reads never enter Registry HTTP; current config/domain is re-read for create/list.

- [x] **Step 1: Write failing storage tests** for token format/collision retry, duration parsing/default, gzip+base64 bounded decode, UTF-8 and 16 MiB rejection, metadata-first/public-last publication, delete ordering, startup repair, permanent records, cursor ordering, and nearest-deadline cleanup with an injected clock.
- [x] **Step 2: Run the focused Registry tests** and verify the new tests fail for missing storage/handler behavior.
- [x] **Step 3: Implement `share_store`** with fixed `records`/`public/s` roots derived from `Config.StateDir`, secure token generation, per-record JSON, atomic temp renames, fail-closed repair, bounded decompression, and a timer loop that is started by `Server.Run`.
- [x] **Step 4: Write failing protocol/handler tests** for authenticated `share.create/list/delete`, invalid payload/config, cursor limit bounds, no-share behavior, and method routing through the existing dispatcher.
- [x] **Step 5: Implement Registry route dispatch and handlers**, including current main-config/share URL validation and hostname conflict checks against declared Gateway sites; expose repository/service methods with typed responses.
- [x] **Step 6: Run focused Go tests**, then run existing Registry/server tests to verify no route or message-size regression.
- [ ] **Step 7: Checkpoint** only Registry, shared command wiring, and repository/service files.

### Task 3: Add Gateway-derived Share site and anonymous static route

**Files:**
- Modify: `server/internal/gateway/types.go`
- Test: `server/internal/gateway/gateway_test.go`
- Modify: `server/internal/gateway/compiler.go`
- Test: `server/internal/gateway/gateway_test.go`
- Modify: `server/internal/gateway/runtime.go`
- Test: `server/internal/gateway/runtime_test.go`
- Modify: `server/cmd/wheelmaker-gateway/main.go`
- Test: `server/cmd/wheelmaker-gateway/main_test.go`
- Modify: `docs/wiki/architecture/gateway.md`

**Acceptance:** `ResolvePaths(--home)` derives the sibling `config.json` and `shares/public`; Gateway compiles an in-memory Share site without `sites/share.json`; valid config hot-loads it, empty/invalid/conflicting Share config removes only Share, and exact GET/HEAD token paths return the required HTML/security headers with generic 404 elsewhere.

- [x] **Step 1: Write failing Gateway tests** for derived paths, valid/empty/invalid share config, hostname collision isolation, watcher fingerprint changes, exact token matcher, static root, forced MIME/headers, no fallback, and other-site preservation.
- [x] **Step 2: Run focused Gateway/cmd tests** and verify failures identify missing Share derivation and route compilation.
- [x] **Step 3: Implement path derivation and an internal Share `SiteConfig` variant** (not loadable from `sites/*.json`), including validation and fail-closed omission when the main config is absent or invalid.
- [x] **Step 4: Implement Caddy route compilation** for `^/s/[A-Za-z0-9_-]{43}$`, `shares/public` file serving, forced `text/html`, `inline`, `no-store`, robots/referrer/nosniff headers, and generic non-matching 404 behavior without CSP or proxy fallback.
- [x] **Step 5: Extend runtime fingerprints and bundle loading** to watch the sibling main config, reload valid Share changes, and remove Share on invalid/empty config while retaining valid Workspace/Release routes.
- [x] **Step 6: Run focused Gateway tests plus existing gateway/cmd tests** and validate generated Caddy JSON through the existing validator.
- [ ] **Step 7: Update the confirmed Gateway wiki page** with the stable Share derivation and route boundary.
- [ ] **Step 8: Checkpoint** only Gateway, command, tests, and its wiki update.

### Task 4: Build App snapshot, compression, and Registry client integration

**Files:**
- Modify: `app/web/src/chat/export/MarkdownHtmlExportDocument.tsx`
- Create: `app/web/src/shares/shareSnapshot.ts`
- Create: `app/web/src/shares/shareCompression.ts`
- Test: `app/__tests__/web-share-snapshot.test.ts`
- Test: `app/__tests__/web-share-compression.test.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`

**Acceptance:** Markdown snapshots reuse the existing standalone export DOM and readiness checks; HTML snapshots preserve raw source; relative HTML dependencies are reported without rewriting; gzip/base64 is feature-detected and preflighted against both size limits; typed service methods create/list/delete shares and surface Registry errors.

- [ ] **Step 1: Write failing snapshot/compression tests** for Markdown standalone output, HTML source identity, relative dependency warnings, UTF-8 byte sizing, gzip/base64 round-trip, unsupported `CompressionStream`, and envelope preflight rejection.
- [ ] **Step 2: Run focused Jest tests** and verify they fail because the share snapshot/compression helpers do not exist.
- [ ] **Step 3: Extract or reuse the existing Markdown export surface** so a caller can await the exact final HTML without triggering a file download; add HTML dependency inspection and a source snapshot helper.
- [ ] **Step 4: Implement browser gzip/base64 helpers** with a bounded preflight and clear update-required error; add typed Registry repository/service methods using the existing request path.
- [ ] **Step 5: Run focused Jest tests and existing Markdown export tests**; verify no change to download/Android/Desktop export behavior.
- [ ] **Step 6: Checkpoint** only snapshot/compression, repository/service, and tests.

### Task 5: Add Share creation entry points and management screen

**Files:**
- Create: `app/web/src/shares/ShareManager.tsx`
- Test: `app/web/src/shares/ShareManager.test.tsx`
- Create: `app/web/src/shares/shares.css`
- Modify: `app/web/src/shell/WheelMakerAppMenu.tsx`
- Test: `app/web/src/shell/WheelMakerAppMenu.test.tsx`
- Modify: `app/web/src/preview/PreviewTabContextMenu.tsx`
- Modify: `app/web/src/chat/ChatFileLinkContextMenu.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Test: `app/__tests__/web-share-ui.test.tsx`
- Modify: relevant app stylesheet import entry

**Acceptance:** App Menu opens a top-level Shares screen; the screen lists current records with default 50/max 100 cursor pagination, copies links, supports stop sharing, remains usable when Share is disabled, and creates a new share from supported project preview/context-menu sources with default one-day expiry, busy/error states, dependency warnings, and success feedback.

- [ ] **Step 1: Write failing component tests** for the App Menu row, supported-file-only Share action, default expiry, warning continuation, create success/error, list pagination, disabled-config management, copy, stop, and idempotent removal.
- [ ] **Step 2: Run focused Jest tests** and verify they fail because the manager, menu callback, and entry actions are absent.
- [ ] **Step 3: Implement `ShareManager`** using the existing standalone screen shell and App service; keep records/tokens out of URL history and use existing clipboard/toast conventions.
- [ ] **Step 4: Thread `openShares` through `WheelMakerAppMenu` and `WorkspaceApp`**, including desktop/mobile history/back behavior and mutual exclusion with Settings, Release publishing, Port Relay, and preview.
- [ ] **Step 5: Add Share actions** to project Markdown/HTML preview tabs and project file context menus; read source through the existing project-file service, invoke the snapshot/compression pipeline, and never expose unsupported external/session sources.
- [ ] **Step 6: Add scoped styling** matching existing standalone settings/release surfaces, then run focused UI tests and existing menu/preview tests.
- [ ] **Step 7: Checkpoint** only Share UI, menu/preview integration, styles, and tests.

### Task 6: Publish wiki feature knowledge and complete verification

**Files:**
- Create: `docs/wiki/features/public-sharing.md`
- Modify: `docs/wiki/features/features.md`
- Modify: `docs/wiki/architecture/gateway.md` (only if Task 3 did not contain the complete confirmed update)
- Modify: `docs/plans/2026-08-10-public-document-sharing/plan-public-document-sharing.md`

**Acceptance:** The wiki records only stable, implemented public-sharing behavior and links the approved spec; the plan has every task checked with actual verification evidence; all required test/build commands pass or a concrete environment blocker is reported.

- [ ] **Step 1: Write the feature wiki page** with the required first-line summary, behavior/lifecycle/security sections, and approved spec link; update the features directory index.
- [ ] **Step 2: Run final verification**: `go test ./...`; `npm test -- --runInBand`; `npm run tsc:web`; `npm run build:web`; and focused deployment/gateway Node tests.
- [ ] **Step 3: Inspect status and diff** for task-only files, protocol version stability, no generated `dist` edits, no placeholders, and no accidental stats/database artifacts.
- [ ] **Step 4: Checkpoint** the wiki/plan only after final verification passes.
- [ ] **Step 5: Finalize** with `git-workflow-preferences finalize complete`, following the configured commit/push/merge/cleanup rules.
