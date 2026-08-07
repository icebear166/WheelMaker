# Claude steer / compact / fork repair plan

> **Status:** implementation and isolated validation complete; existing Hub was left on the formal runtime because the active conversation depends on it.

**Goal:** Make Claude-compatible ACP sessions acknowledge steer immediately, expose and execute advertised context compaction, and create usable current-session forks without changing the Registry protocol version.

## Verified failures

### Native steering acknowledgement

- A live `cc-kimi` session returned success from `_session/steering` in 25 ms with outcome `injected`.
- The returned queue snapshot still contained the selected item with status `steering`.
- The injected instruction was executed, but the item disappeared only when the provider turn ended.
- `claude-agent-acp 0.65.0` intentionally consumes the replayed steering user message internally and does not forward a `user_message_chunk` ACP update for it.
- WheelMaker currently waits for exactly that missing update before completing the queue item.

### Compact capability and execution

- Claude's persisted `available_commands_update` contains `compact`.
- `SessionCapabilityState.Commands` exists, but current summary/action projection omits `SessionAgentState.Commands`, so the frontend correctly renders the server's unsupported result.
- A temporary live Claude session accepted `/compact` through standard `session/prompt` and emitted `Compacting...` followed by the command result. The short diagnostic session reported that there was not enough context to compact, which confirms the command path without mutating an existing user session.

### Fork runtime ownership

- The opt-in live lifecycle test against `claude-agent-acp 0.65.0` returns a child ID from `session/fork`, then fails `session/load(child)` in a newly launched ACP process with `Resource not found`.
- The adapter stores the fresh child in its process-local `sessions` table. WheelMaker's independent validation process cannot see that in-memory child.
- WheelMaker already has `SharedConnPool`, which can route multiple session IDs to independent `Instance` callbacks over one ACP process, but Claude provider creation and fork-target validation do not use it.

## Implementation tasks

### 1. Normalize native steer acceptance at the adapter boundary

**Files:**

- `server/internal/hub/agent/instance.go`
- `server/internal/hub/agent/agent_test.go`
- `server/internal/hub/client/session_steer.go`
- `server/internal/hub/client/session_queue_test.go`
- `server/internal/hub/agent/claude_acp_e2e_test.go`

**Steps:**

1. Add an explicit result marker for native steering paths whose successful response is the provider's delivery acknowledgement and whose input echo is not forwarded.
2. On `injected` / `startedNewTurn`, clear the stale native correlation and project the accepted blocks into one normalized steered user update with the queue item ID as `clientMessageId`.
3. Feed that normalized update through the active prompt stream so transcript ordering and recorder deduplication remain intact.
4. Complete the matching queue item immediately after provider acceptance; retain the current fallback when the provider returns `promptRequired` / inactive.
5. Remove the incorrect heuristic that relabels the next provider user chunk as the native steer echo.

**Tests first:**

- Successful native acceptance records one steered user message and removes the `steering` item before prompt completion.
- An unrelated or late user chunk is never relabeled as the accepted steer.
- Provider error, inactive fallback, cancellation, and Codex's existing echoed-steer path keep their current behavior.
- The live Claude fixture asserts accepted input and output instead of waiting for an upstream echo that the adapter deliberately suppresses.

### 2. Project and execute advertised compact commands

**Files:**

- `server/internal/protocol/session_actions.go`
- `server/internal/protocol/acp_test.go`
- `server/internal/hub/client/session_recorder.go`
- `server/internal/hub/client/client.go`
- `server/internal/hub/client/session.go`
- `server/internal/hub/client/session_queue.go`
- `server/internal/hub/client/session_queue_test.go`
- `server/internal/hub/client/client_test.go`

**Steps:**

1. Treat an advertised command named `compact` (case-insensitive, optional leading slash) as a product-neutral compact capability.
2. Pass persisted `SessionAgentState.Commands` into every `SessionCapabilityState` projection used by summaries and request guards.
3. Keep the negotiated `_wm/session/compact` execution for agents that advertise it.
4. When compact support comes from the advertised command, execute the exact advertised slash command through the normal prompt stream. This preserves Claude's own success/failure text and usage updates instead of fabricating a successful WheelMaker operation.
5. Keep the queue item's external kind as `compact`; only the provider execution path becomes a command prompt.

**Tests first:**

