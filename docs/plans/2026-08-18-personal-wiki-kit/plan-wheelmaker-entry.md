# WheelMaker Personal Wiki Entry Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose one Registry-owned Personal Wiki URL through a backward-compatible connection field and render safe desktop/mobile external-open entries in WheelMaker.

**Scope Source:** `docs/scope/2026-08-18-personal-wiki-kit.md`

**Architecture:** The WheelMaker runtime config owns a single optional canonical URL. Registry places it in optional `connect.init.serverInfo`; Web retains it as connection-level state and supplies one opener to the Chat title bar and app menu. Hubs never report or override the value.

**Tech Stack:** Go strict JSON configuration and Registry WebSocket protocol, TypeScript/React 19, Jest/react-test-renderer, existing WheelMaker icon and menu systems.

**Verification:** Focused Go tests under `server/internal/shared`, `server/internal/registry`, and `server/cmd/wheelmaker`; focused Jest plus TypeScript checks in `app`.

---

### Task 1: Validate and own the Registry-global URL

**Files:**
- Modify: `server/internal/shared/config.go`
- Modify: `server/internal/shared/shared_test.go`
- Modify: `server/config.example.json`
- Modify: `server/cmd/wheelmaker/main.go`
- Modify: `server/cmd/wheelmaker/main_test.go`

**Acceptance:** `knowledgeRegistry.publicUrl` accepts canonical HTTPS origins and loopback HTTP origins, rejects credentials/paths/query/fragment/unknown secret fields, and reaches Registry construction from the Registry host config only.

- [ ] **Step 1: Write failing strict config tests**

Add table tests for:

```go
{"knowledgeRegistry":{"publicUrl":"https://wiki.example.com"}}
{"knowledgeRegistry":{"publicUrl":"http://127.0.0.1:9765"}}
```

and rejection of `http://wiki.example.com`, userinfo, non-root path, query, fragment, `password`, `token`, and `repositoryPath`.

- [ ] **Step 2: Run tests to verify RED**

Run: `go test ./internal/shared ./cmd/wheelmaker -run 'KnowledgeRegistry|RegistryServerConfig'`

Workdir: `server`

Expected: FAIL because the config/model propagation is absent.

- [ ] **Step 3: Implement minimal strict parsing and Registry config propagation**

Normalize by parsing once at the config input boundary. Do not trim repeatedly downstream. Local dev/runtime copies preserve the locator; Hub reporter config does not receive it.

- [ ] **Step 4: Verify GREEN**

Run: `go test ./internal/shared ./cmd/wheelmaker -run 'KnowledgeRegistry|RegistryServerConfig'`

Expected: PASS.

- [ ] **Step 5: Git checkpoint**

Checkpoint shared config, example, Registry construction, and focused tests.

### Task 2: Project the optional URL through Registry connect info

**Files:**
- Modify: `server/internal/protocol/registry.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`

**Acceptance:** Client `connect.init` responses contain optional `serverInfo.knowledgeRegistryPublicUrl`; empty config omits it; Hub reports cannot change it; protocol version remains exactly current.

- [ ] **Step 1: Write failing connect-response tests**

Construct Registry with `KnowledgeRegistryPublicURL: "https://wiki.example.com"`, connect a client, and assert the response field. Connect a Hub that sends arbitrary descriptors/events and assert a later client still receives the configured value. Assert empty config serializes no field.

- [ ] **Step 2: Run tests to verify RED**

Run: `go test ./internal/registry -run 'Connect.*KnowledgeRegistry|KnowledgeRegistry.*Connect'`

Workdir: `server`

Expected: FAIL because the Config and serverInfo field are absent.

- [ ] **Step 3: Implement the optional field without version changes**

Add one Registry Config field and one `omitempty` protocol field. Populate from immutable server config only.

- [ ] **Step 4: Verify GREEN and protocol compatibility**

Run: `go test ./internal/registry ./internal/protocol`

Workdir: `server`

Expected: PASS; `git diff -- server/internal/protocol` contains no default protocol version change.

- [ ] **Step 5: Git checkpoint**

Checkpoint Registry/protocol changes and tests. Do not expand the approved Wiki target set.

