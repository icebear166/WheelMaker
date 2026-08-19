# Well-Known Skill Sources Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use implement to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native, bounded, transactional support for the `skills@1.5.18` well-known discovery formats while preserving existing Git source and Scope semantics.
**Scope Source:** `docs/scope/2026-08-19-well-known-skill-sources.md` (approved 2026-08-19)
**Architecture:** Classify source input into Git or well-known identities, materialize either provider into the existing central snapshot shape, and keep Scope ownership/link/copy/lock transactions provider-agnostic. Well-known discovery publishes only complete staged catalogs and persists the exact canonical index URL as its stable identity.
**Tech Stack:** Go 1.26 (`net/http`, `archive/zip`, `archive/tar`, `compress/gzip`, SHA-256, YAML frontmatter), React 19/TypeScript, Jest.
**Verification:** Focused Windows hidden Go tests, full `server/internal/hub/tools` tests, focused Jest tests, and `npm run tsc:web`; do not run the Web build.

---

## Task 1: Synchronize durable Skills Management documentation

**Files:**
- Modify: `docs/wiki/features/skills-management.md`
- Reference: `docs/scope/2026-08-19-well-known-skill-sources.md`

- [x] Read the `wiki` skill and update the feature wiki before production code.
- [x] Replace Git-only concepts and copy with the unified Git/well-known Source model.
- [x] Document canonical index identity, central snapshot/revision rules, Add-with-empty-management behavior, offline/reindex behavior, strict materialization, and the pre-/post-publish failure boundaries.
- [x] Check the wiki against every approved requirement without copying implementation-plan detail into long-term documentation.
- [x] Fetch `origin`, confirm the branch base has not moved unexpectedly, and checkpoint only the wiki change with `git-workflow`.

## Task 2: Generalize source classification and persistent identity

**Files:**
- Modify: `server/internal/hub/tools/skill_sources.go`
- Modify: `server/internal/hub/tools/skills_native.go`
- Modify: `server/internal/hub/tools/skill_source_catalog.go`
- Modify: `server/internal/hub/tools/skill_source_store.go`
- Add: `server/internal/hub/tools/skill_source_identity_test.go`

- [x] Write failing table tests for GitHub/GitLab/tree/shorthand/SSH/SCP/explicit-`.git` Git inputs, ordinary HTTP(S) well-known inputs, `raw.githubusercontent.com`, rejected userinfo/query/fragment/ref inputs, and no well-known-to-Git fallback classification.
- [x] Write failing tests for canonical well-known index normalization and keys: equivalent entry URLs converge after discovery; scheme, port, complete path, and `agent-skills` versus `skills` remain distinct.
- [x] Add a source-kind/identity abstraction while retaining `normalizeSkillGitSource` compatibility for existing callers and persisted Git locks.
- [x] Teach version 3 lock validation and offline catalog/store lookup to reconstruct either Git or canonical well-known identity without network access or a new wire field.
- [x] Run focused identity/lock tests through `scripts/run-hidden-go-test.vbs`, then run related existing Git identity tests.
- [x] Refactor only after green; fetch/rebase if needed and checkpoint this tested unit.

## Task 3: Implement bounded well-known discovery and materialization

**Files:**
- Add: `server/internal/hub/tools/skill_source_well_known.go`
- Add: `server/internal/hub/tools/skill_source_well_known_http.go`
- Add: `server/internal/hub/tools/skill_source_well_known_archive.go`
- Add: `server/internal/hub/tools/skill_source_well_known_test.go`
- Modify if needed: `server/go.mod`
- Modify if needed: `server/go.sum`

- [x] Add local `httptest` fixtures and failing tests for exact path-relative/root and `agent-skills`/legacy candidate order, direct canonical-index refresh, and discovery failure with no Git fallback.
- [x] Add failing tests for legacy `files[]`: strict index validation, required name/description frontmatter, supporting-file completeness, duplicate install-name rejection, and at least one materialized Skill.
- [x] Add failing tests for discovery 0.2.0 exact schema handling, ignored invalid entries, `skill-md`, ZIP, TAR.GZ/TGZ, SHA-256 validation, root `SKILL.md`, and index-name installation layout.
- [x] Add failing adversarial archive tests for encrypted ZIPs, links, absolute/backslash/dot-segment traversal, file-count/expanded-size limits, and missing root `SKILL.md`.
- [x] Implement candidate discovery, schema parsing, bounded concurrent downloads, streaming digest/copy/extraction, frontmatter validation, duplicate detection, deterministic revision hashing, and complete staging materialization.
- [x] Add and satisfy HTTP policy tests for the 10-minute operation deadline hook, 30-second response-header timeout, five redirects, redirect loops, HTTPS downgrade rejection, safe cross-host redirects without credentials, context cancellation, and sanitized errors.
- [x] Add and satisfy size-budget tests for 4 MiB index, 1000 entries, 32 MiB files, 64 MiB compressed artifacts, 50 MiB/1000-file archives, and 512 MiB/10000-file catalogs; use reduced injectable test limits where allocating the real maximum is unnecessary.
- [x] Run focused well-known provider tests and race-safe deterministic repetition where useful; refactor after green and checkpoint this tested unit.

