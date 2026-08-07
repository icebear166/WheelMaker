# Codex Project-Scoped Shared Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在同一 Hub 进程内，让同一项目、相同工作目录和相同 Codex 启动配置的多个 Codex 会话复用一个 `codex app-server` 进程；同时保持每个会话的 thread、模型、推理强度、审批策略、事件和关闭行为严格隔离。

**Architecture:** 在 Codex provider 内引入一个项目级 runtime pool。pool 以 `projectId` 为一级边界，并以规范化 `cwd` 和非敏感启动配置指纹为二级边界；每个条目持有一个原始 app-server runtime 和引用计数。每个会话仍创建独立 `codexappConn`，并继续以 Codex 原生 `threadId` 分派 RPC、通知和请求。初始化从连接级提升为 runtime 级 singleflight；连接关闭释放 lease，只有最后一个 lease 才停止原始进程。进程异常退出会使对应 pool 条目失效、仅终止绑定连接的活动操作，并让下次会话获取新 runtime。

**Tech Stack:** Go、现有 ACP JSON-RPC bridge、Go `sync`、`crypto/sha256`、现有 `agent_test.go` fake Codex transport。

---

## Scope guardrails

- 不改 ACP 对外协议、HTTP/WebSocket 接口、会话持久化格式或前端协议版本。
- 不把 `cwd` 设为全局可变状态；一个 raw `ACPProcess` 仅由其创建时的 `cwd` 使用。
- 不把模型、推理强度、审批策略或会话 MCP 选项放进 pool key；它们必须继续从各自 `codexappConn.config` 写入各自的 `thread/start` / `turn/start` 请求。
- `openaiDeveloperDocs` MCP 的禁用是独立的启动配置优化；本计划不硬编码修改现有 Codex 启动参数。pool 会把未来的启动参数变化纳入指纹，防止不同启动配置误复用。
- `projectId` 缺失时不共享 runtime：创建仅供该连接使用的 runtime，避免未归属会话跨项目混用。

## Planned file changes

| File | Change |
| --- | --- |
| `server/internal/hub/agent/codexapp_pool.go` | New: project-scoped pool、lease、启动配置 metadata、引用计数、runtime 终止失效和 runtime 级初始化 singleflight。 |
| `server/internal/hub/agent/codexapp_agent.go` | Make the Codex creator acquire a lease instead of owning a runtime; make connection close release the lease; route initialization through the runtime-level initializer. |
| `server/internal/hub/agent/agent_test.go` | Add pool, initialization, isolation, release, and failure-recovery regression tests using the existing fake transport. |

## Task 1: Establish pool identity and safe runtime leasing

**Files:**

- Create: `server/internal/hub/agent/codexapp_pool.go`
- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Test: `server/internal/hub/agent/agent_test.go`

- [ ] Add failing tests before implementation.

  Add these tests beside the existing Codex app-server tests in `agent_test.go`:

  1. `TestCodexAppRuntimePoolSharesMatchingProjectRuntime`: two acquires with the same non-empty project id, cleaned cwd and launch configuration create one fake process and return distinct leases backed by the same runtime.
  2. `TestCodexAppRuntimePoolSeparatesProjectAndRuntimeMetadata`: different project ids, different cleaned cwds, or different launch fingerprints create separate fake processes; acquiring a new metadata variant must not close the already leased variant.
  3. `TestCodexAppRuntimePoolDoesNotShareWithoutProjectID`: empty project id creates an exclusive runtime for each acquire.

  Give the fake launcher a `starts` counter and per-start `fakeCodexappTransport` slice so assertions do not infer sharing from timing.

  Run:

  ```powershell
  cd server
  go test ./internal/hub/agent -run "TestCodexAppRuntimePool" -count=1
  ```

  Expected before implementation: compile failure for `newCodexappRuntimePool` / `Acquire`, or assertion failures showing per-session process creation.

- [ ] Implement immutable pool metadata in `codexapp_pool.go`.

  Define comparable runtime metadata and its construction in one place:

  ```go
  type codexappRuntimeMetadata struct {
      cwd               string
      launchFingerprint string
  }

  type codexappRuntimePool struct {
      mu      sync.Mutex
      entries map[string]map[codexappRuntimeMetadata]*codexappPooledRuntime
      start   codexappRuntimeStarter
  }
  ```

  Build `cwd` with `filepath.Clean`. Build `launchFingerprint` from the executable path and exact launch arguments obtained from the provider's existing `Launch` method; serialize fields with unambiguous lengths and hash with SHA-256. Do not include environment values or credentials in the fingerprint. Keep the full launch arguments only in memory for process startup; the pool key stores the digest.

  Add a small test-only starter seam:

  ```go
  type codexappRuntimeStarter func(context.Context, string, string) (*codexappRuntime, error)
  ```

  Production starter behavior must preserve the current process command: it calls `provider.Launch`, starts `ACPProcess` with the passed cwd, and creates the existing native Codex runtime. It must not add, remove, or reorder Codex command-line options.

