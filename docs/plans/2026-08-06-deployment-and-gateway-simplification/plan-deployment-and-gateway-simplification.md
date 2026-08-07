# Deployment and Gateway Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make business deployments always own their public URL and generated site declaration, keep embedded Caddy behind one explicit idempotent command, and make formal releases externally verifiable and rollback-safe.

**Architecture:** `~/.wheelmaker/config.json` and `~/.wheelmaker/release-server/config.json` become the authoritative public-origin stores; Gateway site JSON is derived output. Release Server serves its complete public tree itself so every frontend is a whole-origin reverse proxy. Formal publishing prepares all aliases before atomically moving `stable.json`, then verifies the anonymous public origin and restores the previous visible release on failure.

**Tech Stack:** Node.js 22 ESM deployment/release scripts with `node:test`, Go HTTP server and embedded Caddy config compiler with `go test`, Bash remote installer embedded in ESM, Markdown Wiki/README documentation.

---

## File Structure

- Modify `scripts/deploy/deploy.mjs`: accept `--public-url`, remove selector and `gateway-update`, preserve self-contained launcher behavior.
- Modify `scripts/deploy/deploy-core.mjs`: persist Workspace `publicUrl`, generate site declarations during deploy/update, keep all published implementation code self-contained, merge Gateway install/update behavior, and clean failed first installs.
- Modify `scripts/deploy/deploy.test.mjs`, `scripts/deploy/deploy-core.test.mjs`, `scripts/deploy/gateway-config.test.mjs`, `scripts/deploy/gateway-install.test.mjs`, `scripts/deploy/gateway-runtime.test.mjs`: define the new CLI/config/lifecycle behavior before implementation.
- Modify `server/internal/shared/config.go` and tests: accept the Workspace `publicUrl` field without renaming Hub configuration files.
- Modify `server/internal/releaseserver/config.go`: store and validate Release Server `publicUrl` and provide an atomic updater used by deployment migration.
- Modify `server/cmd/wheelmaker-release-server/main.go` and tests: add a config-only `configure-public-url` command.
- Modify `server/internal/releaseserver/server.go` and tests: serve the anonymous public tree with CORS, HEAD, Range, cache policy, and path hardening.
- Create `server/internal/releaseserver/public_verify.go` and `public_verify_test.go`: verify the committed release through its configured anonymous origin.
- Modify `server/internal/releaseserver/session.go`, `commit.go`, and `commit_test.go`: inject public verification, commit stable last, and roll back every visible projection on failure.
- Modify `scripts/release-server/deploy.mjs`, `remote-install.mjs`, and tests: remove Gateway selector, migrate `publicUrl`, and always write a reverse-proxy-only Release Server site declaration.
- Modify `server/internal/gateway/types.go`, `compiler.go`, and `gateway_test.go`: remove Release Server static-root ownership, reject duplicate hosts, and redirect to configured external authority.
- Modify `scripts/release-server/index.html` and tests: show independent WheelMaker and Gateway install commands.
- Modify `README.md`, `INSTALL.md`, `scripts/release-server/deployment.md`, `scripts/release-server/deployment.zh-CN.md`, `docs/wiki/architecture/gateway.md`, and `docs/wiki/release-and-build/release.md`: document the final model.
- Modify the superseded `docs/scope/2026-08-05-*.md` files that assert selector/static-root/`gateway-update` behavior: add a historical-status banner linking to the new specification.

---

### Task 1: Define Workspace public URL and CLI semantics

**Files:**
- Modify: `scripts/deploy/deploy.test.mjs`
- Modify: `scripts/deploy/deploy-core.test.mjs`
- Modify: `scripts/deploy/gateway-config.test.mjs`
- Modify: `server/internal/shared/shared_test.go`
- Modify: `scripts/deploy/deploy.mjs`
- Modify: `scripts/deploy/deploy-core.mjs`
- Modify: `server/internal/shared/config.go`

- [x] **Step 1: Write failing launcher and core argument tests**

Replace selector expectations with tests equivalent to:

```js
assert.deepEqual(parseDeployArgs(['--public-url=https://workspace.example.com']), [
  '--public-url=https://workspace.example.com',
]);
assert.throws(() => parseDeployArgs(['--gateway=caddy']), /unknown deploy command/);
assert.throws(() => parseDeployArgs(['--gateway-public-url=https:\/\/workspace.example.com']), /unknown deploy command/);
assert.throws(() => parseDeployArgs(['gateway-update']), /unknown deploy command/);
assert.throws(() => parseDeployArgs(['update', '--public-url=https://workspace.example.com']), /only valid for a full deployment/);
```

Add core tests proving `parsePublicURLDeploymentOptions()` accepts only one complete HTTP(S) origin and returns `{commandArgs, publicUrl}` without Gateway mode state.

- [x] **Step 2: Run the focused tests and verify RED**

```powershell
node --test scripts/deploy/deploy.test.mjs scripts/deploy/deploy-core.test.mjs scripts/deploy/gateway-config.test.mjs
```

Expected: failures mention unsupported `--public-url`, retained Gateway selectors, and retained `gateway-update`.

- [x] **Step 3: Write failing persistence and generation tests**

Cover these exact cases using temporary Home directories:

```js
await configureWorkspacePublicURL({
  home,
  interactive: false,
  publicUrl: 'https://workspace.example.com:8443',
});
assert.equal(JSON.parse(await readFile(join(home, 'config.json'))).publicUrl,
  'https://workspace.example.com:8443');
```

- existing `config.json.publicUrl` is reused without calling the questioner;
- a first interactive deploy asks `WheelMaker server public URL` and persists the answer;
- a first non-interactive full deploy without a value rejects;
- `update` with an existing URL rewrites `gateway/sites/workspace.json`;
- `update` without a URL reports one warning and leaves an existing site file unchanged;
- explicit invalid origins with credentials, paths, query, fragment, or unsupported scheme reject before writing either file.

Add a Go test loading `{"publicUrl":"https://workspace.example.com","projects":[]}` through `shared.LoadConfig` and asserting the field while `db/hub-config.json` remains outside this type.

- [x] **Step 4: Run the focused tests and verify RED**

```powershell
node --test scripts/deploy/deploy-core.test.mjs scripts/deploy/gateway-config.test.mjs
go test ./internal/shared
```

Run the Go command from `server/`. Expected: missing `publicUrl` field and old explicit-Caddy-only generation fail.

- [x] **Step 5: Implement the minimal Workspace model**

In the launcher, reduce the command set and parse only the new full-deploy option:

```js
const ALLOWED_COMMANDS = new Set(['desktop-update', 'gateway', 'migrate-uninstall', 'update']);
```

In the self-contained core:

```js
export function parsePublicURLDeploymentOptions(args) {
  // Remove one --public-url token/value from an otherwise command-only argv.
  // Validate with the shared origin parser and return the normalized origin.
}
```

Change runtime-config preparation to return the parsed object, persist normalized `publicUrl`, and derive `workspace.json` without a mode. Full deploy resolves missing interactive input before application; update reads only existing configuration and warns/skips if absent. Add `PublicURL string \`json:"publicUrl,omitempty"\`` to `shared.AppConfig` and strict input decoding.

- [x] **Step 6: Run tests and refactor while green**

```powershell
node --test scripts/deploy/deploy.test.mjs scripts/deploy/deploy-core.test.mjs scripts/deploy/gateway-config.test.mjs
go test ./internal/shared
```

Expected: PASS and no `--gateway=`/`--gateway-public-url` parsing remains in launcher/core.

- [x] **Step 7: Commit the Workspace configuration slice**

```powershell
git add scripts/deploy/deploy.mjs scripts/deploy/deploy-core.mjs scripts/deploy/deploy.test.mjs scripts/deploy/deploy-core.test.mjs scripts/deploy/gateway-config.test.mjs server/internal/shared/config.go server/internal/shared/shared_test.go
git commit -m "refactor(deploy): make public URL a workspace setting"
```

### Task 2: Make Release Server own its public origin and files

**Files:**
- Modify: `server/internal/releaseserver/config_test.go`
- Modify: `server/cmd/wheelmaker-release-server/main_test.go`
- Modify: `server/internal/releaseserver/server_test.go`
- Modify: `server/internal/releaseserver/config.go`
- Modify: `server/cmd/wheelmaker-release-server/main.go`
- Modify: `server/internal/releaseserver/server.go`

