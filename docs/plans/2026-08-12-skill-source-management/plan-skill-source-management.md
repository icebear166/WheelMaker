# Skill Source Management Implementation Plan

> **For agentic workers:** REQUIRED SKILLS: Use `do-scoped` to execute this plan task-by-task, `wiki` for Task 1, `test-driven-development` before Tasks 2-6 production changes, `frontend-design` for Task 6, and `git-workflow` for every checkpoint/finalize. Respect the handed-off `git_state`: inherit prepared, otherwise prepare. Track execution with the checkbox (`- [ ]`) steps below.

**Goal:** Replace WheelMaker's installed-skill-first management view with a source-first Git catalog that stores complete remote snapshots, reconciles them with live local hashes, and performs only explicit, pinned, conflict-safe skill operations.

**Scope Source:** `docs/scope/2026-08-12-skill-source-management.md`

**Architecture:** Add a versioned Source Store and temporary-checkout Source Resolver beside the existing `skills` CLI adapter. HubState composes source snapshots, native lock ownership, agent-visible local copies, and live directory hashes into one structured Skills section while preserving `effectiveSkills` for Composer and the existing one-write-operation lifecycle. The web renders repositories as the primary hierarchy and keeps per-scope visibility preferences client-local.

**UI Direction:** The page serves developers reconciling Git-hosted skill catalogs. Preserve WheelMaker's compact utility aesthetic, IBM Plex/JetBrains Mono typography, existing color tokens, focus treatments, and motion restraint. Use a repository ledger header—source identity, ref, abbreviated commit, refresh state, and counts—as the signature element; skill rows are subordinate status records. Default views remain quiet by hiding ordinary uninstalled rows, while stale, conflict, removed, error, and pending-removal states stay conspicuous without relying on color alone.

**Tech Stack:** Go, Git CLI through argument-safe `exec.CommandContext`, existing pinned `skills@1.5.18` adapter, HubState Skills section/actions, React 19, TypeScript, Jest/react-test-renderer, existing CSS token system.

**Verification:** Focused Go and Jest tests per task; final `go test ./...`, complete Web Jest suite with baseline comparison if needed, `npm run tsc:web`, and `npm run build:web`. No public Registry method or protocol-version change.

---

### Task 1: Document the source-first ownership contract

**Files:**
- Create: `docs/wiki/features/skills-management.md`
- Modify: `docs/wiki/features/features.md`
- Modify: `docs/wiki/architecture/hub-state.md`

**Acceptance:** The wiki explains the durable source-first behavior and state ownership without duplicating implementation checklists or treating the source lock as an installation database.

- [x] **Step 1: Read the wiki skill and the three target locations**

Read the complete `wiki` skill instructions, then inspect the feature index and HubState architecture conventions before editing.

- [x] **Step 2: Add the Skills management feature page**

Document source/scoped catalog behavior, explicit refresh, per-scope hidden-uninstalled default, local/remote hash reconciliation, conflict and removed-upstream handling, pinned confirmation flows, migration, Project Git behavior, and source deletion/ref-change semantics.

- [x] **Step 3: Update the feature index and HubState ownership page**

Link the new feature page. Record Source Store/Resolver/Installed State Adapter ownership, Skills section composition, client-local display preferences, and the unchanged single-operation/protocol-version boundary.

- [x] **Step 4: Verify the wiki diff**

Run: `git diff --check -- docs/wiki/features/skills-management.md docs/wiki/features/features.md docs/wiki/architecture/hub-state.md`

Expected: PASS; only approved wiki targets are changed in this task.

- [x] **Step 5: Git checkpoint** — `51a4b903 docs(wiki): define skill source management`

Invoke `git-workflow` checkpoint after verification and record the resulting commit hash and subject here.

### Task 2: Build the deterministic source snapshot store

**Files:**
- Create: `server/internal/hub/tools/skill_sources.go`
- Modify: `server/internal/hub/tools/tools_test.go`

