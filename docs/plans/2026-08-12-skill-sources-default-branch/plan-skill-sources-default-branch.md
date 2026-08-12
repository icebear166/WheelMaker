# Skill Sources Default Branch Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove logical Skill Source refs end to end, rebuild source lock V1 or a missing lock as V2 from native npx provenance, and always resolve the remote default `HEAD` while preserving immutable commit pinning.

**Scope Source:** `docs/scope/2026-08-12-skill-sources-default-branch.md`

**Architecture:** Source Store becomes a strict V2 owner with no `ref`, while Native Lock Adapter groups provenance only by normalized repository and rebuilds V2 without touching installed directories. Source Resolver resolves the remote-advertised `HEAD` to a commit; Catalog Composer and Web consume precise source/copy states and pass only repository plus resolved commit through previews and operations.

**Tech Stack:** Go 1.26, local Git fixtures, JSON lock files with CAS atomic writes, React 19, TypeScript 5.8, Jest 30.

**Verification:** `go test ./internal/hub/tools`, `go test ./...`, focused Jest suites, `npm run tsc:web`, `npm test -- --runInBand`, and `npm run build:web`.

---

### Task 1: Synchronize the approved Skills source model into wiki

**Files:**
- Modify: `docs/wiki/features/skills-management.md`
- Modify: `docs/wiki/architecture/hub-state.md`

**Acceptance:** Both confirmed wiki targets describe only V2/default-HEAD behavior, V1-or-missing-lock reconstruction, immutable commit pinning, and precise copy/source statuses; neither page presents ref as editable or stored current state.

- [ ] **Step 1: Rewrite the feature-level current facts**

Update `skills-management.md` so Source identity is repository-only, `.skill-source-lock.json` is version 2, explicit ref inputs are rejected, V1 payloads are discarded, missing/V1 locks rebuild from native provenance, and `Needs refresh`/`Stale`/`Copies differ`/`Error` have separate meanings.

- [ ] **Step 2: Rewrite the HubState ownership and operation facts**

Update `hub-state.md` so Source Store owns source/commit/catalog without ref, Resolver reads remote `HEAD`, native locks are grouped without ref, and source operations no longer include source/ref modification.

- [ ] **Step 3: Verify wiki shape and stale statements**

Run:

```powershell
Get-Content docs/wiki/features/skills-management.md -TotalCount 1
Get-Content docs/wiki/architecture/hub-state.md -TotalCount 1
rg -n '可修改 ref|解析 ref|source/ref|修改 ref|version 1' docs/wiki/features/skills-management.md docs/wiki/architecture/hub-state.md
```

Expected: both first lines begin with `> 摘要：`; the final `rg` returns no matches.

- [ ] **Step 4: Git checkpoint**

After verification passes, invoke `git-workflow` in `checkpoint` mode for only these two wiki files. Record commit hash + subject in the task notes.

### Task 2: Replace V1/ref persistence and ref resolution with V2/default HEAD

**Files:**
- Modify: `server/internal/hub/tools/skill_sources.go`
- Modify: `server/internal/hub/tools/skill_source_resolver.go`
- Test: `server/internal/hub/tools/tools_test.go`

**Acceptance:** New writes are strict deterministic V2 JSON without ref; V1 and missing source locks rebuild from readable native provenance by repository only; failed rebuilds preserve V1 bytes; resolver pins the remote-advertised default `HEAD` for arbitrary default branch names.

- [ ] **Step 1: Write failing V2 store and rebuild tests**

Replace V1/ref expectations and add tests equivalent to:

```go
func TestSkillSourceRebuildsV1AndMissingLockWithoutRefs(t *testing.T) {
    result, err := readOrMigrateSkillSourceLock(nativePath, sourcePath)
    if err != nil {
        t.Fatal(err)
    }
    if result.Lock.Version != 2 || len(result.Lock.Sources) != 1 {
        t.Fatalf("lock=%#v, want one V2 source", result.Lock)
    }
    source := result.Lock.Sources[0]
    if source.SourceKey != "github.com/example/catalog" || source.ResolvedCommit != "" || len(source.SkillList) != 0 {
        t.Fatalf("source=%#v, want repository-only needs-refresh source", source)
    }
}

func TestSkillSourceRebuildFailurePreservesV1Bytes(t *testing.T) {
    _, err := readOrMigrateSkillSourceLock(nativePath, sourcePath)
    if err == nil {
        t.Fatal("rebuild succeeded with malformed native lock")
    }
    after, readErr := os.ReadFile(sourcePath)
    if readErr != nil || !bytes.Equal(after, before) {
        t.Fatalf("V1 bytes changed after failed rebuild: readErr=%v", readErr)
    }
}
```

Assert encoded bytes contain `"version": 2` and no `"ref"`; strict V2 decoding must reject an injected `ref` field.

- [ ] **Step 2: Run store/rebuild tests and verify RED**

Run:

```powershell
go test ./internal/hub/tools -run 'TestSkillSource(StoreWritesStableValidatedJSON|StoreRejectsUnknownVersionAndDuplicateSource|RebuildsV1AndMissingLockWithoutRefs|RebuildFailurePreservesV1Bytes)' -count=1
```

Expected: FAIL because the current schema requires version 1/ref and missing refs are unmanaged.

- [ ] **Step 3: Implement strict V2 and atomic reconstruction**

Set version 2; remove `Ref` from source/native grouping structs; separate envelope detection from strict V2 decode; expose missing versus malformed native locks; rebuild from normalized repository groups for V1 and a first-observed missing source lock; validate before CAS atomic replacement. Preserve unknown-version rejection and never rewrite native locks or installed directories. A missing Project source lock with prior reconciliation history remains an intentional external deletion and must not be bootstrapped again.

- [ ] **Step 4: Write and run a failing remote default-HEAD resolver test**

Create local bare remotes whose symbolic `HEAD` points to `main`, `master`, and `trunk`; assert `Resolve` returns each tip with no logical ref. Run:

```powershell
go test ./internal/hub/tools -run 'TestSkillSourceResolver(PinsRemoteDefaultHEAD|TracksAdditionsDeletionsAndSupportingFiles|CleansTemporaryCheckoutAfterFailure)' -count=1
```

Expected: FAIL because the resolver currently requires and resolves `source.Ref`.

- [ ] **Step 5: Implement default-HEAD resolution and verify GREEN**

Resolve the cloned remote's advertised symbolic `HEAD` to a full commit, detach there, and retain catalog/hash/cleanup behavior. Do not guess `main` or `master`. Re-run Steps 2 and 4; expected PASS.

- [ ] **Step 6: Run focused regressions and Git checkpoint**

Run:

```powershell
go test ./internal/hub/tools -run 'TestSkillSource(LockPath|Identity|DirectoryHash|Store|Resolver|Rebuild)' -count=1
```

Expected: PASS. Then checkpoint the two Go files and `tools_test.go`; record commit hash + subject.

### Task 3: Remove refs from catalog, reconciliation, commands, and native consumers

**Files:**
- Modify: `server/internal/hub/tools/skill_source_catalog.go`
- Modify: `server/internal/hub/tools/skills.go`
- Test: `server/internal/hub/tools/tools_test.go`

**Acceptance:** HubState/catalog/previews/details contain no Skill Source ref; legacy command ref input fails before writes; mixed/missing native refs map to one Source; copy divergence and source freshness are precise states; actual add/update stays pinned to `resolvedCommit`.

- [ ] **Step 1: Write failing catalog state tests**

Add assertions equivalent to:

```go
if row.Status != "copies_differ" || !row.CanUpdate {
    t.Fatalf("row=%#v, want actionable copies_differ", row)
}
if needsRefreshRow.Status == "error" || needsRefreshRow.CanUpdate {
    t.Fatalf("row=%#v, want non-actionable needs_refresh ownership", needsRefreshRow)
}
```

Cover local/node_modules provenance, stale safety, removed-upstream safety, conflicts, reconciliation JSON without ref, and the existing rule that a missing Project source lock with prior reconciliation becomes `Pending removal` rather than being rebuilt.

- [ ] **Step 2: Run catalog tests and verify RED**

Run:

```powershell
go test ./internal/hub/tools -run 'TestSkillSource(Catalog|Reconciliation|NativeProvenance)' -count=1
```

Expected: FAIL because copy mismatch and non-current snapshots collapse to `error`, and reconciliation/catalog carry ref.

- [ ] **Step 3: Implement precise catalog and reconciliation states**

Remove ref from catalog/reconciliation. Distinguish copy divergence from I/O/hash failures, keep `Needs refresh` ownership rows without deletion inference, keep stale snapshots non-actionable, preserve conflict precedence, and rewrite legacy local reconciliation to ref-free current form.

- [ ] **Step 4: Write failing ref-free command boundary tests**

Update preview tests to repository plus `resolvedCommit`; add separate raw-payload assertions for `#branch`, `#tag`, GitHub `/tree/<ref>/...`, and a top-level `ref` field. Each must return `invalid_argument` before resolver/write calls. Assert detail metadata and native reinstall groups do not expose or append native ref values.

- [ ] **Step 5: Run command tests and verify RED**

Run:

```powershell
go test ./internal/hub/tools -run 'TestSkillsCommand(SourcePreview|RejectsExplicitRef|PreviewInstall|PreviewUpdate|PreviewDelete)|TestSkillsLockInstallGroupsIgnoreRef' -count=1
```

Expected: FAIL because command and metadata types still contain ref.

- [ ] **Step 6: Implement commands and immutable pinning**

Remove ref from payload/domain responses, previews, detail metadata, native install groups, and change-ref branches. Detect a top-level legacy `ref` key before normal decode; reject fragment/tree syntax at validation; keep `pinnedSkillSource` using `source.ResolvedCommit`.

