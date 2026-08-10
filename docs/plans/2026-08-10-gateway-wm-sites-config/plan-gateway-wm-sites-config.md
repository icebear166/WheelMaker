# Gateway `wm_sites` Config Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Invoke git-workflow-preferences through prepare/checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Gateway schema 1 top-level site sections with schema 2 `wm_sites`, shared TLS, Hub-synced Registry/Share URL modes, and nested Release runtime configuration.

**Scope Source:** `docs/scope/2026-08-10-gateway-wm-sites-config.md`

**Architecture:** Gateway parses one schema 2 object whose `wm_sites` member owns shared TLS and the three fixed site records. Registry and Share retain runtime-only URLs populated from Hub config, while Release Server and deployment code read and update `wm_sites.release`; schema 1 Gateway files are rejected without writes.

**Tech Stack:** Go, embedded Caddy JSON compiler, Node.js ESM deployment scripts, Go and `node:test` test suites, Markdown Wiki.

**Verification:** `go test ./...` from `server/`; all `scripts/deploy/*.test.mjs` through `node --test`; `gofmt -l`; `git diff --check`; placeholder scan of the spec, plan, and changed sources.

---

### Task 1: Synchronize the confirmed Wiki pages

**Files:**
- Modify: `docs/wiki/architecture/gateway.md`
- Modify: `docs/wiki/architecture/server-runtime.md`
- Modify: `docs/wiki/features/public-sharing.md`
- Modify: `docs/wiki/release-and-build/release.md`

**Acceptance:** The four approved pages describe schema 2 `wm_sites`, shared TLS, `sync_hub`, nested Release configuration, strict schema 1 rejection, and unchanged runtime ownership without retaining the retired Gateway shape.

- [x] **Step 1: Update Gateway architecture**

Replace the schema 1 example and per-site TLS descriptions with the exact schema 2 canonical JSON. Document `wm_sites.registry/share.urlMode`, shared TLS behavior, Release nesting, and the no-migration failure boundary.

- [x] **Step 2: Update runtime, Share, and Release ownership text**

Change only the confirmed pages: keep Hub URL ownership and Registry request-boundary rereads unchanged, but point Gateway/Release reads and writes to `wm_sites.release` and TLS to `wm_sites.tls`.

- [x] **Step 3: Check the approved pages for retired paths**

Run: `rg -n "schema.?1|config\.json\.release|release\.publicUrl|各路由 TLS|Registry 与 Share section|registry\.tls|share\.tls|release\.tls" docs/wiki/architecture/gateway.md docs/wiki/architecture/server-runtime.md docs/wiki/features/public-sharing.md docs/wiki/release-and-build/release.md`

Expected: Any match is explicitly historical or replaced before continuing; current-behavior text uses schema 2 nested paths.

- [x] **Step 4: Validate and checkpoint the Wiki unit**

Run: `git diff --check`

Expected: PASS with no whitespace errors. Invoke `git-workflow-preferences` in checkpoint mode for the four Wiki files and record the resulting commit.

### Task 2: Implement Gateway schema 2 and shared site TLS with TDD

**Files:**
- Modify: `server/internal/gateway/types.go`
- Modify: `server/internal/gateway/runtime.go`
- Modify: `server/internal/gateway/compiler.go`
- Modify: `server/internal/gateway/gateway_test.go`
- Modify: `server/internal/gateway/single_config_test.go`
- Modify: `server/internal/gateway/relay_integration_test.go`
- Modify: `server/cmd/wheelmaker-gateway/main_test.go`

**Acceptance:** Gateway accepts schema 2 `wm_sites`, defaults missing Registry/Share `urlMode` to `sync_hub`, rejects schema 1 and unsupported modes, derives Hub URLs as before, and gives every generated site the same validated TLS configuration.

- [x] **Step 1: Write Gateway schema and defaulting tests**

Add tests that load the exact schema 2 JSON, assert canonical `wm_sites` serialization, assert missing `urlMode` becomes `sync_hub`, and assert schema 1, old top-level site sections, per-site TLS, and another `urlMode` are rejected.

- [x] **Step 2: Write runtime and compiler shared-TLS tests**

Build Registry, Release, and Share routes from Hub plus Gateway inputs and assert their runtime `TLSConfig` values equal `wm_sites.tls`. For a shared explicit certificate, assert generated Caddy JSON loads the certificate pair once while matching all HTTPS site hostnames.

- [x] **Step 3: Run the focused tests and verify RED**

