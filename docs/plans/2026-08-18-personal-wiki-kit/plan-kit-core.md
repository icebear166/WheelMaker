# Personal Wiki Kit Core Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public, versioned Personal Wiki Kit and its local-first private-data workflow without copying any personal knowledge or machine configuration into WheelMaker.

**Scope Source:** `docs/scope/2026-08-18-personal-wiki-kit.md`

**Architecture:** `personal-wiki-kit/` owns the reusable reader, content compiler, CLI, local server, Codex Skills, templates, and tests. A generated private repository contains only content, registries, attachments, a pinned Kit lock, and thin launchers; machine-specific location and routing live under `~/.personal-wiki/`.

**Tech Stack:** Node.js ESM and `node:test`, React 19/webpack for the release-time reader build, Go for the read-only server, YAML/Markdown, Git, Windows BAT wrappers.

**Verification:** `npm test` and `npm run build` in `personal-wiki-kit`, `go test ./...` in `personal-wiki-kit/server`, plus Windows fixture smoke tests that run with the bundled-runtime layout.

---

### Task 1: Synchronize the approved WheelMaker Wiki contract

**Files:**
- Create: `docs/wiki/features/knowledge-registry.md`
- Modify: `docs/wiki/features/features.md`
- Modify: `docs/wiki/architecture/server-runtime.md`
- Modify: `docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md`
- Modify: `docs/wiki/frontend-interaction/app-menu.md`

**Acceptance:** The four approved Wiki targets describe the stable public-Kit/private-data boundary and WheelMaker entry behavior; the features index links the newly materialized page; no private domain, IP, repository, path, or credential is present.

- [ ] **Step 1: Read only the approved pages and their directory index context**

Run: `Get-Content -Raw docs/wiki/features/features.md; Get-Content -Raw docs/wiki/architecture/server-runtime.md; Get-Content -Raw docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md; Get-Content -Raw docs/wiki/frontend-interaction/app-menu.md`

Expected: Existing stable scope and headings are known before editing.

- [ ] **Step 2: Write the stable architecture and interaction facts**

Create/update only the approved pages plus the mandatory features index. Keep implementation checklists in this plan, not in Wiki pages.

- [ ] **Step 3: Verify Wiki shape and privacy boundary**

Run: `git diff --check -- docs/wiki && rg -n "^> 摘要：|^# " docs/wiki/features/knowledge-registry.md docs/wiki/architecture/server-runtime.md docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md docs/wiki/frontend-interaction/app-menu.md`

Expected: All modified pages retain first-line summaries and titles.

Run: `rg -n -i "[A-Z]:/Users/|/home/[^/]+|BEGIN .*PRIVATE KEY|github_pat_|gh[pousr]_" docs/wiki/features/knowledge-registry.md docs/wiki/architecture/server-runtime.md docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md docs/wiki/frontend-interaction/app-menu.md`

Expected: Exit 1 with no matches.

Run: `rg -n "https?://" docs/wiki/features/knowledge-registry.md docs/wiki/architecture/server-runtime.md docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md docs/wiki/frontend-interaction/app-menu.md`

Expected: Any URL shown is a loopback address or an `example.com` example, never an operator-specific value.

- [x] **Step 4: Git checkpoint**

Checkpoint: `999f56cf docs(wiki): define reusable personal wiki kit`.

### Task 2: Establish the public Kit manifest and repository boundary

**Files:**
- Create: `personal-wiki-kit/kit.json`
- Create: `personal-wiki-kit/package.json`
- Create: `personal-wiki-kit/package-lock.json`
- Create: `personal-wiki-kit/.gitignore`
- Create: `personal-wiki-kit/README.md`
- Create: `personal-wiki-kit/src/kit-manifest.mjs`
- Create: `personal-wiki-kit/tests/kit-manifest.test.mjs`
- Modify: `.gitleaks.toml`

**Acceptance:** Kit version `0.1.0` has one strict manifest API, unsupported fields/versions fail closed, and public-boundary tests reject known personal values and forbidden content roots.

