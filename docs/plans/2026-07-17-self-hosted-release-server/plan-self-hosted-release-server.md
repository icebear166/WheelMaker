# Self-Hosted Release Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GitHub Release hosting with an authenticated Go publisher and public Nginx download site at `https://release.wheelmaker.top`, starting a fresh release sequence at `v1.1`.

**Architecture:** The private source repository keeps all build and deploy scripts. Local Windows publishing and the manual private GitHub Action upload identical prebuilt files through one HTTPS API and one shared Bearer token; a loopback-only Go service validates sessions and atomically writes versioned files, while Nginx serves public downloads. All public metadata uses schema 2 root-relative paths derived from the single `scripts/release/channel.json` base URL; Hub Go remains local-state-only.

**Tech Stack:** Go 1.26 standard library, Node.js 22 ESM, Nginx, systemd, Certbot, React/TypeScript/Webpack, PowerShell/BAT, GitHub Actions.

---

### Task 1: Define the single release channel and schema 2 metadata contract

**Files:**
- Modify: `scripts/release/channel.json`
- Create: `scripts/release/channel.mjs`
- Create: `scripts/release/channel.test.mjs`
- Modify: `scripts/release/metadata.mjs`
- Modify: `scripts/release/metadata.test.mjs`

- [ ] **Step 1: Write failing channel and fresh-version tests**

Add tests that require exactly one maintained URL, same-origin root paths, schema 2 stable parsing, and the fresh `v1.1` sequence:

```js
test('release channel has one canonical HTTPS base URL', async () => {
  const raw = JSON.parse(await readFile(new URL('./channel.json', import.meta.url), 'utf8'));
  assert.deepEqual(raw, {baseUrl: 'https://release.wheelmaker.top'});
  assert.equal(releasePublicUrl(raw, '/stable.json'), 'https://release.wheelmaker.top/stable.json');
  assert.throws(() => releasePublicUrl(raw, 'stable.json'), /root-relative/);
  assert.throws(() => releasePublicUrl(raw, '//evil.example/stable.json'), /same origin/);
});

test('missing stable starts the self-hosted channel at v1.1', () => {
  assert.equal(nextVersionFromStableBytes(null), 'v1.1');
});

test('schema 2 stable determines the next version', () => {
  const bytes = encodeJsonBytes({schema: 2, version: 'v1.9'});
  assert.equal(stableVersionFromBytes(bytes), 'v1.9');
  assert.equal(nextVersionFromStableBytes(bytes), 'v1.10');
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```powershell
node --test scripts/release/channel.test.mjs scripts/release/metadata.test.mjs
```

Expected: FAIL because the channel still contains GitHub fields, schema 1 is required, and missing stable is rejected.

- [ ] **Step 3: Replace the channel and add strict path resolution**

Set `channel.json` to:

```json
{
  "baseUrl": "https://release.wheelmaker.top"
}
```

Implement `channel.mjs` with no fallback host:

```js
export function validateReleaseChannel(channel) {
  if (!channel || Object.keys(channel).sort().join(',') !== 'baseUrl') {
    throw new Error('release channel must contain only baseUrl');
  }
  const base = new URL(channel.baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('release channel baseUrl must be a clean HTTPS origin');
  }
  base.pathname = base.pathname.replace(/\/+$/, '') + '/';
  return {baseUrl: base.origin + base.pathname.replace(/\/$/, '')};
}

export function releasePublicUrl(channel, path) {
  const {baseUrl} = validateReleaseChannel(channel);
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
    throw new Error('release path must be root-relative');
  }
  const resolved = new URL(path, `${baseUrl}/`);
  if (resolved.origin !== new URL(baseUrl).origin) {
    throw new Error('release path must stay on the same origin');
  }
  return resolved.href;
}

export function versionAssetPath(version, name) {
  if (!/^v1\.(0|[1-9]\d*)$/.test(version) || !/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error('invalid release asset path');
  }
  return `/releases/${version}/${name}`;
}
```

- [ ] **Step 4: Upgrade version parsing to schema 2 and accept an empty channel**

Replace the stable helpers with:

```js
export function stableVersionFromBytes(bytes) {
  let stable;
  try {
    stable = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error('stable metadata schema is invalid');
  }
  if (
    stable?.schema !== 2 ||
    typeof stable.version !== 'string' ||
    !/^v1\.(0|[1-9]\d*)$/.test(stable.version)
  ) {
    throw new Error('stable metadata schema is invalid');
  }
  return stable.version;
}

export function nextVersionFromStableBytes(bytes) {
  return bytes === null ? 'v1.1' : nextV1Version(stableVersionFromBytes(bytes));
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
node --test scripts/release/channel.test.mjs scripts/release/metadata.test.mjs
git add scripts/release/channel.json scripts/release/channel.mjs scripts/release/channel.test.mjs scripts/release/metadata.mjs scripts/release/metadata.test.mjs
git commit -m "feat: define self-hosted release channel"
```

Expected: tests PASS and the commit succeeds.

### Task 2: Add release-server configuration, token authentication, and command entrypoint

**Files:**
- Create: `server/cmd/wheelmaker-release-server/main.go`
- Create: `server/cmd/wheelmaker-release-server/main_test.go`
- Create: `server/internal/releaseserver/config.go`
- Create: `server/internal/releaseserver/config_test.go`
- Create: `server/internal/releaseserver/server.go`
- Create: `server/internal/releaseserver/server_test.go`

- [ ] **Step 1: Write failing config and authentication tests**

Use a temporary config and assert health remains public while publishing stays unavailable until the single hash is configured:

```go
func TestConfigureTokenHashWritesOnlyDigest(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := Config{Schema: 1, Listen: "127.0.0.1:9680", DataRoot: filepath.Join(t.TempDir(), "data")}
	requireNoError(t, WriteConfig(path, cfg))
	digest := strings.Repeat("a", 64)
	requireNoError(t, ConfigureTokenHash(path, digest))
	got, err := LoadConfig(path)
	requireNoError(t, err)
	if got.TokenSHA256 != digest {
		t.Fatalf("tokenSha256=%q", got.TokenSHA256)
	}
	raw, err := os.ReadFile(path)
	requireNoError(t, err)
	if bytes.Contains(raw, []byte("Bearer")) {
		t.Fatal("config contains a raw token")
	}
}

func TestConfigModeAllowsOnlyRootWriteAndServiceGroupRead(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows does not report POSIX group mode bits")
	}
	path := filepath.Join(t.TempDir(), "config.json")
	requireNoError(t, WriteConfig(path, validConfig(t)))
	info, err := os.Stat(path)
	requireNoError(t, err)
	if info.Mode().Perm() != 0o640 {
		t.Fatalf("mode=%#o", info.Mode().Perm())
	}
}

func TestHealthIsPublicAndPublishRequiresConfiguredBearer(t *testing.T) {
	server := newTestServer(t, Config{Schema: 1, Listen: "127.0.0.1:9680", DataRoot: t.TempDir()})
	assertStatus(t, server, http.MethodGet, "/healthz", "", http.StatusOK)
	assertStatus(t, server, http.MethodPost, "/api/publish/start", "", http.StatusServiceUnavailable)
	server.SetTokenHashForTest(sha256Hex("release-token"))
	assertStatus(t, server, http.MethodPost, "/api/publish/start", "Bearer wrong", http.StatusUnauthorized)
}
```

- [ ] **Step 2: Run focused Go tests and verify failure**

Run from `server`:

```powershell
go test ./internal/releaseserver ./cmd/wheelmaker-release-server
```

Expected: FAIL because neither package exists.

- [ ] **Step 3: Implement strict atomic configuration**

Define the exact server config and validation:

```go
type Config struct {
	Schema      int    `json:"schema"`
	Listen      string `json:"listen"`
	DataRoot    string `json:"dataRoot"`
	TokenSHA256 string `json:"tokenSha256"`
}

