# Protocol Domain Hard Cut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Registry protocol domain cleanup by renaming legacy method domains, deleting public compatibility methods, and hard-cutting the protocol to `2.5`.

**Architecture:** Keep Registry as the routing and authorization boundary, Hub as the owner of HubState/session/project runtime behavior, and App as a protocol-constant caller. Because the current protocol is already hard-cut at `2.4`, this cleanup should hard-cut again to `2.5` and must not keep old method aliases.

**Tech Stack:** Go server protocol/registry/hub packages, React/TypeScript App registry layer, Jest service tests, Go package tests, Markdown protocol docs.

---

## Why This Was Not Completed In The Previous Iteration

The previous implementation plan was scoped as a HubState foundation slice. It implemented:

- envelope top-level `hubId`
- `hub.state.get`
- `hub.state.refresh`
- `hub.state.action`
- Hub-owned `HubStateManager`
- App repository methods for HubState
- Registry protocol version hard cut to `2.4`

It did not implement the broader protocol-domain cleanup from the design spec. That was a planning failure: the original implementation plan deliberately kept `cmd.*`, `fs.*`, `git.*`, `project.list`, `registry.reportProjects`, and `registry.session.*` compatibility in place so the HubState slice could land safely. After the protocol was hard-cut to `2.4`, those old public names should not remain as App-facing protocol. This plan corrects that by treating the cleanup as a second hard-cut release.

## Current State Confirmed In Code

The following old public method names still exist in `server/internal/protocol/registry_methods.go` and active callers/tests:

- `connection.closing`
- `local_read.proof`
- `registry.reportProjects`
- `registry.updateProject`
- `registry.session.updated`
- `registry.session.message`
- `project.list`
- `project.syncCheck`
- `project.online`
- `project.offline`
- `session.new`
- `session.setConfig`
- `session.token.providers`
- `session.token.deepseek.stats`
- `session.token.scan`
- `fs.list`
- `fs.info`
- `fs.read`
- `fs.search`
- `fs.grep`
- `fs.index.status`
- `fs.index.rebuild`
- `fs.index.search`
- `git.refs`
- `git.branches`
- `git.log`
- `git.commit.files`
- `git.commit.fileDiff`
- `git.diff`
- `git.diff.fileDiff`
- `git.status`
- `git.workingTree.fileDiff`
- `cmd.npm`
- `cmd.update`
- `cmd.skills`
- `cmd.token`
- `relay.status`
- `relay.enable`
- `relay.disable`
- `relay.regenerateAccessCode`
- `relay.open`
- `relay.close`

The App registry layer still contains direct string method calls for many of those methods in `app/web/src/registry/RegistryRepository.ts`.

## Target Protocol Names

### Connect

| Current | Target |
| --- | --- |
| `connect.init` | `connect.init` |
| `connection.closing` | `connect.close` |
| `local_read.proof` | `connect.localRead.proof` |

### Registry / Hub / Project Reports

| Current | Target |
| --- | --- |
| `registry.reportProjects` | `hub.report.projects` |
| `registry.updateProject` | `hub.report.project` |
| `project.list` | `registry.project.list` |
| `project.online` | delete |
| `project.offline` | delete |
| no single-project report event | `registry.project.report` |

### Project

| Current | Target |
| --- | --- |
| `project.syncCheck` | `project.sync.check` |
| `fs.list` | `project.fs.list` |
| `fs.info` | `project.fs.info` |
| `fs.read` | `project.fs.read` |
| `fs.search` | `project.fs.search` |
| `fs.grep` | `project.fs.grep` |
| `fs.index.search` | `project.fs.index.search` |
| `git.refs` | `project.git.refs` |
| `git.log` | `project.git.log` |
| `git.commit.files` | `project.git.commit.files` |
| `git.commit.fileDiff` | `project.git.commit.fileDiff` |
| `git.diff` | `project.git.diff` |
| `git.diff.fileDiff` | `project.git.diff.fileDiff` |
| `git.status` | `project.git.status` |
| `git.workingTree.fileDiff` | `project.git.workingTree.fileDiff` |
| `git.branches` | delete |

`fs.index.status` and `fs.index.rebuild` must not remain public Registry methods. App must use:

- `hub.state.refresh` with section `fileIndex`
- `hub.state.action` with section `fileIndex` and action `rebuild`

### Session