- [x] **Step 1: Write failing manifest and boundary tests**

Tests must assert:

```js
assert.deepEqual(parseKitManifest('{"schema":1,"version":"0.1.0"}'), {
  schema: 1,
  version: '0.1.0',
});
assert.throws(() => parseKitManifest('{"schema":1,"version":"latest"}'), /semantic version/);
assert.deepEqual(scanPublicTree(fixtureRoot), []);
```

Add fixtures proving `content/articles/private.md`, a drive-specific path, a private key marker, and a non-example domain are reported.

- [x] **Step 2: Run tests to verify RED**

Run: `node --test personal-wiki-kit/tests/kit-manifest.test.mjs`

Expected: FAIL because `src/kit-manifest.mjs` does not exist.

- [x] **Step 3: Implement the minimal strict manifest and scanner**

The scanner walks only committed Kit source, ignores generated/cache roots, and returns normalized path + reason records. It must not treat `example.com`, loopback URLs, or generic `C:/example/...` fixtures as personal data.

- [x] **Step 4: Generate and lock the development dependency graph**

Run: `npm install --package-lock-only --ignore-scripts`

Workdir: `personal-wiki-kit`

Expected: `package-lock.json` is generated from `package.json`; no package lifecycle script runs.

- [x] **Step 5: Verify GREEN and focused regressions**

Run: `npm test -- --test-name-pattern="kit manifest|public boundary"`

Expected: PASS.

- [x] **Step 6: Git checkpoint**

Checkpoint: `31cdcc33 feat(wiki-kit): establish public package boundary`.

### Task 3: Extract and parameterize the content compiler

**Files:**
- Modify: `personal-wiki-kit/package.json`
- Modify: `personal-wiki-kit/package-lock.json`
- Create: `personal-wiki-kit/schema/article.schema.json`
- Create: `personal-wiki-kit/src/content.mjs`
- Create: `personal-wiki-kit/src/release-manifest.mjs`
- Create: `personal-wiki-kit/tests/content.test.mjs`
- Create: `personal-wiki-kit/tests/registry.test.mjs`
- Create: `personal-wiki-kit/tests/release-manifest.test.mjs`
- Create: `personal-wiki-kit/tests/fixtures/valid-wiki/`

**Acceptance:** The compiler accepts an explicit private repository and output directory, preserves the existing taxonomy/projects/articles contracts and dual catalogs, rejects secrets/unsafe links/unsupported files, and emits deterministic article/search/catalog/release manifests.

- [x] **Step 1: Port behavior tests before compiler code**

Write tests around the desired API:

```js
const result = await compileKnowledge({
  repository: fixtureRepository,
  output: fixtureOutput,
  generatedAt: '2026-08-18T00:00:00.000Z',
});
assert.equal(result.catalog.articleCount, 1);
assert.equal(result.catalog.projects[0].sections[0].categories[0].articles[0].id, 'example-article');
assert.equal(await verifyReleaseRoot(fixtureOutput), true);
```

Cover missing registrations, duplicate orders, unknown project IDs, unmatched attachments, raw HTML, credential patterns, traversal links, deterministic ordering, and unlisted release files.

- [x] **Step 2: Run tests to verify RED**

Run: `node --test tests/content.test.mjs tests/registry.test.mjs tests/release-manifest.test.mjs`

Workdir: `personal-wiki-kit`

Expected: FAIL because the compiler modules are absent.

- [x] **Step 3: Implement the minimal repository-parameterized compiler**

Reuse verified behavior from the private implementation by selective text extraction only. Remove module-level repository paths; every filesystem operation must resolve under the explicit repository/output roots and reject escapes or symlinks crossing those roots.

- [x] **Step 4: Verify GREEN and deterministic output**

Run: `node --test tests/content.test.mjs tests/registry.test.mjs tests/release-manifest.test.mjs`

Expected: PASS with identical manifest hashes across two builds with the same `generatedAt`.

