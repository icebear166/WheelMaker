# Gateway Custom Caddy Sites Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the embedded Gateway into the host's sole Caddy edge by atomically combining WheelMaker-managed routes with trusted operator-owned site-level Caddyfile fragments.

**Scope Source:** `docs/scope/2026-08-12-gateway-custom-caddy-sites.md`

**Architecture:** Keep Gateway schema 2, Hub-derived WheelMaker state, admin/storage/log ownership, and `generated/caddy.json` as the managed runtime artifact. Add `gateway/sites/*.caddy` as a separate user-owned source, synthesize one controlled root Caddyfile, adapt it through embedded Caddy v2, validate managed boundaries and the final JSON, then hot-load and promote the candidate atomically.

**Tech Stack:** Go 1.24, embedded Caddy v2.11, Caddyfile adapter, Node.js deployment scripts/tests, Markdown documentation.

**Verification:** `go test ./internal/gateway ./cmd/wheelmaker-gateway`, `go test ./...`, focused Node `--test` suites for Gateway deployment, `git diff --check`, and generated-config semantic assertions.

---

### Task 1: Persist the Gateway architecture contract in the approved wiki target

**Files:**
- Modify: `docs/wiki/architecture/gateway.md`

**Acceptance:** The Gateway wiki describes `sites/*.caddy` ownership, supported standard site-level capabilities, managed global exclusions, conflict rules, one-bundle validation/hot-load behavior, generated artifact semantics, and manual Nginx migration without adding unconfirmed behavior.

- [x] **Step 1: Re-read the approved spec and current Gateway wiki**

Confirm the stable facts that belong in long-lived architecture documentation and retain the page's existing summary and section organization.

- [x] **Step 2: Update the wiki before production implementation**

Document the source layout and flow:

```text
Hub/Gateway config -> managed source --+
sites/*.caddy + imports ---------------+-> Caddyfile adapter -> boundary/Caddy validation -> active JSON
```

State explicitly that global options/raw JSON/non-embedded modules are rejected, unique custom hostnames may share 80/443, invalid runtime candidates retain the last accepted bundle, and Nginx migration remains manual.

- [x] **Step 3: Verify wiki scope and formatting**

Run: `git diff --check -- docs/wiki/architecture/gateway.md`

Expected: exit 0; only the confirmed Gateway architecture target changes.

- [x] **Step 4: Git checkpoint**

After verification passes, invoke `git-workflow` in `checkpoint` mode for `docs/wiki/architecture/gateway.md`. Record commit hash + subject.

### Task 2: Establish the cross-platform custom-sites layout without changing schema 2

**Files:**
- Modify: `server/internal/gateway/types.go`
- Modify: `server/internal/gateway/gateway_test.go`
- Modify: `server/cmd/wheelmaker-gateway/main.go`
- Modify: `server/cmd/wheelmaker-gateway/main_test.go`
- Modify: `scripts/deploy/deploy-core.mjs`
- Modify: `scripts/deploy/gateway-config.test.mjs`

**Acceptance:** Go and Node path resolvers expose the same `gateway/sites` root; `EnsureHome` and Gateway installation create it idempotently; existing files are byte-for-byte preserved; `paths` prints it; schema-2 JSON remains unchanged.

- [x] **Step 1: Write failing Go path/layout tests**

Extend `TestResolvePathsUsesFixedGatewayHomeLayout`, `TestResolvePathsDerivesRuntimeRoots`, and `TestRunPathsPrintsStableLayout` with assertions equivalent to:

```go
if paths.CustomSitesRoot != filepath.Join(home, "sites") {
	t.Fatalf("CustomSitesRoot = %q", paths.CustomSitesRoot)
}
if output["customSitesRoot"] != filepath.Join(home, "sites") {
	t.Fatalf("customSitesRoot = %q", output["customSitesRoot"])
}
```

Add an `EnsureHome` assertion that the directory exists and a pre-existing `.caddy` file retains its exact bytes.