| Current | Target |
| --- | --- |
| `session.new` | `session.create` |
| `session.setConfig` | `session.config` |
| `session.markRead` | `session.markRead` |
| `registry.session.message` | `session.message` |
| `registry.session.updated` | `session.updated` |
| `session.token.providers` | delete public method; move to HubState tokenStats action |
| `session.token.deepseek.stats` | delete public method; move to HubState tokenStats action |
| `session.token.scan` | delete public method; use HubState tokenStats refresh |

### HubState / CMD

Keep public:

- `hub.state.get`
- `hub.state.refresh`
- `hub.state.action`
- `hub.state.updated`

Delete public:

- `cmd.npm`
- `cmd.update`
- `cmd.skills`
- `cmd.token`

The HubState adapter can keep internal tool execution helpers, but those names must not remain registered Registry protocol methods.

### Relay

| Current | Target |
| --- | --- |
| `relay.status` | `registry.relay.status` |
| `relay.enable` | `registry.relay.enable` |
| `relay.disable` | `registry.relay.disable` |
| `relay.regenerateAccessCode` | `registry.relay.regenerateAccessCode` |
| `relay.open` | `hub.relay.open` |
| `relay.close` | `hub.relay.close` |

### Unchanged Domains

These remain as-is in this plan:

- `speech.*`
- `monitor.*`
- `debug.*`
- `batch`
- `connect.init`
- `hub.ping`

## File Structure

- Modify `server/internal/protocol/registry.go`: bump default protocol version to `2.5`.
- Modify `server/internal/protocol/registry_methods.go`: replace old method constants/descriptors with target names and remove deleted public methods.
- Modify `server/internal/protocol/registry_methods_test.go`: assert old method names are no longer registered and target names have correct route/role/id requirements.
- Modify `server/internal/registry/server.go`: switch request dispatch, project report handling, event broadcast names, relay names, and project method handling to target constants.
- Modify `server/internal/registry/server_test.go`: rewrite Registry protocol tests to target names and add old-name rejection tests.
- Modify `server/internal/hub/reporter.go`: emit `hub.report.projects`, handle target project/fs/git/session/relay method names, publish session events as `session.*`.
- Modify `server/internal/hub/hub_state_adapters.go`: remove dependency on public `cmd.*` Registry method constants; use internal tool method constants or typed tool handler methods.
- Modify `server/internal/hub/client/session_recorder.go`: publish `session.message` and `session.updated`.
- Modify `server/internal/hub/hub_test.go`: rewrite Reporter and local-read tests to target names.
- Modify `server/cmd/wheelmaker-monitor/transport.go` and `server/cmd/wheelmaker-monitor/monitor.go`: verify connect uses `2.5` via `rp.DefaultProtocolVersion`.
- Modify `app/web/src/registry/registryMethods.ts`: add all public method constants that App uses.
- Modify `app/web/src/registry/RegistryRepository.ts`: replace direct method strings with `RegistryMethods.*` and migrate old CMD/token/file-index calls to HubState or target names.
- Modify `app/web/src/features/speech/registrySpeechClient.ts`: replace speech method strings with `RegistryMethods.*`.
- Modify App tests under `app/__tests__/`: update expected method names and add string-scan tests for old public method names.
- Modify `docs/registry-protocol.md`: update to `2.5`, document hard cut and final method names.
- Modify `docs/superpowers/specs/2026-06-05-hub-state-design.md`: mark protocol-domain cleanup decisions as implemented once the code lands.

## Task 1: Protocol Version And Method Registry Hard Cut

**Files:**
- Modify: `server/internal/protocol/registry.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`

- [ ] **Step 1: Write failing descriptor tests**

Add tests that assert:

```go
func TestRegistryProtocolDomainTargetMethods(t *testing.T) {
	targets := []string{
		"connect.close",
		"connect.localRead.proof",
		"hub.report.projects",
		"hub.report.project",
		"registry.project.list",
		"registry.project.report",
		"project.sync.check",
		"project.fs.list",
		"project.fs.info",
		"project.fs.read",
		"project.fs.search",
		"project.fs.grep",
		"project.fs.index.search",
		"project.git.refs",
		"project.git.log",
		"project.git.commit.files",
		"project.git.commit.fileDiff",
		"project.git.diff",
		"project.git.diff.fileDiff",
		"project.git.status",
		"project.git.workingTree.fileDiff",
		"session.create",
		"session.config",
		"session.message",
		"session.updated",
		"registry.relay.status",
		"registry.relay.enable",
		"registry.relay.disable",
		"registry.relay.regenerateAccessCode",
		"hub.relay.open",
		"hub.relay.close",
	}
	for _, method := range targets {
		if _, ok := RegistryMethod(method); !ok {
			t.Fatalf("%s should be registered", method)
		}
	}
}

func TestRegistryProtocolDomainOldMethodsAreRemoved(t *testing.T) {
	oldMethods := []string{
		"connection.closing",
		"local_read.proof",
		"registry.reportProjects",
		"registry.updateProject",
		"registry.session.updated",
		"registry.session.message",
		"project.list",
		"project.syncCheck",
		"project.online",
		"project.offline",
		"session.new",
		"session.setConfig",
		"session.token.providers",
		"session.token.deepseek.stats",
		"session.token.scan",
		"fs.list",
		"fs.info",
		"fs.read",
		"fs.search",
		"fs.grep",
		"fs.index.status",
		"fs.index.rebuild",
		"fs.index.search",
		"git.refs",
		"git.branches",
		"git.log",
		"git.commit.files",
		"git.commit.fileDiff",
		"git.diff",
		"git.diff.fileDiff",
		"git.status",
		"git.workingTree.fileDiff",
		"cmd.npm",
		"cmd.update",
		"cmd.skills",
		"cmd.token",
		"relay.status",
		"relay.enable",
		"relay.disable",
		"relay.regenerateAccessCode",
		"relay.open",
		"relay.close",
	}
	for _, method := range oldMethods {
		if _, ok := RegistryMethod(method); ok {
			t.Fatalf("%s should not be registered", method)
		}
	}
}
```

- [ ] **Step 2: Verify tests fail**

Run:

```powershell
cd server
go test ./internal/protocol -run "TestRegistryProtocolDomain" -count=1
```

Expected: FAIL because old methods are still registered and target names are missing.

- [ ] **Step 3: Update constants and descriptors**

Change `DefaultProtocolVersion` to `2.5`.

Replace public method constants and descriptors with target names only. Keep internal helper functions such as `registryProjectMethod`, `registryHubStateMethod`, and `registryLocalReadProjectMethod`.

Ensure:

- `hub.report.projects` and `hub.report.project` route as `RegistryRouteHubReport`, role `hub`, and require envelope top-level `hubId`.
- `registry.project.list` routes as `RegistryRouteProjectCache`, roles `client` and `monitor`, local-read allowed, batchable.
- `registry.project.report` routes as `RegistryRouteClientEvent`.
- `project.*` file/git methods require top-level `projectId`, remain local-read where the old method was local-read.
- `session.create` and `session.config` route as session-forward methods.
- `session.message` and `session.updated` can be accepted from Hub and broadcast to App under the same method name.
- Deleted methods have no descriptors.

- [ ] **Step 4: Verify protocol tests pass**

Run:

```powershell
cd server
go test ./internal/protocol -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add server/internal/protocol/registry.go server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go
git commit -m "feat: hard cut registry method names"
```

## Task 2: Registry Routing And Broadcast Names

**Files:**
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`

- [ ] **Step 1: Write failing Registry routing tests**

Add tests that:

- connect with protocol `2.5`
- reject protocol `2.4`
- accept `hub.report.projects`
- reject `registry.reportProjects`
- accept `registry.project.list`
- reject `project.list`
- forward `project.fs.list`
- reject `fs.list`
- broadcast `registry.project.report` instead of `project.online` or `project.offline`
- accept `registry.relay.status`
- reject `relay.status`

- [ ] **Step 2: Run failing Registry tests**

Run:

```powershell
cd server
go test ./internal/registry -run "TestConnectInit|TestRegistryReport|TestProjectList|TestProjectFS|TestRelay|TestProjectReport" -count=1
```

Expected: FAIL until routing is switched to the new constants.

- [ ] **Step 3: Switch Registry dispatch**

In `server/internal/registry/server.go`:

- replace report handlers with `hub.report.projects` and `hub.report.project`
- require/validate envelope top-level `hubId` for Hub report methods
- replace project cache methods with `registry.project.list` and `project.sync.check`
- replace project forward methods with `project.fs.*` and `project.git.*`
- replace project online/offline broadcast calls with one `registry.project.report` event containing the complete project snapshot
- replace public relay methods with `registry.relay.*`
- replace Hub relay forwarding methods with `hub.relay.open` and `hub.relay.close`
- remove old CMD dispatch from client request handling

- [ ] **Step 4: Verify Registry tests pass**

Run:

```powershell
cd server
go test ./internal/registry -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add server/internal/registry/server.go server/internal/registry/server_test.go
git commit -m "feat: switch registry routing to protocol domains"
```

## Task 3: Hub Reporter And Session Event Names

**Files:**
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/client/session_recorder.go`
- Modify: `server/internal/hub/hub_test.go`