- [ ] **Step 7: Verify GREEN, package regression, and Git checkpoint**

Re-run Steps 2 and 5, then:

```powershell
go test ./internal/hub/tools -count=1
```

Expected: PASS. Checkpoint `skill_source_catalog.go`, `skills.go`, and `tools_test.go`; record commit hash + subject.

### Task 4: Remove ref parsing, types, controls, and confirmation copy from Web

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/settings/skillManagementView.ts`
- Modify: `app/web/src/settings/SkillManagementContent.tsx`
- Modify: `app/web/src/app/ChatHubSkillManagement.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/shell/AppDialogs.tsx`
- Modify: `app/web/src/styles/chat.css`
- Test: `app/__tests__/web-skill-management-view.test.ts`
- Test: `app/web/src/settings/SkillManagementContent.test.tsx`
- Test: `app/web/src/app/ChatHubSkillManagement.test.tsx`
- Test: `app/web/src/shell/AppDialogs.test.tsx`
- Test: `app/__tests__/web-skill-management-settings.test.ts`
- Test: `app/__tests__/web-skill-management-service.test.ts`

**Acceptance:** Web Skills types and payloads have no ref; parser reports explicit refs invalid; Source cards have no ref editor/change action; preview/detail/confirm UI shows only short resolved commit; other actions and filtering continue working.

- [ ] **Step 1: Write failing parser and component tests**

Require parse errors for `example/catalog#next` and GitHub `/tree/release/...`; keep bare repositories and `npx skills add ... --skill ...` valid. Remove ref from fixtures/targets; assert no ref input/Apply button, `copies_differ` copy, and Refresh/Update/Delete repository-only targets.

- [ ] **Step 2: Write failing dialog/settings tests**

Make confirmations contain `12345678` but not `main at`; delete change-ref confirmation coverage; make update/save/delete fixtures ref-free; make detail/preview omit Ref metadata.

- [ ] **Step 3: Run focused Jest suites and verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-skill-management-view.test.ts web/src/app/ChatHubSkillManagement.test.tsx web/src/shell/AppDialogs.test.tsx web/src/settings/SkillManagementContent.test.tsx
```

Expected: FAIL because parsing, types, controls, and dialogs require ref.

- [ ] **Step 4: Implement ref-free Web behavior**

Remove ref from Registry Skills interfaces/payloads, targets, parsing output, previews, retry payloads, Source card actions, settings metadata, dialogs, and obsolete CSS. Preserve unrelated Git-history/React refs. Surface parser errors before service calls and label pins with `resolvedCommit.slice(0, 8)`.

- [ ] **Step 5: Verify focused GREEN, service regressions, and typecheck**

Re-run Step 3, then:

```powershell
npm test -- --runInBand __tests__/web-skill-management-settings.test.ts __tests__/web-skill-management-service.test.ts
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 6: Git checkpoint**

Checkpoint only the listed Web implementation/test files; record commit hash + subject.

### Task 5: Complete cross-layer verification and implementation record

**Files:**
- Modify: `docs/plans/2026-08-12-skill-sources-default-branch/plan-skill-sources-default-branch.md`
- Review: all files changed by Tasks 1-4

**Acceptance:** Every spec acceptance item has passing evidence, production Skill Source code has no logical ref path, checkboxes reflect actual evidence, and unrelated Git/React refs remain untouched.

- [ ] **Step 1: Audit remaining references**

Run:

```powershell
rg -n 'changeRef|source ref|source\.Ref|preview\.Ref|json:"ref' server/internal/hub/tools app/web/src app/__tests__ -g '*.go' -g '*.ts' -g '*.tsx' -g '*.css'
```

Expected: no production Skill Source ref matches; deliberate legacy/native rejection fixtures may remain. Review every match so unrelated refs are not changed.

- [ ] **Step 2: Run complete Go verification**

Run:

```powershell
go test ./internal/hub/tools -count=1
go test ./... -count=1
```

Expected: PASS.

- [ ] **Step 3: Run complete Web verification**

Run:

```powershell
npm test -- --runInBand
npm run tsc:web
npm run build:web
```

Expected: PASS.

- [ ] **Step 4: Recheck diff, wiki summaries, and contract**

Run:

```powershell
git diff --check
git status -sb
Get-Content docs/wiki/features/skills-management.md -TotalCount 1
Get-Content docs/wiki/architecture/hub-state.md -TotalCount 1
```

Expected: no whitespace errors; only task-owned changes; summaries intact. Compare the final diff against every approved-spec acceptance item.

- [ ] **Step 5: Mark plan and checkpoint**

Update every checkbox only after its evidence passes. Checkpoint the plan and any final task-owned adjustments; record commit hash + subject.

- [ ] **Step 6: Git finalize**

Finalize with the real result. On complete, follow prepared preferences to fetch/rebase, push feature branch, merge into clean local `main`, push `main`, verify remote SHAs, and clean merged task worktree/branches.