- [x] **Step 1: Write failing config migration tests**

Add tests requiring:

```go
cfg := Config{
    Schema: 1, Listen: "127.0.0.1:9680",
    PublicURL: "https://release.example.com:8443",
    DataRoot: t.TempDir(),
}
```

- `Config.Validate` accepts a clean HTTP(S) origin and rejects paths, credentials, query, fragments, or missing URL;
- `ConfigurePublicURL(path, value)` upgrades an existing config while preserving `TokenSHA256` and `DataRoot`;
- `configure-public-url --config <path> --public-url <origin>` has no other accepted arguments.

- [x] **Step 2: Run config tests and verify RED**

```powershell
go test ./internal/releaseserver ./cmd/wheelmaker-release-server -run "Config|PublicURL|ConfigurePublic"
```

Expected: `PublicURL`, `ConfigurePublicURL`, and the CLI command do not exist.

- [x] **Step 3: Implement config ownership and migration command**

Add:

```go
type Config struct {
    Schema int `json:"schema"`
    Listen string `json:"listen"`
    PublicURL string `json:"publicUrl"`
    DataRoot string `json:"dataRoot"`
    TokenSHA256 string `json:"tokenSha256"`
}
```

Implement one origin validator shared by `Validate` and `ConfigurePublicURL`. The updater must decode the known schema, replace only `PublicURL`, and call the existing atomic `WriteConfig` path.

- [x] **Step 4: Write failing anonymous static-serving tests**

Create real files below `<dataRoot>/public` and assert:

```go
GET /                         -> index.html, 200, Access-Control-Allow-Origin: *
HEAD /deploy.mjs              -> 200, empty body
GET /asset.tar.zst Range 1-2  -> 206 and exact bytes
GET /stable.json              -> Cache-Control: no-store
GET /releases/v1.2/a.tar.zst  -> Cache-Control contains immutable
GET /directory/               -> 404 when no index.html
GET /../config.json           -> 404
POST /stable.json             -> 405
GET /api/not-found            -> authenticated API 404, never a static file
```

- [x] **Step 5: Run server tests and verify RED**

```powershell
go test ./internal/releaseserver -run "Public|Static|Range|Traversal|Authentication"
```

Expected: current handler returns 404 for every public file.

- [x] **Step 6: Implement a hardened public-file handler**

Route `/healthz` and `/api/*` first. For remaining paths, allow only GET/HEAD, clean and resolve relative paths under `dataRoot/public`, refuse directory listing, set CORS and cache headers, then call `http.ServeContent` so Range/HEAD/Last-Modified remain standard. Keep API JSON errors and authentication unchanged.

- [x] **Step 7: Run Release Server tests and commit**

```powershell
go test ./internal/releaseserver ./cmd/wheelmaker-release-server
git add server/internal/releaseserver/config.go server/internal/releaseserver/config_test.go server/internal/releaseserver/server.go server/internal/releaseserver/server_test.go server/cmd/wheelmaker-release-server/main.go server/cmd/wheelmaker-release-server/main_test.go
git commit -m "feat(release-server): serve the public release origin"
```

### Task 3: Simplify Release Server remote deployment and Gateway site schema

**Files:**
- Modify: `scripts/release-server/deploy.test.mjs`
- Modify: `scripts/release-server/remote-install.test.mjs`
- Modify: `server/internal/gateway/gateway_test.go`
- Modify: `scripts/release-server/deploy.mjs`
- Modify: `scripts/release-server/remote-install.mjs`
- Modify: `server/internal/gateway/types.go`
- Modify: `server/internal/gateway/compiler.go`
- Modify: `scripts/deploy/deploy-core.mjs`
- Modify: `scripts/deploy/gateway-config.test.mjs`

- [x] **Step 1: Write failing Release Server deploy tests**

Require `parseReleaseServerArgs([])` to return an empty option object and every argument, including `--gateway=none|caddy`, to fail as unknown. Assert the remote installer receives only `sourceSha`, `publicUrl`, and upload directory; invokes `configure-public-url` on the candidate config; always writes `release-server.json`; and never emits `gateway_mode` or `publicRoot`.

