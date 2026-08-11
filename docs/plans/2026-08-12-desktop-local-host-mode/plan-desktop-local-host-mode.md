# Desktop Localhost Mode Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows Desktop-owned Localhost connection mode that serves the installed Workspace from a stable loopback origin and proxies the existing local Registry without requiring Gateway or changing Hub/Registry production code.

**Scope Source:** `docs/scope/2026-08-12-desktop-local-host-mode.md`

**Architecture:** Keep Gateway as the existing HTTPS branch and add an explicit Desktop config branch for Localhost. In Localhost, Desktop owns a fixed `127.0.0.1:9633` HTTP edge with a persisted secret Base Path, serves `~/.wheelmaker/web/local-index.html` plus hashed assets, proxies the Base Path `/ws` contract to fixed `127.0.0.1:9630`, and privately stores the Registry-issued opaque Session Cookie so WebView2 never receives it. Bind WebView bridge authorization to the exact Localhost origin/Base Path and committed navigation epoch.

**Tech Stack:** Go 1.26, Windows WebView2, Go `net/http`/`httputil.ReverseProxy`, Registry's existing HTTP/WebSocket contract, React/TypeScript, webpack 5, Jest, Node.js release tests, Markdown wiki.

**Verification:** Focused Go Desktop and real-Registry proxy tests, focused Web/Jest CSP and endpoint tests, Web production build inspection, Windows cross-build, server-wide and Web-wide regressions, release/deployment source gates, security acceptance, `git diff --check`, and protocol/config ownership review.

---

### Task 1: Persist the Gateway-versus-Desktop architecture boundary in the approved wiki target

**Files:**
- Modify: `docs/wiki/architecture/gateway.md`

**Acceptance:** The Gateway architecture page explains that Desktop Localhost is an EXE-only loopback presentation/proxy adapter, does not use or configure Gateway, does not read Hub config, and relies on the existing empty-`publicUrl`/loopback Registry deployment state without changing deployment ownership.

- [x] **Step 1: Re-read the approved spec and current Gateway wiki**

Extract only stable architectural facts: connection ownership, fixed ports, static/proxy data flow, authentication ownership, supported clients, and explicit deployment/Gateway exclusions.

- [x] **Step 2: Update the wiki before production implementation**

Add a concise Desktop Localhost section and update the layout/route discussion where needed. Preserve the existing Gateway lifecycle, schema, TLS, public route, and deployment documentation. Do not add a deployment mode or claim Hub config controls Desktop.

- [x] **Step 3: Verify wiki scope and formatting**

Run: `git diff --check -- docs/wiki/architecture/gateway.md`

Expected: exit 0; only the approved Gateway wiki target changes.

- [x] **Step 4: Git checkpoint**

After verification passes, invoke `git-workflow` in `checkpoint` mode for `docs/wiki/architecture/gateway.md`. Record commit hash + subject.

### Task 2: Emit a dedicated production Localhost Web document without changing Gateway CSP

**Files:**
- Modify: `app/web/public/index.html`
- Modify: `app/web/webpack.config.js`
- Modify: `app/__tests__/web-security-policy.test.ts`
- Modify: `app/__tests__/web-setup.test.js`
- Modify: `app/__tests__/web-registry-base-url.test.ts`

**Acceptance:** A production Web build emits `index.html` and `local-index.html` using the same hashed JS/CSS assets. Gateway HTML retains `wss:` and `upgrade-insecure-requests`; Localhost HTML permits same-origin `ws:`, omits upgrade, and retains all other restrictive directives. The existing Registry client derives the secret Base Path and loopback WebSocket endpoint from the local document URL.

- [x] **Step 1: Write failing Web build/CSP tests**

Extend the existing security/setup tests to require two `HtmlWebpackPlugin` outputs with shared entry assets and separate policy parameters. Assert the Localhost policy contains `connect-src 'self' ws: wss:` and excludes `upgrade-insecure-requests`, while the Gateway policy remains byte-for-byte equivalent in semantics. Extend the Registry endpoint table with a URL such as `http://127.0.0.1:9633/<secret>/` under explicit loopback allowance.

- [x] **Step 2: Run focused Jest tests to establish RED**

Run from `app/`: `npm test -- --runInBand __tests__/web-security-policy.test.ts __tests__/web-setup.test.js __tests__/web-registry-base-url.test.ts`

Expected: FAIL because `local-index.html` is not configured and the production template cannot receive distinct policies.

- [x] **Step 3: Parameterize the production template and add the Localhost output**

