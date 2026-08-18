# Skills Manager Scope Update and Install Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use implement to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Repo-dependent Skill action update its central clone first, preserve Repo-level Update/Install all, and add current-Scope batch Update/Install all actions with itemized failure handling.

**Scope Source:** `docs/scope/2026-08-19-skills-scope-update-install.md`

**Architecture:** The central Repo store will expose one latest-checkout path that clones or fetches and checks out the remote default branch under the existing Repo lock. Native source operations will reuse that path; Scope operations will orchestrate source work sequentially and aggregate per-source results. The Registry and Workspace UI will add source-less Scope actions while retaining Repo actions and reducing Skill rows to download/uninstall controls.

**Tech Stack:** Go native Git/filesystem manager, Registry WebSocket command payloads, React/TypeScript Workspace UI, Jest/react-test-renderer, local Git fixtures.

**Verification:** Focused Go tests in `server/internal/hub/tools`, focused Jest tests in `app/web`, `npm run tsc:web`, `go test -p 1 ./...`, and `git diff --check`.

---

### Task 1: Central latest Repo helper and install-first-update semantics

**Files:**
- Modify: `server/internal/hub/tools/skill_source_store.go`
- Modify: `server/internal/hub/tools/skills_native.go`
- Modify: `server/internal/hub/tools/skill_source_store_test.go`
- Modify: `server/internal/hub/tools/skills_review_fixes_test.go`

**Acceptance:** One store helper handles clone-or-fetch, default-branch checkout, clean-checkout validation and checkout reading; `addRepo`, `inspectRepo`, `Update`, single download and Repo `Install all` use its latest checkout, while uninstall/remove remain local operations.

- [ ] **Step 1: Write the failing tests**

  Extend the existing native store tests with these behavior assertions:

  - `TestNativeSkillSourceStoreEnsureLatestRepoClonesMissingRepository` creates a local bare remote with a default branch and asserts the helper creates the flat central clone and returns the remote commit and discovered Skill list.
  - `TestNativeSkillSourceStoreEnsureLatestRepoFetchesAndChecksOutRemoteHead` creates an existing clone, adds a commit to the remote, invokes the helper, and asserts the returned commit changes to the new remote head while the working tree is clean.
  - `TestNativeInstallUpdatesRepositoryBeforeInstalling` seeds a Scope lock at commit A, advances the remote to commit B with a new Skill, invokes native single install or Install all, and asserts the Scope lock records B and the installed content comes from B.
  - Keep the existing dirty-checkout assertion and make it cover the shared helper: a dirty central clone returns an error and does not reset, clean, stash, or install.

- [ ] **Step 2: Run the focused tests to verify RED**

  Run from `server`:

  ```text
  go test ./internal/hub/tools -run 'TestNativeSkillSourceStoreEnsureLatestRepo|TestNativeInstallUpdatesRepositoryBeforeInstalling|TestNativeSkillSourceStoreRejectsDirtyCheckoutBeforeUpdate' -count=1
  ```

  Expected result: the new helper/install tests fail because the helper does not exist and native install still uses the current checkout without updating it.

- [ ] **Step 3: Write the minimal implementation**

  - Add the shared latest-checkout method to `skillSourceStore`, reusing the existing flat repository path, Repo lock, clone validation, remote default-branch resolution and checkout reader.
  - Make existing-clone operations fetch/prune and checkout the remote default branch; reject dirty central clones before changing the checkout.
  - Route native add/inspect/update/install code through the helper. Keep the existing `refreshRepo` symbol only as an internal compatibility wrapper if needed, but remove its fetch-only behavior from user-facing flows.
  - Ensure install selects available Skills only after the latest checkout is read, then applies the existing Global link/Project copy transaction and writes the latest Scope commit.
  - Leave native uninstall and Repo removal independent of the latest-checkout helper.

- [ ] **Step 4: Run the focused tests to verify GREEN**

  Run the same focused Go command. Expected result: all helper, install-first-update and dirty-checkout tests pass.

- [ ] **Step 5: Run focused regression checks**

  Run:

  ```text
  go test ./internal/hub/tools -run 'TestNativeSkillSourceStore|TestNativeSkillSource|TestNativeSkillsCommandProjectUpdate' -count=1
  ```

  Expected result: existing clone path, lock path, migration, Global link and Project copy tests remain green.

- [ ] **Step 6: Git checkpoint**

  After the focused tests pass, checkpoint only the Task 1 server files and record the commit hash and subject.

### Task 2: Scope-level native Update and Install all operations

**Files:**
- Modify: `server/internal/hub/tools/skills.go`
- Modify: `server/internal/hub/tools/skills_native.go`
- Modify: `server/internal/hub/tools/tools_test.go`
- Modify: `server/internal/hub/tools/skills_review_fixes_test.go`

**Acceptance:** `cmd.skills` accepts source-less current-Scope Update and Install all actions, processes every locked Repo sequentially, continues after a Repo failure, records per-Repo results and refreshes the catalog after completion.