## Task 4: Publish provider snapshots through the central store

**Files:**
- Modify: `server/internal/hub/tools/skill_source_store.go`
- Modify: `server/internal/hub/tools/skill_source_resolver.go`
- Modify: `server/internal/hub/tools/skill_source_well_known.go`
- Add: `server/internal/hub/tools/skill_source_store_well_known_test.go`

- [x] Write failing tests for the common snapshot shape, well-known metadata, stable `<source-root>/skills/<install-name>` layout, 64-character revision, and sourceKey path reuse.
- [x] Write failing tests proving download/validation/publish failures preserve the previous central snapshot and clean staging/backup artifacts.
- [x] Implement provider dispatch so Git keeps its working clone behavior while well-known stages beside the source root, atomically publishes a complete snapshot, and restores the old root if publication fails.
- [x] Ensure passive read/reindex uses only persisted identity plus central content and never performs HTTP requests; a missing snapshot reports a retriable source-content state.
- [x] Run focused central-store tests plus the existing Git store/resolver suite; refactor after green and checkpoint this tested unit.

## Task 5: Integrate Add, Update, Install, bulk operations, and rollback boundaries

**Files:**
- Modify: `server/internal/hub/tools/skills_native.go`
- Modify: `server/internal/hub/tools/skills.go`
- Modify: `server/internal/hub/tools/skill_sources.go`
- Add: `server/internal/hub/tools/skills_native_well_known_test.go`
- Modify if needed: `server/internal/hub/tools/tools_test.go`

- [x] Write failing operation tests proving Add resolves and persists the canonical index with lock version 3, empty branch, 64-character revision, and empty `managedSkills`, without changing installation directories.
- [x] Write failing tests for Update-only-managed, no auto-install of new upstream Skills, cleanup of removed managed Skills, Install/Install-all using one latest snapshot, explicit unmanaged overwrite, and offline Uninstall/Remove Source.
- [x] Replace background operation contexts with bounded provider-aware contexts while keeping existing Registry action and response field names.
- [x] Route Add/Update/Install/Install-all through the common provider snapshot and keep Global link and Project copy transactions provider-neutral.
- [x] Add distinct failure-boundary tests: before central publish, old central/install/lock survive; after successful central publish, Project rolls back and keeps its old lock while central stays new; Global may expose the new linked content and operation/status reports misalignment.
- [x] Add passive-reindex and central-missing tests proving no network call occurs and user-triggered source actions can recover.
- [x] Run focused operation tests, existing native Scope tests, and the complete hidden `go test ./internal/hub/tools` suite; refactor after green and checkpoint this tested unit.

## Task 6: Generalize the Skills UI copy without adding selection flow

**Files:**
- Modify: `app/web/src/app/ChatHubSkillManagement.tsx`
- Modify: `app/web/src/app/ChatHubSkillManagement.test.tsx`
- Modify if needed: `app/web/src/app/ChatHubMenu.test.tsx`

- [x] Write failing Jest expectations for `Add skill source`, a generic source URL label/placeholder/hint, and the generic empty state.
- [x] Update user-visible Git-only copy while preserving the current direct-submit Add interaction and Registry action names.
- [x] Add an assertion that Add submits the source immediately without rendering preview or Skill selection controls.
- [x] Run the focused Jest test and `npm run tsc:web` from `app`; do not run a Web build.
- [x] Refactor after green and checkpoint this tested unit.

## Task 7: Complete compatibility and acceptance verification

**Files:**
- Modify only if verification exposes a spec defect: files already listed above
- Update: `docs/plans/2026-08-19-well-known-skill-sources/plan-well-known-skill-sources.md`

- [x] Run the focused source identity, provider, store, and native-operation hidden Go tests.
- [x] Run the full hidden Go tests for `./internal/hub/tools` and any other directly affected server packages.
- [x] Run focused Skills Management Jest tests and `npm run tsc:web`; confirm no Web build was run.
- [x] Inspect changed code for protocol version, lock version/migration, Git behavior, error redaction, cleanup, and bounded-resource regressions.
- [x] Mark completed plan checkboxes, fetch `origin`, and checkpoint the final verified implementation/plan state.
- [x] Use `git-workflow` finalize: push the feature branch, merge to local `main` only if its user-owned dirty state permits, and preserve recovery instructions if merge/cleanup cannot be completed safely.