func (c Config) Validate() error {
	if c.Schema != 1 || c.Listen != "127.0.0.1:9680" || !filepath.IsAbs(c.DataRoot) {
		return errors.New("invalid release server config")
	}
	if c.TokenSHA256 != "" && !validLowerHex(c.TokenSHA256, 64) {
		return errors.New("invalid publisher token hash")
	}
	return nil
}
```

`WriteConfig` must create mode `0640`, write UTF-8 JSON plus one newline to a same-directory temporary file, `Sync`, close, and rename. The deployment step owns the setgid config directory as `root:wheelmaker-release` with mode `2750`, so every root-created temporary file inherits the service-readable group while only root can replace configuration. `ConfigureTokenHash` must load the existing file, replace the one `tokenSha256`, and call `WriteConfig`; it must not accept raw tokens.

- [ ] **Step 4: Implement health and constant-time Bearer authentication**

Use the digest of the exact Bearer value and constant-time comparison:

```go
func authenticate(header string, configured string) error {
	if configured == "" {
		return errPublisherNotConfigured
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) || len(header) == len(prefix) {
		return errUnauthorized
	}
	want, err := hex.DecodeString(configured)
	if err != nil {
		return errPublisherNotConfigured
	}
	got := sha256.Sum256([]byte(header[len(prefix):]))
	if subtle.ConstantTimeCompare(got[:], want) != 1 {
		return errUnauthorized
	}
	return nil
}
```

`GET /healthz` returns `{"ok":true,"publisherConfigured":false}` before token initialization. Every `/api/` handler authenticates before reading the request body and returns JSON errors without echoing the Authorization header.

- [ ] **Step 5: Add `serve` and `configure-token` commands**

The command contract is:

```text
wheelmaker-release-server serve --config /etc/wheelmaker-release-server/config.json
wheelmaker-release-server configure-token --config /etc/wheelmaker-release-server/config.json --sha256 $tokenHash
```

Here `$tokenHash` denotes the computed 64-character lowercase SHA-256 digest, not a value read from user input.

Use `http.Server` with header and idle timeouts but no total request-duration deadline. `serve` handles SIGINT/SIGTERM with bounded shutdown; `configure-token` performs one atomic config update and exits.

- [ ] **Step 6: Run tests and commit**

```powershell
Push-Location server
go test ./internal/releaseserver ./cmd/wheelmaker-release-server
Pop-Location
git add server/cmd/wheelmaker-release-server server/internal/releaseserver
git commit -m "feat: add release server authentication"
```

Expected: tests PASS.

### Task 3: Implement authenticated upload sessions and public status

**Files:**
- Create: `server/internal/releaseserver/session.go`
- Create: `server/internal/releaseserver/session_test.go`
- Modify: `server/internal/releaseserver/server.go`
- Modify: `server/internal/releaseserver/server_test.go`

- [ ] **Step 1: Write failing session, status, and upload tests**

Cover the exact request shapes and enforce auth before body consumption:

```go
func TestPublishSessionStreamsDeclaredFile(t *testing.T) {
	s := newAuthenticatedTestServer(t)
	started := startSession(t, s, startRequest{
		Version: "v1.1", SourceSHA: strings.Repeat("a", 40), Publisher: "local",
	})
	body := []byte("#!/usr/bin/env node\n")
	request := newRequest(http.MethodPut, "/api/publish/"+started.SessionID+"/files/deploy.mjs", body)
	request.Header.Set("Authorization", "Bearer release-token")
	request.Header.Set("X-WheelMaker-SHA256", sha256HexBytes(body))
	response := serveRequest(s, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	assertSessionFile(t, s.DataRoot(), started.SessionID, "deploy.mjs", body)
}

func TestUploadRejectsTraversalAndDigestMismatch(t *testing.T) {
	s := newAuthenticatedTestServer(t)
	started := startSession(t, s, validStartRequest("v1.1"))
	assertUploadStatus(t, s, started.SessionID, "%2e%2e%2fstable.json", []byte("x"), sha256HexBytes([]byte("x")), http.StatusBadRequest)
	assertUploadStatus(t, s, started.SessionID, "deploy.mjs", []byte("x"), strings.Repeat("0", 64), http.StatusUnprocessableEntity)
}

func TestStatusContainsNoSecretOrStack(t *testing.T) {
	s := newAuthenticatedTestServer(t)
	started := startSession(t, s, validStartRequest("v1.1"))
	putStatus(t, s, started.SessionID, statusRequest{State: "running", Phase: "building"})
	raw := readPublicFile(t, s.DataRoot(), "publish-status.json")
	if bytes.Contains(raw, []byte("release-token")) || bytes.Contains(raw, []byte("stack")) {
		t.Fatalf("unsafe status: %s", raw)
	}
}
```

- [ ] **Step 2: Run the tests and verify failure**

```powershell
Push-Location server
go test ./internal/releaseserver -run "Session|Upload|Status"
Pop-Location
```

Expected: FAIL because session routes do not exist.

- [ ] **Step 3: Define session metadata and the fixed filename whitelist**

Persist each session as `staging/{session-id}/session.json`:

```go
type publishSession struct {
	Schema      int             `json:"schema"`
	SessionID   string          `json:"sessionId"`
	Version     string          `json:"version"`
	SourceSHA   string          `json:"sourceSha"`
	Publisher   string          `json:"publisher"`
	WithDesktop bool            `json:"withDesktop"`
	WithAndroid bool            `json:"withAndroid"`
	PublishedAt string          `json:"publishedAt"`
	UpdatedAt   string          `json:"updatedAt"`
	Files       map[string]file `json:"files"`
}

type file struct {
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}
```

Required names are `deploy.mjs`, `deploy-core.mjs`, `release-manifest.json`, and exactly three names rendered from `wheelmaker-${version}-${platform}.tar.gz`. Desktop adds `WheelMakerDesktop.exe`; Android adds `WheelMakerAndroid.apk` and `android-release.json`. Reject all other names before creating a file.

- [ ] **Step 4: Add start and public status handlers**

`POST /api/publish/start` validates `version`, 40-lower-hex `sourceSha`, `publisher` in `local|action`, and booleans, then returns:

```json
{
  "schema": 1,
  "sessionId": "32-lower-hex",
  "version": "v1.1",
  "publishedAt": "2026-07-17T09:00:00Z"
}
```

`PUT /status` accepts only the phases and states from the spec, stamps server `updatedAt`, and atomically replaces public `publish-status.json`. It derives version, source SHA, publisher, and startedAt from the session instead of trusting the status payload.

- [ ] **Step 5: Stream uploads with hard limits**

Require `Content-Length` and `X-WheelMaker-SHA256`. Before consuming the body, verify the declared file and session totals and require enough current free space for the file plus the fixed 1 GiB safety margin. Use `io.LimitReader` with one extra byte, stream to a session-local temporary file while hashing, compare both declared values, `Sync`, close, then rename. Enforce 5 MiB for MJS/JSON, 2 GiB for binary assets, 9 files, and 8 GiB total. Never read a package into a single `[]byte`.

- [ ] **Step 6: Add explicit cancel and stale staging cleanup**

`DELETE /api/publish/{session}` removes only that staging directory after authentication. Start a bounded maintenance goroutine with the server: once per hour and once at startup, it marks sessions whose server-owned `UpdatedAt` is older than 24 hours as `publisher_timeout`, then removes only those staging directories. Stop the goroutine during server shutdown. Track the public status owner internally so timing out an older parallel session cannot overwrite a newer session's public status. This cleanup must never traverse or delete `public/releases`; it is unrelated to published-asset retention.

- [ ] **Step 7: Run tests and commit**

```powershell
Push-Location server
go test ./internal/releaseserver -run "Session|Upload|Status"
Pop-Location
git add server/internal/releaseserver
git commit -m "feat: accept streamed release uploads"
```

Expected: tests PASS.

### Task 4: Commit schema 2 releases atomically and preserve all published assets

**Files:**
- Create: `server/internal/releaseserver/metadata.go`
- Create: `server/internal/releaseserver/commit.go`
- Create: `server/internal/releaseserver/commit_test.go`
- Create: `server/internal/releaseserver/disk_linux.go`
- Create: `server/internal/releaseserver/disk_other.go`
- Modify: `server/internal/releaseserver/server.go`

- [ ] **Step 1: Write failing first-release, inheritance, conflict, and stable-last tests**

Use injected rename/write failure points so ordering is observable:

```go
func TestFirstCommitCreatesV11Schema2Stable(t *testing.T) {
	store := newCommitFixture(t, nil)
	result, err := store.Commit(context.Background(), completeSession(t, store, "v1.1"))
	requireNoError(t, err)
	if result.Stable.Schema != 2 || result.Stable.Version != "v1.1" {
		t.Fatalf("stable=%+v", result.Stable)
	}
	if result.Stable.Deploy.MJSPath != "/releases/v1.1/deploy.mjs" {
		t.Fatalf("mjsPath=%q", result.Stable.Deploy.MJSPath)
	}
}

func TestCommitCarriesOptionalPointers(t *testing.T) {
	previous := stableFixture("v1.1")
	previous.Desktop = &desktopPointer{Version: "v1.1", Path: "/releases/v1.1/WheelMakerDesktop.exe", SHA256: strings.Repeat("d", 64)}
	store := newCommitFixture(t, previous)
	result, err := store.Commit(context.Background(), completeSession(t, store, "v1.2"))
	requireNoError(t, err)
	if result.Stable.Desktop.Version != "v1.1" {
		t.Fatalf("desktop=%+v", result.Stable.Desktop)
	}
}

func TestStableFailureLeavesPreviousStableBytesUntouched(t *testing.T) {
	store, previousBytes := newFailingStableFixture(t, "v1.1")
	_, err := store.Commit(context.Background(), completeSession(t, store, "v1.2"))
	if err == nil {
		t.Fatal("expected stable write failure")
	}
	if got := readStableBytes(t, store); !bytes.Equal(got, previousBytes) {
		t.Fatalf("stable changed after failure: %s", got)
	}
}

func TestConcurrentSameVersionHasOneWinner(t *testing.T) {
	store := newCommitFixture(t, nil)
	results := commitConcurrently(t, store, "v1.1", 2)
	assertStatusCounts(t, results, map[int]int{http.StatusOK: 1, http.StatusConflict: 1})
}
```

- [ ] **Step 2: Run commit tests and verify failure**

```powershell
Push-Location server
go test ./internal/releaseserver -run "Commit|First|Concurrent|Stable"
Pop-Location
```

Expected: FAIL because commit storage is absent.

- [ ] **Step 3: Define exact public metadata types**

Use schema 2 root-relative paths:

```go
type stableDocument struct {
	Schema      int             `json:"schema"`
	Version     string          `json:"version"`
	PublishedAt string          `json:"publishedAt"`
	SourceSHA   string          `json:"sourceSha"`
	Deploy      deployPointer   `json:"deploy"`
	Release     manifestPointer `json:"release"`
	Desktop     *desktopPointer `json:"desktopExe,omitempty"`
	Android     *androidPointer `json:"androidApk,omitempty"`
}

type deployPointer struct {
	MJSPath    string `json:"mjsPath"`
	MJSSHA256  string `json:"mjsSha256"`
	CorePath   string `json:"corePath"`
	CoreSHA256 string `json:"coreSha256"`
}

type releaseManifest struct {
	Schema      int                 `json:"schema"`
	Version     string              `json:"version"`
	PublishedAt string              `json:"publishedAt"`
	SourceSHA   string              `json:"sourceSha"`
	Artifacts   map[string]artifact `json:"artifacts"`
}

type artifact struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type desktopPointer struct {
	Version string `json:"version"`
	Path    string `json:"path"`
	SHA256  string `json:"sha256"`
}

type androidPointer struct {
	Version     string `json:"version"`
	VersionName string `json:"versionName"`
	VersionCode int    `json:"versionCode"`
	PublishedAt string `json:"publishedAt"`
	SourceSHA   string `json:"sourceSha"`
	Path        string `json:"path"`
	SHA256      string `json:"sha256"`
	Size        int64  `json:"size"`
}
```

`releases.json` is schema 1 with `releases[]` entries containing version, publishedAt, sourceSha, manifestSha256, and every committed file's name/path/size/SHA-256. There is no changelog or `available` flag because published assets are never aged out.

- [ ] **Step 4: Validate the complete transaction before public mutation**

Verify every required session file exists and matches recorded size/SHA, parse schema 2 manifest, require its version/source/publishedAt to equal the session, require all three platform paths to match the fixed version directory, and validate optional Android manifest identity. Check free bytes through an injected function; production Linux uses `unix.Statfs`, non-Linux returns an unsupported error, and the commit requires declared remaining writes plus a 1 GiB safety margin.

- [ ] **Step 5: Implement one short in-process commit critical section**

Inside one `sync.Mutex`:

1. Read current stable; no file means the only accepted version is `v1.1`.
2. Otherwise require exactly `nextV1Version(current.version)`.
3. Rename the validated staging `files` directory to `public/releases/{version}` on the same filesystem.
4. Construct stable using versioned MJS paths and inherited optional pointers.
5. Atomically replace `stable.json` with temp + sync + rename.
6. Copy current version MJS to root `deploy.mjs`/`deploy-core.mjs` atomically.
7. Append and atomically replace `releases.json`.
8. Atomically write `publish-status.json` as succeeded and remove the now-empty session directory.

Anything before step 5 may fail without changing the old stable. Anything after step 5 is repairable from the version directory and stable.

- [ ] **Step 6: Add startup recovery without deleting successful releases**

On startup, if stable points to a complete version directory missing from `releases.json`, regenerate that history entry and root MJS. A version directory newer than stable is an uncommitted transaction: move it into a uniquely named staging recovery directory and let only the 24-hour staging janitor remove it later. Never directly delete from `public/releases`, never delete a version at or below stable, and never implement time/quantity/capacity retention.

- [ ] **Step 7: Expose `POST /commit` and map conflicts/storage errors**

Return stable JSON on success, `409` for version conflict, `422` for invalid transaction identity, and `507` for insufficient storage. All responses use generic error codes and omit paths outside the public root.

- [ ] **Step 8: Run tests and commit**

```powershell
Push-Location server
go test ./internal/releaseserver ./cmd/wheelmaker-release-server
Pop-Location
git add server/internal/releaseserver server/cmd/wheelmaker-release-server
git commit -m "feat: atomically publish release metadata"
```

Expected: tests PASS.

### Task 5: Add idempotent Windows-to-Ubuntu release-server deployment

**Files:**
- Create: `deploy-release-server.bat`
- Create: `scripts/release-server/deploy.mjs`
- Create: `scripts/release-server/deploy.test.mjs`
- Create: `scripts/release-server/nginx-bootstrap.conf`
- Create: `scripts/release-server/nginx.conf`
- Create: `scripts/release-server/wheelmaker-release-server.service`
- Create: `scripts/release-server/index.html`
- Modify: `scripts/release/entry.test.mjs`

- [ ] **Step 1: Write failing source and orchestration tests**

Assert the wrapper pauses and the MJS derives the host from channel.json, uses the dedicated key, never copies the private key, preserves remote config, and performs external health verification:

```js
test('release server deploy uses fixed derived SSH defaults', async () => {
  const deps = recordingDependencies();
  await deployReleaseServer(deps);
  assert.equal(deps.ssh.host, 'release.wheelmaker.top');
  assert.equal(deps.ssh.user, 'root');
  assert.equal(deps.ssh.port, 22);
  assert.match(deps.ssh.identityFile, /\.ssh[\\/]wheelmaker-release-server_ed25519$/);
  assert.equal(deps.scpFiles.some(path => path.endsWith('wheelmaker-release-server_ed25519')), false);
  assert.deepEqual(deps.healthChecks, ['https://release.wheelmaker.top/healthz']);
});

test('root BAT delegates to Node and pauses', async () => {
  const source = await readFile(new URL('../../deploy-release-server.bat', import.meta.url), 'utf8');
  assert.match(source, /scripts\\release-server\\deploy\.mjs/);
  assert.match(source, /set "EXIT_CODE=%ERRORLEVEL%"/i);
  assert.match(source, /pause/i);
  assert.match(source, /exit \/b %EXIT_CODE%/i);
});
```

- [ ] **Step 2: Run deployment tests and verify failure**

```powershell
node --test scripts/release-server/deploy.test.mjs scripts/release/entry.test.mjs
```

Expected: FAIL because the deployment entry and templates do not exist.

- [ ] **Step 3: Create the thin BAT wrapper**

Use this complete wrapper shape:

```bat
@echo off
setlocal
node "%~dp0scripts\release-server\deploy.mjs"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%
```

- [ ] **Step 4: Implement deterministic local build and upload orchestration**

`deploy.mjs` must:

- validate the channel and derive SSH host from the base URL;
- require a clean source SHA and `linux/amd64` remote architecture;
- verify `go`, `ssh`, and `scp` exist;
- build with `CGO_ENABLED=0 GOOS=linux GOARCH=amd64` into `.release-work/tmp/release-server-{sourceSha}/`;
- upload the binary and four templates to a unique `/tmp/wheelmaker-release-server-{sourceSha}/` directory;
- run only fixed remote commands with validated SHA/domain values;
- always clean the local temporary directory and request remote temporary cleanup.

The remote installation must create non-login user/group `wheelmaker-release`, `/srv/wheelmaker-release/{public,staging,data}`, `/etc/wheelmaker-release-server`, and `/opt/wheelmaker-release-server/versions/{sourceSha}`. Preserve an existing config; create only this initial value when absent:

```json
{
  "schema": 1,
  "listen": "127.0.0.1:9680",
  "dataRoot": "/srv/wheelmaker-release",
  "tokenSha256": ""
}
```

Own `/etc/wheelmaker-release-server` as `root:wheelmaker-release` mode `2750` and its config as `root:wheelmaker-release` mode `0640`. Own `/srv/wheelmaker-release` as `wheelmaker-release:www-data` mode `0750`, `public` as `wheelmaker-release:www-data` mode `2750`, and staging/data as `wheelmaker-release:wheelmaker-release` mode `0700`; public directories/files created by the service remain group-readable but not group-writable. Install the binary mode `0755`, switch `/opt/wheelmaker-release-server/current` atomically, install templates, run `systemctl daemon-reload`, enable/restart the service, run `nginx -t`, and reload Nginx.

- [ ] **Step 5: Add hardened systemd and Nginx templates**

The service must run as `wheelmaker-release`, execute only `serve --config`, restart on failure, set `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, and allow writes only to `/srv/wheelmaker-release`.

The final Nginx site must:

- redirect port 80 to HTTPS and serve TLS on 443 from the Certbot live certificate paths;
- serve `/srv/wheelmaker-release/public` with autoindex off;
- expose public GET/HEAD/Range and `Access-Control-Allow-Origin: *` for static content;
- proxy only `/api/` and `/healthz` to `127.0.0.1:9680`;
- set `proxy_request_buffering off` for `/api/` and `client_max_body_size 2g`;
- omit CORS headers on `/api/`.

For a first deployment without `/etc/letsencrypt/live/release.wheelmaker.top/fullchain.pem`, install `nginx-bootstrap.conf`, which listens only on port 80 and serves `/.well-known/acme-challenge/` plus the minimal index. After `nginx -t` and reload, run `certbot certonly --webroot --non-interactive --agree-tos --webroot-path /srv/wheelmaker-release/public --domain release.wheelmaker.top`, install the final TLS template, then re-test/reload Nginx. Later deployments detect the existing certificate and install only the final template. The current server already has a registered Certbot account; do not introduce Caddy or let Certbot rewrite the managed Nginx template.

- [ ] **Step 6: Add the minimal installation page**

`index.html` contains the exact no-timeout commands using the new root launcher:

```powershell
$ErrorActionPreference='Stop'; $d=Join-Path $HOME '.wheelmaker'; New-Item -ItemType Directory -Force -Path $d | Out-Null; $m=Join-Path $d 'deploy.mjs'; Invoke-WebRequest 'https://release.wheelmaker.top/deploy.mjs' -OutFile $m; & node $m migrate-uninstall; if ($LASTEXITCODE -eq 0) { & node $m }
```

```bash
(d="$HOME/.wheelmaker" && mkdir -p "$d" && curl --fail --location --progress-bar --proto '=https' --tlsv1.2 'https://release.wheelmaker.top/deploy.mjs' --output "$d/deploy.mjs" && node "$d/deploy.mjs" migrate-uninstall && node "$d/deploy.mjs")
```

- [ ] **Step 7: Run tests, cross-compile, and commit**

```powershell
node --test scripts/release-server/deploy.test.mjs scripts/release/entry.test.mjs
$env:CGO_ENABLED='0'; $env:GOOS='linux'; $env:GOARCH='amd64'
Push-Location server
go build -o ..\.release-work\tmp\wheelmaker-release-server-test .\cmd\wheelmaker-release-server
Pop-Location
Remove-Item Env:CGO_ENABLED,Env:GOOS,Env:GOARCH
git add deploy-release-server.bat scripts/release-server
git commit -m "feat: deploy the release server"
```

Expected: tests and cross-compilation PASS.

### Task 6: Replace GitHub publishing with the HTTPS client and automatic single-token bootstrap

**Files:**
- Create: `scripts/release/release-server-api.mjs`
- Create: `scripts/release/publisher-config.mjs`
- Create: `scripts/release/release-server-api.test.mjs`
- Create: `scripts/release/publisher-config.test.mjs`
- Modify: `scripts/release/publish.mjs`
- Modify: `scripts/release/publish.test.mjs`
- Modify: `scripts/release/cli.mjs`
- Modify: `scripts/release/cli.test.mjs`
- Modify: `scripts/release/progress.mjs`
- Modify: `scripts/release/progress.test.mjs`
- Delete: `scripts/release/github-api.mjs`
- Delete: `scripts/release/github-app.mjs`

- [ ] **Step 1: Write failing API and token-bootstrap tests**

Require streamed uploads, no timeout signal, one local token file, hash-only SSH provisioning, and stdin-only `gh secret set`:

```js
test('release server client streams an asset with declared identity and no deadline', async () => {
  const requests = [];
  const api = new ReleaseServerApi({
    baseUrl: 'https://release.wheelmaker.top',
    token: 'release-token',
    requestImpl: recordingHttpsRequest(requests, {statusCode: 204}),
  });
  await api.upload('session-1', {
    name: 'deploy.mjs', path: fixturePath, size: 18, sha256: 'a'.repeat(64),
  });
  assert.equal(requests[0].options.headers.Authorization, 'Bearer release-token');
  assert.equal(requests[0].options.headers['X-WheelMaker-SHA256'], 'a'.repeat(64));
  assert.equal(requests[0].options.timeout, undefined);
  assert.equal(requests[0].setTimeoutCalls.length, 0);
});

test('first local publish creates one token and sends only its hash', async () => {
  const deps = publisherConfigFixture();
  const token = await resolvePublisherToken({actions: false}, deps);
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  assert.deepEqual(JSON.parse(await deps.readConfig()), {schema: 1, token});
  assert.equal(deps.sshArgs.some(value => value === token), false);
  assert.equal(deps.sshArgs.some(value => /^[0-9a-f]{64}$/.test(value)), true);
  assert.equal(deps.ghStdin, token);
  assert.equal(deps.ghArgs.includes(token), false);
});

test('interrupted provisioning resumes from the protected pending token', async () => {
  const deps = publisherConfigFixture({failAfterRemoteConfigure: true});
  await assert.rejects(resolvePublisherToken({actions: false}, deps), /health check/);
  const pending = JSON.parse(await deps.readPendingConfig());
  deps.failAfterRemoteConfigure = false;
  const token = await resolvePublisherToken({actions: false}, deps);
  assert.equal(token, pending.token);
  assert.equal(await deps.pendingConfigExists(), false);
});

test('Action reads the same token only from its secret', async () => {
  await expectToken(resolvePublisherToken({actions: true}, actionDeps({WHEELMAKER_RELEASE_TOKEN: 'same-token'})), 'same-token');
});
```

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
node --test scripts/release/release-server-api.test.mjs scripts/release/publisher-config.test.mjs scripts/release/publish.test.mjs scripts/release/cli.test.mjs
```

Expected: FAIL because publishing still uses GitHub APIs and App credentials.

- [ ] **Step 3: Implement the HTTP client**

`ReleaseServerApi` owns `readStable`, `start`, `status`, `upload`, `commit`, and `cancel`. Every publishing request uses the shared Bearer token; `readStable` is anonymous and treats only 404 as an empty channel. `upload` uses Node's `https.request` with `Content-Length`, pipes `createReadStream` through a counting `Transform` with backpressure, reports byte/percent progress, and never sets a socket or total-duration timeout. Small JSON requests may use the same request helper. Map HTTP 409 to `ReleaseVersionConflictError`, 401/503 to actionable authentication errors, 507 to storage failure, and omit response bodies from errors when they could contain server internals.

- [ ] **Step 4: Implement zero-input local token initialization**

Use `%USERPROFILE%\.wheelmaker\release-server.json` / `~/.wheelmaker/release-server.json` with exact schema:

```json
{
  "schema": 1,
  "token": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
}
```

The token above is a deterministic 32-byte test/example value; production always uses `randomBytes(32).toString('base64url')`.

When absent, generate the token in memory, compute SHA-256, then spawn SSH with this argument structure (the final array element is the computed `tokenHash` variable):

```js
[
  '-i', identityFile, '-p', '22', 'root@release.wheelmaker.top',
  '/opt/wheelmaker-release-server/current/wheelmaker-release-server',
  'configure-token', '--config',
  '/etc/wheelmaker-release-server/config.json', '--sha256', tokenHash,
]
```

Before SSH, atomically persist the generated schema 1 document as `release-server.json.pending` with current-user-only permissions (`0600` on POSIX; remove inheritance and grant the current Windows user through `icacls`). After `configure-token` succeeds, run a second fixed SSH command for `systemctl restart wheelmaker-release-server`, then poll public health until `publisherConfigured` is true. Atomically rename the protected pending file to `release-server.json`; a later run must resume a surviving pending Token instead of generating a different one, so a crash after remote provisioning cannot lose the only matching secret.

After the final local file exists, if both `gh --version` and `gh auth status` succeed, pipe the raw token to `gh secret set WHEELMAKER_RELEASE_TOKEN` through stdin; never place it in argv. If `gh` is absent, unauthenticated, or Secret update fails, retain the working local Token and print an actionable warning instead of regenerating it or failing the local publish. Subsequent local publishes read the final file without prompts or SSH. Actions require `WHEELMAKER_RELEASE_TOKEN` and never use SSH. The first Action publish is supported only after one successful local Token initialization has configured both the server and (when available) the repository Secret.

- [ ] **Step 5: Rewrite packaging for the exact server version directory**

`packageBuiltRelease` must emit schema 2 manifest `path` fields and copy rendered `deploy.mjs` plus `deploy-core.mjs` into `.release-out/{version}/`. Render the launcher from one marker using `channel.baseUrl`; reject zero or multiple markers. The final directory contains exactly:

```text
deploy.mjs
deploy-core.mjs
release-manifest.json
wheelmaker-v1.x-windows-amd64.tar.gz
wheelmaker-v1.x-linux-amd64.tar.gz
wheelmaker-v1.x-darwin-arm64.tar.gz
WheelMakerDesktop.exe                 optional
WheelMakerAndroid.apk                 optional
android-release.json                  optional
```

MJS files are not inside any tar.gz.

- [ ] **Step 6: Start the remote session before public builds and publish through it**

For public mode, order `runRelease` as:

```text
resolve source SHA → resolve version → resolve token/client → start session
→ status building → build → status packaging → package
→ status uploading → upload every final file → status committing → commit
```

Use the server-returned `publishedAt` in release manifest and stable-linked metadata. On any failure before commit, write a generic failed status then cancel the session. A 409 retains the existing full rebuild behavior: re-read stable, allocate the next version, create a new session, and rebuild all versioned artifacts. Local no-publish mode still reads public stable (404 means v1.1), creates the identical final directory, and never authenticates or opens a remote session.

- [ ] **Step 7: Remove GitHub-specific production code and tests**

Delete both GitHub modules and replace JWT/App/Release tests with server API tests. There must be no draft cleanup, tag creation, public repository commit, GitHub App environment parsing, or `gh auth token` path. Keep `gh` only for Action triggering/watching and the optional secret initialization.

- [ ] **Step 8: Run release tests and commit**

```powershell
node --test scripts/release/*.test.mjs
git add -A scripts/release
git commit -m "feat: publish releases over HTTPS"
```

Expected: all release tests PASS and the deleted GitHub adapters are absent.

### Task 7: Switch the manual Action and interactive copy to the shared server token

**Files:**
- Modify: `.github/workflows/publish-release.yml`
- Modify: `scripts/release/entry.mjs`
- Modify: `scripts/release/entry.test.mjs`
- Modify: `publish-release.bat`
- Modify: `publish-release-action.bat`

- [ ] **Step 1: Write failing workflow assertions**

Replace the credential assertions with:

```js
test('manual Action requires only the release server token', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/publish-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /WHEELMAKER_RELEASE_TOKEN/);
  assert.doesNotMatch(workflow, /WHEELMAKER_RELEASE_APP_ID/);
  assert.doesNotMatch(workflow, /WHEELMAKER_RELEASE_INSTALLATION_ID/);
  assert.doesNotMatch(workflow, /WHEELMAKER_RELEASE_APP_PRIVATE_KEY/);
  assert.match(workflow, /node scripts\/release\.mjs/);
});
```

Update interactive text assertions to require “release server” instead of “public release repository”; keep Desktop, Android, and public questions plus Action watch/log behavior.

- [ ] **Step 2: Run entry tests and verify failure**

```powershell
node --test scripts/release/entry.test.mjs scripts/release/cli.test.mjs
```

Expected: FAIL on the old GitHub App secrets and copy.

- [ ] **Step 3: Simplify the workflow secret preflight**

Before checkout, require only nonempty `${{ secrets.WHEELMAKER_RELEASE_TOKEN }}`. Pass it only to the final build/publish step as `WHEELMAKER_RELEASE_TOKEN`. Preserve the existing manual ref validation, single Ubuntu job, one Web build, Go/webpack/Gradle caches, and optional Android/Desktop setup.

- [ ] **Step 4: Update interactive operator copy without adding parameters**

Keep both BAT wrappers thin and paused. `publish-release.bat` still asks Desktop, Android, and whether to publish; `publish-release-action.bat` still checks the pushed commit, asks optional assets, triggers, displays the Action URL, watches steps, and prints failed logs. Do not add server/token questions.

- [ ] **Step 5: Run tests and commit**

```powershell
node --test scripts/release/entry.test.mjs scripts/release/cli.test.mjs
git add .github/workflows/publish-release.yml scripts/release/entry.mjs scripts/release/entry.test.mjs publish-release.bat publish-release-action.bat
git commit -m "ci: publish to the release server"
```

Expected: tests PASS.

### Task 8: Move deploy launcher, core, migration, and Desktop update to schema 2 paths

**Files:**
- Modify: `scripts/deploy/deploy.mjs`
- Modify: `scripts/deploy/deploy.test.mjs`
- Modify: `scripts/deploy/deploy-core.mjs`
- Modify: `scripts/deploy/deploy-core.test.mjs`

- [ ] **Step 1: Write failing schema 2 and same-origin tests**

Use rendered launcher bytes and root-relative paths:

```js
test('launcher resolves only same-origin schema 2 paths', async () => {
  const stable = {
    schema: 2,
    version: 'v1.1',
    publishedAt: '2026-07-17T09:00:00Z',
    sourceSha: 'a'.repeat(40),
    deploy: {
      mjsPath: '/releases/v1.1/deploy.mjs', mjsSha256: 'b'.repeat(64),
      corePath: '/releases/v1.1/deploy-core.mjs', coreSha256: 'c'.repeat(64),
    },
    release: {manifestPath: '/releases/v1.1/release-manifest.json', manifestSha256: 'd'.repeat(64)},
  };
  const validated = validateStable(stable, 'https://release.wheelmaker.top');
  assert.equal(validated.deploy.coreUrl, 'https://release.wheelmaker.top/releases/v1.1/deploy-core.mjs');
  assert.throws(() => validateStable({...stable, release: {...stable.release, manifestPath: '//evil.example/x'}}, 'https://release.wheelmaker.top'), /same origin/);
});

test('migration resets old-channel installed metadata', async () => {
  await seedFile(home, 'release.json', '{"schemaVersion":2,"version":"v1.5"}\n');
  await runCore(['migrate-uninstall'], fixtureDeps);
  assert.equal(await exists(join(home, 'release.json')), false);
});
```

Update platform and Desktop fixtures to manifest schema 2 `path` and stable `desktopExe.path`.

- [ ] **Step 2: Run deploy tests and verify failure**

```powershell
node --test scripts/deploy/*.test.mjs
```

Expected: FAIL because deploy validates schema 1 absolute URLs.

- [ ] **Step 3: Render the standalone launcher from the canonical base URL**

Replace the GitHub constant with one exact marker:

```js
export const RELEASE_BASE_URL = '__WHEELMAKER_RELEASE_BASE_URL__';
export const STABLE_PATH = '/stable.json';
```

The release packager replaces the marker with `https://release.wheelmaker.top`. `createDefaultDependencies` constructs stable URL from the rendered base. Source tests must render a temporary launcher before executing defaults; production launcher must fail clearly if the marker remains.

- [ ] **Step 4: Validate schema 2 root paths and resolve one trusted origin**

Add a resolver that accepts only strings beginning with one `/`, rejects credentials/query fragments where not expected, resolves against the rendered base, and enforces equal origin. Validate stable identity, MJS hashes, manifest pointer, Desktop pointer, and Android pointer. Pass the resolved trusted base into core rather than letting core accept arbitrary origins.

- [ ] **Step 5: Update core manifest, package, and Desktop downloads**

Core requires manifest schema 2 and resolves `artifact.path`, `stable.release.manifestPath`, and `desktopExe.path` against the trusted base. Preserve existing maximum sizes, progress output, no total download timeout, secure tar extraction, `bin/web/desktop` layout, update non-admin boundary, start/stop wrappers, and SHA verification before execution/extraction.

- [ ] **Step 6: Reset the old channel only in migrate-uninstall**

Delete local `release.json` during `migrate-uninstall` after stopping old runtimes; preserve config, databases, logs, Desktop, and user data. Normal deploy/update must not contain GitHub migration checks. Successful installation writes the existing local schemaVersion 2 metadata with the new v1.1+ version.

- [ ] **Step 7: Run deploy tests and commit**

```powershell
node --test scripts/deploy/*.test.mjs
git add scripts/deploy
git commit -m "feat: deploy from self-hosted release paths"
```

Expected: tests PASS.

### Task 9: Move Web history and Android APK metadata to the canonical release origin

**Files:**
- Create: `app/web/src/settings/releaseChannel.ts`
- Modify: `app/web/src/settings/agentPackageUpdateView.ts`
- Modify: `app/web/src/platform/android/androidApkUpdate.ts`
- Modify: `app/web/src/settings/UpdateSettingsDetail.tsx`
- Modify: `app/web/webpack.config.js`
- Modify: `app/__tests__/web-agent-package-update-settings.test.ts`
- Modify: `app/__tests__/web-agent-package-update-view.test.ts`
- Modify: `app/__tests__/web-android-apk-update.test.ts`
- Modify: `app/__tests__/web-security-policy.test.ts`
- Modify: `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidApkUpdateRuntimeTest.kt`

- [ ] **Step 1: Write failing Web schema, history, Android, and CSP tests**

Use the self-hosted payloads:

```ts
test('loads schema 2 metadata and release history from one origin', async () => {
  expect(WHEELMAKER_STABLE_URL).toBe('https://release.wheelmaker.top/stable.json');
  expect(WHEELMAKER_PUBLISH_STATUS_URL).toBe('https://release.wheelmaker.top/publish-status.json');
  expect(WHEELMAKER_RELEASE_HISTORY_URL).toBe('https://release.wheelmaker.top/releases.json');
  const history = await fetchWheelMakerReleaseHistory(mockJson({
    schema: 1,
    releases: [{
      version: 'v1.1', publishedAt: '2026-07-17T09:00:00Z',
      sourceSha: 'a'.repeat(40), manifestSha256: 'b'.repeat(64), assets: [],
    }],
  }));
  expect(history).toEqual([{
    version: 'v1.1',
    publishedAt: '2026-07-17T09:00:00Z',
    url: 'https://release.wheelmaker.top/releases/v1.1/release-manifest.json',
  }]);
});

test('Android pointer resolves its root-relative path', () => {
  const latest = parseAndroidStableRelease({
    schema: 2,
    version: 'v1.1',
    androidApk: {
      version: 'v1.1', versionName: '1.1', versionCode: 1,
      publishedAt: '2026-07-17T09:00:00Z', sourceSha: 'a'.repeat(40),
      path: '/releases/v1.1/WheelMakerAndroid.apk', sha256: 'b'.repeat(64), size: 1024,
    },
  });
  expect(latest?.apk.downloadUrl).toBe('https://release.wheelmaker.top/releases/v1.1/WheelMakerAndroid.apk');
});
```

Change CSP expectation to `connect-src 'self' wss: https://release.wheelmaker.top` with no GitHub API/raw hosts.

- [ ] **Step 2: Run focused App tests and verify failure**

```powershell
Push-Location app
npm test -- web-agent-package-update-settings.test.ts web-agent-package-update-view.test.ts web-android-apk-update.test.ts web-security-policy.test.ts --runInBand
Pop-Location
```

Expected: FAIL on GitHub constants and schema 1 fields.

- [ ] **Step 3: Import the canonical JSON without duplicating the URL**

Create `releaseChannel.ts`:

```ts
import channel from '../../../../scripts/release/channel.json';

const base = new URL(channel.baseUrl);
if (base.protocol !== 'https:' || base.origin + base.pathname.replace(/\/$/, '') !== channel.baseUrl) {
  throw new Error('Invalid WheelMaker release channel.');
}

export const WHEELMAKER_RELEASE_BASE_URL = channel.baseUrl;

export function wheelMakerReleaseUrl(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid WheelMaker release path.');
  const url = new URL(path, `${WHEELMAKER_RELEASE_BASE_URL}/`);
  if (url.origin !== base.origin) throw new Error('Invalid WheelMaker release origin.');
  return url.href;
}
```

Webpack reads the same JSON for CSP and adds it to filesystem cache build dependencies. Do not add a fallback URL literal.

- [ ] **Step 4: Parse schema 2 public metadata and history**

Build stable/status/history URLs with `wheelMakerReleaseUrl`. Replace Android `url` with validated `path`. Parse `releases.json` schema 1, validate versions/timestamps/SHA fields, map history links to each version manifest, sort newest first, and keep the existing ten-entry UI limit. Remove GitHub Accept headers and draft/prerelease fields.

- [ ] **Step 5: Resolve Android download paths before the native bridge**

`parseAndroidStableRelease` requires stable schema 2 and calls `wheelMakerReleaseUrl(pointer.path)` to produce `downloadUrl`. Native Kotlin remains generic HTTPS downloader code; replace GitHub-specific redirect examples in its tests with same-origin/alternate HTTPS fixtures so active tests no longer encode the retired host.

- [ ] **Step 6: Update UI copy and CSP**

Change “public releases” to “releases” and “No public releases” to “No releases”. CSP permits only the release origin needed by stable/status/history/APK downloads; keep other existing directives unchanged.

- [ ] **Step 7: Run focused and type tests, then commit**

```powershell
Push-Location app
npm test -- web-agent-package-update-settings.test.ts web-agent-package-update-view.test.ts web-android-apk-update.test.ts web-security-policy.test.ts --runInBand
npm run tsc:web
Pop-Location
Push-Location mobile\android
.\gradlew.bat testDebugUnitTest --tests com.wheelmaker.android.AndroidApkUpdateRuntimeTest
Pop-Location
git add app/web/src/settings app/web/src/platform/android app/web/webpack.config.js app/__tests__/web-agent-package-update-settings.test.ts app/__tests__/web-agent-package-update-view.test.ts app/__tests__/web-android-apk-update.test.ts app/__tests__/web-security-policy.test.ts mobile/android/app/src/test/java/com/wheelmaker/android/AndroidApkUpdateRuntimeTest.kt
git commit -m "feat: query self-hosted release metadata"
```

Expected: tests and typecheck PASS.

### Task 10: Update active documentation and security acceptance, then remove retired hosting references

**Files:**
- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `CLAUDE.md`
- Modify: `server/CLAUDE.md`
- Modify: `docs/security.md`
- Modify: `docs/security-known-risks.md`
- Modify: `docs/prebuilt-release-deployment-design.md`
- Modify: `docs/self-hosted-release-server-design.md`
- Modify: `scripts/release/entry.test.mjs`
- Modify: `scripts/security_acceptance.ps1`
- Modify: `scripts/security_acceptance.sh`
- Modify: `scripts/test_security_docs.ps1`

- [ ] **Step 1: Add failing documentation and forbidden-host assertions**

Extend release entry/security tests to require:

```js
for (const path of ['README.md', 'INSTALL.md', 'CLAUDE.md']) {
  const source = await readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /raw\.githubusercontent\.com\/swm8023\/wheelmaker-release/);
  assert.doesNotMatch(source, /WHEELMAKER_RELEASE_APP_(ID|PRIVATE_KEY)/);
}
```

Security acceptance scans active production/release files for retired URLs and credentials while excluding explicitly historical superseded documents:

```text
raw.githubusercontent.com/swm8023/wheelmaker-release
api.github.com/repos/swm8023/wheelmaker-release
github.com/swm8023/wheelmaker-release/releases
WHEELMAKER_RELEASE_APP_ID
WHEELMAKER_RELEASE_INSTALLATION_ID
WHEELMAKER_RELEASE_APP_PRIVATE_KEY
```

- [ ] **Step 2: Run the documentation/security source tests and verify failure**

```powershell
node --test scripts/release/entry.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_security_docs.ps1
```

Expected: FAIL on current GitHub installation and credential instructions.

- [ ] **Step 3: Rewrite active operator documentation**

Document:

- `release.wheelmaker.top` anonymous downloads and authenticated uploads;
- first release is a fresh `v1.1`, with no GitHub v1.5 migration;
- one-line install/migration commands from the release site;
- one automatic shared Token, local config path, optional automatic `gh secret set`, and Action secret name;
- `deploy-release-server.bat` prerequisites and independent server deployment;
- schema 2 relative paths, stable-last behavior, versioned MJS outside tar.gz;
- all published assets retained indefinitely and disk-full behavior;
- Web history from `releases.json`, with Hub still local-state-only.

Add the publishing trust boundary to `docs/security.md`: the raw shared Token exists only in the publisher user's protected home file and the private repository Secret, the release server stores only SHA-256, and browsers/downloaders never receive it. Record the accepted single-server/no-automatic-backup availability risk and the shared publisher Token blast radius in `docs/security-known-risks.md`; do not add an unapproved rotation system. Extend `test_security_docs.ps1` to require these statements.

Mark `docs/prebuilt-release-deployment-design.md` as superseded by the self-hosted design rather than rewriting its historical GitHub implementation. Keep `docs/self-hosted-release-server-design.md` status “待实施” until real rollout succeeds.

- [ ] **Step 4: Add the new release-server gates**

Both security acceptance scripts run:

```text
go test ./internal/releaseserver ./cmd/wheelmaker-release-server
node --test scripts/release-server/*.test.mjs scripts/release/*.test.mjs scripts/deploy/*.test.mjs
```

They also verify the release service bind address is loopback in its template, the Nginx API location has no wildcard CORS, publisher config code resolves the secret only below the user's home directory, and no private SSH key or raw Token is copied by deployment source.

- [ ] **Step 5: Run targeted documentation/security tests and commit**

```powershell
node --test scripts/release/entry.test.mjs scripts/release-server/deploy.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_security_docs.ps1
git add README.md INSTALL.md CLAUDE.md server/CLAUDE.md docs/security.md docs/security-known-risks.md docs/prebuilt-release-deployment-design.md docs/self-hosted-release-server-design.md scripts/release/entry.test.mjs scripts/security_acceptance.ps1 scripts/security_acceptance.sh scripts/test_security_docs.ps1
git commit -m "docs: document self-hosted releases"
```

Expected: tests PASS.

### Task 11: Run full acceptance, deploy the service, and perform the controlled v1.1 cutover

**Files:**
- Modify after successful rollout: `docs/self-hosted-release-server-design.md`
- Modify after successful rollout: `docs/scope/2026-07-17-self-hosted-release-server.md` only if a verified production fact differs from the approved spec

- [ ] **Step 1: Run all local automated acceptance**

```powershell
node --test scripts/release-server/*.test.mjs scripts/release/*.test.mjs scripts/deploy/*.test.mjs
Push-Location server
go test ./...
Pop-Location
Push-Location app
npm test -- --runInBand
npm run tsc:web
npm run build:web:release
Pop-Location
Push-Location mobile\android
.\gradlew.bat testDebugUnitTest
Pop-Location
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security_acceptance.ps1
```

Expected: every command exits 0; security acceptance prints `Security acceptance: PASS`.

- [ ] **Step 2: Verify repository hygiene before touching production**

```powershell
rg -n "raw\.githubusercontent\.com/swm8023/wheelmaker-release|api\.github\.com/repos/swm8023/wheelmaker-release|github\.com/swm8023/wheelmaker-release/releases|WHEELMAKER_RELEASE_APP_(ID|PRIVATE_KEY)|WHEELMAKER_RELEASE_INSTALLATION_ID" CLAUDE.md README.md INSTALL.md scripts app/web/src mobile/android/app/src/main .github --glob '!**/dist/**'
git diff --check
git status --short
```

Expected: `rg` returns no active matches, diff check passes, and only intentional implementation changes/commits exist. Do not touch unrelated historical task records unless their owning task has separately committed them.

- [ ] **Step 3: Deploy the release server to the confirmed Ubuntu host**

Run interactively:

```powershell
.\deploy-release-server.bat
```

Expected: cross-compile, SCP, idempotent remote setup, Nginx/Certbot, systemd restart, external health check, and BAT pause all succeed.

- [ ] **Step 4: Verify remote service isolation and public HTTP behavior**

Before the repository completion tail, run:

```powershell
$key = Join-Path $HOME '.ssh\wheelmaker-release-server_ed25519'
ssh -i $key root@release.wheelmaker.top "systemctl is-active wheelmaker-release-server; systemctl show wheelmaker-release-server -p User -p Group; ss -lntp | grep 127.0.0.1:9680; nginx -t"
Invoke-RestMethod https://release.wheelmaker.top/healthz
curl.exe -I https://release.wheelmaker.top/
curl.exe -sS -o NUL -w "%{http_code}`n" -X POST https://release.wheelmaker.top/api/publish/start
```

Expected: service active as `wheelmaker-release`, port 9680 loopback-only, Nginx valid, health 200, root page 200, unauthenticated publish 503 before first Token initialization. Existing `wheelmaker.top` and port 9630 remain untouched.

- [ ] **Step 5: Run a real no-publish v1.1 build**

With the new server still missing stable:

```powershell
node scripts/release.mjs
Get-ChildItem .release-out\v1.1 -File | Select-Object Name,Length
```

Expected: the final directory contains rendered MJS, schema 2 manifest, and three platform archives; no remote session or Token file is created in no-publish mode.

- [ ] **Step 6: Obtain explicit approval for the first external product publish**

Ask the user to confirm whether the controlled `v1.1` should include Desktop and/or Android. Do not infer optional assets and do not run a public product publish until that selection is explicit. The selected command is exactly one of:

```powershell
node scripts/release.mjs --publish
node scripts/release.mjs --with-desktop --publish
node scripts/release.mjs --with-android --publish
node scripts/release.mjs --with-desktop --with-android --publish
```

- [ ] **Step 7: Publish v1.1 and verify the public trust chain**

Run the approved command, then verify before the final Git tail:

```powershell
$stable = Invoke-RestMethod https://release.wheelmaker.top/stable.json
if ($stable.schema -ne 2 -or $stable.version -ne 'v1.1') { throw 'unexpected stable version' }
Invoke-WebRequest https://release.wheelmaker.top/releases.json -OutFile $env:TEMP\wheelmaker-releases.json
curl.exe -I https://release.wheelmaker.top/releases/v1.1/release-manifest.json
curl.exe -r 0-1023 -o NUL -sS -w "%{http_code} %{size_download}`n" https://release.wheelmaker.top/releases/v1.1/wheelmaker-v1.1-windows-amd64.tar.gz
```

Expected: Token generation/provisioning is noninteractive, stable/history are valid, manifest HEAD is 200, Range returns 206 with 1024 bytes, and public status is succeeded. Do not run the migration one-liner on the release server itself because it already hosts an unrelated WheelMaker runtime.

- [ ] **Step 8: Mark the verified design implemented**

Change only the self-hosted design status from `待实施` to `已实施`, and record the verified production date/domain without adding secrets or server-local paths.

- [ ] **Step 9: Execute the repository completion tail exactly**

These must be the final shell commands, with no command after push:

```powershell
git add -A
git commit -m "feat: launch self-hosted releases"
git push origin main
```

Expected: all three commands succeed. If unrelated untracked work still exists, stop before this step and get its owner/user disposition rather than absorbing it into this commit.

## Self-review

Spec coverage:

- Single base URL, schema 2 relative paths, fresh v1.1, and no GitHub migration: Tasks 1, 6, and 8.
- Loopback Go service, one hashed Token, streaming upload, limits, status, sessions, and no manual lock: Tasks 2–4.
- Stable-last atomic publication, optional pointer inheritance, permanent assets, history, disk failure, and crash recovery: Task 4.
- Root/versioned MJS, no MJS in tar.gz, launcher/core self-update, Desktop/Android, and migration reset: Tasks 6, 8, and 9.
- Idempotent root-SSH Windows deployment, non-root runtime, existing Nginx/Certbot, public CORS/static downloads, and no Caddy/Docker/database: Task 5.
- Local and manual Action parity, automatic shared token file/hash/Secret, progress, no total timeout, and 409 rebuild: Tasks 6 and 7.
- Web status/history without GitHub, Android URL resolution, Hub protocol invariance, docs/security cleanup, and production rollout: Tasks 9–11.
- Published-asset deletion, rollback, backup, multi-server, CDN, download authentication, and protocol changes remain outside scope.

Type consistency:

- Public stable and release manifest use `schema: 2`; public history/session/status/config use `schema: 1`; installed local `release.json` remains `schemaVersion: 2`.
- Public locations are always root-relative `path`; only boundary helpers produce absolute HTTPS URLs.
- The shared raw secret is always `token`; the server stores only `tokenSha256`; the Action secret is `WHEELMAKER_RELEASE_TOKEN`.
- Session phases are `validating`, `building`, `packaging`, `uploading`, `committing`, and `updating-stable`; terminal states are `succeeded` and `failed`.
- Release server paths are `/srv/wheelmaker-release`, `/etc/wheelmaker-release-server`, `/opt/wheelmaker-release-server`, and loopback `127.0.0.1:9680`.
- Product versions are only `v1.x`; an absent self-hosted stable means `v1.1`, never GitHub v1.5.