**Acceptance:** Hub and Project source locks have safe path selection, strict versioned validation, stable normalization/sorting, deterministic whole-directory hashes, credential rejection, atomic compare-and-swap writes, and byte-preserving failure behavior.

- [x] **Step 1: Read the TDD skill before production code**

Follow its red/green/refactor cycle for every production unit in Tasks 2-6.

- [x] **Step 2: Write failing Source Store and source identity tests**

Cover Hub default/XDG and Project paths, HTTP(S) userinfo/query credential rejection, valid HTTPS and SCP-style SSH normalization, case-insensitive source-key deduplication, unknown schema, malformed/duplicate records, stable sorting/JSON, and immutable source-address behavior.

- [x] **Step 3: Write failing deterministic hash and safety tests**

Use temporary directories to assert normalized relative-path plus raw-byte hashing includes supporting files, ignores checkout `.git`, changes on file/path/content changes, is order independent, and rejects unreadable entries or links escaping the skill root.

- [x] **Step 4: Write failing atomic persistence tests**

Assert same-directory temp write and compare-and-swap semantics, external-edit detection, cleanup after injected write/rename errors, and exact old bytes retained on every failure.

- [x] **Step 5: Run focused Go tests to verify RED**

Run: `go test ./internal/hub/tools -run 'TestSkillSource(Store|Identity|LockPath|DirectoryHash)'`

Working directory: `server`

Expected: FAIL because the source snapshot domain does not exist.

- [x] **Step 6: Implement the minimal Source Store**

Add version 1 structs and validation, source normalization/security checks, stable serialization, hash traversal, path resolution, file-revision tokens, and atomic CAS replacement. Keep the source lock independent from upstream lock schemas and never persist credentials or local hashes.

- [x] **Step 7: Run focused Go tests to verify GREEN**

Run the Step 5 command, then `go test ./internal/hub/tools`.

Expected: PASS.

- [x] **Step 8: Git checkpoint** — `2848b6a5 feat(skills): add source snapshot store`

Invoke `git-workflow` checkpoint for Task 2 after verification and record the commit hash and subject.

### Task 3: Resolve Git sources, migrate native locks, and compose the catalog

**Files:**
- Create: `server/internal/hub/tools/skill_source_resolver.go`
- Modify: `server/internal/hub/tools/skill_sources.go`
- Modify: `server/internal/hub/tools/skills.go`
- Modify: `server/internal/hub/tools/tools_test.go`
- Modify: `server/internal/hub/skills_state.go`
- Modify: `server/internal/hub/hub_test.go`

**Acceptance:** Explicit refresh resolves a ref to an immutable commit and complete valid catalog using local Git fixtures; first read migrates only unambiguous native-lock sources; composition yields structured source/unmanaged rows with correct live hash, stale, conflict, removed, error, and action-availability states while retaining existing effective inventories.

- [x] **Step 1: Write failing local-Git resolver tests**

Create temporary repositories with branches/tags, nested skills, supporting files, additions/deletions, and branch movement. Assert full commit pinning, stable discovery/hash output, unsafe-skill rejection, cancellation/error cleanup, no shell interpolation, and no dependency on public network access.

- [x] **Step 2: Write failing migration tests**

Cover idempotent creation of `Needs refresh` sources from unique native-lock source/ref pairs, no install or native-lock mutation, ambiguous multi-ref/address output as `Needs resolution`, and local/node_modules/unverifiable entries remaining unmanaged.

- [x] **Step 3: Write failing catalog reconciliation tests**

Cover `uninstalled`, `up_to_date`, `update_available`, `removed_upstream`, `conflict`, and `error`; require whole-directory live hashing across every expected agent copy, source-source and source-unmanaged case-insensitive collision blocking, stale snapshot retention/action blocking, and unchanged `effectiveSkills` behavior.

- [x] **Step 4: Run focused Go tests to verify RED**

Run: `go test ./internal/hub/tools -run 'TestSkillSource(Resolver|Migration|Catalog)' && go test ./internal/hub -run 'TestSkillsState'`