Replace the hard-coded CSP value in `public/index.html` with an escaped webpack template parameter. Configure one plugin for `index.html` with the current Gateway policy and one for `local-index.html` with the local policy; both must inject the same production chunks. Keep the development-server policy and preview-header exception intact.

- [x] **Step 4: Reach GREEN and inspect actual generated HTML**

Run the focused Jest command again.

Run from `app/` with a temporary `WHEELMAKER_WEB_TARGET`: `npm run build:web`

Inspect both generated documents and assert their script/style asset names match, the Gateway document still upgrades insecure requests, and the Localhost document allows `ws:` without upgrade.

- [x] **Step 5: Git checkpoint**

After verification passes, invoke `git-workflow` in `checkpoint` mode for the five Task 2 files. Do not commit generated Web output. Record commit hash + subject.

### Task 3: Add strict Desktop connection config and private Localhost credential state

**Files:**
- Modify: `server/cmd/wheelmaker-desktop/base_url_store.go`
- Modify: `server/cmd/wheelmaker-desktop/app_test.go`
- Create: `server/cmd/wheelmaker-desktop/localhost_state.go`
- Create: `server/cmd/wheelmaker-desktop/localhost_edge_test.go`

**Acceptance:** Desktop config accepts only `gateway`/`localhost`; Gateway owns `baseUrl`; a legacy valid `baseUrl` migrates to Gateway; an empty legacy file remains unselected; invalid combinations fail closed. A separate current-user-only atomic state file persists a high-entropy URL-safe Base Path and, when present, only the opaque Registry cookie value/expiry. Corrupt, expired, malformed, or oversized state is rejected without exposing secrets.

- [x] **Step 1: Write failing config migration and validation tests**

Add table-driven tests for empty config, legacy Gateway migration, normalized Gateway mode, Localhost without `baseUrl`, unknown mode, Localhost with `baseUrl`, and Gateway without a valid HTTPS URL. Assert persisted JSON names the explicit mode and never reads `~/.wheelmaker/config.json`.

- [x] **Step 2: Run focused config tests to establish RED**

Run from `server/`: `go test ./cmd/wheelmaker-desktop -run 'TestDesktop(ConnectionConfig|LegacyConfig|ConfigStore)'`

Expected: FAIL because `connectionMode` and strict normalization do not exist.

- [x] **Step 3: Implement the Desktop-only config contract**

Introduce typed connection-mode constants and one boundary normalization/migration function used after `Load`. Save explicit mode values atomically through the existing private config store. Do not add Hub config paths, Registry port fields, dynamic ports, or HTTP Gateway URL support.

- [x] **Step 4: Reach GREEN for connection config**

Run the focused config tests again.

Expected: PASS.

- [x] **Step 5: Write failing private credential-state tests**

In `localhost_edge_test.go`, cover first-run secret creation, restart stability, URL-safe entropy/segment validation, cookie capture fields, expiry, atomic `0600` behavior where observable, credential-only clearing, full removal on connection exit, corrupt/unknown/oversized JSON, and rejection of values containing control characters or a wrong cookie contract.

- [x] **Step 6: Run credential tests to establish RED**

Run from `server/`: `go test ./cmd/wheelmaker-desktop -run 'TestDesktopLocalhost(State|Credential)'`

Expected: FAIL because the Localhost state store does not exist.

- [x] **Step 7: Implement the minimal state store**

Use `crypto/rand`, base64url without padding, strict schema decoding/size bounds, explicit expiry checks, and `shared.WriteConfigFile`. Keep Token and CSRF absent from all state structures. Provide separate operations for clearing the Session while retaining the Base Path during invalidation and deleting all Localhost state when leaving the mode.

- [x] **Step 8: Run config/state regressions and checkpoint**

Run from `server/`: `go test ./cmd/wheelmaker-desktop -run 'TestDesktop(ConnectionConfig|LegacyConfig|ConfigStore|LocalhostState|LocalhostCredential)'`

Expected: PASS.

Invoke `git-workflow` in `checkpoint` mode for the four Task 3 files. Record commit hash + subject.

### Task 4: Build the fail-closed fixed-port Localhost static/proxy edge

**Files:**
- Create: `server/cmd/wheelmaker-desktop/localhost_edge.go`
- Modify: `server/cmd/wheelmaker-desktop/localhost_edge_test.go`
- Modify: `server/cmd/wheelmaker-desktop/app_test.go`

**Acceptance:** The edge binds only `127.0.0.1:9633`, validates `~/.wheelmaker/web/local-index.html`, requires the persisted secret Base Path and exact Host, provides safe static files plus SPA fallback, and proxies only that Base Path's `/ws` routes to fixed `http://127.0.0.1:9630`. It preserves HTTP/WebSocket/preview/download semantics, consumes the Registry Session Cookie natively, attaches it upstream, and clears it on logout or unauthenticated responses.