- [ ] Add leases and reference-counted eviction.

  Add `Acquire(ctx, projectID, cwd string) (*codexappRuntimeLease, error)` and an idempotent `Release()` method. A successful shared acquire increments only the matching pool entry's reference count. `Release` decrements it once; reaching zero removes that exact map entry while holding the pool mutex, then closes the raw runtime after releasing the mutex.

  For an empty project id, return an exclusive lease whose `Release` always closes its runtime and which is never inserted into `entries`.

  On a same-project metadata mismatch, leave existing entries untouched and start a second generation under the new metadata. Never kill a live runtime simply because a new session uses a different cwd or launch configuration.

- [ ] Change `codexappInstanceCreator` in `codexapp_agent.go` to own one pool closure per `ACPFactory` creator.

  Construct the pool when registering the Codex creator, obtain the project name with the existing context helper, and acquire a lease for each created Codex instance. Build a new `codexappConn` around `lease.Runtime()` rather than calling `newOwnedCodexappConn` for every session. Keep `newOwnedCodexappConn` only if tests or an explicit exclusive compatibility path still need it; normal factory-created sessions must use the pool.

  Add a `lease *codexappRuntimeLease` field to `codexappConn`. Do not place the pool on `Client`, and do not modify session registry or frontend code.

- [ ] Verify the task.

  ```powershell
  cd server
  gofmt -w internal/hub/agent/codexapp_pool.go internal/hub/agent/codexapp_agent.go internal/hub/agent/agent_test.go
  go test ./internal/hub/agent -run "TestCodexAppRuntimePool" -count=1
  ```

  Expected: all three pool identity tests pass. Inspect `git diff --check` and ensure there is no process start in the matching-entry branch of `Acquire`.

- [ ] Commit the cohesive pool-identity change.

  ```powershell
  git add server/internal/hub/agent/codexapp_pool.go server/internal/hub/agent/codexapp_agent.go server/internal/hub/agent/agent_test.go
  git commit -m "feat(agent): pool Codex runtimes by project"
  ```

## Task 2: Make shared initialization singleflight and retry-safe

**Files:**

- Modify: `server/internal/hub/agent/codexapp_pool.go`
- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Test: `server/internal/hub/agent/agent_test.go`

- [ ] Add failing initialization tests.

  Add `TestCodexAppSharedRuntimeInitializesOnce` that creates two connections from one pooled runtime, calls `Initialize` concurrently, and makes the fake transport block the first `initialize` result until both goroutines are waiting. Assert exactly one outgoing `initialize` request and exactly one outgoing `initialized` notification.

  Add `TestCodexAppSharedRuntimeRetriesInitializationAfterFailure`: make the first initialization response fail, then make a later call succeed. Assert the failed attempt does not leave the runtime permanently marked initialized and the next call sends a second request.

  ```powershell
  cd server
  go test ./internal/hub/agent -run "TestCodexAppSharedRuntimeInitial" -count=1
  ```

  Expected before implementation: two `initialize` calls or an unrecoverable second initialization failure.

- [ ] Move raw initialization ownership from `codexappConn` to the shared runtime.

  In `codexappRuntime`, add mutex-protected state for one in-flight initializer, cached successful ACP initialize result, and a completion channel for waiters. Implement this behavior:

  1. First caller sends the current raw `initialize` request and then the current `initialized` notification.
  2. Concurrent callers wait for that attempt, honoring their own context cancellation while waiting.
  3. Successful result is cached and returned to every later connection without sending another protocol message.
  4. Failure is returned to current waiters, clears in-flight state, and permits a later retry.

  Keep raw request construction and capability conversion in `codexapp_agent.go`; expose a narrow runtime method such as `initialize(ctx, send func(context.Context) (*protocol.InitializeResult, error))`. The pool file owns synchronization, while the bridge file remains the only place that knows ACP payload shapes.

- [ ] Adapt `codexappConn.Initialize` / existing `sendInitialize`.

  Preserve its public behavior and response mapping, but replace the connection-local `c.initialized` short circuit with a call through the runtime initializer. After a successful shared initialization, set only the calling connection's local readiness state needed by its own lifecycle. Do not copy model lists, thread ids, session ids, active turn fields, or config between connections.