- [ ] **Step 1: Write the failing tests**

  Add native command tests with concrete assertions:

  - `TestSkillsCommandScopeUpdateProcessesEveryRepository` creates a Hub or Project Scope lock with two sources, advances both remotes, submits the Scope Update action, waits for completion, and asserts both Scope commits and managed copies/links are updated.
  - `TestSkillsCommandScopeUpdateContinuesAfterSourceFailure` makes the first source fail during latest checkout, keeps the second source valid, and asserts operation status is partial, the result list contains one failed and one succeeded source, and the second source lock advances.
  - `TestSkillsCommandScopeInstallAllUpdatesBeforeInstalling` seeds an old commit and an uninstalled Skill available only in the new remote commit, invokes Scope Install all, and asserts the new Skill is installed from the new commit for each successful source.
  - `TestSkillsCommandScopeInstallAllSkipsInstallationForFailedSource` makes one source fail before checkout and asserts that source has no new installation while another source still installs successfully.

- [ ] **Step 2: Run the focused tests to verify RED**

  Run from `server`:

  ```text
  go test ./internal/hub/tools -run 'TestSkillsCommandScope(Update|InstallAll)' -count=1
  ```

  Expected result: the command action is rejected or no Scope operation exists, so the new tests fail for the missing source-less batch behavior.

- [ ] **Step 3: Write the minimal implementation**

  - Add source-less Scope action routing while keeping Repo-level Update and Install all actions.
  - Resolve the current Scope lock once, process its sources in stable order, and reuse the latest Repo helper plus existing managed-skill reconciliation for each source.
  - Extend the async Skills operation state so Scope work can append a result per source and finish as succeeded, failed or partial without stopping at the first source error.
  - On a source failure, do not install from its old checkout; continue with remaining sources. Preserve the existing Project transaction and Global central-link semantics.
  - Trigger the existing operation-done/catalog refresh callback after the batch finishes so the UI no longer shows stale source state after a successful Update or Install.

- [ ] **Step 4: Run the focused tests to verify GREEN**

  Run the same Scope operation test command. Expected result: all batch success, partial failure and skip-on-failure assertions pass.

- [ ] **Step 5: Run focused regression checks**

  Run:

  ```text
  go test ./internal/hub/tools -run 'TestSkillsCommand(WriteActions|Update|Install|Uninstall|RejectsConcurrent)|TestSkillsOperationsHaveUniqueIDs' -count=1
  ```

  Expected result: existing Repo operations, concurrent-operation rejection and operation lifecycle tests remain green.

- [ ] **Step 6: Git checkpoint**

  After verification passes, checkpoint only the Task 2 server action and test files and record the commit hash and subject.

