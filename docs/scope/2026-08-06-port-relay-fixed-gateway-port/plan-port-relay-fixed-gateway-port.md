# Fixed Gateway Port Port Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ] syntax) for tracking.

**Goal:** Move Port Relay's public data-plane listener from per-enable Registry sockets to one fixed Gateway/Caddy listener, while also supporting a client-managed port behind manually configured Nginx when Gateway is absent, preserving the existing Registry, Hub, App, access-code, and frame contracts.

**Architecture:** gateway/config.json owns an optional relay.listenPort when Gateway is present. Gateway compiles a separate HTTP or HTTPS Caddy server for that port and proxies every URI to Registry loopback 9630 with X-WheelMaker-Relay: 1. When the Gateway config is absent, Registry enters client-managed mode for a manually configured Nginx edge and accepts enable.listenPort. Registry routes marked requests into the existing portrelay.Controller and keeps only the loopback listener; Gateway-managed enable.listenPort must match the configured port.

**Tech Stack:** Go, embedded Caddy v2.11.4, Gorilla WebSocket, Registry 2.7 Go protocol, React 19, TypeScript, Jest, React Test Renderer.

---

## Files and ownership

- Gateway configuration and Caddy JSON: server/internal/gateway/types.go, server/internal/gateway/compiler.go, server/internal/gateway/gateway_test.go.
- Registry-to-Gateway configuration wiring: server/internal/registry/gateway_relay_config.go, server/internal/registry/server.go, server/cmd/wheelmaker/main.go, and their tests.
- Relay controller/data plane: server/internal/portrelay/types.go, server/internal/portrelay/listener.go, server/internal/portrelay/listener_test.go.
- Caddy-to-Registry routing: server/internal/registry/http_routes.go and server/internal/registry/server_test.go.
- Web server-port ownership: app/web/src/app/WorkspaceApp.tsx, app/web/src/settings/PortRelaySettingsDetail.tsx, app/web/src/portRelay/portRelayUrl.ts, and focused Web tests.
- End-to-end proxy coverage: server/internal/gateway/relay_integration_test.go.
- Long-lived decisions were synchronized before this plan in docs/wiki/architecture/gateway.md and docs/wiki/protocols/registry.md.

## Task 1: Add fixed Relay configuration and Caddy route compilation

**Files:**
- Modify: server/internal/gateway/types.go
- Modify: server/internal/gateway/compiler.go
- Test: server/internal/gateway/gateway_test.go

- [ ] **Step 1: Write the failing Gateway configuration tests**

Add tests that express the public configuration contract before adding the types:

~~~
func TestLoadGlobalReadsFixedRelayPort(t *testing.T) {
    global, err := LoadGlobal(strings.NewReader("{\"schema\":1,\"relay\":{\"listenPort\":28810},\"log\":{\"level\":\"INFO\"}}"))
    if err != nil {
        t.Fatalf("LoadGlobal(): %v", err)
    }
    if global.Relay.ListenPort != 28810 {
        t.Fatalf("Relay.ListenPort=%d, want 28810", global.Relay.ListenPort)
    }
}

func TestValidateGlobalRejectsReservedRelayPorts(t *testing.T) {
    for _, port := range []int{80, 443, 9630, 9680, 2019, -1, 65536} {
        err := ValidateGlobal(GlobalConfig{
            Schema: GlobalSchemaVersion,
            Relay:  RelayConfig{ListenPort: port},
            Log:    LogConfig{Level: "INFO"},
        })
        if err == nil {
            t.Fatalf("ValidateGlobal(port=%d)=nil, want rejection", port)
        }
    }
}
~~~

Add compiler tests for an HTTP Workspace, an HTTPS Workspace, and no Workspace site. Each test must decode generated JSON and assert the separate relay server has only the fixed listener, the Workspace hostname matcher, the Registry upstream, and X-WheelMaker-Relay: 1; it must not contain Workspace static-file handlers. The HTTPS assertion must find a tls_connection_policies entry matching the Workspace hostname.

