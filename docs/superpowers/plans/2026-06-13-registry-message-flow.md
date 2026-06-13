# Registry Message Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Registry `batch` and stop slow hub-bound requests from blocking unrelated hub-bound requests on the same client connection.

**Architecture:** Keep Registry as an auth, route lookup, cache snapshot, and broadcast relay. Delete the `batch` protocol surface. Replace the single per-client async FIFO with route-aware dispatch so unrelated hub-bound requests execute independently while WebSocket writes remain serialized by `peerConn.writeMu`.

**Tech Stack:** Go server (`server/internal/registry`, `server/internal/protocol`), TypeScript registry constants, markdown protocol docs, existing Go tests.

---

### Task 1: Remove Registry Batch Protocol

**Files:**
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `docs/registry-protocol.md`

- [x] **Step 1: Write failing tests**

Add tests proving `batch` is no longer registered and direct `batch` requests are rejected before any hub forwarding.

- [x] **Step 2: Run focused tests and verify red**

Run: `cd server && go test ./internal/protocol ./internal/registry -run "Batch|RegistryHubStateMethodsRequireHubID|RegistryProtocolDomainOldMethodsAreRemoved" -count=1`

Expected: FAIL while production code still registers and handles `batch`.

- [x] **Step 3: Delete batch production code**

Remove batch descriptors, feature advertisement, request routing, and batch handler/executor.

- [x] **Step 4: Run focused tests and verify green**

Run: `cd server && go test ./internal/protocol ./internal/registry -run "Batch|RegistryHubStateMethodsRequireHubID|RegistryProtocolDomainOldMethodsAreRemoved" -count=1`

Expected: PASS.

### Task 2: Split Hub-Bound Request Flow

**Files:**
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`

- [x] **Step 1: Write failing test**

Add a two-hub test where a slow `session.list` forwarded to one hub does not prevent a later `session.list` from being forwarded to a different hub and returned first.

- [x] **Step 2: Run focused test and verify red**

Run: `cd server && go test ./internal/registry -run TestForwardRequestsToDifferentHubsDoNotShareClientQueue -count=1`

Expected: FAIL with the fast hub not receiving the second request before the deadline.

- [x] **Step 3: Implement route-aware async dispatch**

Remove the single `asyncRequests` worker. Dispatch relay, monitor forward, hub state, and client forward requests independently. Keep local registry/cache requests inline.

- [x] **Step 4: Run focused test and verify green**

Run: `cd server && go test ./internal/registry -run "TestForwardRequestsToDifferentHubsDoNotShareClientQueue|TestProjectListRespondsWhileSameClientHasPendingHubStateRequest" -count=1`

Expected: PASS.

### Task 3: Verify Full Server Surface

**Files:**
- No new files.

- [x] **Step 1: Run server tests**

Run: `cd server && go test ./...`

Expected: PASS.

- [x] **Step 2: Check remaining batch protocol references**

Run: `rg -n "RegistryMethodBatch|RegistryRouteBatch|SupportsBatch|Batchable|RegistryMethods\\.Batch|method\\\": \\\"batch\\\"|method\\\":\\\"batch\\\"" server app/web/src docs/registry-protocol.md --glob "!**/dist/**"`

Expected: no Registry protocol batch references remain.
