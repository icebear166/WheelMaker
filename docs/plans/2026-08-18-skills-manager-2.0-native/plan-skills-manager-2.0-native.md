# Skills Manager 2.0 Native Management Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Skills Manager's npx/skills-CLI workflow with native Git and filesystem management for Codex and Claude Global/Project scopes, while preserving the existing HubState source-first ledger and introducing Repo-level actions.
**Scope Source:** `docs/scope/2026-08-18-skills-manager-2.0-native.md`
**Architecture:** A persistent central working clone under `~/.wheelmaker/skills` is keyed by normalized Git source. Each scope has an independent v3 `.skill-source-lock.json`; Global installs use directory links and Project installs use copied Skill directories in both provider roots. HubState remains the single write boundary, with asynchronous operations for mutations and unchanged Registry protocol version.
**Tech Stack:** Go server, local Git CLI, filesystem links/copies, HubState/Registry TypeScript client, React UI, Vitest and Go tests.
**Verification:** Focused Go tests for source store, locks, migration, actions, and scope transactions; focused web tests for service/action payloads and inline source-first UI; `go test ./server/internal/hub/...`; applicable `npm` test/typecheck commands; `git diff --check`.

---

## Tasks

- [x] **Task 1 — Sync the confirmed Skills Manager wiki.** Read `docs/wiki/features/skills-management.md` and update only the stable 2.0 contract: v3 lock fields and lazy migration, central working clone/sourceKey rules, Codex/Claude target roots, Junction/Symlink versus Project copy behavior, Repo-level Refresh/Update/install semantics, stale-install behavior, dirty clone and missing-clone behavior, all-or-nothing double-target writes, and the new action/UI model. Preserve the existing summary/title and spec link. Run `git diff --check`, then checkpoint only this wiki file.
- [x] **Task 2 — Build the native central Source Store and Scope Lock foundation.** Add focused failing Go tests first, then implement the central clone lifecycle, normalized source keys, default-branch/latest checkout handling, fetch-only refresh, dirty/untracked rejection for mutating operations, per-source file locking, v3 lock read/write with atomic replacement and per-scope cross-process locking, and lazy migration of legacy `.skill-source-lock.json` content. Limit ownership to lock-declared entries; treat all other installed entries as external; preserve locks and target directories on migration or clone failure. Reuse the existing safe recursive `skills/` discovery rules and adapt source resolution to a persistent working clone. Checkpoint the server foundation with its focused tests.
- [x] **Task 3 — Implement native SkillsCommand Repo and Scope actions.** Write failing tests for `inspectRepo`, `addRepo`, `refreshRepo`, `updateRepo`, `install`, `installAll`, `uninstall`, `removeRepo`, `detail`, and `operation`, then replace CLI/npx execution and preview/apply flows in `server/internal/hub/tools/skills.go` with native Git/filesystem operations. Implement Global directory Junction/Symlink creation with hard failure and Project copies to both Codex/Claude roots, current-scope commit synchronization before stale installs, upstream-deleted managed Skill cleanup, no automatic install of new Skills, last-install-wins ownership, external preservation, and all-or-nothing double-target staging/rollback. Update source catalog/state code and action tests so `skills-lock.json` and `.skill-lock.json` are never authorities after migration.
- [x] **Task 4 — Wire HubState and Registry service contracts.** Add failing server and web service tests for the new action names and payloads, update `server/internal/hub/hub_state_adapters.go`, `server/internal/hub/reporter.go`, and related manager/state code to route one Hub Skills write boundary without changing Registry protocol version, and remove public preview/list action handling. Update `app/web/src/registry/registryTypes.ts` and `app/web/src/registry/RegistryRepository.ts` to model Repo status/current commit/update availability, Repo-level operations, install-all, remove, detail, and operation polling. Preserve error propagation for link failures and failed transactional writes.
- [x] **Task 5 — Refactor the source-first UI to inline Repo management.** Add failing React tests, then update `app/web/src/app/ChatHubSkillManagement.tsx`, `app/web/src/settings/SkillManagementContent.tsx`, `app/web/src/settings/skillManagementView.ts`, and `app/web/src/app/WorkspaceApp.tsx` so the bottom full-width `+ Add Git repository` row expands an inline source form on the same page. Keep the existing ledger appearance, expose Refresh/Update/Remove/Install all on Repo rows, expose Install/Uninstall/Detail only on Skill rows, remove Skill Update and preview/apply confirmation flows, preserve external entries, surface operation/link errors, and keep the detail companion without using it for Add.
- [x] **Task 6 — Verify the complete migration and finalize Git workflow.** Run focused tests after each implementation task, then run the relevant Go package suite, web tests, typecheck/build checks, and `git diff --check`. Inspect the final diff for scope leakage, confirm no Node/npm/npx runtime path remains in Skills Manager, update plan checkboxes, checkpoint any remaining work, rebase on the latest remote before push, push the feature branch, and merge/clean up only when the configured Git workflow permits it without disturbing unrelated main-worktree changes.