- [x] **Step 1: Write failing listener/static isolation tests**

Cover exact loopback/default addresses, fixed origin across restarts, missing `local-index.html`, occupied port, wrong Host, unknown/malformed/escaped Base Path, static hashed assets, directory/index denial, SPA fallback, response security headers, and graceful close. Use injectable test listener/upstream options only in package-private constructors; production defaults must remain constants.

- [x] **Step 2: Run static/listener tests to establish RED**

Run from `server/`: `go test ./cmd/wheelmaker-desktop -run 'TestDesktopLocalhost(Listener|Static|BasePath|Startup|StableOrigin)'`

Expected: FAIL because the edge does not exist.

- [x] **Step 3: Implement the listener and static handler**

Validate assets before exposing the URL, bind `tcp4` loopback at the fixed port, enforce exact Host and secret path, serve only files contained by the configured Web root, fall back to `local-index.html` only for eligible navigation requests, and return 404 outside the allowed namespace. Do not use `9632`, random ports, LAN listeners, embedded assets, or Gateway fallback.

- [x] **Step 4: Reach GREEN for listener/static behavior**

Run the focused listener/static tests again.

Expected: PASS.

- [x] **Step 5: Write failing real-Registry authentication/proxy tests**

Start `registry.New(...).Handler()` behind `httptest`, then exercise the Desktop edge contract for unauthenticated status, Token login, stripped `Set-Cookie`, stored opaque cookie, authenticated status after recreating the edge/state store, CSRF logout, revoked/rotated-session status, WebSocket authentication, file-download path, and HTML Preview response headers. Add upstream-unavailable and non-target-cookie negative cases. Assert request Token/body and CSRF are never persisted.

- [x] **Step 6: Run proxy tests to establish RED**

Run from `server/`: `go test ./cmd/wheelmaker-desktop -run 'TestDesktopLocalhost(Proxy|Registry|Session|WebSocket|Download|Preview)'`

Expected: FAIL until reverse proxy and native cookie handling are implemented.

- [x] **Step 7: Implement the fixed Registry adapter**

Use a narrowly configured `httputil.ReverseProxy` targeting `127.0.0.1:9630`; preserve the external Host/Origin contract, set trusted loopback forwarding metadata, remove client cookies, and attach only the validated stored Registry cookie. In response modification, consume and strip the target `Secure` cookie, persist it before success reaches WebView, inspect only bounded auth-status JSON for `authenticated:false`, and clear credentials on logout deletion or unauthorized responses. Preserve WebSocket upgrade and upstream Preview/download headers.

- [x] **Step 8: Verify the complete edge and checkpoint**

Run from `server/`: `go test ./cmd/wheelmaker-desktop -run 'TestDesktopLocalhost'`

Expected: PASS with the real Registry handler contract and all fail-closed cases.

Invoke `git-workflow` in `checkpoint` mode for the three Task 4 files. Record commit hash + subject.

### Task 5: Wire the Desktop connection selector, runtime lifecycle, and retry/change behavior

**Files:**
- Modify: `server/cmd/wheelmaker-desktop/app.go`
- Modify: `server/cmd/wheelmaker-desktop/main.go`
- Modify: `server/cmd/wheelmaker-desktop/desktop_runtime.go`
- Modify: `server/cmd/wheelmaker-desktop/desktop_bridge.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows.go`
- Modify: `server/cmd/wheelmaker-desktop/bootstrap/index.html`
- Modify: `server/cmd/wheelmaker-desktop/app_test.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows_test.go`
- Modify: `scripts/release/android.test.mjs`

**Acceptance:** Only Desktop Bootstrap exposes `Gateway` and `Localhost`. Android/non-Desktop retains the current Gateway-only URL flow. Selecting Localhost saves Desktop mode without an address, starts the edge, and navigates its secret URL; startup failures preserve the selected mode and expose Retry/Change Connection. Legacy Gateway startup and HTTPS probe/save behavior remain unchanged. Explicit connection change logs out/clears site data, closes the edge, removes Localhost credential state, and returns to an unselected selector.

- [ ] **Step 1: Write failing Bootstrap capability and runtime transition tests**

Require `connectionMode`/`supportsLocalhost` in Desktop state, a Desktop-only Localhost selection binding, explicit selector UI, no URL field for Localhost, existing Gateway validation, and state-driven Retry/Change Connection. Test saved Gateway direct launch, saved Localhost edge launch without Gateway probe, Localhost startup failure retention, Retry success, mode switching cleanup order, Local Dev enter/exit returning to the selected connection, and edge shutdown after the Desktop window exits.