Run from `server/`: `go test ./internal/gateway ./cmd/wheelmaker-gateway`

Expected: FAIL because schema 2, `wm_sites`, `sync_hub`, and shared TLS are not implemented; failures must come from the new behavior assertions rather than malformed test fixtures.

- [x] **Step 4: Implement the minimal Gateway model and runtime changes**

Set `GlobalSchemaVersion` to 2; introduce `WMSitesConfig` and a Hub-synced site config carrying `urlMode` plus runtime-only `PublicURL`; move `ReleaseConfig` beneath `wm_sites`; default and validate only `sync_hub`; assign `wm_sites.tls` to every generated site; deduplicate a shared explicit certificate in the Caddy TLS app.

- [x] **Step 5: Format and verify GREEN**

Run from `server/`: `gofmt -w internal/gateway/types.go internal/gateway/runtime.go internal/gateway/compiler.go internal/gateway/gateway_test.go internal/gateway/single_config_test.go internal/gateway/relay_integration_test.go cmd/wheelmaker-gateway/main_test.go`

Run from `server/`: `go test ./internal/gateway ./cmd/wheelmaker-gateway`

Expected: PASS with schema 2 and shared-TLS behavior covered.

- [x] **Step 6: Checkpoint the Gateway unit**

Invoke `git-workflow-preferences` in checkpoint mode for the listed Gateway files after the focused tests pass. Record commit hash and subject.

### Task 3: Replace deploy-time Gateway migration with strict schema 2 handling

**Files:**
- Modify: `scripts/deploy/deploy-core.mjs`
- Modify: `scripts/deploy/gateway-config.test.mjs`
- Modify: `scripts/deploy/gateway-single-config.test.mjs`
- Modify: `scripts/deploy/deploy-core.test.mjs`

**Acceptance:** New Gateway files use canonical schema 2 `wm_sites`; schema 2 inputs are normalized without losing unrelated values; schema 1 files fail before any write; deploy readers expose nested Release configuration.

- [x] **Step 1: Write deploy schema 2 tests**

Assert the default file contains `schema: 2`, top-level `acme` and `wm_sites`, shared TLS, both `sync_hub` defaults, and complete nested Release fields. Assert old top-level Registry/Release/Share and per-site TLS are unknown fields.

- [x] **Step 2: Write no-migration and atomic-failure tests**

Create a schema 1 file with recognizable bytes, call `ensureGatewayConfiguration`, assert an unsupported-schema error, then reread the file and assert byte-for-byte equality. Add a schema 2 missing-`urlMode` case that normalizes both modes to `sync_hub`.

- [x] **Step 3: Run deploy tests and verify RED**

Run: `node --test scripts/deploy/gateway-config.test.mjs scripts/deploy/gateway-single-config.test.mjs scripts/deploy/deploy-core.test.mjs`

Expected: FAIL because deployment still emits schema 1 top-level sections and migrates old Gateway fields.

- [x] **Step 4: Implement schema 2 validation, defaults, and reads**

Replace the three top-level site constants with `wm_sites`; validate shared TLS and only `sync_hub`; nest Release validation/output; remove the schema 1 Gateway migration path from `ensureGatewayConfiguration`; keep normalization writes only after a schema 2 input validates successfully; return nested site values from `readGatewayConfiguration`.

- [x] **Step 5: Verify GREEN and focused deploy regression**

Run: `node --test scripts/deploy/gateway-config.test.mjs scripts/deploy/gateway-single-config.test.mjs scripts/deploy/deploy-core.test.mjs scripts/deploy/gateway-runtime.test.mjs scripts/deploy/gateway-install.test.mjs`

Expected: PASS with schema 1 bytes preserved on rejection and all Gateway deployment behavior green.

- [x] **Step 6: Checkpoint the deploy unit**

Invoke `git-workflow-preferences` in checkpoint mode for the deploy implementation and tests after verification passes. Record commit hash and subject.

### Task 4: Move Release Server integration to `wm_sites.release`

**Files:**
- Modify: `server/internal/releaseserver/config.go`
- Modify: `server/internal/releaseserver/config_test.go`
- Modify: `server/cmd/wheelmaker-release-server/main_test.go`

**Acceptance:** Release Server strictly reads and atomically updates schema 2 `wm_sites.release`, preserves sibling `wm_sites` values and shared TLS, creates schema 2 when converting a legacy standalone Release Server config, and refuses an existing schema 1 Gateway file unchanged.

