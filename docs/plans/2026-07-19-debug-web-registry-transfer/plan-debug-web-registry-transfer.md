# Debug Web Registry Direct Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a temporary Debug Web ZIP from the source-building Hub to a selected Web Hub through Registry, with no Release Server upload or download.

**Architecture:** Formal releases keep the existing Release Server path. A Debug Web job writes a ZIP owned by its source Hub job directory, then streams acknowledged 4 MiB chunks through Registry. Registry only retains in-memory session metadata; the Web Hub receives under its existing update lease, verifies the archive, and atomically replaces `~/.wheelmaker/web`.

**Tech Stack:** Go, Gorilla WebSocket, Node MJS, React/TypeScript, Go tests, Node test runner, Jest.

---

### Task 1: Build a job-owned Debug Web archive locally

**Files:**
- Modify: `scripts/release/debug-web.mjs`
- Modify: `scripts/release/debug-web.test.mjs`

- [ ] **Step 1: Write a failing `buildDebugWeb` test**

Replace the publication API test with a fake Web build that writes `index.html`, then assert `buildDebugWeb` produces requested ZIP metadata.

```javascript
const archive = await buildDebugWeb({repoRoot: root, outputPath: join(root, 'job', 'debug-web.zip'), runner});
assert.match(archive.sha256, /^[a-f0-9]{64}$/);
```

- [ ] **Step 2: Run red test**

Run: `node --test scripts/release/debug-web.test.mjs`

Expected: `buildDebugWeb is not exported`.

- [ ] **Step 3: Implement local-only CLI**

Export `buildDebugWeb`, preserve deterministic ZIP generation, and make the executable entrypoint accept only an absolute output path. Remove Release Server API and publisher-token imports.

```javascript
if (args.length !== 2 || args[0] !== '--output' || !isAbsolute(args[1])) throw new Error('usage: node scripts/release/debug-web.mjs --output <absolute-zip-path>');
await buildDebugWeb({repoRoot, outputPath: args[1]});
```

- [ ] **Step 4: Run green test and commit**

Run: `node --test scripts/release/debug-web.test.mjs`

Expected: PASS.

```bash
git add scripts/release/debug-web.mjs scripts/release/debug-web.test.mjs
git commit -m "refactor(release): build debug web locally"
```

### Task 2: Define additive Hub transfer methods

**Files:**
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`

- [ ] **Step 1: Write failing route/role tests**

Test that source methods `hub.debugWeb.transfer.start`, `.chunk`, `.finish`, `.abort` are Hub-only, require `hubId`, and use `RegistryRouteHubDebugWebTransfer`; assert `DefaultProtocolVersion` stays `2.6`.

```go
if RegistryMethodAllowed(string(RegistryRoleClient), RegistryMethodHubDebugWebTransferChunk) { t.Fatal("client must not send chunks") }
```

- [ ] **Step 2: Run red test**

Run: `cd server && go test ./internal/protocol -run TestRegistryMethodRolesAndRoutes -count=1`

Expected: compile failure for the new constant.

- [ ] **Step 3: Register method families**

Add the route and source descriptors. Add Registry-to-Web-Hub internal constants `hub.debugWeb.receive.start`, `.chunk`, `.finish`, `.abort`; do not expose these to clients and do not alter the protocol version.

- [ ] **Step 4: Run green test and commit**

Run: `cd server && go test ./internal/protocol -count=1`

Expected: PASS.

```bash
git add server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go
git commit -m "feat(protocol): add hub debug web transfer routes"
```

### Task 3: Relay acknowledged chunks in Registry

**Files:**
- Create: `server/internal/registry/debug_web_transfer.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`

- [ ] **Step 1: Write failing integration tests**

Use two reported Hub peers. Assert start forwards to the Web Hub, `sequence:0` chunk forwards with its base64 data, finish returns target success, and invalid sequence/offline Hub fail. Assert disconnect sends `hub.debugWeb.receive.abort`.

```go
if forwarded.Payload["sequence"] != float64(0) { t.Fatalf("chunk sequence=%v", forwarded.Payload["sequence"]) }
```

- [ ] **Step 2: Run red test**

Run: `cd server && go test ./internal/registry -run DebugWebTransfer -count=1`

Expected: FAIL because no transfer route exists.

- [ ] **Step 3: Implement bounded in-memory sessions**

Store transfer ID, source Hub, Web Hub, expected size/hash and next sequence in `Server`. Validate identity, target online, base64, 4 MiB decoded chunk maximum and ordering. Forward each request via `targetPeer.registerPending`; wait 60 seconds for target acknowledgement; delete the session on finish, abort, error, timeout or either-Hub disconnect. On disconnect, best-effort abort the surviving receiver. Register this route with async request dispatch; never write bytes to disk.

```go
if transfer.SourceHubID != state.hubID || sequence != transfer.NextSequence { writeError(peer, in.RequestID, in.Method, codeConflict, "invalid debug web transfer sequence", nil); return }
```

- [ ] **Step 4: Run green test and commit**

Run: `cd server && go test ./internal/registry -run "DebugWebTransfer|HubReleaseNotification" -count=1`

Expected: PASS.

```bash
git add server/internal/registry/debug_web_transfer.go server/internal/registry/server.go server/internal/registry/server_test.go
git commit -m "feat(registry): relay debug web archives between hubs"
```

### Task 4: Source streaming and Web Hub application

**Files:**
- Modify: `server/internal/hub/reporter.go`, `server/internal/hub/hub_test.go`
- Modify: `server/internal/hub/tools/release.go`, `server/internal/hub/tools/manager.go`
- Modify: `server/internal/hub/tools/debug_web.go`, `server/internal/hub/tools/debug_web_test.go`, `server/internal/hub/tools/tools_test.go`

- [ ] **Step 1: Write failing job and receiver tests**

Require `webHubId` for Debug Web jobs; assert the runner receives `scripts/release/debug-web.mjs --output <job-dir>/debug-web.zip`; assert transfer metadata/status and artifact retention. Test receiver success, wrong sequence and digest mismatch while preserving existing `web/index.html`.

```go
if string(current) != "old" { t.Fatalf("existing web was replaced: %q", current) }
```

- [ ] **Step 2: Run red tests**

Run: `cd server && go test ./internal/hub ./internal/hub/tools -run "DebugWeb.*Transfer|ReleaseCommand.*DebugWeb" -count=1`

Expected: FAIL because the notifier and receiver are absent.

- [ ] **Step 3: Implement source job and Reporter sender**

Extend `ReleaseNotifier` with `TransferDebugWeb(ctx, targetHubID, transferID, archivePath string, size int64, sha256 string)`. A Debug Web ReleaseCommand builds to `release-jobs/<jobId>/debug-web.zip`, computes metadata, marks `transferring`, calls this notifier, writes final `targetState`, and retains the archive. Version jobs alone retain `baseUrl`, `targetHubId`, and `autoPull`. Reporter reads and base64-sends at most 4 MiB per request, waiting after start/chunk/finish, and dispatches internal receive methods to its Tool Manager.

- [ ] **Step 4: Implement lease-bound receiver**

Replace HTTP `ApplyDebugWeb` with begin/append/finish/abort operations. Begin creates the update lease and a `0600` staging archive. Append writes only the expected sequence while hashing. Finish verifies exact bytes and SHA-256, calls `extractDebugWebZip` and `replaceDebugWeb`, then removes staging and lease. Abort removes staging/lease and leaves current Web unchanged. `Manager.ApplyRelease` accepts only `version`, eliminating any Hub Debug Web pull from Release Server.

```go
if session.written != session.size || hex.EncodeToString(session.hash.Sum(nil)) != session.sha256 { return failedDigestStatus }
```

- [ ] **Step 5: Run green tests and commit**

Run: `cd server && go test ./internal/hub ./internal/hub/tools -count=1`

Expected: PASS.

```bash
git add server/internal/hub/reporter.go server/internal/hub/hub_test.go server/internal/hub/tools/release.go server/internal/hub/tools/manager.go server/internal/hub/tools/debug_web.go server/internal/hub/tools/debug_web_test.go server/internal/hub/tools/tools_test.go
git commit -m "feat(hub): transfer debug web through registry"
```

### Task 5: Separate version and temporary-Web targets in Settings

**Files:**
- Modify: `app/web/src/settings/ReleasePublishSettings.tsx`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/__tests__/web-agent-package-update-settings.test.ts`