- [ ] Verify the task.

  ```powershell
  cd server
  gofmt -w internal/hub/agent/codexapp_pool.go internal/hub/agent/codexapp_agent.go internal/hub/agent/agent_test.go
  go test ./internal/hub/agent -run "TestCodexAppSharedRuntimeInitial" -count=1
  go test ./internal/hub/agent -run "TestCodexAppRuntimePool|TestCodexAppSharedRuntimeInitial" -count=1
  ```

  Expected: the fake observes one initial handshake for a shared runtime; a failed handshake is retried and all pool tests remain green.

- [ ] Commit the initialization change.

  ```powershell
  git add server/internal/hub/agent/codexapp_pool.go server/internal/hub/agent/codexapp_agent.go server/internal/hub/agent/agent_test.go
  git commit -m "fix(agent): initialize shared Codex runtime once"
  ```

## Task 3: Preserve per-session thread and option isolation

**Files:**

- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Test: `server/internal/hub/agent/agent_test.go`

- [ ] Add an end-to-end shared-runtime isolation regression test.

  Add `TestCodexAppSharedRuntimeKeepsThreadConfigAndEventsIsolated`. Use two `codexappConn` values from one runtime and configure different values through the normal public methods:

  - connection A: model A, reasoning effort A, approval policy A;
  - connection B: model B, reasoning effort B, approval policy B.

  Have the fake capture `thread/start` and `turn/start` payloads and emit interleaved notifications and a permission request for both `threadId`s. Assert:

  1. each `thread/start` / `turn/start` includes the config from its own connection only;
  2. A receives no B update, permission request, prompt callback, or compact callback;
  3. B receives no A update, permission request, prompt callback, or compact callback;
  4. an event carrying an unknown `threadId` reaches no connection.

  Re-run the existing `TestCodexAppRuntimeRoutesNotificationsByThread` in the same command so the new test extends rather than replaces current coverage.

- [ ] Make only the minimal connection changes required for pooling.

  Retain the current native routing maps in `codexappRuntime` (`conns`, `queues`, and request/notification dispatch by Codex `threadId`). Do not replace them with generic ACP-session routing. Keep the following fields connection-owned: `cwd`, `acpSessionID`, `threadID`, `config`, active prompt state, compact state, callbacks, and per-thread queue.

  Ensure connection registration happens before any `thread/start` or `thread/resume` request. For an early notification that has no registered thread connection, drop it with the existing fail-closed behavior; never route it to an arbitrary or most-recent connection.

  Ensure `sendSetConfigOption` continues to mutate only `c.config`. Do not write option data into the shared runtime, lease, pool metadata, or app-server process configuration.

- [ ] Verify the task.

  ```powershell
  cd server
  gofmt -w internal/hub/agent/codexapp_agent.go internal/hub/agent/agent_test.go
  go test ./internal/hub/agent -run "TestCodexApp(RuntimeRoutesNotificationsByThread|SharedRuntimeKeepsThreadConfigAndEventsIsolated)" -count=1
  go test ./internal/hub/agent -count=1
  ```

  Expected: both connections can receive interleaved traffic while the fake-captured options and callbacks remain thread-local.

- [ ] Commit the isolation regression coverage.

  ```powershell
  git add server/internal/hub/agent/codexapp_agent.go server/internal/hub/agent/agent_test.go
  git commit -m "test(agent): cover shared Codex session isolation"
  ```

## Task 4: Make close and unexpected process exit safe

**Files:**

- Modify: `server/internal/hub/agent/codexapp_pool.go`
- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Test: `server/internal/hub/agent/agent_test.go`

- [ ] Add failing lifecycle tests.

  Add `TestCodexAppSharedRuntimeCloseOneConnectionKeepsOtherAliveAndClosesOnLastRelease`:

  1. create A and B from one pooled runtime;
  2. close A;
  3. emit a B-thread notification and assert B receives it while fake transport close count remains zero;
  4. close B and assert the transport closes exactly once.

  Add `TestCodexAppRuntimeExitEvictsOnlyItsPoolEntryAndRecovers`:

  1. create connections A and B on one pooled entry and C in a separate project entry;
  2. mark the A/B fake process done unexpectedly while A has a pending prompt and B has a pending compact operation;
  3. assert A and B receive terminal errors, C remains usable, and a later acquire for A/B's key starts a fresh process;
  4. close old A/B after failure and assert no double-close or map corruption.

  The fake transport must expose a deterministic `Done`/exit trigger; do not use `time.Sleep` in these tests.

- [ ] Change connection close to release, not directly close the shared runtime.

  Make `codexappConn.Close` idempotent with `sync.Once` (or the existing equivalent). Its ordered behavior is:

  1. unregister its own thread routing and fail only its own unfinished operations;
  2. release its lease;
  3. never call `runtime.close()` directly when a lease is present.

  Keep an explicit compatibility fallback only for a connection created outside the pool; that fallback may retain its old owned-runtime close behavior. Factory-created connections must always take the lease branch.

