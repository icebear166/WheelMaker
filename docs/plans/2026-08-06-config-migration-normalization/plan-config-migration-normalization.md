# Hub Config Migration and publicUrl Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Move Hub identity fields to the top level, remove runtime use of `registry.server`, make `publicUrl` (or an automatic loopback default) the Hub Registry endpoint, and migrate existing config files in Go without user interaction.

**Architecture:** Go owns all existing-config migration. A locked, atomic migration reads legacy JSON, resolves top-level-vs-nested identity, converts legacy `registry.server` according to listener/loopback semantics, writes a private pre-migration backup, and exposes only the canonical schema to strict `LoadConfig`. Hub Reporter derives its WebSocket URL from `publicUrl`, while the Registry listener always binds loopback. MJS writes the canonical shape for new installs, preserves legacy fields on existing installs, and restores the pre-migration backup before any old-runtime fallback.

**Tech Stack:** Go 1.26, `encoding/json`, `net/url`, platform file locking, Gorilla WebSocket, Node.js ESM deploy core, Node built-in test runner, Go table-driven tests.

---

### Task 1: Add canonical config types and the Go migration engine

**Files:**
- Create: `server/internal/shared/config_migration.go`
- Create: `server/internal/shared/config_lock_unix.go`
- Create: `server/internal/shared/config_lock_windows.go`
- Modify: `server/internal/shared/config.go:10-95`
- Modify: `server/internal/shared/config_write.go:9-58`
- Test: `server/internal/shared/shared_test.go`

- [x] **Step 1: Write failing migration and schema tests**

Add table-driven tests for legacy entry, legacy worker, mixed identity, loopback fallback,
malformed input, idempotence, concurrent callers, private permissions, and the
`config.json.pre-migration` backup. The strict loader must reject `registry.server`,
`registry.token`, and `registry.hubId` after migration while the raw migration reader accepts
them. Use these expected endpoint values:

```text
legacy worker server=registry.example.com, port=28800 -> publicUrl=https://registry.example.com
legacy loopback server=127.0.0.1, publicUrl absent -> publicUrl absent, loopback runtime fallback
top-level non-empty token/hubId/publicUrl -> preserve top-level values, remove nested legacy keys
publicUrl and old server differ -> keep publicUrl, remove old server without prompting
```

- [x] **Step 2: Run the focused tests to verify they fail**

```powershell
cd server
go test ./internal/shared -run 'Test(ConfigMigration|LoadConfig)' -count=1
```

Expected: FAIL because `AppConfig` has no top-level identity fields and no migration entrypoint exists.

- [x] **Step 3: Implement the canonical schema**

Change the Go types to:

```go
type AppConfig struct {
    PublicURL string          `json:"publicUrl,omitempty"`
    Token     string          `json:"token,omitempty"`
    HubID     string          `json:"hubId,omitempty"`
    Projects  []ProjectConfig `json:"projects"`
    Registry  RegistryConfig  `json:"registry,omitempty"`
    Log       LogConfig       `json:"log,omitempty"`
}

type RegistryConfig struct {
    Port   int  `json:"port,omitempty"`
    Listen bool `json:"listen,omitempty"`
}
```

Keep `LoadConfig` side-effect free and strict; legacy fields exist only in raw migration maps.

- [x] **Step 4: Implement locked raw-JSON migration**

Export `MigrateConfig(path string) error`, `FinalizeConfigMigration(path string) error`,
and `MigrationBackupPath(path string) string` from `config_migration.go`. Hold a sibling
`config.json.lock` with the platform file-lock primitive for the complete transaction. Before
the first changed write, create `config.json.pre-migration` with mode `0600` and do not overwrite
an existing backup. Use `WriteConfigFile` for backup and canonical replacement; remove the backup
only after strict parsing and token validation succeed.

Apply deterministic rules: non-empty top-level identity wins over nested identity; Go migration
never generates identity; `listen:true` treats old server as a bind host and deletes it; a
`listen:false` non-loopback old server becomes publicUrl when publicUrl is absent, preserving
only a port explicitly present in the old server; loopback or missing old server leaves publicUrl
empty for the loopback default; existing publicUrl always wins; registry.port remains the
local/default loopback port and never fills a remote public URL port. Normalize remote origins to
HTTPS and loopback origins to HTTP, reject credentials,
query/fragment, non-root paths, invalid ports, and unclassifiable non-loopback servers without
changing the original file.

- [x] **Step 5: Run migration tests and commit**

```powershell
go test ./internal/shared -run 'Test(ConfigMigration|LoadConfig)' -count=1
git add internal/shared/config.go internal/shared/config_write.go internal/shared/config_migration.go internal/shared/config_lock_unix.go internal/shared/config_lock_windows.go internal/shared/shared_test.go
git commit -m "feat(config): migrate hub identity and registry endpoint"
```