- [x] **Step 2: Run the focused Go tests to establish RED**

Run: `go test ./internal/gateway ./cmd/wheelmaker-gateway -run 'TestResolvePaths|TestEnsureHome|TestRunPaths'`

Expected: FAIL because `CustomSitesRoot`/`customSitesRoot` and directory creation do not exist.

- [x] **Step 3: Implement the Go layout contract**

Add `CustomSitesRoot` to `gateway.Paths`, resolve it as `<gateway-home>/sites`, create it from `EnsureHome`, and include `customSitesRoot` in the `paths` command JSON. Do not alter `GlobalConfig`, `GlobalSchemaVersion`, or Gateway config decoding.

- [x] **Step 4: Run the focused Go tests to reach GREEN**

Run: `go test ./internal/gateway ./cmd/wheelmaker-gateway -run 'TestResolvePaths|TestEnsureHome|TestRunPaths'`

Expected: PASS.

- [x] **Step 5: Write failing Node deployment tests**

Extend `gateway-config.test.mjs` so `gatewayConfigPaths(home).customSitesRoot` equals `join(home, 'sites')`, the first `ensureGatewayConfiguration(home)` creates the directory, and a second call preserves a sentinel `sites/existing.caddy` byte-for-byte while the normalized config remains exactly schema 2.

- [x] **Step 6: Run the focused Node test to establish RED**

Run: `node --test scripts/deploy/gateway-config.test.mjs`

Expected: FAIL because the sites path/directory is absent.

- [x] **Step 7: Implement deployment layout initialization**

Add `customSitesRoot` to `gatewayConfigPaths`, create it recursively in the Gateway-specific ensure/install path, and leave its contents untouched. Do not inspect Nginx, create example sites, or add JSON config fields.

- [x] **Step 8: Run layout regressions**

Run: `go test ./internal/gateway ./cmd/wheelmaker-gateway`

Run: `node --test scripts/deploy/gateway-config.test.mjs scripts/deploy/gateway-single-config.test.mjs scripts/deploy/gateway-install.test.mjs`

Expected: PASS.

- [x] **Step 9: Git checkpoint**

After verification passes, invoke `git-workflow` in `checkpoint` mode for the six Task 2 files. Record commit hash + subject.

### Task 3: Compile managed and custom Caddyfile sources into one validated config

**Files:**
- Create: `server/internal/gateway/caddyfile.go`
- Modify: `server/internal/gateway/compiler.go`
- Modify: `server/internal/gateway/runtime.go`
- Modify: `server/internal/gateway/gateway_test.go`
- Modify: `server/internal/gateway/single_config_test.go`

**Acceptance:** `LoadBundle` deterministically imports top-level `sites/*.caddy`, preserves standard site-level Caddyfile semantics and source diagnostics, produces one valid JSON config containing managed and custom routes, tracks all source dependencies under `sites`, and rejects global options, non-embedded modules, managed hostname duplication, catch-all interception, and reserved listener use.

- [x] **Step 1: Add failing happy-path adapter tests**

In existing Gateway tests, create a temporary Home with schema-2/Hub config plus custom files that exercise a unique HTTPS hostname, `reverse_proxy`, WebSocket-compatible proxying, `file_server`, matcher/`handle`, `rewrite`, `header`, a named snippet imported by a site, an imported nested file, and `tls internal`. Assert:

```go
bundle, err := LoadBundle(home)
if err != nil { t.Fatal(err) }
for _, expected := range []string{
	"custom.example.com", "reverse_proxy", "file_server", "headers", "rewrite", "pki",
} {
	if !bytes.Contains(bundle.JSON, []byte(expected)) {
		t.Fatalf("compiled JSON missing %q", expected)
	}
}
if err := ValidateJSON(bundle.JSON); err != nil { t.Fatal(err) }
```

Compile the same disk state twice and assert equal JSON and equal ordered dependency paths.