- [x] **Step 2: Write failing Gateway schema and compiler tests**

Define Release Server sites as:

```go
SiteConfig{
    Schema: 1, Kind: SiteReleaseServer,
    PublicURL: "https://release.example.com",
    Upstream: "http://127.0.0.1:9680",
}
```

Assert the compiled host has exactly one catch-all reverse proxy route, duplicate hostnames fail case-insensitively, and an HTTPS site with `https://example.com:8443` redirects to `https://example.com:8443{http.request.uri}` while its matcher remains `example.com`.

- [x] **Step 3: Run focused tests and verify RED**

```powershell
node --test scripts/release-server/deploy.test.mjs scripts/release-server/remote-install.test.mjs scripts/deploy/gateway-config.test.mjs
go test ./internal/gateway
```

Expected: selector/static-root routes remain and duplicate hosts compile successfully.

- [x] **Step 4: Implement remote deployment and site validation**

Remove the fourth remote-script argument and selector parsing. Always write:

```json
{"schema":1,"kind":"release-server","publicUrl":"https://release.example.com","upstream":"http://127.0.0.1:9680","tls":{"certificateFile":"","keyFile":""}}
```

Use the staged Release Server binary to update the candidate `config.json.publicUrl` before validation. Update both Go and self-contained JS site validators so only Workspace requires `webRoot`; Release Server rejects both `webRoot` and `publicRoot`.

- [x] **Step 5: Implement compiler uniqueness, proxy, and redirects**

Before sorting, map `strings.ToLower(site.Host())` to the first site and reject repeats. Replace Release Server file routes with `reverseProxyHandler(site.UpstreamAddress())`. Pass each site to the redirect builder and construct the Location prefix from parsed `publicUrl` scheme/host, preserving the configured port.

- [x] **Step 6: Run tests and commit**

```powershell
node --test scripts/release-server/deploy.test.mjs scripts/release-server/remote-install.test.mjs scripts/deploy/gateway-config.test.mjs
go test ./internal/gateway ./cmd/wheelmaker-gateway
git add scripts/release-server/deploy.mjs scripts/release-server/deploy.test.mjs scripts/release-server/remote-install.mjs scripts/release-server/remote-install.test.mjs scripts/deploy/deploy-core.mjs scripts/deploy/gateway-config.test.mjs server/internal/gateway/types.go server/internal/gateway/compiler.go server/internal/gateway/gateway_test.go server/cmd/wheelmaker-gateway/main_test.go
git commit -m "refactor(gateway): proxy release server as one origin"
```

### Task 4: Collapse Gateway lifecycle and clean failed first installs

**Files:**
- Modify: `scripts/deploy/deploy.test.mjs`
- Modify: `scripts/deploy/deploy-core.test.mjs`
- Modify: `scripts/deploy/gateway-runtime.test.mjs`
- Modify: `scripts/deploy/gateway-install.test.mjs`
- Modify: `scripts/deploy/deploy.mjs`
- Modify: `scripts/deploy/deploy-core.mjs`

- [x] **Step 1: Write failing command and idempotence tests**

Assert `gateway-update` is unknown, `gateway` invokes `installGatewayFromStable` without a force distinction, and the same command starts an installed stopped version or reinstalls a damaged service.

- [x] **Step 2: Write failing failed-start retention tests**

Inject a runtime with recorded `install`, `health`, and `stop` calls. Make health fail after
install and assert:

```js
assert.deepEqual(calls, ['stop', 'install', 'health', 'stop']);
assert.equal(await exists(paths.binary), true);
assert.equal(await exists(join(paths.home, 'state', 'release.json')), true);
```

The runtime adapter exposes no uninstall operation. The failed version and generated service
files remain available for a later retry after the operator fixes the prerequisite.

- [x] **Step 3: Run focused tests and verify RED**

```powershell
node --test scripts/deploy/deploy.test.mjs scripts/deploy/deploy-core.test.mjs scripts/deploy/gateway-install.test.mjs scripts/deploy/gateway-runtime.test.mjs
```