Expected: PASS, including concurrent callers producing one canonical file and preserving the
backup until finalization.

### Task 2: Run migration before every Go runtime entry and enforce loopback listener

**Files:**
- Modify: `server/cmd/wheelmaker/main.go:97-253`
- Modify: `server/cmd/wheelmaker/daemon.go:74-95`
- Test: `server/cmd/wheelmaker/main_test.go`

- [x] **Step 1: Write failing startup and listener tests**

Update fixtures to top-level `token`/`hubId`. Assert `loadValidatedRuntimeConfig` and guardian
both migrate before strict parsing, token errors name `token`, registry worker binds
`127.0.0.1:<port>` regardless of legacy server text, and local-dev copying clears PublicURL,
sets Listen/Port, and does not mutate the source config.

- [x] **Step 2: Run the focused tests to verify they fail**

```powershell
go test ./cmd/wheelmaker -run 'Test(LoadValidated|RunRegistry|LocalDev|Guardian)' -count=1
```

Expected: FAIL on nested identity and `cfg.Registry.Server` references.

- [x] **Step 3: Integrate migration/finalization**

Make `loadValidatedRuntimeConfig` call `shared.MigrateConfig`, strict `shared.LoadConfig`,
`security.ValidateRegistryToken(cfg.Token)`, then `shared.FinalizeConfigMigration`; return
before finalization on any error so the backup remains recoverable. Make guardian use this same
validated helper. Pass `cfg.Token` to `registryServerConfig`, bind the registry worker to the
literal loopback address, preserve the configured/default port, and reject non-loopback
`--registry-addr` values.

- [x] **Step 4: Update local-dev tests and commit**

Set `localDevRuntimeConfig` to clear PublicURL, force Listen=true and Port=9630, and preserve
top-level identity. Run `go test ./cmd/wheelmaker -count=1`, then commit:

```powershell
git add server/cmd/wheelmaker/main.go server/cmd/wheelmaker/daemon.go server/cmd/wheelmaker/main_test.go
git commit -m "feat(runtime): migrate config before workers start"
```

### Task 3: Make Hub Reporter use publicUrl with automatic loopback fallback

**Files:**
- Modify: `server/internal/hub/hub.go:322-362`
- Modify: `server/internal/hub/reporter.go:125-139,200-225,661-672,3608-3637`
- Test: `server/internal/hub/hub_test.go`

- [x] **Step 1: Add failing endpoint and setup tests**

Replace the server-based cases with:

```text
publicUrl="", port=9630                         -> ws://127.0.0.1:9630/ws
publicUrl="https://host:28800", port=0          -> wss://host:28800/ws
publicUrl="http://127.0.0.1:9630/ws", port=0    -> ws://127.0.0.1:9630/ws
publicUrl="https://host:28800/ws", port=0        -> wss://host:28800/ws
```

Add setup coverage showing top-level PublicURL, Token, and HubID reach ReporterConfig, while
an empty publicUrl uses the configured/default loopback port. Preserve the existing skip for a
completely empty Registry configuration.

- [x] **Step 2: Run the focused tests to verify they fail**

```powershell
go test ./internal/hub -run 'Test(BuildWSURL|.*Registry.*|.*LocalDev.*)' -count=1
```

Expected: FAIL because Hub setup and Reporter still read `Registry.Server`.

- [x] **Step 3: Implement the publicUrl endpoint path**

Rename `ReporterConfig.Server` to `PublicURL`. Pass `h.cfg.PublicURL`, top-level `h.cfg.Token`,
top-level `h.cfg.HubID`, and Registry.Port from Hub setup. Replace `buildWSURL(server, port)`
with `buildWSURL(publicURL, port)`: empty input produces loopback, HTTP becomes WS, HTTPS
becomes WSS, a missing/root path becomes exactly `/ws`, and invalid components return an error.
Do not accept a bare non-loopback host at runtime; migration canonicalizes it first.

- [x] **Step 4: Run Hub tests and commit**

```powershell
go test ./internal/hub -count=1
git add server/internal/hub/hub.go server/internal/hub/reporter.go server/internal/hub/hub_test.go
git commit -m "feat(hub): connect registry through publicUrl"
```

Expected: PASS with no production reference to `Registry.Server` or `ReporterConfig.Server`.

### Task 4: Make MJS config generation schema-aware without migrating existing files

**Files:**
- Modify: `scripts/deploy/deploy-core.mjs:1676-1747,2014-2018`
- Test: `scripts/deploy/deploy-core.test.mjs:808-854`

- [x] **Step 1: Write failing deployment config tests**

Require fresh config to contain top-level `token` and `hubId`, with registry containing only
listen/port. Add tests proving an existing legacy config keeps nested identity and
`registry.server`, an existing canonical config does not synthesize nested values, a mixed config
keeps both representations, and omitted publicUrl is accepted for local-only deployment.
Add a failure-path test that restores `config.json.pre-migration` before runtime.start when the
new Hub fails its health check.