- [x] **Step 2: Run happy-path tests to establish RED**

Run: `go test ./internal/gateway -run 'TestLoadBundleIncludesCustomCaddySites|TestCustomCaddyCompilationIsDeterministic'`

Expected: FAIL because custom Caddyfile loading/adaptation is not implemented.

- [x] **Step 3: Introduce the custom-source and adapted-candidate model**

Create `caddyfile.go` with focused types for source files/dependencies, adapter warnings, and the adapted candidate. Enumerate only top-level `*.caddy` entrypoints in lexical path order; allow native imports/snippets while requiring every imported file resolved from user input to remain under `CustomSitesRoot`, so recursive directory hashing covers content and import-glob membership deterministically. Preserve Caddy token file/line metadata in returned warnings/errors.

- [x] **Step 4: Render the existing managed behavior as controlled Caddyfile source**

Refactor the compiler so the synthetic root owns exactly one global options block and emits Registry, Release, Share, and Relay routes with the existing matcher order, static roots, upstreams, headers, cache rules, compression, SPA fallback, redirects, TLS certificate policy, Relay marker replacement, admin `127.0.0.1:2019`, storage root, and log level. Keep `CompileConfig`/`CompileConfigAt` as managed-only compatibility entrypoints used by existing tests, but route them through the same adapter/validation implementation as `LoadBundle`.

- [x] **Step 5: Adapt and validate the combined source**

Use `caddyconfig.GetAdapter("caddyfile")` registered by embedded standard modules. Adapt the controlled root plus imports to JSON, surface adapter warnings, decode and re-assert the managed admin/storage/log/listener boundaries, then call `ValidateJSON`. Extend `ConfigBundle` with warnings, ordered dependencies, and a content fingerprint needed by commands/runtime.

- [x] **Step 6: Run managed and custom happy-path regressions**

Run: `go test ./internal/gateway -run 'TestCompileConfig|TestLoadBundle|TestCustomCaddy|TestGatewayConfigIncludesReleaseRuntimeFields'`

Expected: PASS, including existing managed-route semantic assertions.

- [x] **Step 7: Add failing boundary and diagnostic tests**

Use table-driven cases for:

```text
global options block
unknown third-party directive
same managed hostname with different case/scheme/explicit port
hostless :80 and :443 catch-all
listeners on :2019, :9630, :9680, and the configured Relay port
import path escaping CustomSitesRoot
syntax error in a directly loaded and an imported file
```

Each case must assert rejection before load, the offending file and positive line number, and the relevant hostname/port/managed owner. Add a control case proving `reverse_proxy 127.0.0.1:9630` is allowed because it is an upstream, not a listener.

- [x] **Step 8: Run boundary tests to establish RED**

Run: `go test ./internal/gateway -run 'TestCustomCaddyRejects|TestCustomCaddyAllowsManagedLoopbackUpstream'`

Expected: FAIL until semantic boundary validation exists.

- [x] **Step 9: Implement minimal managed-boundary validation**

Validate case-insensitive hostnames independently of scheme/port, reject hostless listeners that overlap managed listeners, reject custom listener ports 2019/9630/9680/current Relay, and retain source positions from parsed Caddyfile tokens. Do not forbid unique custom hostnames sharing 80/443 or proxy upstreams using reserved loopback service ports.

- [x] **Step 10: Verify compiler and bundle behavior**

Run: `go test ./internal/gateway`

Expected: PASS.

- [x] **Step 11: Git checkpoint**

After verification passes, invoke `git-workflow` in `checkpoint` mode for the Task 3 files. Record commit hash + subject.

### Task 4: Make CLI and runtime acceptance atomic across source changes and load failures

**Files:**
- Modify: `server/internal/gateway/runtime.go`
- Modify: `server/internal/gateway/single_config_test.go`
- Modify: `server/cmd/wheelmaker-gateway/main.go`
- Modify: `server/cmd/wheelmaker-gateway/main_test.go`