- [ ] **Step 1: Write nested Release read/write tests**

Use a complete schema 2 fixture and assert LoadConfig, public URL updates, token hash updates, and data-root updates operate on `wm_sites.release` while preserving `wm_sites.tls`, Registry/Share modes, ACME, and unrelated valid fields.

- [ ] **Step 2: Write strict old-Gateway rejection tests**

Pass an existing schema 1 Gateway file through Release configuration/update and legacy-conversion entry points; assert a schema error and byte-for-byte unchanged contents. Keep standalone Release config schema 1 tests for the separate legacy source format.

- [ ] **Step 3: Run Release Server tests and verify RED**

Run from `server/`: `go test ./internal/releaseserver ./cmd/wheelmaker-release-server`

Expected: FAIL because the integration still searches for and writes a top-level `release` object.

- [ ] **Step 4: Implement nested Release helpers**

Parse the Gateway schema independently from the standalone Release config schema; locate `wm_sites.release`; validate schema 2 before writes; preserve the complete outer document and sibling `wm_sites` fields during atomic updates; remove Release TLS from the nested runtime record; emit canonical schema 2 `wm_sites` when the legacy standalone config conversion creates a new Gateway file.

- [ ] **Step 5: Format and verify GREEN**

Run from `server/`: `gofmt -w internal/releaseserver/config.go internal/releaseserver/config_test.go cmd/wheelmaker-release-server/main_test.go`

Run from `server/`: `go test ./internal/releaseserver ./cmd/wheelmaker-release-server`

Expected: PASS with nested read/write and schema 1 no-write behavior covered.

- [ ] **Step 6: Checkpoint the Release Server unit**

Invoke `git-workflow-preferences` in checkpoint mode for the listed Release Server files after focused tests pass. Record commit hash and subject.

### Task 5: Complete integration verification and task records

**Files:**
- Modify: `docs/plans/2026-08-10-gateway-wm-sites-config/plan-gateway-wm-sites-config.md`

**Acceptance:** Every spec criterion and plan checkbox is satisfied, all Go and deployment tests pass, formatting is clean, and no old Gateway shape remains in current source or the four approved Wiki pages.

- [ ] **Step 1: Run the complete Go suite**

Run from `server/`: `go test ./...`

Expected: PASS for every package.

- [ ] **Step 2: Run every deployment test**

Run from the repository root in PowerShell: `$deployTests = @(Get-ChildItem -LiteralPath 'scripts/deploy' -Filter '*.test.mjs' -File | Select-Object -ExpandProperty FullName); node --test $deployTests`

Expected: PASS with zero failed tests.

- [ ] **Step 3: Run formatting, retired-shape, placeholder, and diff checks**

Run: `gofmt -l server/internal/gateway server/internal/releaseserver server/cmd/wheelmaker-gateway server/cmd/wheelmaker-release-server`

Expected: no output for changed Go files.

Run: `rg -n "config\.json\.release|Gateway.*release section|\"schema\": 1|registry\.tls|share\.tls|release\.tls" server/internal/gateway server/internal/releaseserver server/cmd/wheelmaker-gateway server/cmd/wheelmaker-release-server scripts/deploy docs/wiki/architecture/gateway.md docs/wiki/architecture/server-runtime.md docs/wiki/features/public-sharing.md docs/wiki/release-and-build/release.md`

Expected: matches are limited to explicit schema 1 rejection tests, standalone Release config schema 1, or historical context; current Gateway fixtures and behavior use schema 2.

Run: `rg -n "T(BD)|T(ODO)|implement l(ater)|fill in d(etails)|待(定)|待(确认)|适当(处理)" docs/scope/2026-08-10-gateway-wm-sites-config.md docs/plans/2026-08-10-gateway-wm-sites-config server/internal/gateway server/internal/releaseserver scripts/deploy`

Expected: no task-created placeholders.

Run: `git diff --check`

Expected: PASS.

- [ ] **Step 4: Review the approved scope and Wiki targets**

Confirm every acceptance item in `docs/scope/2026-08-10-gateway-wm-sites-config.md` maps to passing tests or an inspected diff, and confirm only the four approved Wiki files were changed under `docs/wiki`.

- [ ] **Step 5: Final checkpoint and Git finalization**

Mark all completed plan steps, invoke `git-workflow-preferences` checkpoint for the verification record, then invoke finalize with the actual result. Follow configured push, local `main` merge, main push, and successful branch/worktree cleanup behavior.