- [ ] **Step 1: Write a failing payload/UI test**

Assert version requests contain Release Server fields but Debug Web requests are exactly `{kind, sourcePath, webHubId}`. Assert `Web Hub` is required only for the temporary Web button.

```ts
expect(debugPayload).toEqual({kind: 'debugWeb', sourcePath: '/src/WheelMaker', webHubId: 'web-hub'});
```

- [ ] **Step 2: Run red test**

Run: `cd app && npm test -- --runTestsByPath __tests__/web-agent-package-update-settings.test.ts`

Expected: FAIL because current Debug Web sends `baseUrl` and uses the Server Hub/auto-pull controls.

- [ ] **Step 3: Implement separate controls**

Persist `webHubId`; retain `serverHubId` and `autoPull` for version publishing. Render separate Version deployment and Temporary Web deployment sections with independent enablement and explicit payload construction. Continue polling source-Hub jobs and display `targetState` for the selected Web Hub.

- [ ] **Step 4: Run green test and commit**

Run: `cd app && npm test -- --runTestsByPath __tests__/web-agent-package-update-settings.test.ts`

Expected: PASS.

```bash
git add app/web/src/settings/ReleasePublishSettings.tsx app/web/src/registry/registryTypes.ts app/__tests__/web-agent-package-update-settings.test.ts
git commit -m "feat(web): choose a hub for temporary web delivery"
```

### Task 6: Final documentation and verification

**Files:**
- Modify: `docs/wiki/protocols/registry.md`, `docs/wiki/release-and-build/release.md`
- Add: `docs/scope/2026-07-19-debug-web-registry-transfer.md`
- Add: `docs/plans/2026-07-19-debug-web-registry-transfer/plan-debug-web-registry-transfer.md`

- [ ] **Step 1: Align docs with exact method names**

Document the two method families, 4 MiB chunk bound, in-memory-only Registry semantics, source artifact retention, and removal of Release Server Debug Web delivery.

- [ ] **Step 2: Run complete verification**

Run: `cd server && go test ./internal/protocol ./internal/registry ./internal/hub ./internal/hub/tools -count=1`

Run: `cd app && npm test -- --runTestsByPath __tests__/web-agent-package-update-settings.test.ts`

Run: `node --test scripts/release/debug-web.test.mjs`

Run: `git diff --check`

Expected: every command exits `0`.

- [ ] **Step 3: Commit docs**

```bash
git add docs/wiki/protocols/registry.md docs/wiki/release-and-build/release.md docs/scope/2026-07-19-debug-web-registry-transfer.md
git commit -m "docs: describe direct debug web delivery"
```