### Task 3: Registry Scope action transport and Workspace callbacks

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.test.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/app/ChatHubMenu.tsx`

**Acceptance:** The frontend can submit current-Scope Update and Install all payloads without a source, while existing Repo-level actions continue to submit their source payloads and all operation callbacks reach the active Hub menu.

- [ ] **Step 1: Write the failing tests**

  Extend `RegistryWorkspaceService.test.ts` with request-shape tests:

  - `submits a current scope skills update without a source` constructs `RegistryRepository`, invokes the Scope Update method with `{hubId, scope, projectName}`, and asserts the request action is the source-less Scope Update action and the payload contains no source field.
  - `submits a current scope install all without a source` invokes the Scope Install all method and asserts the same Scope target fields plus the Scope Install all action.

  Update the existing action type test fixtures so Repo Update and Repo Install all still include source/sourceKey.

- [ ] **Step 2: Run the focused tests to verify RED**

  Run from `app`:

  ```text
  npm test -- --runInBand web/src/registry/RegistryWorkspaceService.test.ts
  ```

  Expected result: the new repository methods or request actions are missing, so the tests fail before implementation.

- [ ] **Step 3: Write the minimal implementation**

  - Add the Scope operation action types and repository methods using the existing HubState `skills` command path.
  - Keep Repo action payloads and methods unchanged except for the new latest-install semantics already owned by the server.
  - Add Workspace callbacks that create Scope targets and dispatch the two new actions.
  - Thread the callbacks through `ChatHubMenu` without changing unrelated Hub actions.

- [ ] **Step 4: Run the focused tests to verify GREEN**

  Run the Registry test command again. Expected result: both source-less request-shape tests and existing Registry tests pass.

- [ ] **Step 5: Run type regression checks**

  Run from `app`:

  ```text
  npm run tsc:web
  ```

  Expected result: the new action unions, payloads and callback props type-check across WorkspaceApp and ChatHubMenu.

- [ ] **Step 6: Git checkpoint**

  After tests and type checking pass, checkpoint only the Task 3 frontend transport/callback files and record the commit hash and subject.

### Task 4: Skill Manager UI actions and aligned Skill row controls

**Files:**
- Modify: `app/web/src/app/ChatHubSkillManagement.tsx`
- Modify: `app/web/src/app/ChatHubSkillManagement.test.tsx`
- Modify: `app/web/src/app/ChatHubMenu.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles.css` or the existing Skills Manager stylesheet containing `chat-hub-skill-*` rules

**Acceptance:** Scope toolbar buttons invoke batch actions, Repo headers retain Update/Install all/delete, Refresh disappears from the visible UI, and each Skill row exposes only aligned download/uninstall controls.

- [ ] **Step 1: Write the failing tests**

  Update `ChatHubSkillManagement.test.tsx` assertions:

  - `renders scope Update and Install all controls` finds the current-scope buttons and asserts they call `onUpdateScope` and `onInstallAllScope` with the rendered target.
  - `keeps Repo Update and Install all but removes Refresh` asserts the source header has Update, Install all and Delete, and has no Refresh button.
  - `keeps only download and uninstall in one Skill action column` asserts installed, uninstalled, removed and unmanaged rows contain no Skill Update or Refresh controls and expose only the expected download/uninstall buttons in the shared action container.
  - `disables Scope actions while the operation is running` renders a running operation and asserts both Scope buttons and Repo buttons are disabled.
  - `renders per-Repo partial operation results` uses source-level result names and asserts failed/succeeded source results remain visible after a batch operation.

- [ ] **Step 2: Run the focused tests to verify RED**

  Run from `app`:

  ```text
  npm test -- --runInBand web/src/app/ChatHubSkillManagement.test.tsx
  ```

  Expected result: the current Refresh button is still rendered and Scope buttons/callbacks are absent, so the new expectations fail.

- [ ] **Step 3: Write the minimal implementation**

  - Extend `ChatHubSkillActions` with Scope Update and Scope Install all callbacks.
  - Add the two buttons to the Scope toolbar and wire them to the current Scope target.
  - Remove only the visible source Refresh control; preserve source Update, Install all and Delete.
  - Keep Skill rows limited to download and uninstall, with one stable right-aligned action column and no Skill Update control.
  - Update accessible labels and existing CSS selectors without changing the source-first hierarchy or inline Add repository row.
  - Render batch operation results by source while preserving existing loading, error, unmanaged and conflict states.

- [ ] **Step 4: Run the focused tests to verify GREEN**

  Run the same component test command. Expected result: all updated UI assertions and existing component tests pass.

- [ ] **Step 5: Run frontend regression checks**

  Run:

  ```text
  npm test -- --runInBand web/src/app/ChatHubSkillManagement.test.tsx web/src/registry/RegistryWorkspaceService.test.ts
  npm run tsc:web
  ```

  Expected result: focused UI/Registry tests and TypeScript checks pass without unrelated snapshots or layout regressions.

- [ ] **Step 6: Git checkpoint**

  After verification passes, checkpoint only the Task 4 UI and test files and record the commit hash and subject.

### Task 5: Wiki synchronization and full verification

**Files:**
- Modify: `docs/wiki/features/skills-management.md`
- Modify: `docs/scope/2026-08-19-skills-scope-update-install.md` only if implementation exposes a factual correction to the approved design

**Acceptance:** The Skills wiki describes the implemented latest-first operations and no longer documents Refresh as a user action; all required tests and repository checks pass.

- [ ] **Step 1: Write the failing documentation checks**

  Search the existing wiki and assert the stale user-facing rules are identified:

  ```text
  rg -n "Refresh|Install 本身不触发 fetch|Repo 行提供 Refresh|Scope 工具栏|Install all" docs/wiki/features/skills-management.md
  ```

  Expected result: the current wiki contains the old Refresh and install-without-fetch descriptions that must be replaced.

- [ ] **Step 2: Run the documentation check to verify RED**

  Run the command above and record the matching lines before editing; the check is RED while old user-facing behavior remains documented.

- [ ] **Step 3: Write the minimal wiki update**

  Update only `docs/wiki/features/skills-management.md` to document: latest-first Repo operations, Scope-level Update/Install all, Repo-level Update/Install all retention, installation-before-update ordering, source-level partial failure continuation, Global link/Project copy semantics, and the absence of the visible Refresh action. Preserve the existing migration, lock, source discovery, external Skill and protocol-version rules.

- [ ] **Step 4: Run full verification**

  Run from `server`:

  ```text
  go test -p 1 ./...
  ```

  Run from `app`:

  ```text
  npm test -- --runInBand web/src/app/ChatHubSkillManagement.test.tsx web/src/registry/RegistryWorkspaceService.test.ts
  npm run tsc:web
  ```

  Run from the worktree root:

  ```text
  git diff --check
  git status --short --branch
  ```

  Expected result: all tests and type checks pass, diff check is clean, and only approved spec/plan/wiki plus implementation files are present.

- [ ] **Step 5: Git checkpoint and finalize**

  Checkpoint the wiki update if it is an independent verified work unit. Then run `git-workflow` finalize with the actual completion result, commit hashes, push branch, merge/cleanup state and any pre-existing files left untouched.
