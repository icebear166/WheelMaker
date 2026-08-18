# Personal Wiki Kit Release and Migration Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package reproducible self-contained Kit releases, provide parameterized authenticated online deployment, and migrate the existing private Wiki onto the pinned data-only workflow without interrupting the current site.

**Scope Source:** `docs/scope/2026-08-18-personal-wiki-kit.md`

**Architecture:** WheelMaker builds versioned Windows and Linux Kit archives with manifests and SHA-256 lock metadata. Generated private repositories download exact artifacts in CI, while migration compares old/new site manifests before switching the private repository workflow and only removes legacy program files after an online candidate passes authentication and health checks.

**Tech Stack:** Node.js release orchestration and `node:test`, Go cross-builds, GitHub Actions, tar/zip manifests, OpenSSH, systemd, Argon2id, Bash provisioning/activation scripts.

**Verification:** Release packager fixture tests, self-contained Windows smoke, Linux server/deploy tests, generated Action contract tests, private-repository migration dry-run and manifest comparison, authenticated deployment smoke when credentials are available.

---

### Task 1: Build deterministic Kit platform archives

**Files:**
- Create: `personal-wiki-kit/scripts/build-release.mjs`
- Create: `personal-wiki-kit/scripts/build-release.test.mjs`
- Create: `personal-wiki-kit/scripts/archive.mjs`
- Create: `personal-wiki-kit/scripts/archive.test.mjs`
- Create: `personal-wiki-kit/runtime/README.md`
- Create: `personal-wiki-kit/tests/windows-local-smoke.test.mjs`
- Modify: `personal-wiki-kit/package.json`

**Acceptance:** A Kit version produces deterministic Windows and Linux archive trees containing CLI/runtime, prebuilt Reader, server binary, Skills, templates, manifest, and per-file SHA-256; no host Node/Go is needed after extraction.

- [x] **Step 1: Write failing archive-layout, tamper, and Windows smoke tests**

Fixture tests assert required paths, executable metadata for Linux assets, deterministic normalized ordering/timestamps, manifest completeness, runtime invocation path, and failure when a declared file is missing or extra. The Windows smoke removes host Node/Go from `PATH`, then exercises the staged runtime through setup, query, build, open-health, and local publish fixtures.

- [x] **Step 2: Run tests to verify RED**

Run: `node --test scripts/archive.test.mjs scripts/build-release.test.mjs tests/windows-local-smoke.test.mjs`

Workdir: `personal-wiki-kit`

Expected: FAIL because release modules are absent.

- [x] **Step 3: Implement minimal packager**

Copy `process.execPath` as the development Windows runtime fixture, accept explicit platform runtime/server inputs for CI, copy production dependencies without running lifecycle scripts, and generate manifests after the final tree is complete.

- [x] **Step 4: Verify GREEN and self-contained invocation**

Run: `node --test scripts/archive.test.mjs scripts/build-release.test.mjs tests/windows-local-smoke.test.mjs && npm run build:release -- --platform windows-x64 --output .wiki-kit-out`

Expected: PASS; invoking the staged `setup-wiki.bat --help` succeeds with `PATH` that excludes host Node/Go.

- [x] **Step 5: Git checkpoint**

Checkpoint release packager, archive helpers, package scripts, and tests; do not commit `.wiki-kit-out`.

### Task 2: Parameterize authenticated server provisioning and atomic activation

**Files:**
- Create: `personal-wiki-kit/deployment/provision.sh`
- Create: `personal-wiki-kit/deployment/activate-release.sh`
- Create: `personal-wiki-kit/deployment/personal-wiki.service.template`
- Create: `personal-wiki-kit/deployment/Caddyfile.template`
- Create: `personal-wiki-kit/deployment/publish-action.yml.template`
- Create: `personal-wiki-kit/src/deployment-config.mjs`
- Create: `personal-wiki-kit/tests/deployment-config.test.mjs`
- Create: `personal-wiki-kit/tests/deployment-contract.test.mjs`
- Modify: `personal-wiki-kit/server/cmd/wiki-server/main.go`

**Acceptance:** Deployment templates contain no personal defaults, listen only on loopback, keep plaintext passwords/private keys out of repository output, use strict known-host SSH, verify candidate manifests, atomically activate, health-check, and roll back on failure.

- [x] **Step 1: Write failing template/config contract tests**

Tests assert canonical domain/port/user input, rejection of secrets in committed config, loopback service listener, restrictive systemd settings, exact remote archive pattern, server-side lock, manifest verification before symlink switch, rollback after failed health, and absence of real domains/IPs/paths.

- [x] **Step 2: Run tests to verify RED**

Run: `node --test tests/deployment-config.test.mjs tests/deployment-contract.test.mjs`

Expected: FAIL because parameterized assets are absent.

- [x] **Step 3: Implement minimal deployment renderer and templates**

Selectively extract verified security behavior, replace all site-specific literals with validated render inputs, and keep credentials as GitHub Secret/server-file instructions rather than rendered repository values.