**Acceptance:** `validate`, `render`, cold `serve`, and watcher reload share the same candidate builder; warnings are visible; config/input/import changes trigger reload; invalid candidates and injected reload/write failures preserve the active config and accepted `generated/caddy.json`; cold-start bind/load failure does not promote a candidate.

- [x] **Step 1: Add failing command-level tests**

Extend `main_test.go` to prove:

```go
validate: valid custom site -> "valid" and warnings on stderr when present
validate: invalid imported file -> error names imported file and line
render: valid bundle -> atomically writes bundle.JSON and returns generated path
render: invalid bundle -> prior generated bytes remain unchanged
paths: customSitesRoot remains exposed
```

- [x] **Step 2: Run command tests to establish RED**

Run: `go test ./cmd/wheelmaker-gateway -run 'TestRunValidate|TestRunRender|TestRunPaths'`

Expected: FAIL for custom diagnostics/warnings and invalid-render preservation gaps.

- [x] **Step 3: Unify command candidate handling**

Add one command helper that calls `EnsureHome` where mutation is intended, loads the same `ConfigBundle`, prints every adapter warning with source position, and only calls `WriteGenerated` after complete validation. `validate` remains read-only with respect to generated output; `render` keeps the previous file on every candidate error.

- [x] **Step 4: Run command tests to reach GREEN**

Run: `go test ./cmd/wheelmaker-gateway -run 'TestRunValidate|TestRunRender|TestRunPaths'`

Expected: PASS.

- [x] **Step 5: Add failing runtime state-transition tests**

Refactor runtime side effects behind package-local injectable functions or a small runner interface, then test these transitions without public ports:

```text
valid initial candidate -> start succeeds -> generated JSON promoted
invalid file after start -> active JSON and generated bytes unchanged
fixed file -> hot-load succeeds -> generated bytes promoted
reload returns error -> active/generated state and accepted fingerprint unchanged
promotion write returns error -> stop/fail cold start or reload the prior accepted runtime config
create/rename/delete/import change -> semantic fingerprint changes
```

- [x] **Step 6: Run runtime tests to establish RED**

Run: `go test ./internal/gateway -run 'TestRunManaged|TestSemanticFingerprint|TestAcceptedGeneratedConfig'`

Expected: FAIL because the current watcher only tracks two JSON files and writes generated JSON before reload.

- [x] **Step 7: Implement atomic runtime acceptance**

Replace metadata-only fingerprinting with deterministic content hashing of Gateway config, Hub config, the recursive custom-sites tree, and validated import membership. On cold start, run the candidate before promotion and stop/fail if promotion cannot complete. On reload, stage the candidate file, call Caddy load, atomically promote `generated/caddy.json`, and update the accepted fingerprint only after both succeed. If promotion fails after Caddy accepted the candidate, immediately reload the prior accepted JSON and report the promotion error; tests must prove the prior runtime/generated pair is restored. Retain and retry the candidate on every rejected transition.

- [x] **Step 8: Run runtime and CLI regressions**

Run: `go test ./internal/gateway ./cmd/wheelmaker-gateway`

Expected: PASS.

- [x] **Step 9: Git checkpoint**

After verification passes, invoke `git-workflow` in `checkpoint` mode for the Task 4 files. Record commit hash + subject.

### Task 5: Document operation and lock deployment/Nginx compatibility

**Files:**
- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `scripts/deploy/gateway-config.test.mjs`
- Modify: `scripts/deploy/gateway-install.test.mjs`

**Acceptance:** Operators have a copyable custom-site example and a safe validate/stop-Nginx/start-Gateway sequence; tests prove deployment preserves custom files and never gains Nginx lifecycle behavior.

- [x] **Step 1: Add explicit deployment preservation assertions**