Working directory: `server`

Expected: FAIL because resolver, migration, and source catalog composition are absent.

- [x] **Step 5: Implement the resolver and installed-state composition**

Use argument arrays with temporary Git clone/fetch/checkout, pin `resolvedCommit`, discover `SKILL.md` roots, reject partial catalogs, and clean temporary paths. Parse the native locks into source ownership, migrate only safe identities, scan local skill directories in real time, detect missing copies/collisions, and extend the Skills snapshot while preserving legacy inventory fields.

- [x] **Step 6: Run focused and adjacent Go tests to verify GREEN**

Run the Step 4 commands, then `go test ./internal/hub/tools ./internal/hub`.

Expected: PASS.

- [x] **Step 7: Git checkpoint** — `15acadb2 feat(skills): resolve and reconcile source catalogs`

Invoke `git-workflow` checkpoint for Task 3 after verification and record the commit hash and subject.

### Task 4: Route source lifecycle and pinned best-effort operations through HubState

**Files:**
- Modify: `server/internal/hub/tools/skill_sources.go`
- Modify: `server/internal/hub/tools/skills.go`
- Modify: `server/internal/hub/tools/tools_test.go`
- Modify: `server/internal/hub/skills_state.go`
- Modify: `server/internal/hub/hub_state_adapters.go`
- Modify: `server/internal/hub/hub_test.go`
- Modify only if needed for local reconciliation ownership: `server/internal/hub/hub.go`

**Acceptance:** Add/refresh/ref-preview/ref-apply/install/update/update-all/uninstall/delete/pending-removal actions all use the existing asynchronous single-write lifecycle, force fresh previews where required, pin installs to the previewed commit, never infer deletion from stale data, and report itemized best-effort results.

- [x] **Step 1: Write failing action contract tests**

Assert bare sources refresh/save without add, explicit skill URLs/`--skill` input install only named catalog entries, existing source merge requires the same ref, ref changes require preview plus CAS apply, and every write action rejects a concurrent Skills operation.

- [x] **Step 2: Write failing pinned install/update tests**

With a fake runner, require source at `resolvedCommit`, fixed agents, Hub/Project scope, Project `--copy`, and `-y`; move the branch after preview and prove arguments/content remain pinned. Require a fresh preview before install/update and an overwrite-local warning marker for every mismatch.

- [x] **Step 3: Write failing batch/delete/reconciliation tests**

Assert Update All selects only installed, present, changed, non-conflicting rows; skips additions and removed-upstream rows; continues after individual failures; returns success/failure/skip/conflict results; rescans afterward; and deletes a source only after all managed uninstalls succeed. Cover persisted Pending removal for externally deleted Project sources without automatic uninstall.

- [x] **Step 4: Run focused Go tests to verify RED**

Run: `go test ./internal/hub/tools -run 'TestSkillsCommand.*(Source|Refresh|Pinned|UpdateAll|Delete|BestEffort)' && go test ./internal/hub -run 'TestHubStateSkills'`

Working directory: `server`

Expected: FAIL because the new lifecycle/actions and result model do not exist.

- [x] **Step 5: Implement the source actions and operation result model**

Extend the internal Skills action payload/response without adding public Registry methods. Reuse the single running operation guard for source-lock and native-install writes; refresh before previewed operations; execute batches sequentially and best-effort; republish running/terminal state; rescan installed state; and store only source identity/deletion retry metadata locally.

- [x] **Step 6: Run focused and full Hub tests to verify GREEN**

Run the Step 4 commands, then `go test ./internal/hub/...`.

Expected: PASS with Registry protocol version unchanged.

- [x] **Step 7: Git checkpoint** — `62c49549 feat(skills): add pinned source operations`

Invoke `git-workflow` checkpoint for Task 4 after verification and record the commit hash and subject.