Expected: `gateway-update` is unknown and the adapter has no uninstall method.

- [x] **Step 4: Implement one Gateway command without Gateway rollback**

Remove force routing and `gateway-update`. Keep the selected binary, state, wrappers and service
definition when install or health checks fail. Stop the failed service and report a retryable
error; do not add an uninstall operation or restore the previous binary. The existing
idempotence path starts the retained version on the next `gateway` invocation.

- [x] **Step 5: Run tests and commit**

```powershell
node --test scripts/deploy/deploy.test.mjs scripts/deploy/deploy-core.test.mjs scripts/deploy/gateway-install.test.mjs scripts/deploy/gateway-runtime.test.mjs
git add scripts/deploy/deploy.mjs scripts/deploy/deploy-core.mjs scripts/deploy/deploy.test.mjs scripts/deploy/deploy-core.test.mjs scripts/deploy/gateway-install.test.mjs scripts/deploy/gateway-runtime.test.mjs
git commit -m "fix(gateway): retain failed installs for retry"
```

### Task 5: Commit stable last and verify the public origin

**Files:**
- Create: `server/internal/releaseserver/public_verify.go`
- Create: `server/internal/releaseserver/public_verify_test.go`
- Modify: `server/internal/releaseserver/session.go`
- Modify: `server/internal/releaseserver/commit.go`
- Modify: `server/internal/releaseserver/commit_test.go`

- [x] **Step 1: Write failing commit-order and rollback tests**

Use injected `writeJSON` and public verifier functions to record events. Require successful order:

```text
publish version -> swap gateway -> deploy aliases -> releases.json -> success status -> stable.json -> public verify
```

Inject failure for each pre-stable projection and assert old `stable.json`, aliases, history, Gateway current, and version directory remain unchanged. Inject public-verifier failure after stable and assert all visible files are restored and commit returns `commit_failed`.

- [x] **Step 2: Run commit tests and verify RED**

```powershell
go test ./internal/releaseserver -run "Commit|StableLast|PublicVerification|Rollback"
```

Expected: current stable event occurs before aliases and post-stable errors return success.

- [x] **Step 3: Implement transactional visible projections**

Add a small snapshot type that captures the bytes/existence of `stable.json`, top-level deployment aliases, `releases.json`, and public status before replacement. Prepare version/Gateway swaps, write every derived projection, atomically write stable last, then call the injected verifier. On any error, restore snapshots, Gateway swap, and staged version location. Do not classify post-stable projection failures as repairable success.

- [x] **Step 4: Write failing public verifier tests**

Use `httptest.Server` and assert the verifier:

- reads anonymous stable and checks version/source SHA;
- downloads top-level `deploy.mjs`, `deploy-core.mjs`, and pointed release/Gateway manifests and checks SHA-256;
- issues `Range: bytes=0-0` to every newly published large artifact and requires 206 with one byte;
- rejects cross-origin redirects, 403/404, malformed JSON, wrong digest, ignored Range, and timeout.

- [x] **Step 5: Run verifier tests and verify RED**

```powershell
go test ./internal/releaseserver -run "VerifyPublic"
```

Expected: verifier implementation is missing.

- [x] **Step 6: Implement bounded anonymous verification**

Create a verifier with a dedicated `http.Client`, finite timeout, redirect policy that rejects origin changes, bounded control-file reads, SHA-256 checks, and one-byte Range probes. Wire the production dependency from `Config.PublicURL`; inject a no-network verifier in ordinary commit tests.

- [x] **Step 7: Run tests and commit**

```powershell
go test ./internal/releaseserver ./cmd/wheelmaker-release-server
git add server/internal/releaseserver/public_verify.go server/internal/releaseserver/public_verify_test.go server/internal/releaseserver/session.go server/internal/releaseserver/commit.go server/internal/releaseserver/commit_test.go
git commit -m "fix(release): publish stable only after verifiable projections"
```

### Task 6: Update release homepage and operational documentation

