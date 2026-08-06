# Gateway Pointer and Hub Update Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Gateway through the existing Desktop/APK-style virtual pointer and expose an independent Gateway version/update action on each Hub row only when Gateway is installed on that Hub host.

**Architecture:** Keep the release number shared with normal version releases while `stable.gateway` remains an independently advancing pointer; a release without Gateway carries the previous pointer forward. Add a dedicated `gatewayUpdate` HubState section so Gateway status/jobs cannot collide with WheelMaker runtime updates. The Hub invokes the existing `deploy.mjs gateway` command and the Web compares the local Gateway release identity with the public stable pointer.

**Tech Stack:** Go Hub/Registry runtime, Node.js release/deploy scripts, React/TypeScript Web UI, Jest/Vitest-style frontend tests, Go tests, Markdown Wiki.

---

### Task 1: Extend the release publish contract for Gateway

**Files:**
- Modify: `app/web/src/settings/ReleasePublishSettings.tsx`
- Test: `app/web/src/settings/ReleasePublishSettings.test.tsx`
- Modify: `server/internal/hub/tools/release.go`
- Test: `server/internal/hub/tools/tools_test.go`

- [x] **Step 1: Write failing tests**
  - Assert the publish form persists `gateway`, renders `Include Gateway`, and sends `gateway: true` in a version publish request.
  - Assert `cmd.release start` accepts the Gateway field and the release runner receives `--with-gateway` while retaining Desktop/Android flags.

- [x] **Step 2: Run the focused tests and verify they fail**
  - Run `npm test -- --runInBand app/web/src/settings/ReleasePublishSettings.test.tsx` from the Web package and `go test ./internal/hub/tools -run 'Release|release'` from `server`.
  - Expected failures must report the missing Gateway field/argument rather than test setup errors.

- [x] **Step 3: Implement the minimum contract changes**
  - Add `gateway: boolean` to persisted UI settings, default it to `false`, render the checkbox, include it in confirmation data, and send it as `gateway` for `kind: "version"`.
  - Add `Gateway bool \`json:"gateway,omitempty"\`` to `releaseCommandPayload` and append `--with-gateway` in `ReleaseCommand.run` when true.

- [x] **Step 4: Run focused tests and verify they pass**
  - Re-run the two commands above; then run the existing release publish test file and Go release command tests.

### Task 2: Preserve and validate the Gateway stable pointer in Web metadata

**Files:**
- Modify: `app/web/src/settings/agentPackageUpdateView.ts`
- Test: `app/web/src/settings/agentPackageUpdateView.test.ts`
- Modify: `app/web/src/registry/registryTypes.ts`

- [x] **Step 1: Write failing tests**
  - Add a stable metadata fixture containing `gateway` and assert parsing returns the pointer.
  - Assert malformed Gateway version/source/manifest identity is rejected.

- [x] **Step 2: Run the focused parser tests and verify they fail**
  - Run `npm test -- --runInBand app/web/src/settings/agentPackageUpdateView.test.ts`.

- [x] **Step 3: Implement the pointer type and parser validation**
  - Define `RegistryWheelMakerGatewayPointer` / `WheelMakerGatewayPointer` with `version`, `sourceSha`, `manifestPath`, and `manifestSha256`.
  - Validate the fixed `/gateway/current/gateway-manifest.json` path and digests, and preserve the pointer in `WheelMakerStableMetadata`.

- [x] **Step 4: Run focused parser tests and the existing Web settings test suite**

### Task 3: Add Hub-local Gateway status and update execution

