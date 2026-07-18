# Darwin AMD64 Release Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Intel macOS (`darwin-amd64`) as a fourth first-class WheelMaker Hub/Web release target that can be built, published, installed, and updated through the existing trusted release chain.

**Architecture:** Extend the existing platform matrix rather than introducing a new updater path. The Node release builder will cross-compile a CGO-free Darwin/AMD64 Hub, the deploy core will map Node's `darwin/x64` identity to the new artifact key, and the Go release server will derive both its upload allowlist and manifest validation from one four-platform list. Existing stable/manifest schemas and Registry protocols remain unchanged because artifacts are already represented as a keyed map.

**Tech Stack:** Node.js ES modules and `node:test`, Go release server and `go test`, cross-compiled CGO-free Go Hub binaries, Markdown release documentation.

---

### Task 1: Build and package the fourth release target

**Files:**
- Modify: `scripts/release/build.test.mjs:44-85`
- Modify: `scripts/release/build.test.mjs:285-305`
- Modify: `scripts/release/publish.test.mjs:21-35`
- Modify: `scripts/release/publish.test.mjs:79-113`
- Modify: `scripts/release/build.mjs:7-26`

- [ ] **Step 1: Write the failing build expectation**

Rename the first build test to `release build compiles Web once and exactly four Hub targets` and make its target expectation include the Intel macOS binary:

```js
assert.deepEqual(hubTargets, [
  { target: 'darwin/amd64', binary: 'wheelmaker' },
  { target: 'darwin/arm64', binary: 'wheelmaker' },
  { target: 'linux/amd64', binary: 'wheelmaker' },
  { target: 'windows/amd64', binary: 'wheelmaker.exe' },
]);
```

Add `Building darwin-amd64` to the existing progress expectation. Extend the publisher fixture and exact asset/manifest expectations with:

```js
['darwin-amd64', 'wheelmaker']
```

```js
'wheelmaker-v1.1-darwin-amd64.tar.gz'
```

```js
'darwin-amd64': '/releases/v1.1/wheelmaker-v1.1-darwin-amd64.tar.gz'
```

- [ ] **Step 2: Run the release tests and verify RED**

Run:

```bash
node --test scripts/release/build.test.mjs scripts/release/publish.test.mjs
```

Expected: FAIL because the build runner records no `darwin/amd64` Hub target and no `Building darwin-amd64` progress event.

- [ ] **Step 3: Add the minimal release target**

Add this entry next to the existing Darwin target in `RELEASE_TARGETS`:

```js
{
  key: 'darwin-amd64',
  GOOS: 'darwin',
  GOARCH: 'amd64',
  binary: 'wheelmaker',
},
```

Keep `CGO_ENABLED=0`, the shared Web build, archive naming, and manifest generation unchanged.

- [ ] **Step 4: Run the release tests and verify GREEN**

Run:

```bash
node --test scripts/release/build.test.mjs scripts/release/publish.test.mjs
```

Expected: PASS with four platform packages represented in the build result and schema 2 manifest.

### Task 2: Select and stage Intel macOS packages on target machines

**Files:**
- Modify: `scripts/deploy/deploy-core.test.mjs:7-20`
- Modify: `scripts/deploy/deploy-core.test.mjs:442-528`
- Modify: `scripts/deploy/deploy-core.mjs:472-495`

- [ ] **Step 1: Write failing platform mapping and staging tests**

Import `currentPlatformKey` in `deploy-core.test.mjs` and add:

```js
test('platform mapping includes Intel macOS releases', () => {
  assert.equal(currentPlatformKey('darwin', 'x64'), 'darwin-amd64');
  assert.equal(currentPlatformKey('darwin', 'arm64'), 'darwin-arm64');
});
```

Convert the existing `manifest and completed archive are verified before extraction` fixture from `windows-amd64` to `darwin-amd64`: create `hub/wheelmaker`, use the `darwin-amd64` manifest key and URL, pass `platform: 'darwin-amd64'`, and expect the label `darwin-amd64 release package`.

- [ ] **Step 2: Run the deploy test and verify RED**

Run:

```bash
node --test scripts/deploy/deploy-core.test.mjs
```

Expected: FAIL with `unsupported deployment platform: darwin/x64` and/or `unsupported deployment platform: darwin-amd64`.

- [ ] **Step 3: Add the minimal platform mapping and allowlist entry**

Extend `currentPlatformKey` with:

```js
if (key === 'darwin/x64') return 'darwin-amd64';
```

Extend the staging allowlist so it accepts exactly these host keys:

```js
[
  'windows-amd64',
  'linux-amd64',
  'darwin-amd64',
  'darwin-arm64',
]
```

- [ ] **Step 4: Run the deploy test and verify GREEN**

Run:

```bash
node --test scripts/deploy/deploy-core.test.mjs
```

Expected: PASS, including full manifest/hash/extraction coverage for the Intel macOS artifact.

### Task 3: Accept and validate four-platform publications