- [ ] **Step 2: Lock Android compatibility before implementation**

Extend `scripts/release/android.test.mjs` to assert the shared Bootstrap still uses postMessage capability detection and does not assume the Desktop-only Localhost method exists. Run: `node --test scripts/release/android.test.mjs`

Expected: the new assertions are RED until the selector is capability-gated; no Android production source is modified.

- [ ] **Step 3: Run focused Desktop tests to establish RED**

Run from `server/`: `go test ./cmd/wheelmaker-desktop -run 'TestDesktop(Bootstrap|Connection|LocalhostLaunch|Runtime|ServerSwitch|LocalDev)'`

Expected: FAIL because the selector action and edge lifecycle are not wired.

- [ ] **Step 4: Implement the capability-gated selector and lifecycle**

Extend Desktop bootstrap state/results and direct bindings with an explicit Localhost capability/action. Keep Android's generic bridge path Gateway-only when the capability is absent. Inject a package-private edge factory into runtime tests while `main` constructs canonical defaults. Save mode before attempting Localhost startup, retain it on failure, reuse/restart the fixed edge on Retry, and never probe/fallback to Gateway.

- [ ] **Step 5: Preserve explicit switch and Local Dev semantics**

Generalize the existing switch helper from server URL to connection target while retaining best-effort Registry logout and complete WebView site-data cleanup. For Localhost, use the edge's native credential/logout path, close the listener, remove Localhost state, clear Desktop config/authorization, and show the selector. Make Local Dev exit restore either Gateway or the active Localhost URL without granting Local Dev production capabilities.

- [ ] **Step 6: Reach GREEN and checkpoint**

Run the focused Desktop command again.

Run: `node --test scripts/release/android.test.mjs`

Expected: PASS; Android behavior remains Gateway-only.

Invoke `git-workflow` in `checkpoint` mode for the Task 5 files that changed. Record commit hash + subject.

### Task 6: Authorize only the exact committed Localhost page and expose the production Desktop bridge

**Files:**
- Modify: `server/cmd/wheelmaker-desktop/webview_policy.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_policy_test.go`
- Modify: `server/cmd/wheelmaker-desktop/desktop_bridge.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_profile_windows.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows_test.go`
- Modify: `server/cmd/wheelmaker-desktop/app_test.go`

**Acceptance:** Localhost has its own trusted page mode and exact fixed-origin/secret-prefix policy. Only a committed top-level navigation in the current epoch receives the normal production Desktop bridge. Wrong paths/origins, iframes, stale/rejected navigation, Bootstrap, Local Dev, dangerous schemes, and arbitrary local pages cannot inherit it. Navigation failures return to the correct Bootstrap failure state without weakening HTTPS remote policy.

- [ ] **Step 1: Write failing Localhost policy/epoch tests**

Add table cases for exact Localhost root/child/preview/download URLs; wrong port/host/scheme; prefix confusion; path cleaning/encoding; query/fragment rules; main frame versus iframe; committed versus stale/rejected epochs; external window handling; Bootstrap and Local Dev action separation; and certificate-error behavior for Gateway. Assert Localhost receives the same production actions as trusted remote, excluding Local Dev operations.

- [ ] **Step 2: Run policy tests to establish RED**

Run from `server/`: `go test ./cmd/wheelmaker-desktop -run 'TestDesktop(LocalhostPolicy|LocalhostPage|BridgeNavigationEpoch|NavigationPolicy)'`

Expected: FAIL because Localhost is not a distinct page mode.

- [ ] **Step 3: Implement exact Localhost WebView policy**

Add a Localhost policy constructor from the edge URL, require `http://127.0.0.1:9633` and the exact normalized secret Base Path, and keep navigation/bridge decisions tied to the security state's current mode and committed epoch. Do not broaden the existing HTTPS policy or `4173` Local Dev policy.

- [ ] **Step 4: Write failing runtime-script/Windows adapter tests**

Assert the initialization script exposes the normal `WheelMakerDesktop` object on exact Localhost pages, remains inert on arbitrary HTTP origins/paths, and does not leak Bootstrap or Local Dev bindings. Assert the adapter reports Localhost navigation failure text and keeps site-data cleanup scoped to explicit connection changes.

- [ ] **Step 5: Implement bridge injection and adapter behavior**

Generate the Localhost script predicate from the authorized fixed URL/Base Path rather than accepting generic loopback HTTP. Reuse the production remote bridge action list for the Localhost mode. Keep all native binding functions guarded by `AuthorizeCurrent` and avoid writing Base Path or credentials into logs/diagnostics.