- [ ] **Step 1: Write failing Reporter tests**

Add tests that assert:

- Reporter initial project report uses `hub.report.projects`
- single-project report uses `hub.report.project`
- Reporter handles `project.fs.read` instead of `fs.read`
- Reporter handles `project.git.status` instead of `git.status`
- Reporter handles `session.create` instead of `session.new`
- Reporter handles `session.config` instead of `session.setConfig`
- SessionRecorder publishes `session.message` and `session.updated`
- Reporter no longer accepts `cmd.*` from Registry

- [ ] **Step 2: Run failing Reporter tests**

Run:

```powershell
cd server
go test ./internal/hub -run "TestReporter|TestSessionRecorder|TestHubState" -count=1
```

Expected: FAIL until Reporter and SessionRecorder switch method names.

- [ ] **Step 3: Update Reporter dispatch and publishing**

In `server/internal/hub/reporter.go`:

- emit `hub.report.projects`
- emit `hub.report.project`
- switch request dispatch to `project.fs.*`, `project.git.*`, `session.create`, `session.config`, and `hub.relay.*`
- remove public `cmd.*` cases from `handleRegistryRequest`
- keep HubState adapters as the only App-facing route for NPM/update/skills/token/file-index status and rebuild

In `server/internal/hub/client/session_recorder.go`:

- publish `session.message`
- publish `session.updated`

- [ ] **Step 4: Verify Hub tests pass**

Run:

```powershell
cd server
go test ./internal/hub -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add server/internal/hub/reporter.go server/internal/hub/client/session_recorder.go server/internal/hub/hub_test.go
git commit -m "feat: switch hub reporter to protocol domains"
```

## Task 4: Replace App Method Strings With Constants

**Files:**
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/features/speech/registrySpeechClient.ts`
- Modify: App tests under `app/__tests__/`

- [ ] **Step 1: Write failing App method-name tests**

Add or update tests that scan `RegistryRepository.ts` and assert it does not contain these public old method strings:

```ts
[
  "method: 'project.list'",
  "method: 'project.syncCheck'",
  "method: 'fs.",
  "method: 'git.",
  "method: 'relay.",
  "method: 'session.new'",
  "method: 'session.setConfig'",
  "method: 'session.token.",
  "method: 'cmd.",
]
```

The test should allow non-protocol fixtures in unrelated chat message payload tests, but App registry service code must use `RegistryMethods`.

- [ ] **Step 2: Run failing App tests**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-registry-protocol-domain-service.test.ts
```

Expected: FAIL because `RegistryRepository.ts` still contains old direct strings.

- [ ] **Step 3: Expand `RegistryMethods`**

Add constants for all App-used public methods:

- `RegistryProjectList`
- `RegistryRelayStatus`
- `RegistryRelayEnable`
- `RegistryRelayDisable`
- `RegistryRelayRegenerateAccessCode`
- `ProjectSyncCheck`
- `ProjectFSList`
- `ProjectFSInfo`
- `ProjectFSRead`
- `ProjectFSSearch`
- `ProjectFSGrep`
- `ProjectFSIndexSearch`
- `ProjectGitRefs`
- `ProjectGitLog`
- `ProjectGitCommitFiles`
- `ProjectGitCommitFileDiff`
- `ProjectGitDiff`
- `ProjectGitDiffFileDiff`
- `ProjectGitStatus`
- `ProjectGitWorkingTreeFileDiff`
- `SessionCreate`
- `SessionConfig`
- all existing session/archive/attachment methods that App calls
- all speech methods that `registrySpeechClient.ts` sends

- [ ] **Step 4: Update `RegistryRepository.ts`**

Replace App calls:

- `project.list` to `RegistryMethods.RegistryProjectList`
- `project.syncCheck` to `RegistryMethods.ProjectSyncCheck`
- `fs.*` to `RegistryMethods.ProjectFS*`
- `fs.index.search` to `RegistryMethods.ProjectFSIndexSearch`
- `git.*` to `RegistryMethods.ProjectGit*`
- `relay.*` to `RegistryMethods.RegistryRelay*`
- `session.new` to `RegistryMethods.SessionCreate`
- `session.setConfig` to `RegistryMethods.SessionConfig`
- `session.token.scan` to `refreshHubState(hubId, ['tokenStats'])`
- `cmd.npm`, `cmd.update`, `cmd.skills`, and `cmd.token` to HubState methods

- [ ] **Step 5: Update App tests**

Update expected request shapes in:

- `web-agent-package-update-service.test.ts`
- `web-skill-management-service.test.ts`
- `web-port-relay-service.test.ts`
- `web-local-hub-read-service.test.ts`
- `web-registry-debug-records.test.ts`
- `web-chat-ui.test.ts`
- `web-session-list-schema.test.ts`
- any App test that asserts old method names

- [ ] **Step 6: Verify App tests pass**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-registry-protocol-domain-service.test.ts __tests__/web-hub-state-service.test.ts __tests__/web-agent-package-update-service.test.ts __tests__/web-skill-management-service.test.ts __tests__/web-port-relay-service.test.ts
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```powershell
git add app/web/src/registry/registryMethods.ts app/web/src/registry/RegistryRepository.ts app/web/src/features/speech/registrySpeechClient.ts app/__tests__
git commit -m "feat: switch app registry methods to protocol domains"
```

## Task 5: HubState TokenStats Completion And CMD Public Deletion

**Files:**
- Modify: `server/internal/hub/hub_state_adapters.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/__tests__/web-hub-state-service.test.ts`
- Modify: `app/__tests__/web-agent-package-update-service.test.ts`
- Modify: `app/__tests__/web-skill-management-service.test.ts`

- [ ] **Step 1: Write failing TokenStats action tests**

Add Hub and App tests for tokenStats actions:

- `hub.state.refresh` section `tokenStats` replaces `cmd.token scan`
- `hub.state.action` section `tokenStats` action `providers` replaces `session.token.providers`
- `hub.state.action` section `tokenStats` action `deepseekStats` replaces `session.token.deepseek.stats`

- [ ] **Step 2: Run failing tests**

Run:

```powershell
cd server
go test ./internal/hub -run "TestHubState.*Token" -count=1
cd ../app
npm test -- --runTestsByPath __tests__/web-hub-state-service.test.ts
```

Expected: FAIL until tokenStats actions are implemented.

- [ ] **Step 3: Implement tokenStats HubState actions**

Extend `hubStateSectionHandlers()` so `tokenStats` has an `Action` handler.

Supported actions:

- `providers`
- `deepseekStats`

Reporter validation must allow those actions for `tokenStats`.

- [ ] **Step 4: Remove public CMD method descriptors**

Remove public Registry descriptors and Registry dispatch for:

- `cmd.npm`
- `cmd.update`
- `cmd.skills`
- `cmd.token`

Keep internal tool execution behind HubState only.

- [ ] **Step 5: Verify public old CMD methods are rejected**

Run:

```powershell
cd server
go test ./internal/protocol ./internal/registry ./internal/hub -run "Test.*Cmd|TestHubState" -count=1
```

Expected: PASS with old `cmd.*` method registration tests rewritten to expect removal.

- [ ] **Step 6: Commit Task 5**

```powershell
git add server/internal/hub/hub_state_adapters.go server/internal/hub/reporter.go server/internal/hub/hub_test.go server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go server/internal/registry/server.go server/internal/registry/server_test.go app/web/src/registry/RegistryRepository.ts app/__tests__
git commit -m "feat: remove public cmd registry methods"
```

## Task 6: Local Read And Monitor Path Alignment

**Files:**
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/__tests__/web-local-hub-read-service.test.ts`

- [ ] **Step 1: Write failing local-read tests**

Assert:

- App sends `connect.localRead.proof`
- Hub local-read endpoint accepts `connect.localRead.proof`
- old `local_read.proof` is rejected
- local-read project methods use `registry.project.list`, `project.fs.*`, and `project.git.*`

- [ ] **Step 2: Run failing tests**

Run:

```powershell
cd server
go test ./internal/hub -run "TestLocalRead|TestReporterLocalRead" -count=1
cd ../app
npm test -- --runTestsByPath __tests__/web-local-hub-read-service.test.ts
```

Expected: FAIL until local-read proof and project method names are switched.

- [ ] **Step 3: Switch local-read methods**

Update local-read proof and local-read allowed method checks to target names only.

- [ ] **Step 4: Verify tests pass**

Run:

```powershell
cd server
go test ./internal/hub -count=1
cd ../app
npm test -- --runTestsByPath __tests__/web-local-hub-read-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```powershell
git add server/internal/hub/reporter.go server/internal/hub/hub_test.go app/web/src/registry/RegistryRepository.ts app/__tests__/web-local-hub-read-service.test.ts
git commit -m "feat: align local read protocol methods"
```