**Files:**
- Modify: `server/internal/releaseserver/session_test.go:102-143`
- Modify: `server/internal/releaseserver/commit_test.go:18-56`
- Modify: `server/internal/releaseserver/commit_test.go:201-255`
- Modify: `server/internal/releaseserver/session.go:25-33`
- Modify: `server/internal/releaseserver/session.go:553-569`
- Modify: `server/internal/releaseserver/commit.go:169-183`

- [ ] **Step 1: Write failing upload and commit expectations**

In `TestUploadRejectsDeclaredFileAndSessionLimitsBeforeReadingBody`, assert that the started session allows:

```go
"wheelmaker-v1.1-darwin-amd64.tar.gz"
```

Extend `prepareCompleteTestSession` with:

```go
"wheelmaker-" + request.Version + "-darwin-amd64.tar.gz": []byte("darwin amd64 archive"),
```

Build its test manifest from this explicit expectation:

```go
[]string{"windows-amd64", "linux-amd64", "darwin-amd64", "darwin-arm64"}
```

Update `TestFirstCommitCreatesV11Schema2StableAndHistory` to assert the Intel macOS file exists in the committed directory and that the base release history contains seven assets.

- [ ] **Step 2: Run the release server tests and verify RED**

Run from `server/`:

```bash
go test ./internal/releaseserver -count=1
```

Expected: FAIL because the session upload allowlist rejects the new file and commit validation still requires exactly three artifacts.

- [ ] **Step 3: Define one shared four-platform server list**

Add one package-level array in `session.go`:

```go
var releasePlatforms = [...]string{
	"windows-amd64",
	"linux-amd64",
	"darwin-amd64",
	"darwin-arm64",
}
```

Build the three control-file entries first, then populate platform archive rules by ranging over `releasePlatforms`:

```go
for _, platform := range releasePlatforms {
	name := "wheelmaker-" + request.Version + "-" + platform + ".tar.gz"
	files[name] = fileRule{MaxSize: maxBinaryFileSize}
}
```

In `commit.go`, require `len(manifest.Artifacts) == len(releasePlatforms)` and range over the same array when validating paths, hashes, and sizes. Do not change schema numbers or request fields.

- [ ] **Step 4: Format and run the release server tests GREEN**

Run:

```bash
gofmt -w internal/releaseserver/session.go internal/releaseserver/session_test.go internal/releaseserver/commit.go internal/releaseserver/commit_test.go
go test ./internal/releaseserver -count=1
```

Expected: PASS with the new archive required for every complete publication.

### Task 4: Update current release documentation

**Files:**
- Modify: `README.md:354-365`
- Modify: `README.md:605-611`
- Modify: `docs/wiki/release-and-build/build.md:63-87`
- Modify: `docs/self-hosted-release-server-design.md:119-138`

- [ ] **Step 1: Document the fourth target and unchanged trust model**

Correct the README local release layout to show the final `.tar.gz` packages and flat control/optional assets, add `wheelmaker-v1.x-darwin-amd64.tar.gz`, and state that release builds cross-compile both macOS Intel and Apple Silicon Hubs.

In the build wiki, list:

```text
windows-amd64
linux-amd64
darwin-amd64
darwin-arm64
```

Change `三个 Hub 构建` to `四个 Hub 构建` and add `wheelmaker-v1.x-darwin-amd64.tar.gz` to the artifact tree.

In the current self-hosted release server design, change the maximum full publication from 9 to 10 files and `三平台 Hub` to `四平台 Hub`. Preserve historical scope/spec files as records of the superseded three-platform decision.

- [ ] **Step 2: Check documentation consistency**

Run:

```bash
rg -n --glob '!**/dist/**' 'three Hub|three platform|三平台|三个 Hub|三个平台|三个 Hub 构建|三份完整' README.md INSTALL.md docs/wiki docs/self-hosted-release-server-design.md
```

Expected: no current documentation claims that formal releases contain only three Host platforms.

### Task 5: Verify the integrated change and publish the branch

**Files:**
- Verify all modified files
- Commit the plan and implementation together according to the repository completion gate

- [ ] **Step 1: Run all relevant Node tests**

Run:

```bash
node --test scripts/release/*.test.mjs scripts/deploy/*.test.mjs
```

Expected: all relevant Node release/deploy tests pass; platform-specific skips remain skips.

- [ ] **Step 2: Run all Go tests**

Run from `server/`:

```bash
go test ./...
```

Expected: all Go packages pass.

- [ ] **Step 3: Cross-compile and inspect the real Intel macOS Hub**

Run from `server/`:

```bash
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -trimpath -o /private/tmp/wheelmaker-darwin-amd64-smoke ./cmd/wheelmaker
file /private/tmp/wheelmaker-darwin-amd64-smoke
rm -f /private/tmp/wheelmaker-darwin-amd64-smoke
```

Expected: `file` reports a Mach-O 64-bit x86_64 executable.

- [ ] **Step 4: Review repository state**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: only the planned source, test, documentation, and plan files are modified; no build output is tracked.

- [ ] **Step 5: Execute the repository completion gate**

Run exactly:

```bash
git add -A
git commit -m "feat(release): add Intel macOS host packages"
git push origin feat/darwin-amd64-release
```

Expected: the feature branch is committed and pushed. Do not deploy the release server and do not run a public release command in this task.