**Files:**
- Modify: `scripts/release-server/deploy.test.mjs`
- Modify: `scripts/release-server/index.html`
- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `scripts/release-server/deployment.md`
- Modify: `scripts/release-server/deployment.zh-CN.md`
- Modify: `docs/wiki/architecture/gateway.md`
- Modify: `docs/wiki/release-and-build/release.md`
- Modify: relevant `docs/scope/2026-08-05-*.md`

- [x] **Step 1: Write failing homepage command tests**

Assert the HTML has distinct WheelMaker and built-in Gateway command panels. WheelMaker commands download once and execute one full deploy, without `migrate-uninstall`; Gateway commands download once and execute exactly `node ... deploy.mjs gateway`. Assert no selector, `gateway-update`, or repeated full deployment appears.

- [x] **Step 2: Run homepage tests and verify RED**

```powershell
node --test scripts/release-server/deploy.test.mjs
```

Expected: no Gateway panel and current commands invoke migration plus deploy.

- [x] **Step 3: Update the homepage minimally**

Reuse existing command-card styling and copy behavior. Label the two purposes explicitly, keep client downloads unchanged, and make every command use same-origin `https://release.wheelmaker.top/deploy.mjs`.

- [x] **Step 4: Update long-lived docs using the confirmed Wiki targets**

Document:

```text
business config publicUrl -> generated site JSON -> optional Gateway consumer
Release Server origin -> reverse proxy to 127.0.0.1:9680
deploy.mjs gateway -> sole Gateway lifecycle entry
stable last -> anonymous public verification -> rollback on failure
```

Delete active instructions for `/srv`, cross-user static roots, selectors, `gateway-update`, and automatic Nginx migration. Add a minimal Nginx whole-origin proxy example. Add a first-paragraph superseded banner to historical specs that contradict the new document, without deleting their bodies.

- [x] **Step 5: Run documentation regression tests and commit**

```powershell
node --test scripts/release-server/deploy.test.mjs scripts/release/entry.test.mjs
git add scripts/release-server/index.html scripts/release-server/deploy.test.mjs README.md INSTALL.md scripts/release-server/deployment.md scripts/release-server/deployment.zh-CN.md docs/wiki/architecture/gateway.md docs/wiki/release-and-build/release.md docs/scope/2026-08-05-* docs/scope/2026-08-06-deployment-and-gateway-simplification.md
git commit -m "docs: describe backend-neutral deployment"
```

### Task 7: Self-contained artifact and full regression verification

**Files:**
- Modify only if a failing test exposes a defect in files already listed above.

- [x] **Step 1: Verify all deployment and release Node tests**

```powershell
node --test scripts/deploy/*.test.mjs scripts/release-server/*.test.mjs scripts/release/*.test.mjs
```

Expected: PASS, zero failed tests.

- [x] **Step 2: Verify all Go server tests**

```powershell
go test ./...
```

Run from `server/`. Expected: PASS.

- [x] **Step 3: Verify generated deploy scripts are self-contained**

Run the repository release packaging tests and inspect both published scripts:

```powershell
rg -n "^import .*['\"]\.\/" scripts/deploy/deploy.mjs scripts/deploy/deploy-core.mjs
node --test scripts/deploy/archive-fixtures.test.mjs scripts/release/build.test.mjs scripts/release/publish.test.mjs
```

Expected: `rg` finds no local imports; tests pass.

- [x] **Step 4: Review the final diff and working tree**

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors and only scoped files changed.

- [x] **Step 5: Commit verification-only fixes if any**

If full verification required a code correction, first add a reproducing failing test, apply the minimum fix, rerun the affected suite, and commit only those files:

```powershell
git commit -m "test(deploy): close release workflow regressions"
```

Do not create an empty commit when no correction was needed.

## Completion Definition

- All seven tasks are checked off.
- Workspace and Release Server persist business-level `publicUrl` and always derive site declarations.
- Nginx/Caddy only reverse proxy the Release Server origin; no cross-user static permissions are required.
- `gateway` is the only Gateway deployment command and a failed first install leaves no enabled service.
- Formal release visibility is stable-last, publicly verified, and rollback-safe.
- Duplicate hosts and external-port redirects are correct.
- Public launcher/core remain self-contained and all focused/full Node and Go suites pass.
- README, deployment docs, Wiki, homepage, and historical-spec status agree with running code.
