# Hub, Registry, and Gateway Configuration Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Invoke git-workflow-preferences through prepare/checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Hub main config the canonical source for shared Registry, Share, Relay, and local Gateway log settings while keeping Release-only settings in Gateway config and limiting hot reload to Gateway.

**Scope Source:** `docs/scope/2026-08-10-hub-registry-gateway-config.md`

**Architecture:** The Go shared config layer owns the canonical `registry.share` shape and migrates the old top-level `share`. Gateway loads its own TLS/ACME/Release config together with the parent Hub config, derives local routes from the merged runtime view, and fingerprints both files. Hub and Registry continue reading the Hub config at their existing startup/request boundaries; the deployer removes Gateway duplicates and preserves canonical Hub values.

**Tech Stack:** Go, Caddy embedded runtime, Node.js deployment tests, Markdown wiki.

**Verification:** Focused Go package tests, focused Node test files, `go test ./...`, the relevant Node test suite, `gofmt`, and `git diff --check`.

---

### Task 1: Synchronize confirmed architecture and feature Wiki pages

**Files:**
- Modify: `docs/wiki/architecture/gateway.md`
- Modify: `docs/wiki/architecture/server-runtime.md`
- Modify: `docs/wiki/features/public-sharing.md`
- Modify: `docs/wiki/release-and-build/release.md`

**Acceptance:** The four confirmed pages describe `~/.wheelmaker/config.json` as the shared source, `registry.share.publicUrl` as the Share origin, Gateway-only dual-file hot loading, Hub/Registry startup boundaries, and Gateway-owned Release settings. No unconfirmed behavior or protocol change is added.

- [x] **Step 1: Update the confirmed pages**

  Rewrite only the existing configuration ownership, route derivation, Share boundary, Relay boundary, and Release deployment statements that conflict with the approved spec. Preserve each page's first-line summary and existing unrelated knowledge.

- [x] **Step 2: Verify Wiki structure**

  Run `rg -n '^> 摘要：|registry\.share\.publicUrl|双配置|hot-load|热加载|Release-only' docs/wiki/architecture/gateway.md docs/wiki/architecture/server-runtime.md docs/wiki/features/public-sharing.md docs/wiki/release-and-build/release.md`.

  Expected: every modified page still begins with its summary and contains the relevant canonical ownership/lifecycle statements.

- [x] **Step 3: Git checkpoint**

  After the Wiki diff passes review, checkpoint only the four Wiki pages.

### Task 2: Move shared Share configuration into the Hub Registry section

**Files:**
- Modify: `server/internal/shared/config.go`
- Modify: `server/internal/shared/config_migration.go`
- Modify: `server/internal/shared/shared_test.go`

**Acceptance:** Strict runtime loading exposes `cfg.Registry.Share.PublicURL`; old top-level `share` is accepted only by migration, nested `registry.share` wins conflicts, and migration remains atomic/idempotent.

- [x] **Step 1: Write the failing shared-config tests**

  Add assertions for nested `registry.share`, strict rejection of an unmigrated top-level `share`, migration of a top-level Share object, and preservation of an already canonical nested Share value when both locations exist.

- [x] **Step 2: Run the focused tests and verify RED**

  Run `go test ./internal/shared -run 'TestLoadConfig|TestMigrateConfig'`.

  Expected: the new nested-field and migration-priority assertions fail because the current model still owns top-level `share` and does not move it.

- [x] **Step 3: Implement the canonical model and migration**

  Put `Share ShareConfig` under `RegistryConfig`, remove top-level Share from the strict runtime input, and extend `canonicalizeConfig` to move legacy top-level Share into `registry.share` while deleting the legacy key. Treat an existing nested `registry.share` value as canonical and keep the existing lock, backup, atomic write, and rollback behavior.

- [x] **Step 4: Run the focused tests and verify GREEN**

  Run `gofmt -w server/internal/shared/config.go server/internal/shared/config_migration.go server/internal/shared/shared_test.go` and `go test ./internal/shared -run 'TestLoadConfig|TestMigrateConfig'`.

  Expected: all shared config tests pass.

- [x] **Step 5: Git checkpoint**

  Checkpoint only the shared config implementation and tests after the focused package is green.

### Task 3: Make Gateway derive shared routes from Hub config and watch both files

**Files:**
- Modify: `server/internal/gateway/types.go`
- Modify: `server/internal/gateway/runtime.go`
- Modify: `server/internal/gateway/gateway_test.go`
- Modify: `server/internal/gateway/single_config_test.go`

**Acceptance:** Gateway config owns only its ACME/TLS/Release fields; `LoadBundle` reads the parent Hub config, enables Registry only for `registry.listen:true` plus Hub `publicUrl`, derives Share and Relay from Hub `registry.share.publicUrl` and `registry.relayPort`, preserves Release-only operation, and fingerprints both config files.

- [x] **Step 1: Write the failing Gateway tests**

  Replace single-file route fixtures with a parent Hub config plus Gateway TLS/Release config. Add assertions for `registry.listen` gating, Hub-derived Share/Relay/log values, release-only operation without Hub config, invalid shared URL isolation, rejection of duplicate Gateway URL/Relay/log fields, and fingerprint changes when the parent Hub config changes.