- [x] **Step 2: Run focused Node tests to verify failure**

```powershell
node --test scripts/deploy/deploy-core.test.mjs --test-name-pattern "config|Gateway configuration|Hub health"
```

Expected: FAIL because fresh config writes nested identity and ensureRuntimeConfig requires a
public URL.

- [x] **Step 3: Update fresh/existing config behavior**

For a missing config, write this shape (omitting publicUrl when no URL is supplied):

```js
{
  projects: [],
  ...(normalizedPublicUrl ? {publicUrl: normalizedPublicUrl} : {}),
  token: randomBytes(32).toString('base64url'),
  hubId: 'local-hub',
  registry: {listen: true, port: 9630},
  log: {level: 'warn'},
}
```

For existing config, inspect both identity layouts without moving or deleting them. Generate a
missing value only when both representations are absent, placing it in the detected legacy
layout; never create a parallel value. Preserve `registry.server` exactly. Keep explicit
public-url/interactive deployment normalization, but allow an omitted URL to skip the Workspace
Gateway site declaration.

- [x] **Step 4: Restore migration backups before fallback**

Add `restoreConfigMigrationBackup(home)` that atomically restores private
`config.json.pre-migration` bytes to `config.json` and removes the backup. Call it immediately
before the existing failure-path `runtime.start()`. If restore fails, report that error and do
not start a runtime against a possibly new schema.

- [x] **Step 5: Run Node tests and commit**

```powershell
node --test scripts/deploy/deploy-core.test.mjs
git add scripts/deploy/deploy-core.mjs scripts/deploy/deploy-core.test.mjs
git commit -m "feat(deploy): preserve legacy config until Go migration"
```

Expected: PASS, including fresh top-level schema, legacy preservation, local-only deployment,
and backup restoration.

### Task 5: Align examples, documentation, and generated-config assertions

**Files:**
- Modify: `server/config.example.json`
- Modify: `docs/wiki/architecture/server-runtime.md`
- Modify: `docs/wiki/release-and-build/release.md`
- Modify: `INSTALL.md`
- Modify: `README.md`
- Test: `server/internal/shared/shared_test.go`

- [x] **Step 1: Verify canonical examples and docs**

Ensure every user-facing example uses top-level publicUrl/token/hubId, contains only registry
listen/port, explains optional publicUrl loopback behavior, and describes non-interactive Go
migration. Keep historical registry.server mentions only where they explain automatic migration.

- [x] **Step 2: Run documentation/config checks**

```powershell
node -e "JSON.parse(require('fs').readFileSync('server/config.example.json','utf8'))"
cd server
go test ./internal/shared -run TestLoadConfig_ConfigExampleIsValid -count=1
cd ..
git diff --check
```

Expected: all commands succeed and no canonical example contains nested registry.token or
registry.hubId.

- [x] **Step 3: Commit documentation alignment**

```powershell
git add server/config.example.json docs/wiki/architecture/server-runtime.md docs/wiki/release-and-build/release.md INSTALL.md README.md server/internal/shared/shared_test.go
git commit -m "docs(config): document publicUrl registry endpoint"
```

### Task 6: Run the complete verification suite and review migration safety

**Files:**
- Test: `server/internal/shared/shared_test.go`
- Test: `server/cmd/wheelmaker/main_test.go`
- Test: `server/internal/hub/hub_test.go`
- Test: `scripts/deploy/deploy-core.test.mjs`

- [x] **Step 1: Run focused Go packages**

```powershell
cd server
go test ./internal/shared ./cmd/wheelmaker ./internal/hub
```

Expected: PASS.

- [x] **Step 2: Run the full Go suite**

```powershell
go test ./...
```

Expected: PASS with no protocol-version changes.

- [x] **Step 3: Run deploy tests and scan removed-field references**

```powershell
cd ..
node --test scripts/deploy/deploy-core.test.mjs scripts/deploy/gateway-config.test.mjs
rg -n "Registry\.Server|Registry\.Token|Registry\.HubID|registry\.server|registry\.token|registry\.hubId" server scripts/deploy --glob '!**/dist/**'
```

Expected: the scan reports only intentional legacy migration/tests and no production runtime
reads of removed fields.

- [x] **Step 4: Review safety invariants**

Verify migration never logs token/hub identity values, never prompts, preserves the original
config on malformed input or failed writes, keeps the backup private, and cannot start an old
runtime against a migrated config. Confirm the Registry wire envelope hubId and protocol version
are unchanged.

- [x] **Step 5: Commit the verified implementation**

```powershell
git add server scripts/deploy/deploy-core.mjs scripts/deploy/deploy-core.test.mjs docs INSTALL.md README.md
git commit -m "feat(config): complete automatic hub config migration"
```