### Task 5: Add the typed web source model and per-scope filtering

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/registryService.ts`
- Modify: `app/web/src/hubState/hubSelectors.ts`
- Modify: `app/web/src/settings/skillManagementView.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-skill-management-view.test.ts`
- Modify: `app/__tests__/web-skill-management-service.test.ts`
- Modify only if selector coverage belongs there: `app/__tests__/web-hub-state-store.test.ts`

**Acceptance:** The client consumes complete source snapshots and operation previews/results through HubState actions, derives no permissions from labels/colors, preserves Composer inputs, and stores a default-off `Show uninstalled skills` preference independently for each stable Hub/scope key.

- [x] **Step 1: Write failing type/parser/service tests**

Cover source/catalog/action/result shapes, HubState-only action routing, complete input normalization for bare Git/direct skill/`npx skills add --skill`, and preservation of `effectiveSkills`. Reject unsupported or ambiguous input before dispatch.

- [x] **Step 2: Write failing preference/filter tests**

Assert stable Hub and Project keys, default false, independent persistence per scope, ordinary uninstalled filtering only, and unconditional visibility of installed, conflict, removed, stale/error, and pending-removal rows.

- [x] **Step 3: Run focused Jest tests to verify RED**

Run: `npm test -- --runInBand __tests__/web-skill-management-view.test.ts __tests__/web-skill-management-service.test.ts`

Working directory: `app`

Expected: FAIL because source types/actions and scope visibility helpers do not exist.

- [x] **Step 4: Implement the minimal typed client model**

Extend current Skills section parsing and repository methods; add explicit source action/preview/result targets and scoped localStorage helpers; remove the old selected-candidate model; retain legacy installed/effective inventory compatibility while UI migration is in progress.

- [x] **Step 5: Run focused tests and typecheck to verify GREEN**

Run the Step 3 command, then `npm run tsc:web`.

Working directory: `app`

Expected: PASS.

- [x] **Step 6: Git checkpoint** — `0e3cdfbc feat(skills): add web source catalog model`

Invoke `git-workflow` checkpoint for Task 5 after verification and record the commit hash and subject.

### Task 6: Replace the installed-skill list with the repository ledger UI

**Files:**
- Modify: `app/web/src/app/ChatHubSkillManagement.tsx`
- Modify: `app/web/src/app/ChatHubSkillManagement.test.tsx`
- Modify: `app/web/src/app/ChatHubMenu.tsx`
- Modify: `app/web/src/app/ChatHubSkillCompanion.tsx`
- Modify: `app/web/src/app/ChatHubSkillCompanion.test.tsx`
- Modify: `app/web/src/settings/SkillManagementContent.tsx`
- Modify: `app/web/src/settings/SkillManagementContent.test.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/shell/AppDialogs.tsx`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/web/src/styles/settings.css`
- Modify: `app/__tests__/web-skill-management-settings.test.ts`

**Acceptance:** Hub and each Project show sources first, source rows expose repository/ref/commit/status/counts, the default-off scope switch controls only normal uninstalled rows, unmanaged skills have a dedicated group, conflicts are disabled, and every destructive/overwrite/source-lifecycle action has an accurate preview and accessible confirmation/result state.

- [ ] **Step 1: Perform frontend-design two-pass planning before component code**

Pass 1: sketch source ledger, expanded catalog, unmanaged group, add-source surface, and preview/result dialog states using current component primitives. Pass 2: reject layouts that obscure scope, depend on color, duplicate selection UI, or collapse source and skill actions into one control. Keep responsive wrapping, keyboard focus, and reduced-motion behavior explicit.

- [ ] **Step 2: Write failing source-list component tests**

Assert source-first hierarchy, repository ledger metadata, expansion to the full filtered catalog, independent scope toggles, status text/icons, hidden ordinary uninstalled rows by default, unmanaged group, conflict-disabled actions, Update only on hash mismatch, and Removed upstream manual Uninstall only.

- [ ] **Step 3: Write failing add/preview/action tests**

Assert bare Git confirms source-only save, explicit names are separately listed for install without checkboxes/select-all, refresh/ref-change/update/update-all/delete dialogs render the server preview, overwrite confirmations state local replacement, cancellation performs no write, stale states block dependent actions, and itemized partial results remain visible/retriable.