- [x] **Step 4: Verify GREEN and Go server security**

Run: `node --test tests/deployment-config.test.mjs tests/deployment-contract.test.mjs`

Workdir: `personal-wiki-kit`

Run: `go test ./...`

Workdir: `personal-wiki-kit/server`

Expected: PASS.

- [x] **Step 5: Git checkpoint**

Checkpoint deployment templates, renderer, server adjustment, and tests.

### Task 3: Add independent WheelMaker-hosted Kit publication

**Files:**
- Create: `scripts/personal-wiki-kit-release.mjs`
- Create: `scripts/personal-wiki-kit-release.test.mjs`
- Create: `.github/workflows/publish-personal-wiki-kit.yml`
- Modify: `.github/workflows/security.yml`
- Modify: `scripts/security_acceptance.ps1`
- Modify: `scripts/security_acceptance.sh`
- Modify: `CLAUDE.md`

**Acceptance:** A dedicated manual workflow builds/tests both Kit platform assets, publishes tag/assets for the exact Kit version, emits a lock descriptor with SHA-256, rejects an existing/mismatched tag, and is separate from normal WheelMaker release publication.

- [x] **Step 1: Write failing release-orchestration tests**

Inject command/GitHub adapters and assert version/tag mapping `personal-wiki-kit-v0.1.0`, clean source requirement, exact asset names, duplicate-tag refusal, checksum descriptor, no WheelMaker release-server token dependency, and dry-run behavior.

- [x] **Step 2: Run tests to verify RED**

Run: `node --test scripts/personal-wiki-kit-release.test.mjs`

Expected: FAIL because release orchestration is absent.

- [x] **Step 3: Implement minimal release entry and workflow**

Use GitHub Actions `contents: write` only in the dedicated workflow. Build source remains in WheelMaker; private Wiki content is never checked out or referenced. Update security gates to scan Kit source and artifacts.

- [x] **Step 4: Verify GREEN and workflow syntax contracts**

Run: `node --test scripts/personal-wiki-kit-release.test.mjs && pwsh -File scripts/test_security_hooks.ps1 && pwsh -File scripts/test_security_acceptance_ps1.ps1`

Expected: PASS.

- [x] **Step 5: Git checkpoint**

Checkpoint Kit release entry, workflow, security gates, and release instructions.

### Task 4: Generate the data-only online workflow

**Files:**
- Modify: `personal-wiki-kit/src/setup.mjs`
- Modify: `personal-wiki-kit/src/deployment-config.mjs`
- Modify: `personal-wiki-kit/templates/private-repository/wiki-kit.lock.json`
- Modify: `personal-wiki-kit/templates/private-repository/wiki.config.json`
- Modify: `personal-wiki-kit/templates/private-repository/.github/workflows/publish.yml`
- Create: `personal-wiki-kit/tests/generated-workflow.test.mjs`

**Acceptance:** A generated private repository pins an exact Kit version/artifact digest, downloads and verifies Linux assets in Action, builds only private content, publishes through required secrets, and never runs `npm install` or compiles Kit source.

- [ ] **Step 1: Write failing generated-workflow tests**

Assert exact-version URL, checksum verification before extraction, no `latest`, no source checkout outside the private repository, no host `npm install`, secret-only SSH identity/known hosts/host/port, and local-only repositories omitting the workflow until online mode is enabled.

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test tests/generated-workflow.test.mjs tests/setup.test.mjs`

Workdir: `personal-wiki-kit`

Expected: FAIL because the online template is not integrated.

- [ ] **Step 3: Implement minimal workflow generation**

Render only non-secret site data and pinned release metadata. Keep `WIKI_DEPLOY_KEY`, `WIKI_SSH_KNOWN_HOSTS`, `WIKI_DEPLOY_HOST`, and optional port in GitHub Secrets.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/generated-workflow.test.mjs tests/setup.test.mjs tests/deployment-config.test.mjs`

Expected: PASS.

- [ ] **Step 5: Git checkpoint**

Checkpoint setup/deployment integration, workflow template, locks, and tests.

### Task 5: Implement idempotent private-repository migration

**Files:**
- Create: `personal-wiki-kit/src/migrate-repository.mjs`
- Create: `personal-wiki-kit/tests/migrate-repository.test.mjs`
- Create: `personal-wiki-kit/tests/manifest-equivalence.test.mjs`
- Modify: `personal-wiki-kit/src/cli.mjs`
- Modify: `personal-wiki-kit/README.md`

**Acceptance:** Migration dry-run classifies retained data, generated thin files, and legacy program paths; apply requires a clean recoverable Git state, proves old/new catalog and article identity equivalence, and does not remove legacy program files until a validated candidate workflow exists.

- [ ] **Step 1: Write failing repository-migration tests**