- `compact` and `/compact` commands enable compact; unrelated commands do not.
- Persisted commands enable the action after session reload.
- Command-backed compaction sends `/compact`, records provider updates, and drains the compact queue item.
- Negotiated WheelMaker compaction still uses `_wm/session/compact` and its operation lifecycle.

### 3. Pool compatible Claude sessions in one ACP runtime

**Files:**

- `server/internal/hub/agent/conn_shared.go`
- `server/internal/hub/agent/instance.go`
- `server/internal/hub/agent/factory.go`
- `server/internal/hub/agent/agent_test.go`
- `server/internal/hub/client/client.go`
- `server/internal/hub/client/client_test.go`
- `server/internal/protocol/session_actions.go`
- `server/internal/protocol/acp_test.go`
- `server/internal/hub/agent/claude_acp_e2e_test.go`

**Steps:**

1. Add a Claude ACP runtime pool keyed by project, working directory, provider profile, executable, arguments, and environment fingerprint. Different Claude/`cc-*` profiles, API keys, or launch settings must never share a runtime.
2. Give every WheelMaker session its own `SharedConnPool` route, callbacks, queue, transcript, and session ID while reusing the compatible adapter process.
3. Handle dead runtime generations without rebinding live routes: new sessions start a fresh process and old routes remain attached to their failed generation until normal cleanup.
4. Validate `session/load(child)` on a route in the source runtime and retain that initialized route as the new WheelMaker target session runtime instead of closing it as a disposable probe.
5. Route source and child notifications independently by session ID through the existing shared connection router.
6. Keep the existing validation/cleanup transaction: do not publish or persist a product child if the pooled load fails.
7. Once the lifecycle test passes, enable current-session fork from standard ACP `sessionCapabilities.fork` plus `loadSession`; retain historical-turn fork rules.

**Tests first:**

- Compatible sessions share one adapter process; incompatible project/profile/launch fingerprints do not.
- A process-local child fails from an independent fake runtime but loads through a pooled route.
- Source and target receive only their own updates and can prompt independently.
- Failed sibling load cleans the provider child and never publishes a product session.
- Current fork capability is enabled by standard fork + load without a private WheelMaker release bit.
- The live Claude lifecycle fixture forks, loads the target through the shared runtime, prompts the child, and leaves the source usable.

## Documentation updates

Update the alignment spec/plan and ACP/session capability wiki to replace the obsolete steering-echo assumption, document command-backed compact capability, and describe Claude fork runtime ownership. No protocol version bump is needed because all changes are internal projection/runtime behavior.

## Validation

1. Run focused Go tests for `internal/protocol`, `internal/hub/agent`, and `internal/hub/client`.
2. Run the complete server test suite.
3. Run the relevant frontend session action, queue, and fork wiring tests; no frontend production change is expected unless a regression test exposes one.
4. Build the server and web app using repository commands.
5. Install/restart the local WheelMaker build only after the code tests pass.
6. Re-test on temporary real Claude sessions:
   - steer acknowledgement removes the item immediately while the generation continues;
   - compact icon/action is enabled and Claude's real command result is shown;
   - fork icon/action creates a selectable child that can be prompted independently;
   - source session remains promptable after child creation.
7. Delete all diagnostic sessions and report any cleanup limitation.

## Validation results

- Focused and full Go test suites pass, including the Hub, Agent, Client, Protocol, Registry, and command packages.
- Relevant Web chat tests, TypeScript checking, and the production Web build pass.
- The opt-in real `claude-agent-acp 0.65.0` lifecycle fixture passes with one shared adapter process: source creation and prompt, current fork, child load and prompt, native steer acceptance, and a final source prompt after child activity.
- The live fixture deletes its source and child sessions during cleanup.
- The formal user Hub was restored after an attempted Dev-runtime switch revealed that the active conversation depends on that Hub. Further validation uses isolated processes only and does not stop or restart the formal Hub.

## Risk controls

- Do not touch the user's unrelated dirty files or reset the worktree.
- Keep shared transport scoped to compatible Claude-provider sessions; do not change other ACP provider process ownership.
- Pool only within an identical project/profile/cwd/launch fingerprint. Sharing the adapter process does not merge Claude SDK query streams, callbacks, queues, or transcripts.
- The adapter process is intentionally ephemeral: when its last route closes, process-local resumability ends unless the provider has persisted the session externally.
- Preserve fallback and error cleanup so a provider capability claim alone cannot publish an unusable child.
- Do not infer compact support from provider name or description; require the advertised command name.
- Do not change Registry protocol version `2.7`.