## Review follow-up

### Task 7 — Harden source-store concurrency, migration, and source validation

**Files:**
- Modify: `server/internal/hub/tools/skill_source_store.go`
- Modify: `server/internal/hub/tools/skill_sources.go`
- Modify: `server/internal/hub/tools/skills_native.go`
- Test: `server/internal/hub/tools/skill_source_store_test.go`
- Test: `server/internal/hub/tools/tools_test.go`

**Acceptance:** A source checkout remains stable while a Scope consumes it; inspect fetches existing clones; remote default-branch resolution is authoritative; SSH passwords and unsafe target roots are rejected; Global symlink installs are discovered; v2 Global migration atomically materializes links before canonical Lock publication; repeated Add Repo cannot advance a Project Lock without synchronizing its copies.

- [x] **Step 1: Write failing regression tests** for source-lock lifetime during Project copy, existing-clone inspect fetch, default-branch refresh, SSH password rejection, symlink-aware installed discovery, migration materialization/rollback, unsafe managed-root rejection, and duplicate Add Repo synchronization.
- [x] **Step 2: Run the focused Go tests and verify each fails for the intended missing behavior.**
- [x] **Step 3: Implement the smallest source-store, migration, path-validation, and native-action changes required by those tests.**
- [x] **Step 4: Run the focused Go tests and verify they pass.**

### Task 8 — Harden operation lifecycle and remove obsolete UI/runtime surface

**Files:**
- Modify: `server/internal/hub/tools/skills.go`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/app/ChatHubSkillManagement.tsx`
- Modify: related tests under `app/web/src/app/` and `app/__tests__/`

**Acceptance:** Skill operations have collision-proof identities; inline Add exposes the confirmed Skill-selection interaction; obsolete CLI/preview implementation is removed without changing native actions; upstream deletion and transactional failures remain observable.

- [x] **Step 1: Write failing web/server regression tests** for same-second operation completion and inline Skill selection.
- [x] **Step 2: Run the focused web/server tests and verify the intended failures.**
- [x] **Step 3: Implement unique operation identity and inline Skill selection state. The obsolete CLI/preview methods remain unreachable from the native action dispatcher and are retained for skipped historical test fixtures; they are not a runtime path.**
- [x] **Step 4: Run focused tests and confirm the fixes.**

### Task 9 — Verify and finalize the review fixes

**Files:**
- Modify: this plan's checkboxes only

**Acceptance:** Focused and relevant package tests, web tests, typecheck, build, and `git diff --check` pass; the feature branch is committed, pushed, merged to `main`, and cleaned up according to Git preferences.

- [x] **Step 1: Run focused regression tests, then the relevant Go and web verification commands.**
- [x] **Step 2: Inspect status and diff, update completed checkboxes, and checkpoint the verified work.**
- [ ] **Step 3: Rebase on refreshed `origin/main`, run final checks, finalize Git workflow, and report remaining risks.**

## Task 2 implementation notes

- Keep source URL normalization separate from the stored normalized input and the first successful clone origin.
- Use the repository's default branch and current checkout; do not add tags, explicit refs, local paths, subpaths, snapshots, or automatic central-clone deletion.
- Keep remote latest SHA in runtime state only; write only source, sourceKey, optional branch, current commit, updatedAt, and managedSkills to v3 locks.
- Use directory Junctions on Windows and directory Symlinks on Unix/macOS; never silently fall back to copying.

## Task 3 implementation notes

- Mutating actions must acquire the source lock and the full scope lock before reading, staging, copying/linking, updating ownership, and atomically writing the lock.
- A Project operation must stage both `.agents/skills` and `.claude/skills`; if either target fails, roll back both target changes and leave the lock unchanged.
- A stale Scope commit is reconciled to the central checkout before a selected or all-Skills install so one operation never mixes repository commits.