Build a legacy fixture matching current shape. Assert content/registries/attachments retained byte-for-byte, stable article IDs/URLs and search entries equivalent, program files classified for removal, lock/launchers generated, unknown files block, dirty trees block, repeated dry-run is stable, and apply failure leaves the repository unchanged.

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test tests/migrate-repository.test.mjs tests/manifest-equivalence.test.mjs`

Expected: FAIL because migration modules are absent.

- [ ] **Step 3: Implement minimal transactional migration**

Operate through a candidate worktree/directory and explicit Git path list. The live repository is changed only after equivalence checks pass; retain a migration report and recoverable pre-migration commit/tag in the private repository.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/migrate-repository.test.mjs tests/manifest-equivalence.test.mjs && npm test`

Workdir: `personal-wiki-kit`

Expected: PASS.

- [ ] **Step 5: Git checkpoint**

Checkpoint repository migrator, equivalence tests, CLI integration, and documentation.

### Task 6: Migrate and verify the existing private Personal Wiki

**Files:**
- Modify in repository resolved by `~/.personal-wiki/config.json`: legacy program tree removal and generated data-only integration files
- Preserve in that repository: `content/articles/`, `content/registry/`, `attachments/`, private Git history
- Create in that repository: migration report and Kit lock

**Acceptance:** The existing private Wiki runs from the same Kit as new users, preserves article IDs/URLs/catalog/search/attachments, and keeps the current online release active until a new authenticated candidate passes.

- [ ] **Step 1: Establish a separate private-repository Git worktree and recovery point**

Read its own instructions and status, fetch its remote, create a migration branch/worktree from the latest approved private feature branch, and record all pre-existing modifications. Do not mutate the currently checked-out private worktree.

- [ ] **Step 2: Run migration dry-run and equivalence report**

Run: `node personal-wiki-kit/src/cli.mjs migrate-repository --config "$env:USERPROFILE/.personal-wiki/config.json" --dry-run --report .wiki-kit-out/private-migration-report.json`

Workdir: WheelMaker task worktree root.

Expected: Report contains only known retained/generated/legacy paths and zero unknown or identity differences.

- [ ] **Step 3: Apply migration in the private migration worktree**

Use the locally built, checksum-verified Kit candidate. Run the private repository's new check/build/query tests and compare generated manifests against the pre-migration output.

- [ ] **Step 4: Verify online candidate without cutting off the old release**

If deployment credentials and a published Kit asset are available, push the private migration branch, run/observe its candidate Action, authenticate to the protected URL, and verify health/catalog/article reads. If release authority or credentials are unavailable, stop before merge/legacy removal and report the exact external blocker; do not claim migration complete.

- [ ] **Step 5: Switch the private default branch only after candidate success**

Merge using that repository's Git preferences, push, verify the active release and current symlink/health, then remove only the legacy program files already classified by the migration report.

- [ ] **Step 6: Git checkpoint/finalize for the private repository**

Record private branch/worktree, commit hashes, push/merge status, and cleanup separately from WheelMaker's Git lifecycle.

### Task 7: Complete cross-repository acceptance

**Files:**
- Modify: these plan checkboxes and migration report only after evidence exists.

**Acceptance:** Public Kit, WheelMaker entry, generated private repository, and migrated existing Wiki satisfy every spec acceptance item with evidence or are reported as externally blocked without unsafe partial cutover.

- [ ] **Step 1: Run Kit full validation**

Run: `npm test && npm run typecheck && npm run build && npm run check:public && npm run smoke:windows-local`

Workdir: `personal-wiki-kit`

Expected: PASS.

- [ ] **Step 2: Run WheelMaker focused validation**

Run: `go test ./internal/shared ./internal/registry ./internal/protocol ./cmd/wheelmaker`

Workdir: `server`

Run: `npm test -- --runInBand web/src/shell/WheelMakerAppMenu.test.tsx web/src/registry/RegistryClient.test.ts __tests__/web-registry-workspace-service.test.ts __tests__/web-chat-file-peek-viewer.test.ts && npm run tsc:web && npm run build:web`

Workdir: `app`

Expected: PASS.

- [ ] **Step 3: Run security and privacy gates**

Run: `pwsh -File scripts/test_security_hooks.ps1; pwsh -File scripts/test_security_acceptance_ps1.ps1`

Expected: PASS.

Run: `rg -n -i "[A-Z]:/Users/|/home/[^/]+|BEGIN .*PRIVATE KEY|github_pat_|gh[pousr]_" personal-wiki-kit`

Expected: Exit 1 with no matches.

- [ ] **Step 4: Audit spec coverage and Git state**

Compare every acceptance bullet in `docs/scope/2026-08-18-personal-wiki-kit.md` to recorded test/manual evidence. Inspect `git status -sb` and diff in both repositories and distinguish task files from pre-existing files.

- [ ] **Step 5: Git finalize**

Invoke WheelMaker `git-workflow` finalize with the truthful result. Do not mark complete if the required existing-Wiki online migration or a mandatory acceptance remains unverified.
