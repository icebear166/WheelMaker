# File Index Scalable Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project file mention search reliable for repositories with hundreds of thousands of files.

**Architecture:** Keep the on-disk index as one path per line. In memory, build searchable entries from snapshot paths and store complete candidate indexes in query sessions so incremental queries narrow from the full prior match set instead of a capped top-N result set.

**Tech Stack:** Go Hub file index manager, existing `github.com/sahilm/fuzzy` matcher, existing Registry API.

---

### Task 1: Regression Test For Large Candidate Narrowing

**Files:**
- Modify: `server/internal/hub/hub_test.go`

- [ ] **Step 1: Write the failing test**

Add a test that creates more than 5000 one-character matches, performs a query-session search for `m`, then refines to `mi`. The target file must not be present in the first capped session pool in the old implementation, and the refined query must still find it.

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/hub -run TestProjectFileIndexQuerySessionNarrowsBeyondInitialTopSet`

Expected: fail with no `MobileInstance.ts` result on the refined query under the old capped-session implementation.

### Task 2: Full Candidate Query Sessions

**Files:**
- Modify: `server/internal/hub/file_index.go`

- [ ] **Step 1: Add searchable entries**

Add a `projectFileIndexEntry` slice to snapshots containing path, base name, and lowercase values derived from paths. Build it after scan/load without changing the index file format.

- [ ] **Step 2: Store full candidate indexes**

Change query sessions from capped path lists to full matched entry indexes. Only returned UI results remain limited.

- [ ] **Step 3: Keep ranking behavior**

Preserve filename-first fuzzy ranking and path-segment fallback. Empty queries still return the first indexed paths.

- [ ] **Step 4: Verify focused tests**

Run: `go test ./internal/hub -run FileIndex`

Expected: pass.

### Task 3: Final Verification And Commit

**Files:**
- Commit all changed files.

- [ ] **Step 1: Run full verification**

Run:
- `go test ./...` from `server/`
- `npm test -- --runInBand` from `app/`
- `npm run tsc:web` from `app/`
- `npm run build:web` from `app/`

- [ ] **Step 2: Commit and push**

Run the repository completion gate:
- `git add -A`
- `git commit -m "fix: keep full file index query candidates"`
- `git push origin main`