- [x] **Step 2: Run the focused tests and verify RED**

  Run `go test ./internal/gateway`.

  Expected: tests fail because Gateway currently reads route URLs, Relay, and log level from its own file and fingerprints only that file.

- [x] **Step 3: Implement the merged Gateway runtime view**

  Add the parent Hub config path to `Paths`, make duplicate shared fields non-serializable and unknown to the Gateway file decoder, load the Hub config through the shared config package without writing it, merge valid shared values into the Gateway runtime view, gate the local Registry route on `registry.listen`, and keep Release routes available when Hub-derived fields are absent or invalid. Include both config paths in `semanticFingerprint` and retain the last valid Caddy config on rejected changes.

- [x] **Step 4: Run the focused tests and verify GREEN**

  Run `gofmt -w server/internal/gateway/types.go server/internal/gateway/runtime.go server/internal/gateway/gateway_test.go server/internal/gateway/single_config_test.go` and `go test ./internal/gateway`.

  Expected: all Gateway route, validation, release-only, and dual-file fingerprint tests pass.

- [x] **Step 5: Git checkpoint**

  Checkpoint only the Gateway implementation and tests after the package is green.

### Task 4: Update deployment config writers and migrate Gateway duplicates

**Files:**
- Modify: `scripts/deploy/deploy-core.mjs`
- Modify: `scripts/deploy/deploy-core.test.mjs`
- Modify: `scripts/deploy/gateway-config.test.mjs`
- Modify: `scripts/deploy/gateway-single-config.test.mjs`

**Acceptance:** New Hub config writes Share under `registry.share`; Gateway config no longer writes or validates `log`, `relay.listenPort`, `registry.publicUrl`, or `share.publicUrl`; existing canonical Hub values win while old Gateway duplicates are moved when a Hub config exists; Release section updates remain isolated.

- [x] **Step 1: Write the failing Node tests**

  Update fresh/default Gateway shape assertions, add Hub Share migration and nested-priority assertions, add Gateway duplicate cleanup/migration assertions, and assert Release-only Gateway config remains valid without a Hub file.

- [x] **Step 2: Run the focused tests and verify RED**

  Run `node --test scripts/deploy/gateway-config.test.mjs scripts/deploy/gateway-single-config.test.mjs scripts/deploy/deploy-core.test.mjs`.

  Expected: existing assertions fail because the deployer still owns duplicate Gateway fields and preserves top-level Hub Share.

- [x] **Step 3: Implement deployment normalization**

  Update `ensureRuntimeConfig` to canonicalize top-level Share into `registry.share`, update Gateway validation/defaults to retain only TLS in Registry/Share and Release runtime fields, and migrate old Gateway Registry/Share/Relay values into an existing parent Hub config only when that canonical field is absent. Remove duplicate fields from Gateway output while preserving unrelated fields and atomic/security behavior.

- [x] **Step 4: Run the focused tests and verify GREEN**

  Run `node --test scripts/deploy/gateway-config.test.mjs scripts/deploy/gateway-single-config.test.mjs scripts/deploy/deploy-core.test.mjs`.

  Expected: all deployment configuration and migration tests pass.

- [x] **Step 5: Git checkpoint**

  Checkpoint only the Node deployment implementation and tests after the focused suite is green.

### Task 5: Read nested Share config at Registry request boundaries

**Files:**
- Modify: `server/internal/registry/share.go`
- Modify: `server/internal/registry/share_test.go`

**Acceptance:** `share.create` and `share.list` reread only `registry.share.publicUrl` at each request boundary; Gateway config and legacy top-level Share never affect Registry responses; no Registry config watcher is introduced.

- [x] **Step 1: Write the failing Registry tests**

  Change request-boundary fixtures to nested `registry.share`, add a legacy top-level-only negative case, and keep the Gateway duplicate negative case.

- [x] **Step 2: Run the focused tests and verify RED**

  Run `go test ./internal/registry -run 'TestShare'`.

  Expected: nested Share tests fail because the current reader only decodes top-level `share`.

- [x] **Step 3: Implement the nested reader**

  Decode only the `registry.share.publicUrl` path in the request-boundary config reader and preserve existing URL normalization, fail-closed behavior, and Gateway independence.

- [x] **Step 4: Run focused and full verification**

  Run `gofmt` on changed Go files, `go test ./internal/registry -run 'TestShare'`, `go test ./...`, and the focused Node deployment tests. Expected: all pass with no protocol-version or wire-payload changes.

- [x] **Step 5: Git checkpoint**

  Checkpoint the Registry implementation and tests after full verification is green.

### Final verification and handoff

- [x] Compare the final diff with the approved spec and confirm no Hub/Registry watcher, Hub Config API, protocol version, or secret ownership change was introduced.
- [x] Check `git status -sb`, `git diff --check`, and the final test output.
- [ ] Run `git-workflow-preferences` finalize with the actual result, then report branch/worktree, commits, push/merge/cleanup, verification, and remaining risk.