### Task 3: Retain Registry connection metadata in the Web service

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryClient.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/__tests__/web-registry-workspace-service.test.ts`
- Create: `app/web/src/registry/RegistryClient.test.ts`

**Acceptance:** The Web client safely normalizes the optional URL from `connect.init`, exposes it on the connected workspace session, clears it on disconnect/reconnect, and treats old-server or malformed values as absent.

- [ ] **Step 1: Write failing client/service tests**

Assert `connectInit()` returns normalized server info, `initialize()` retains it, `connect()` places it on `WorkspaceSession`, and a reconnect to an old server clears the prior value. Do not accept non-HTTP(S) values from an untrusted test server.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- --runInBand web/src/registry/RegistryClient.test.ts __tests__/web-registry-workspace-service.test.ts`

Workdir: `app`

Expected: FAIL because connect response metadata is discarded.

- [ ] **Step 3: Implement minimal typed propagation**

Return the `RegistryEnvelope` from `connectInit`, normalize one optional string in `RegistryRepository.initialize`, and carry it in `WorkspaceSession`. Avoid adding a second fetch or Hub-owned state.

- [ ] **Step 4: Verify GREEN and TypeScript**

Run: `npm test -- --runInBand web/src/registry/RegistryClient.test.ts __tests__/web-registry-workspace-service.test.ts && npm run tsc:web`

Expected: PASS.

- [ ] **Step 5: Git checkpoint**

Checkpoint Web Registry types/client/service and tests.

### Task 4: Add the desktop title-bar and mobile app-menu entries

**Files:**
- Modify: `app/web/src/common/Icon.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/shell/WheelMakerAppMenu.tsx`
- Modify: `app/web/src/shell/WheelMakerAppMenu.test.tsx`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`

**Acceptance:** Configured sessions render one accessible Personal Wiki button between Terminal and Files on desktop and one `Personal Wiki` app-menu row on mobile; missing URL renders neither; both call the same safe external opener and never embed/navigate the current WheelMaker page.

- [ ] **Step 1: Write failing UI tests**

`WheelMakerAppMenu.test.tsx` asserts the row is absent without URL, present with URL, closes the menu and calls `onOpenPersonalWiki` once. The Workspace static/React contract asserts `aria-label="Open Personal Wiki"`, ordering after terminal and before files, and no iframe/current-location assignment.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- --runInBand web/src/shell/WheelMakerAppMenu.test.tsx __tests__/web-chat-file-peek-viewer.test.ts`

Workdir: `app`

Expected: FAIL because props, row, icon, and title action are absent.

- [ ] **Step 3: Implement the shared external opener and entries**

Use the existing icon vocabulary with a semantic book/library icon. Browser uses `window.open(url, '_blank', 'noopener,noreferrer')`; Desktop follows the existing external-browser handling path. Pass the same callback to title and menu surfaces.

- [ ] **Step 4: Verify GREEN, layout contracts, and build**

Run: `npm test -- --runInBand web/src/shell/WheelMakerAppMenu.test.tsx __tests__/web-chat-file-peek-viewer.test.ts && npm run tsc:web && npm run build:web`

Workdir: `app`

Expected: PASS; no mobile title-bar width changes because the row is in the app menu.

- [ ] **Step 5: Git checkpoint**

Checkpoint icon, UI, and tests. Reuse the existing title-action classes without a new style contract.

### Task 5: Run WheelMaker compatibility regression

**Files:**
- Modify: this plan's checkboxes only after commands pass.

**Acceptance:** New/old client-server combinations remain compatible, no protocol version changed, and unrelated Hub/project behavior is unchanged.

- [ ] **Step 1: Run focused Go suites**

Run: `go test ./internal/shared ./internal/registry ./internal/protocol ./cmd/wheelmaker`

Workdir: `server`

Expected: PASS.

- [ ] **Step 2: Run focused Web and type/build suites**

Run: `npm test -- --runInBand web/src/shell/WheelMakerAppMenu.test.tsx web/src/registry/RegistryClient.test.ts __tests__/web-registry-workspace-service.test.ts __tests__/web-chat-file-peek-viewer.test.ts && npm run tsc:web && npm run build:web`

Workdir: `app`

Expected: PASS.

- [ ] **Step 3: Audit protocol and privacy boundaries**

Run: `git diff origin/main...HEAD -- server/internal/protocol | rg -n "DefaultProtocolVersion|RegistryProtocolVersion"`

Expected: No changed version constant.

- [ ] **Step 4: Git checkpoint**

Checkpoint any test-only compatibility corrections and mark this plan complete.