- [x] **Step 5: Git checkpoint**

Checkpoint: `6c82951e feat(wiki-kit): compile private knowledge data`.

### Task 4: Build the release-time Reader and data-only site assembly

**Files:**
- Modify: `personal-wiki-kit/package.json`
- Modify: `personal-wiki-kit/package-lock.json`
- Create: `personal-wiki-kit/reader/public/index.html`
- Create: `personal-wiki-kit/reader/src/App.tsx`
- Create: `personal-wiki-kit/reader/src/MarkdownRenderer.tsx`
- Create: `personal-wiki-kit/reader/src/main.tsx`
- Create: `personal-wiki-kit/reader/src/routes.ts`
- Create: `personal-wiki-kit/reader/src/styles.css`
- Create: `personal-wiki-kit/reader/src/types.ts`
- Create: `personal-wiki-kit/reader/tsconfig.json`
- Create: `personal-wiki-kit/reader/webpack.config.cjs`
- Create: `personal-wiki-kit/src/site-builder.mjs`
- Create: `personal-wiki-kit/tests/site-builder.test.mjs`

**Acceptance:** Reader supports topic and project views with stable article IDs, and private-repository builds copy a prebuilt Reader shell plus generated data without webpack/npm execution.

- [x] **Step 1: Write failing site assembly tests**

Use a fake prebuilt Reader containing `index.html` and hashed assets. Assert `buildSite()` copies only declared Reader files, overlays generated `data/`, writes release metadata/manifest, and rejects extra or tampered Reader assets.

- [x] **Step 2: Run tests to verify RED**

Run: `node --test tests/site-builder.test.mjs`

Expected: FAIL because `src/site-builder.mjs` is absent.

- [x] **Step 3: Implement the minimal site assembler and Reader source**

Reader source is selectively extracted from the current private implementation, with no private content/default URL. The release build writes `reader-dist/`; `buildSite()` accepts that directory explicitly and never invokes npm.

- [x] **Step 4: Verify Reader and assembler GREEN**

Run: `npm run typecheck && npm run build:reader && node --test tests/site-builder.test.mjs`

Expected: PASS; production Reader output contains no content article markdown or real infrastructure values.

- [ ] **Step 5: Git checkpoint**

Checkpoint Reader, assembler, configuration, and tests.

### Task 5: Move lookup, routing, and publication Skills onto user-level configuration

**Files:**
- Create: `personal-wiki-kit/src/user-config.mjs`
- Create: `personal-wiki-kit/src/project-routing.mjs`
- Create: `personal-wiki-kit/src/query-knowledge.mjs`
- Create: `personal-wiki-kit/src/git-target.mjs`
- Create: `personal-wiki-kit/skills/lookup-knowledge/SKILL.md`
- Create: `personal-wiki-kit/skills/lookup-knowledge/agents/openai.yaml`
- Create: `personal-wiki-kit/skills/publish-knowledge/SKILL.md`
- Create: `personal-wiki-kit/skills/publish-knowledge/agents/openai.yaml`
- Create: `personal-wiki-kit/skills/publish-knowledge/references/article-contract.md`
- Create: `personal-wiki-kit/tests/user-config.test.mjs`
- Create: `personal-wiki-kit/tests/project-routing.test.mjs`
- Create: `personal-wiki-kit/tests/query-knowledge.test.mjs`
- Create: `personal-wiki-kit/tests/git-target.test.mjs`

**Acceptance:** Both Skills are fully Chinese, read only `~/.personal-wiki/config.json` and `project-routing.json`, default queries to Git HEAD, preserve multi-root/longest-root/unassigned semantics, and infer Git remote/default branch from the private repository.

- [ ] **Step 1: Write failing configuration, route, query, and Git tests**