- [ ] **Step 2: Run the Gateway tests and verify the intended RED result**

Run from server:

~~~
go test ./internal/gateway -run 'Test(LoadGlobalReadsFixedRelayPort|ValidateGlobalRejectsReservedRelayPorts|CompileConfig.*Relay)' -count=1
~~~

Expected result: compilation fails because GlobalConfig.Relay, RelayConfig, and the fixed Relay compiler output do not exist yet. Do not change production code until this failure is observed.

- [ ] **Step 3: Implement the minimum Gateway configuration model**

Add the additive schema-1 field without changing GlobalSchemaVersion:

~~~
type GlobalConfig struct {
    Schema int         `json:"schema"`
    ACME   ACMEConfig  `json:"acme"`
    Log    LogConfig   `json:"log"`
    Relay  RelayConfig `json:"relay,omitempty"`
}

type RelayConfig struct {
    ListenPort int `json:"listenPort,omitempty"`
}
~~~

Extend ValidateGlobal so 0 means disabled and every nonzero value is in 1..65535 and not 80, 443, 9630, 9680, or 2019. Keep strict JSON decoding and the existing schema version unchanged.

- [ ] **Step 4: Implement the separate fixed Caddy server**

Change compileHTTPApp to receive GlobalConfig, locate the single SiteWorkspace, and add a separate relay server only when global.Relay.ListenPort > 0 and the Workspace site exists. Put the server in the HTTP app's servers map instead of adding the port to the existing http or https server, so Relay traffic cannot reach static Workspace handlers.

Use a dedicated Relay route with request-header handlers enforcing this contract. Caddy's HeaderOps applies `set` before `delete` within one handler, so delete the incoming marker in one handler and set the exact marker in the following handler:

~~~
"headers": map[string]any{
    "request": map[string]any{
        "delete": []string{"X-WheelMaker-Relay"},
    },
}
~~~

The following headers handler sets `X-WheelMaker-Relay: 1` and `X-Forwarded-Proto: {http.request.scheme}` before the reverse proxy handler. For an HTTP Workspace, set the Relay server's `automatic_https.disable` flag so the fixed HTTP port is not upgraded or redirected.

The Relay server route must use the Workspace hostname matcher, preserve incoming URI/query, and reverse proxy to the existing Workspace upstream. For an HTTPS Workspace, attach a hostname-matched tls_connection_policies entry to the fixed server and the existing HTTPS server using the same TLS automation/certificate app. For an HTTP Workspace, add the fixed server to the HTTP server set with no redirect handler.

- [ ] **Step 5: Run Gateway tests and the existing package suite**

~~~
gofmt -w internal/gateway/types.go internal/gateway/compiler.go internal/gateway/gateway_test.go
go test ./internal/gateway -run 'Relay|TLS|CompileConfig' -count=1
go test ./internal/gateway -count=1
~~~

Expected result: all focused and existing Gateway tests pass, including deterministic JSON and Caddy validation.

- [ ] **Step 6: Record the verified Gateway slice for the final commit**

Do not create a slice commit while the feature is still incomplete. Keep the verified changes staged only at the final handoff after all required suites pass, following the repository Git preference.

## Task 2: Add the shared Gateway port provider and Registry wiring

**Files:**
- Create: server/internal/registry/gateway_relay_config.go
- Modify: server/internal/registry/server.go
- Modify: server/cmd/wheelmaker/main.go
- Test: server/internal/registry/server_test.go
- Test: server/cmd/wheelmaker/main_test.go

- [ ] **Step 1: Write failing provider and worker-wiring tests**

Add tests for the provider contract:

~~~
func TestGatewayRelayPortProviderReadsConfiguredPort(t *testing.T) {
    path := filepath.Join(t.TempDir(), "gateway", "config.json")
    writeFile(t, path, "{\"schema\":1,\"relay\":{\"listenPort\":28810},\"log\":{\"level\":\"INFO\"}}")
    provider := newGatewayRelayPortProvider(path)
    port, err := provider()
    if err != nil || port != 28810 {
        t.Fatalf("provider()=(%d,%v), want (28810,nil)", port, err)
    }
}