**Files:**
- Create: `server/internal/hub/tools/gateway_update.go`
- Test: `server/internal/hub/tools/gateway_update_test.go`
- Modify: `server/internal/hub/tools/manager.go`
- Modify: `server/internal/hub/hub_state.go`
- Modify: `server/internal/hub/hub_state_adapters.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/registry/server.go`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/hubState/hubRefreshTriggers.ts`
- Test: `server/internal/hub/hub_test.go`
- Test: `server/internal/registry/server_test.go`

- [x] **Step 1: Write failing command/state tests**
  - Query returns `not_installed` without `gateway/state/release.json`.
  - Query returns the installed Gateway identity for a valid state file.
  - A request creates one accepted job and invokes `node <stateDir>/deploy.mjs gateway`; a second request while active is rejected/returns the same pending job.
  - HubState bootstrap/refresh includes `gatewayUpdate`; the action validator and update-only Hub allow `gatewayUpdate/requestUpdate`.

- [x] **Step 2: Run the focused Go tests and verify they fail**
  - Run `go test ./internal/hub/tools -run Gateway` and `go test ./internal/hub ./internal/registry -run 'Gateway|gateway'` from `server`.

- [x] **Step 3: Implement the minimum Hub command**
  - Read/write only `gateway/state/release.json` for local identity.
  - Persist a small Gateway job/lease under `gateway/update`, launch the existing `deploy.mjs gateway` command through an injected runner, and refresh the section when it reaches a terminal state.
  - Keep the Hub runtime running; do not call the WheelMaker runtime restart path.

- [x] **Step 4: Wire the dedicated `gatewayUpdate` section**
  - Register its refresh/action handlers, bootstrap it, refresh it after completion, add the Registry type literal, and allow its refresh/action in update-only mode.

- [x] **Step 5: Run focused Go tests and the full server test suite**

### Task 4: Derive Gateway availability and render an independent Hub-row action

**Files:**
- Modify: `app/web/src/settings/agentPackageUpdateView.ts`
- Test: `app/web/src/settings/agentPackageUpdateView.test.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/app/ChatHubMenu.tsx`
- Test: `app/web/src/app/ChatHubMenu.test.tsx` (or the existing Hub menu test file)
- Modify: relevant Web stylesheet adjacent to Hub menu styles

- [x] **Step 1: Write failing derivation/UI tests**
  - Installed Gateway + newer stable pointer yields `update_available` and a visible Gateway action.
  - Missing Gateway data yields no Gateway version/action.
  - Equal pointer identity yields a visible version with no update dot/action.
  - Clicking the Gateway action calls the Gateway-specific confirmation/request callback without changing WheelMaker pending state.

- [x] **Step 2: Run focused tests and verify they fail**
  - Run the helper and Hub menu test files with the Web test runner.

- [x] **Step 3: Implement derivation and state plumbing**
  - Add Gateway status/identity helpers that compare `manifestSha256`/`sourceSha` and validated version sequences against `stable.gateway`.
  - Add `gateway` data to the operational Hub card and a separate pending/confirmation path calling `service.requestGatewayUpdate`.

- [x] **Step 4: Implement the Hub row UI**
  - Render `Gateway <version>` before the existing WheelMaker version only when Gateway is installed.
  - Render a separate refresh button/dot and spinner; keep WheelMaker update/restart buttons unchanged.

- [x] **Step 5: Run focused Web tests, typecheck, and Web build**

### Task 5: Update long-lived Wiki documentation

**Files:**
- Modify: `docs/wiki/release-and-build/release.md`
- Modify: `docs/wiki/architecture/gateway.md`

- [x] **Step 1: Read the two approved Wiki pages and the release/deploy source references**

- [x] **Step 2: Update the release page**
  - Document `Include Gateway`, `stable.gateway` carry-forward/advance semantics, and the fact that Gateway shares the release number but has an independent virtual pointer.

- [x] **Step 3: Update the Gateway architecture page**
  - Document Hub-local detection, the dedicated `gatewayUpdate` action, `deploy.mjs gateway`, and that Gateway updates do not stop/restart WheelMaker.

- [x] **Step 4: Run Markdown/link checks available in the repository**

### Task 6: Full verification and handoff

**Files:**
- Test only; no additional production files.

- [x] **Step 1: Run all focused Web and Go tests again**
- [x] **Step 2: Run `go test ./... -count=1` from `server`**
- [x] **Step 3: Run the Web test/typecheck/build commands required by `app/web/package.json`**
- [x] **Step 4: Review the diff for protocol-version changes, accidental Gateway auto-update, and unapproved files**
- [x] **Step 5: Report changed files, test results, and any remaining operational caveat**