## Task 7: Documentation And Old-Name Guardrails

**Files:**
- Modify: `docs/registry-protocol.md`
- Modify: `docs/superpowers/specs/2026-06-05-hub-state-design.md`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `app/__tests__/web-registry-protocol-domain-service.test.ts`

- [ ] **Step 1: Add old-name scan tests**

Add server and App tests that fail if old public method names reappear in protocol descriptors or registry service source.

- [ ] **Step 2: Update docs to protocol `2.5`**

Update `docs/registry-protocol.md`:

- title to Registry Protocol `2.5`
- `connect.init.protocolVersion` examples to `2.5`
- role allowlist to target names
- version history with `2.5` hard cut from `2.4`
- remove old `cmd.*`, `fs.*`, `git.*`, `relay.*`, `registry.reportProjects`, and `project.list` from public method tables

Update HubState spec status from the current design state to implemented for:

- envelope top-level `hubId`
- `hub.state.*`
- protocol domain hard cut

- [ ] **Step 3: Verify docs and guardrails**

Run:

```powershell
cd server
go test ./internal/protocol -count=1
cd ../app
npm test -- --runTestsByPath __tests__/web-registry-protocol-domain-service.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit Task 7**

```powershell
git add docs/registry-protocol.md docs/superpowers/specs/2026-06-05-hub-state-design.md server/internal/protocol/registry_methods_test.go app/__tests__/web-registry-protocol-domain-service.test.ts
git commit -m "docs: document registry protocol 2.5 domains"
```

## Task 8: Full Verification

**Files:**
- Verify all files touched by Tasks 1-7.

- [ ] **Step 1: Run server verification**

```powershell
cd server
go test ./internal/protocol ./internal/registry ./internal/hub -count=1
```

Expected: PASS.

- [ ] **Step 2: Run App verification**

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-registry-protocol-domain-service.test.ts __tests__/web-local-hub-read-service.test.ts __tests__/web-hub-state-service.test.ts __tests__/web-agent-package-update-service.test.ts __tests__/web-skill-management-service.test.ts __tests__/web-port-relay-service.test.ts __tests__/web-registry-debug-records.test.ts
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 3: Run protocol old-name scan**

```powershell
rg -n "registry\\.reportProjects|registry\\.updateProject|registry\\.session\\.|project\\.list|project\\.syncCheck|project\\.online|project\\.offline|session\\.new|session\\.setConfig|session\\.token\\.|fs\\.|git\\.|cmd\\.|relay\\.|local_read\\.proof|connection\\.closing" server/internal app/web/src docs/registry-protocol.md --glob "!**/dist/**"
```

Expected: no hits for public Registry protocol names, except historical version notes if the docs intentionally mention old names in version history.

- [ ] **Step 4: Commit final verification fixes if needed**

```powershell
git add -A
git commit -m "test: verify registry protocol domain hard cut"
```

If verification leaves no file changes, do not create an empty commit.

## Self-Review

Spec coverage:

- Covered: connect naming, Hub report naming, Registry project list/report naming, Project fs/git naming, session create/config/event naming, relay naming, CMD deletion, tokenStats migration, local-read proof rename, protocol version hard cut.
- Intentionally unchanged: `speech.*`, `monitor.*`, `debug.*`, `batch`, `connect.init`, `hub.ping`.
- Known follow-up after this plan: UI state screens should prefer HubState data flows for settings pages, but the protocol layer must first hard-cut old App-facing methods.

Placeholder scan:

- The plan contains concrete method names, file paths, commands, and expected outcomes.
- No unresolved placeholder markers are left.

Type consistency:

- Server constants should use `RegistryMethodHubReportProjects`, `RegistryMethodRegistryProjectList`, `RegistryMethodProjectFSRead`, `RegistryMethodSessionCreate`, and equivalent target-domain names.
- App constants should mirror server public method strings exactly.
- Deleted public names should not remain in method descriptors or App registry service calls.