func TestGatewayRelayPortProviderTreatsMissingOrZeroAsUnconfigured(t *testing.T) {
    missing, err := newGatewayRelayPortProvider(filepath.Join(t.TempDir(), "missing.json"))()
    if err != nil || missing != 0 {
        t.Fatalf("missing provider()=(%d,%v), want (0,nil)", missing, err)
    }
    path := filepath.Join(t.TempDir(), "config.json")
    writeFile(t, path, "{\"schema\":1,\"relay\":{\"listenPort\":0},\"log\":{\"level\":\"INFO\"}}")
    zero, err := newGatewayRelayPortProvider(path)()
    if err != nil || zero != 0 {
        t.Fatalf("zero provider()=(%d,%v), want (0,nil)", zero, err)
    }
}
~~~

Add an invalid-config test that expects the same ValidateGlobal error used by Gateway. Extend the Registry command test so registryServerConfig receives the user Home and sets the default path userHome/.wheelmaker/gateway/config.json.

- [ ] **Step 2: Run the provider tests and verify RED**

~~~
go test ./internal/registry ./cmd/wheelmaker -run 'GatewayRelay|RegistryConfigIncludesGateway' -count=1
~~~

Expected result: compilation fails because the provider, Config.GatewayConfigPath, and the worker wiring do not exist.

- [ ] **Step 3: Implement the read-only provider and Registry configuration field**

Create newGatewayRelayPortProvider(path string) portrelay.RelayPortProvider in gateway_relay_config.go. It must return (0, nil) for a missing file or relay.listenPort == 0, parse using gateway.LoadGlobal, call gateway.ValidateGlobal, and return the configured port for valid input. It must never write or mutate Gateway files.

The shared `portrelay.RelayPortProvider` type/config field is a prerequisite for this wiring and may be introduced before the later Controller behavior task; this does not change data-plane behavior by itself.

Extend registry.Config with:

~~~
GatewayConfigPath string
RelayPortProvider portrelay.RelayPortProvider
~~~

In registry.New, use the injected provider for tests; otherwise construct it from GatewayConfigPath; when both are empty, use a disabled provider returning (0, nil) so isolated Registry unit tests remain deterministic. Pass the provider into portrelay.NewController.

Update runRegistryServer, runRegistryWorker, and registryServerConfig to derive the default Gateway config path from the same OS user Home used by wheelmaker-gateway. Preserve existing Registry state, token, logging, and ServerData wiring.

- [ ] **Step 4: Run provider and command tests GREEN**

~~~
gofmt -w internal/registry/gateway_relay_config.go internal/registry/server.go cmd/wheelmaker/main.go internal/registry/server_test.go cmd/wheelmaker/main_test.go
go test ./internal/registry ./cmd/wheelmaker -run 'GatewayRelay|RegistryConfigIncludesGateway' -count=1
~~~

Expected result: provider returns the configured fixed port, missing/zero is disabled, invalid JSON is rejected, and worker configuration points at the shared Gateway config.

- [ ] **Step 5: Record the verified provider slice for the final commit**

Do not create a slice commit while the feature is still incomplete. Keep the verified changes for the final handoff after all required suites pass, following the repository Git preference.

## Task 3: Remove per-enable Relay listeners and enforce the fixed port

**Files:**
- Modify: server/internal/portrelay/types.go
- Modify: server/internal/portrelay/listener.go
- Modify: server/internal/portrelay/listener_test.go

- [ ] **Step 1: Write failing Controller tests for fixed-port behavior**

Add provider-backed tests with fixedPort := 28810. Cover these independent behaviors:

~~~
func TestEnableUsesConfiguredPortWithoutCreatingListener(t *testing.T) {
    occupied := reserveRelayTestPort(t)
    forwarded := false
    controller := newTestController(t, ControllerConfig{
        RelayPortProvider: func() (int, error) { return occupied, nil },
        ForwardHubRequest: func(context.Context, string, string, any) ControlResult {
            forwarded = true
            return ControlResult{Code: rp.CodeUnavailable, Message: "test tunnel"}
        },
    })
    _, failure := controller.Enable(context.Background(), rp.RelayEnablePayload{
        ListenPort: occupied, HubID: "hub-local", TargetHost: "127.0.0.1", TargetPort: 43210, AccessCode: "123456",
    }, "relay.example.com", true)
    if failure == nil || !forwarded {
        t.Fatalf("Enable() failure=%#v forwarded=%v, want forwarded open attempt", failure, forwarded)
    }
}

func TestEnableRejectsPortDifferentFromGateway(t *testing.T) {
    forwarded := false
    controller := newTestController(t, ControllerConfig{
        RelayPortProvider: func() (int, error) { return 28810, nil },
        ForwardHubRequest: func(context.Context, string, string, any) ControlResult {
            forwarded = true
            return ControlResult{}
        },
    })
    _, failure := controller.Enable(context.Background(), rp.RelayEnablePayload{
        ListenPort: 28811, HubID: "hub-local", TargetHost: "127.0.0.1", TargetPort: 43210, AccessCode: "123456",
    }, "relay.example.com", true)
    if failure == nil || failure.Code != rp.CodeInvalidArgument || forwarded {
        t.Fatalf("Enable() failure=%#v forwarded=%v, want invalid_argument without Hub request", failure, forwarded)
    }
}
~~~

Also add tests for an unconfigured provider returning CodeUnavailable, status returning Disabled with listenPort 28810 after disable, and a provider port change invalidating the active slot before a data-plane request. Replace the old listener bind/timeout tests with assertions that no net.Listener is created by Enable.

- [ ] **Step 2: Run the Controller tests and verify RED**

~~~
go test ./internal/portrelay -run 'TestEnableUsesConfiguredPortWithoutCreatingListener|TestEnableRejectsPortDifferentFromGateway' -count=1
~~~

Expected result: compilation fails because RelayPortProvider and the fixed-port controller behavior are not present.

- [ ] **Step 3: Add the provider interface and marker constants**

In server/internal/portrelay/types.go, add the injected provider and shared marker names:

~~~
type RelayPortProvider func() (int, error)

const (
    RelayMarkerHeader = "X-WheelMaker-Relay"
    RelayMarkerValue  = "1"
)
~~~

Set a nil provider to a deterministic (0, nil) provider in NewController. Add controller state for the current configured port and provider error so snapshotLocked can include the fixed listenPort while disabled.

- [ ] **Step 4: Replace listener creation with provider validation and slot reconciliation**

Remove listener, oldListener, newRelayListener, and listener shutdown from the Controller. Add an internal reconciliation path called before Status, Enable, Disable, RegenerateAccessCode, and ServeHTTP:

1. Read the provider.
2. Treat 0 as disabled and a provider error as unavailable.
3. If the active slot's port differs from the provider or the provider is disabled/error, detach and close the active tunnel, clear the slot, and asynchronously send hub.relay.close for the old Relay ID.
4. Store the current configured port/error for the status snapshot.

Enable must validate target host, target port, access code, Hub forwarder, provider result, and exact payload.ListenPort == configuredPort before generating a Relay ID or sending hub.relay.open. Include the configured port in invalid-argument details. Keep buildPublicRelayURL and buildTunnelRelayURL; they now use the validated fixed port.

Disable must close only the current tunnel/streams, keep the configured port in the disabled snapshot, and never close a Caddy listener. snapshotLocked must return the existing Disabled, Opening, Up, and Error enum values only; an unconfigured provider is represented by Disabled plus error: relay port is not configured.

- [ ] **Step 5: Delete the independent listener implementation and protect marker headers**

Delete the relayListener type, newRelayListener, and its Close method from listener.go. Keep Controller.ServeHTTP and all existing login, cookie, stream, frame, and WebSocket handlers. In filterRequestHeaders, drop RelayMarkerHeader so the internal marker cannot reach the Hub target.