- [ ] **Step 4: Run focused component tests to verify RED**

Run: `npm test -- --runInBand web/src/app/ChatHubSkillManagement.test.tsx web/src/app/ChatHubSkillCompanion.test.tsx web/src/settings/SkillManagementContent.test.tsx __tests__/web-skill-management-settings.test.ts`

Working directory: `app`

Expected: FAIL against the installed-skill-first and checkbox-selection UI.

- [ ] **Step 5: Implement the repository ledger and companion flows**

Reshape props/wiring around source snapshots and explicit action availability. Render ledger metadata in monospace where appropriate, meaningful non-color status labels, aligned skill action slots, a client-local scope switch, and server-provided previews/results. Remove selection mode and candidate selection. Preserve skill detail and Marketplace affordances where still relevant.

- [ ] **Step 6: Refine responsive, focus, and reduced-motion styling**

Use existing spacing/color variables, allow long repository/ref text to wrap or truncate with accessible titles, retain visible focus rings and minimum action targets, avoid new ambient animations, and ensure narrow companion/menu surfaces remain usable.

- [ ] **Step 7: Run focused and adjacent frontend tests to verify GREEN**

Run the Step 4 command plus `npm test -- --runInBand __tests__/web-skill-management-view.test.ts __tests__/web-skill-management-service.test.ts`.

Working directory: `app`

Expected: PASS.

- [ ] **Step 8: Git checkpoint**

Invoke `git-workflow` checkpoint for Task 6 after verification and record the commit hash and subject.

### Task 7: Complete migration, security, compatibility, and release gates

**Files:**
- Modify: `docs/plans/2026-08-12-skill-source-management/plan-skill-source-management.md`
- Modify only when a failing acceptance test identifies an in-scope defect: files already owned by Tasks 1-6

**Acceptance:** Every approved acceptance item has evidence, no real user skill directory or public network is touched by tests, no credential reaches snapshots/errors/logs, no Registry protocol version changes, and the implementation branch is ready for finalize.

- [ ] **Step 1: Run source-management security and behavior tests**

Run focused Go tests covering credentials, symlink boundaries, Git cleanup, CAS conflicts, migration idempotence, stale safety, pinned commits, conflicts, removed-upstream, best-effort results, source delete/ref changes, and Pending removal.

Expected: PASS using only temp directories, local Git fixtures, and fake runners.

- [ ] **Step 2: Run the complete Go suite**

Run: `go test ./...`

Working directory: `server`

Expected: PASS.

- [ ] **Step 3: Run the complete Web test suite**

Run: `npm test -- --runInBand`

Working directory: `app`

Expected: PASS, or any pre-existing baseline failures are reproduced on `origin/main` and documented with zero branch-only regressions.

- [ ] **Step 4: Run TypeScript and production build checks**

Run: `npm run tsc:web` and `npm run build:web`

Working directory: `app`

Expected: PASS.

- [ ] **Step 5: Inspect scope, generated artifacts, secrets, and protocol compatibility**

Run: `git diff --check`, `git status -sb`, `git diff --stat origin/main...HEAD`, targeted secret-pattern checks on `.skill-source-lock.json` fixtures/output, and `git diff origin/main...HEAD -- server/internal/protocol app/web/src/registry/registryMethods.ts`.

Expected: No whitespace errors, unowned/generated artifacts, credential material, public Registry method changes, or protocol-version changes.

- [ ] **Step 6: Reconcile all spec acceptance items**

Map each item in `docs/scope/2026-08-12-skill-source-management.md` to passing automated evidence or a documented manual UI check. Repair only in-scope gaps and rerun the narrowest affected verification before repeating release gates.

- [ ] **Step 7: Complete the plan and Git lifecycle**

Mark all verified steps complete, checkpoint this plan if needed, then invoke `git-workflow` finalize with commit list, verification evidence, push/merge result, and cleanup status.