- [ ] **Step 6: Run Desktop policy/runtime regressions and checkpoint**

Run from `server/`: `go test ./cmd/wheelmaker-desktop`

Expected: PASS.

Invoke `git-workflow` in `checkpoint` mode for the Task 6 files that changed. Record commit hash + subject.

### Task 7: Close release, security, deployment, and compatibility acceptance

**Files:**
- Modify: `server/cmd/wheelmaker-desktop/app_test.go`
- Modify: `app/__tests__/web-security-policy.test.ts`
- Modify: `app/__tests__/web-setup.test.js`
- Review: `scripts/release/build.mjs`
- Review: `scripts/release/build.test.mjs`
- Review: `scripts/deploy/`
- Review: `server/internal/hub/`
- Review: `server/internal/registry/`
- Review: `docs/scope/2026-08-12-desktop-local-host-mode.md`
- Modify: `docs/plans/2026-08-12-desktop-local-host-mode/plan-desktop-local-host-mode.md`

**Acceptance:** Standard Web release output includes the Localhost document; Desktop remains a standalone EXE and reads installed Web assets at runtime; old `9632`, insecure TLS bypass, non-loopback Registry exposure, Hub/Registry/Android production changes, deployment mode changes, and protocol changes remain absent. All accepted behavior has reproducible passing evidence and plan checkboxes reflect actual completion.

- [ ] **Step 1: Update source gates for the intentional local edge**

Replace the obsolete blanket “no Desktop asset server” assertion with precise invariants: `9633` is loopback-only, Web assets are not embedded in the EXE, `9632` and retired source-selection/fallback symbols remain forbidden, Gateway URLs remain HTTPS-only, and Desktop source contains no Hub config read. Keep credential-value leakage checks.

- [ ] **Step 2: Verify focused Desktop and Web behavior**

Run from `server/`: `go test ./cmd/wheelmaker-desktop`

Run from `app/`: `npm test -- --runInBand __tests__/web-security-policy.test.ts __tests__/web-setup.test.js __tests__/web-registry-base-url.test.ts`

Run from `app/`: `npm run tsc:web`

Expected: PASS.

- [ ] **Step 3: Verify release output and Windows build**

Run: `node --test scripts/release/build.test.mjs scripts/release/android.test.mjs scripts/release/entry.test.mjs`

Run from `server/`: `$env:GOOS='windows'; $env:GOARCH='amd64'; $env:CGO_ENABLED='0'; go test ./cmd/wheelmaker-desktop; go build -trimpath -o <temporary-path>/WheelMakerDesktop.exe ./cmd/wheelmaker-desktop`

Build Web to a temporary target and assert `index.html` plus `local-index.html` are present while `WheelMakerDesktop.exe` contains no bundled Workspace output.

- [ ] **Step 4: Run broad regression suites**

Run from `server/`: `go test ./...`

Run from `app/`: `npm test -- --runInBand`

Run: `node --test scripts/deploy/deploy-core.test.mjs scripts/deploy/deploy.test.mjs`

Expected: PASS; deployment behavior is unchanged.

- [ ] **Step 5: Run security and ownership gates**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_security_acceptance_ps1.ps1`

Run the repository security acceptance command if its required local tools are available; otherwise report the exact unavailable prerequisite and preserve the focused security evidence.

Run: `git diff --check`

Run source/diff checks proving no production changes under `scripts/deploy/`, `server/internal/hub/`, `server/internal/registry/`, or Android runtime; no `ProtocolVersion` change; no `:9632`/`InsecureSkipVerify`; and no new LAN listener.

- [ ] **Step 6: Perform a Windows smoke test**

With installed Web assets and a local Registry on `127.0.0.1:9630`, launch Desktop twice in Localhost mode. Verify fixed origin, Token login, session reuse, Web storage continuity, authenticated WebSocket, preview/download, port-conflict error, Retry, and Change Connection cleanup. Record any environment-limited checks separately from automated evidence.

- [ ] **Step 7: Review every spec acceptance criterion and finish plan checkboxes**

Inspect `git status -sb`, `git diff --stat`, task-owned diffs, generated-output exclusions, and the approved spec. Update only the already approved Gateway wiki target if the implementation introduced a stable fact missing from Task 1.

- [ ] **Step 8: Invoke `git-workflow` finalize**

Pass the truthful result (`complete`, `verification_failed`, `blocked`, or `awaiting_review`) and all verification evidence. Follow configured refresh/rebase, final commit, feature-branch push, clean-main merge/push, and cleanup behavior. Report every commit SHA/subject and every skipped action with its reason.