- [ ] **Step 6: Run all Port Relay tests GREEN**

~~~
gofmt -w internal/portrelay/types.go internal/portrelay/listener.go internal/portrelay/listener_test.go
go test ./internal/portrelay -count=1
~~~

Expected result: all existing authentication, cookie, stream, frame, tunnel replacement, and Hub target validation tests pass, while the old per-enable listener tests are replaced by fixed-provider assertions.

- [ ] **Step 7: Record the verified Controller slice for the final commit**

Do not create a slice commit while the feature is still incomplete. Keep the verified changes for the final handoff after all required suites pass, following the repository Git preference.

## Task 4: Route Caddy-marked requests through Registry

**Files:**
- Modify: server/internal/registry/http_routes.go
- Modify: server/internal/portrelay/listener_test.go
- Test: server/internal/registry/server_test.go

- [ ] **Step 1: Write failing Registry HTTP dispatch tests**

Add tests using a Registry with an injected fixed-port provider:

~~~
func TestRelayMarkerDispatchesBeforeRegistryRoutes(t *testing.T) {
    server := New(Config{RelayPortProvider: func() (int, error) { return 28810, nil }})
    req := httptest.NewRequest(http.MethodGet, "http://relay.example.com/__wheelmaker/relay/status", nil)
    req.Header.Set(portrelay.RelayMarkerHeader, portrelay.RelayMarkerValue)
    resp := httptest.NewRecorder()
    server.Handler().ServeHTTP(resp, req)
    if resp.Code != http.StatusOK {
        t.Fatalf("marked status code=%d, want 200", resp.Code)
    }
}

func TestUnmarkedRegistryRequestDoesNotEnterRelayDataPlane(t *testing.T) {
    server := New(Config{RelayPortProvider: func() (int, error) { return 28810, nil }})
    req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:9630/__wheelmaker/relay/status", nil)
    resp := httptest.NewRecorder()
    server.Handler().ServeHTTP(resp, req)
    if resp.Code != http.StatusNotFound {
        t.Fatalf("unmarked status code=%d, want 404", resp.Code)
    }
}
~~~

Add a marker-header filtering assertion that a request reaching the Hub target does not include X-WheelMaker-Relay.

- [ ] **Step 2: Run the new Registry tests and verify RED**

~~~
go test ./internal/registry -run 'Test(RelayMarkerDispatchesBeforeRegistryRoutes|UnmarkedRegistryRequestDoesNotEnterRelayDataPlane)' -count=1
~~~

Expected result: the marked request is currently 404 because handleHTTP has no Gateway marker branch.

- [ ] **Step 3: Add the marker branch before existing Registry routes**

At the start of Server.handleHTTP, dispatch only the exact marker value:

~~~
if r.Header.Get(portrelay.RelayMarkerHeader) == portrelay.RelayMarkerValue {
    if s.relay == nil {
        http.Error(w, "relay controller unavailable", http.StatusServiceUnavailable)
        return
    }
    s.relay.ServeHTTP(w, r)
    return
}
~~~

Leave /ws, HTML preview, Registry authentication, and all existing direct Registry routes unchanged when the marker is absent. Keep the main Registry server loopback-only.

- [ ] **Step 4: Run Registry and related Port Relay tests GREEN**

~~~
gofmt -w internal/registry/http_routes.go internal/registry/server_test.go
go test ./internal/registry ./internal/portrelay -run 'Relay|relay' -count=1
~~~

Expected result: marked requests enter the Controller, unmarked direct requests remain ordinary Registry routes, and the internal marker is not forwarded to Hub targets.

- [ ] **Step 5: Record the verified HTTP dispatch slice for the final commit**

Do not create a slice commit while the feature is still incomplete. Keep the verified changes for the final handoff after all required suites pass, following the repository Git preference.

## Task 5: Make the Web use the server-owned port