Tests assert strict schema/unknown-field rejection, canonical path handling, multiple roots to one project, nested longest root, merged sources, no-match empty IDs, HEAD vs working-tree labels, and remote/default branch inference without committed remote fields.

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test tests/user-config.test.mjs tests/project-routing.test.mjs tests/query-knowledge.test.mjs tests/git-target.test.mjs`

Expected: FAIL because the modules are absent.

- [ ] **Step 3: Implement minimal modules and Chinese Skills**

All scripts accept explicit paths for testing; production defaults resolve `%USERPROFILE%/.personal-wiki`. Skill update instructions must state that Skill code is replaceable while user configuration is outside the Skill tree.

- [ ] **Step 4: Verify GREEN and Skill language contract**

Run: `node --test tests/user-config.test.mjs tests/project-routing.test.mjs tests/query-knowledge.test.mjs tests/git-target.test.mjs`

Expected: PASS.

Run: `rg -n "repositoryPath|project-routing|已提交快照|明确批准" skills -g "*.md"`

Expected: Both Skills contain the new location and Chinese workflow; no user path is embedded.

- [ ] **Step 5: Git checkpoint**

Checkpoint configuration/query/routing modules, Skills, and tests.

### Task 6: Implement setup, templates, and one-time legacy migration

**Files:**
- Create: `personal-wiki-kit/src/setup.mjs`
- Create: `personal-wiki-kit/src/migrate-config.mjs`
- Create: `personal-wiki-kit/src/install-skills.mjs`
- Create: `personal-wiki-kit/src/cli.mjs`
- Create: `personal-wiki-kit/templates/private-repository/content/registry/taxonomy.yaml`
- Create: `personal-wiki-kit/templates/private-repository/content/registry/projects.yaml`
- Create: `personal-wiki-kit/templates/private-repository/content/registry/articles.yaml`
- Create: `personal-wiki-kit/templates/private-repository/content/articles/example-article.md`
- Create: `personal-wiki-kit/templates/private-repository/wiki-kit.lock.json`
- Create: `personal-wiki-kit/templates/private-repository/wiki.config.json`
- Create: `personal-wiki-kit/templates/private-repository/open-wiki.bat`
- Create: `personal-wiki-kit/templates/private-repository/publish-wiki.bat`
- Create: `personal-wiki-kit/templates/private-repository/update-wiki-kit.bat`
- Create: `personal-wiki-kit/setup-wiki.bat`
- Create: `personal-wiki-kit/tests/setup.test.mjs`
- Create: `personal-wiki-kit/tests/migrate-config.test.mjs`
- Create: `personal-wiki-kit/tests/install-skills.test.mjs`

**Acceptance:** Setup creates a new local private Git repository without network writes, optionally creates a GitHub private remote only after confirmation, installs Skills atomically, and migrates old locator/routes with preview, backup, verification, and rollback.

- [ ] **Step 1: Write failing setup/migration fixtures**

Use injected command/prompt/filesystem adapters. Assert no `gh` call by default, `gh repo create --private` only after explicit true, refusal to overwrite non-empty targets, exact generated files, atomic Skill directory replacement, old-config preview, backup creation, successful cutover, and rollback after verification failure.

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test tests/setup.test.mjs tests/migrate-config.test.mjs tests/install-skills.test.mjs`

Expected: FAIL because setup modules are absent.

- [ ] **Step 3: Implement minimal setup and migration transactions**

All destructive-looking replacement occurs in sibling candidate directories and uses rename after validation. Existing user files are never deleted; timestamped backups are retained and reported.

- [ ] **Step 4: Verify GREEN and generated repository content check**

Run: `node --test tests/setup.test.mjs tests/migrate-config.test.mjs tests/install-skills.test.mjs && node src/cli.mjs check --repository templates/private-repository`

Expected: PASS; generated repository validates without network or host Node assumptions beyond the development runner.

- [ ] **Step 5: Git checkpoint**

Checkpoint setup/migration modules, templates, wrappers, and tests.

### Task 7: Provide loopback-only local opening