- [ ] Watch raw process termination and invalidate exactly one pool entry.

  Start one watcher per `codexappRuntime` using `ACPProcess.Done()`. On an unexpected end, mark the runtime terminal exactly once, fail active prompt/compact work on only its registered connections, and invoke the pool invalidation callback with the runtime identity. The callback removes the entry only when the stored runtime pointer is the same instance, so an old watcher cannot evict a recovered generation.

  An intentional last-lease close must use the same terminal-state guard and must not report a second failure. The watcher must not hold the pool mutex while failing callbacks, waiting for process exit, or closing the process.

- [ ] Verify the task.

  ```powershell
  cd server
  gofmt -w internal/hub/agent/codexapp_pool.go internal/hub/agent/codexapp_agent.go internal/hub/agent/agent_test.go
  go test ./internal/hub/agent -run "TestCodexApp(SharedRuntimeCloseOneConnectionKeepsOtherAliveAndClosesOnLastRelease|RuntimeExitEvictsOnlyItsPoolEntryAndRecovers)" -count=1
  go test ./internal/hub/agent -count=1
  ```

  Expected: closing one session cannot terminate a sibling; an app-server crash affects only its pool entry and subsequent acquisition recovers through a new process.

- [ ] Commit lifecycle safety.

  ```powershell
  git add server/internal/hub/agent/codexapp_pool.go server/internal/hub/agent/codexapp_agent.go server/internal/hub/agent/agent_test.go
  git commit -m "fix(agent): release shared Codex runtime safely"
  ```

## Task 5: Run integration verification and prepare the MCP follow-up

**Files:**

- Verify only: `server/internal/hub/agent/*`, `server/internal/hub/client/*`

- [ ] Run focused and package-level tests from a clean build cache state for the affected packages.

  ```powershell
  cd server
  go test ./internal/hub/agent -count=1
  go test ./internal/hub/client -count=1
  go test ./... -count=1
  ```

  Expected: all commands exit 0. Investigate and fix any race-sensitive failure in the affected agent tests before proceeding; do not suppress or skip a test.

- [ ] Perform a manual local shared-runtime smoke check.

  Start WheelMaker, create two Codex sessions for the same project/cwd, run a harmless prompt in each, change the model or approval option in only one session, then close the first session and send another harmless prompt in the second. Check the process list while both sessions are active: exactly one additional `codex.exe app-server` should serve that matching pool entry. Confirm the second session remains usable after the first closes.

  Repeat with a second project or a different cwd and confirm it receives a separate app-server process. Do not use production data or destructive prompt actions.

- [ ] Record baseline and post-change memory measurements with the same method.

  With five empty new Codex sessions in one project/cwd, collect `WorkingSet64` and `PrivateMemorySize64` for `codex.exe app-server` processes using PowerShell. Compare only after all sessions have completed initialization, and state both total process count and bytes. Treat the earlier synthetic estimate (~75% working-set / ~69% private-memory saving for empty sessions) as a hypothesis, not a pass criterion; report actual values from this check.

- [ ] Keep MCP optimization as a separately reviewable follow-up.

  If the user authorizes applying it, add the exact process launch override only in the WheelMaker Codex provider:

  ```text
  -c mcp_servers.openaiDeveloperDocs.enabled=false
  ```

  Add a provider-launch test that verifies the override is appended while all other configured MCP servers are untouched. Because launch args feed the fingerprint, enabled and disabled variants naturally receive separate runtime entries. Do not make this behavior per-session.

- [ ] Final repository checks and handoff.

  ```powershell
  git diff --check
  git status --short
  git log --oneline -4
  git push
  ```

  Expected: no whitespace errors; working tree contains only intentional tracked changes; all implementation commits are present and pushed. Report test commands, observed process count, and measured memory values in the final handoff.

## Review checklist

- [ ] `projectId` is the outer isolation boundary; empty ids never share.
- [ ] `cwd` and launch fingerprint prevent unsafe reuse without terminating existing compatible sessions.
- [ ] Models, reasoning effort, approval policy, session state, callbacks, queues, and thread ids remain on `codexappConn`.
- [ ] Runtime initialization is exactly-once on success, retryable after failure, and cancellation-safe for waiters.
- [ ] A close only releases its own lease; a runtime closes exactly once after the last lease or terminal process exit.
- [ ] Unknown-thread messages fail closed, and one failed process cannot terminate connections in another pool entry.
- [ ] No ACP protocol or frontend contract changes were introduced.