**Files:**
- Modify: app/web/src/app/WorkspaceApp.tsx
- Modify: app/web/src/settings/PortRelaySettingsDetail.tsx
- Modify: app/web/src/portRelay/portRelayUrl.ts
- Test: app/web/src/settings/PortRelaySettingsDetail.test.tsx
- Test: app/web/src/portRelay/portRelayUrl.test.ts

- [ ] **Step 1: Write failing Web tests for server-owned port display and URL derivation**

Create a focused settings test with a snapshot containing listenPort: 28810 and assert the UI renders a read-only Server Listen Port value of 28810, with no editable listen-port input or onChange handler. Create URL tests asserting:

~~~
expect(resolvePortRelayOpenUrl({
    relayUrl: "https://workspace.example.com:28810/",
    registryAddress: "http://127.0.0.1:9630",
    listenPort: 28810,
})).toBe("https://workspace.example.com:28810/");

expect(buildPortRelayOpenUrl("https://workspace.example.com", 28810))
    .toBe("https://workspace.example.com:28810/");
~~~

Add a regression assertion that a stale persisted portRelayListenPort value is not used when the Registry snapshot has a different fixed port.

- [ ] **Step 2: Run the Web tests and verify RED**

Run from app:

~~~
npx jest --runInBand web/src/settings/PortRelaySettingsDetail.test.tsx web/src/portRelay/portRelayUrl.test.ts
~~~

Expected result: the settings test finds the current editable Listen Port field and the stale-port regression fails against current WorkspaceApp behavior.

- [ ] **Step 3: Remove LocalStorage as the port authority**

In WorkspaceApp.tsx:

- Initialize Relay port display from the Registry snapshot, not persistedGlobal.portRelayListenPort.
- Stop accepting or writing listenPort in persistPortRelaySettings; retain old persistence data only as ignored migration data.
- Make enablePortRelayForTarget and openPortRelayWorkbenchTab require portRelaySnapshot.listenPort and show Relay server port is not configured. when it is absent.
- Send snapshot.listenPort in the existing RegistryPortRelayEnablePayload; never send a browser-selected port.
- Build iframe/open URLs from snapshot.relayUrl and snapshot.listenPort, with the existing Registry address fallback only when both are available.
- Remove the listen-port dependency from target switching, mobile menu actions, and preview tab opening.

In PortRelaySettingsDetail.tsx, replace the editable input and “applies on Enable” warning with a read-only server-port field showing portRelaySnapshot.listenPort ?? Not configured. Keep target, access-code, cache-clear, enable, and disable behavior unchanged.

- [ ] **Step 4: Run focused Web tests and typecheck GREEN**

~~~
npx jest --runInBand web/src/settings/PortRelaySettingsDetail.test.tsx web/src/portRelay/portRelayUrl.test.ts
npm run tsc:web
~~~

Expected result: the UI displays only the server-owned port, stale LocalStorage cannot change the enable payload or URL, and TypeScript passes.

- [ ] **Step 5: Record the verified Web slice for the final commit**

Do not create a slice commit while the feature is still incomplete. Keep the verified changes for the final handoff after all required suites pass, following the repository Git preference.

## Task 6: Verify Caddy-to-Registry HTTP and WebSocket behavior

**Files:**
- Create: server/internal/gateway/relay_integration_test.go
- Modify: server/internal/gateway/gateway_test.go if shared Caddy test helpers are needed

- [ ] **Step 1: Write the failing integration test**

Create a test that reserves one loopback fixed port, compiles an HTTP Workspace Gateway config, starts embedded Caddy with generated JSON, and serves a loopback Registry test handler as the Workspace upstream. Send a request with Host: workspace.example.com and assert the upstream receives:

- the original path and query string;
- X-WheelMaker-Relay: 1;
- X-Forwarded-Proto: http;
- no static-file response from Gateway.

Add a WebSocket case through the same fixed listener using Gorilla WebSocket and assert the upstream receives the upgrade and echoes a text frame. The Registry/Port Relay unit tests cover authentication and frame forwarding; this integration test covers the real Caddy boundary.