**Files:**
- Create: `personal-wiki-kit/server/go.mod`
- Create: `personal-wiki-kit/server/go.sum`
- Create: `personal-wiki-kit/server/cmd/wiki-server/main.go`
- Create: `personal-wiki-kit/server/internal/wiki/server.go`
- Create: `personal-wiki-kit/server/internal/wiki/server_test.go`
- Create: `personal-wiki-kit/server/internal/wiki/auth.go`
- Create: `personal-wiki-kit/server/internal/wiki/auth_test.go`
- Create: `personal-wiki-kit/server/internal/wiki/manifest.go`
- Create: `personal-wiki-kit/server/internal/wiki/manifest_test.go`
- Create: `personal-wiki-kit/src/open-local.mjs`
- Create: `personal-wiki-kit/tests/open-local.test.mjs`

**Acceptance:** Local open builds with the pinned Reader, chooses an available loopback port, starts a no-auth local-only server, opens the browser, and cannot bind a non-loopback address; online mode still requires Argon2id authentication.

- [ ] **Step 1: Write failing Go and Node tests**

Go tests assert non-loopback rejection, local no-auth serving only when explicitly enabled, authenticated online routes, secure headers, session behavior, rate limiting, manifest verification, and health response without content leakage. Node tests assert port selection, child arguments, browser opener injection, and cleanup.

- [ ] **Step 2: Run tests to verify RED**

Run: `go test ./...`

Workdir: `personal-wiki-kit/server`

Run: `node --test tests/open-local.test.mjs`

Workdir: `personal-wiki-kit`

Expected: FAIL because server/open modules are absent.

- [ ] **Step 3: Implement minimal local/online server modes and orchestrator**

Selectively extract the verified server implementation, replace private module names/default roots, and make no-auth legal only for an explicit loopback-local command. The CLI owns child lifecycle and temporary site cleanup.

- [ ] **Step 4: Verify GREEN**

Run: `go test ./... && go build ./cmd/wiki-server`

Workdir: `personal-wiki-kit/server`

Run: `node --test tests/open-local.test.mjs`

Workdir: `personal-wiki-kit`

Expected: PASS.

- [ ] **Step 5: Git checkpoint**

Checkpoint server, local-open orchestrator, and tests.

### Task 8: Implement safe local publication and explicit Kit updates

**Files:**
- Create: `personal-wiki-kit/src/local-publish.mjs`
- Create: `personal-wiki-kit/src/kit-lock.mjs`
- Create: `personal-wiki-kit/src/update-kit.mjs`
- Modify: `personal-wiki-kit/src/cli.mjs`
- Create: `personal-wiki-kit/tests/local-publish.test.mjs`
- Create: `personal-wiki-kit/tests/kit-lock.test.mjs`
- Create: `personal-wiki-kit/tests/update-kit.test.mjs`
- Modify: `personal-wiki-kit/package.json`

**Acceptance:** Thin launchers invoke one CLI; publication stages only knowledge allowlist paths and handles no-remote/local commits honestly; update verifies exact version/checksum and changes the lock only after candidate compatibility checks pass.

- [ ] **Step 1: Write failing publish/lock/update tests**

Cover porcelain parsing, rename records, supported attachments, blocked files, explicit path staging, default branch requirement, no remote, normal push, non-fast-forward single retry, deployment status unknown, strict lock schema, digest mismatch, failed migration rollback, and successful atomic lock update.

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test tests/local-publish.test.mjs tests/kit-lock.test.mjs tests/update-kit.test.mjs`

Expected: FAIL because modules are absent.

- [ ] **Step 3: Implement minimal publish/update CLI**

Extend the Task 6 command dispatcher with `build`, `query`, `open`, `publish`, and `update`. It reports whether the result is local-only, pushed with deployment unknown, or deployed; it never reports online success without evidence.

- [ ] **Step 4: Verify GREEN and full Kit regression**

Run: `npm test && npm run typecheck && npm run build:reader && npm run check:public`

Workdir: `personal-wiki-kit`

Expected: PASS with no warning about private values or unhandled lifecycle scripts.

- [ ] **Step 5: Git checkpoint**

Checkpoint CLI, publisher, lock/updater, package scripts, and tests.