Extend Node tests to seed nested Caddy fragments before both configuration ensure and install, then assert exact bytes afterward. Assert Gateway install runner calls do not contain `nginx`, `disable-nginx`, or reads of Nginx config paths.

- [x] **Step 2: Run deployment tests before documentation changes**

Run: `node --test scripts/deploy/gateway-config.test.mjs scripts/deploy/gateway-install.test.mjs scripts/deploy/gateway-runtime.test.mjs`

Expected: PASS for existing behavior and RED only for newly added sites-directory preservation assertions until Task 2/5 wiring is complete.

- [x] **Step 3: Write operator documentation matching executable behavior**

Add a minimal example such as:

```caddyfile
app.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Document the standard embedded-module boundary, managed global exclusions, automatic/custom site TLS, `paths`, offline `validate`, atomic reload/error behavior, generated JSON ownership, and the explicit migration sequence. Keep the existing standalone Nginx mode documented for operators who choose not to deploy Gateway; do not claim Gateway auto-converts or stops it.

- [x] **Step 4: Run deployment and documentation checks**

Run: `node --test scripts/deploy/gateway-config.test.mjs scripts/deploy/gateway-single-config.test.mjs scripts/deploy/gateway-install.test.mjs scripts/deploy/gateway-runtime.test.mjs`

Run: `git diff --check -- README.md INSTALL.md scripts/deploy/deploy-core.mjs scripts/deploy/gateway-config.test.mjs scripts/deploy/gateway-install.test.mjs`

Expected: PASS.

- [x] **Step 5: Git checkpoint**

After verification passes, invoke `git-workflow` in `checkpoint` mode for the Task 5 files that changed. Record commit hash + subject.

### Task 6: Close every acceptance criterion and finalize Git delivery

**Files:**
- Modify: `docs/plans/2026-08-12-gateway-custom-caddy-sites/plan-gateway-custom-caddy-sites.md`
- Review: all task-owned files and `docs/scope/2026-08-12-gateway-custom-caddy-sites.md`

**Acceptance:** Every spec requirement maps to passing evidence, plan checkboxes reflect actual work, no task-external changes are included, and configured commit/push/merge/cleanup behavior completes or is reported accurately.

- [x] **Step 1: Run focused Gateway verification**

Run: `go test ./internal/gateway ./cmd/wheelmaker-gateway`

Run: `node --test scripts/deploy/gateway-config.test.mjs scripts/deploy/gateway-single-config.test.mjs scripts/deploy/gateway-install.test.mjs scripts/deploy/gateway-runtime.test.mjs scripts/release/gateway.test.mjs`

Expected: PASS.

- [x] **Step 2: Run the server-wide regression suite**

Run from `server/`: `go test ./...`

Expected: PASS.

- [x] **Step 3: Verify source, docs, schema, and protocol boundaries**

Run: `git diff --check`

Run: `rg -n 'GlobalSchemaVersion|GATEWAY_SCHEMA|ProtocolVersion' server scripts docs/wiki/architecture/gateway.md`

Expected: no whitespace errors; Gateway remains schema 2; Registry protocol version is unchanged; documentation matches the implemented paths/commands.

- [x] **Step 4: Review spec acceptance evidence and finish plan checkboxes**

Record the exact passing commands and inspect `git status -sb`, `git diff --stat`, and task-owned diffs. Confirm no pre-existing/user changes were present at prepare and no unrelated files entered the task.

- [x] **Step 5: Final wiki accuracy pass**

If implementation introduced additional stable facts within the already approved `docs/wiki/architecture/gateway.md` target, update only that page and rerun its formatting check; otherwise record that the first wiki sync remains accurate.

- [x] **Step 6: Invoke `git-workflow` finalize**

Pass the truthful result (`complete`, `verification_failed`, `blocked`, or `awaiting_review`) and all verification evidence. Follow configured behavior for final commit, refresh/rebase, feature-branch push, clean-main merge/push, and cleanup; report every commit SHA/subject and each skipped action with its reason.