- [ ] **Step 2: Run the integration test and verify RED**

~~~
go test ./internal/gateway -run TestGatewayFixedRelayIntegration -count=1 -v
~~~

Expected result: the test fails because the fixed Relay server is not yet present in generated Caddy JSON or because the marker is not set.

- [ ] **Step 3: Add stable Caddy lifecycle and request helpers**

Use existing embedded Caddy Run, Stop, ValidateJSON, and Reload functions. Reserve the port before compiling, close it before starting Caddy, send the Workspace hostname through the HTTP Host header, and stop Caddy with t.Cleanup. Keep the test HTTP-only so it does not require real DNS, ACME, certificates, or firewall state; remove only the unrelated generated `:80` server in the test fixture so the host machine's port 80 is not required.

- [ ] **Step 4: Run integration and full focused server suites**

~~~
go test ./internal/gateway -run TestGatewayFixedRelayIntegration -count=1 -v
go test ./internal/gateway ./internal/portrelay ./internal/registry ./cmd/wheelmaker -count=1
~~~

Expected result: Caddy fixed-port HTTP and WebSocket proxying pass, and all affected Go packages are green.

- [ ] **Step 5: Record the verified integration slice for the final commit**

Do not create a slice commit while the feature is still incomplete. Keep the verified changes for the final handoff after all required suites pass, following the repository Git preference.

## Standalone Nginx mode extension

When `GatewayConfigPath` is missing, the provider returns the client-managed sentinel. The
Controller does not create a listener; it accepts and retains the client `listenPort`, reports
`listenPortManaged: false`, and leaves Nginx port binding, TLS, marker injection, WebSocket
upgrade, buffering, and timeout configuration to the operator. A present Gateway config remains
authoritative, including an explicit `relay.listenPort: 0` disabled state and validation errors.
The Web UI renders the port as editable only when `listenPortManaged` is false and continues to
use the server snapshot in Gateway-managed mode. The additive status field does not change the
Registry protocol version, method names, or Relay frame protocol.

## Task 7: Full verification and handoff

- [ ] **Step 1: Run the complete Go suite**

From server:

~~~
go test ./... -count=1
~~~

Expected result: exit code 0 with all Go packages passing.

- [ ] **Step 2: Run the complete Web verification**

From app:

~~~
npm test -- --runInBand
npm run tsc:web
npm run build:web
~~~

Expected result: Jest, TypeScript, and the production Web build all exit with code 0.

- [ ] **Step 3: Check protocol and scope invariants**

Run:

~~~
rg -n "DefaultProtocolVersion|RelayStatus|FrameVersion|registry\\.relay|hub\\.relay" server/internal/protocol app/web/src/registry
git diff --check
git status --short --branch
~~~

Confirm that no Registry protocol version, method name, Relay frame version, HubState contract, Nginx/DNS/firewall behavior, or external user worktree file was changed.

- [ ] **Step 4: Rebase before final commit and inspect the final diff**

Follow the repository Git preference: sync origin/main before the final commit, rebase this feature branch if it is behind, resolve only changes inside this scoped feature, rerun affected suites after the rebase, and inspect:

~~~
git diff --stat origin/main...HEAD
git diff -- server/internal/gateway server/internal/portrelay server/internal/registry server/cmd/wheelmaker app/web/src/portRelay app/web/src/settings/PortRelaySettingsDetail.tsx app/web/src/app/WorkspaceApp.tsx docs/wiki/architecture/gateway.md docs/wiki/protocols/registry.md
~~~

- [ ] **Step 5: Commit only after every verification passes**

No task-slice commits are created during execution. After the final diff is complete and every required verification passes, commit all verified files:

~~~
git add server app docs/wiki/architecture/gateway.md docs/wiki/protocols/registry.md docs/scope/2026-08-06-port-relay-fixed-gateway-port
git commit -m "feat: route Port Relay through fixed Gateway port"
~~~

Report the feature branch/worktree, commit hashes, test commands/results, push/merge status, and any intentionally unperformed Git action.
