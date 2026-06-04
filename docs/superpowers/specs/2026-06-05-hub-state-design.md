# Hub State Design

Date: 2026-06-05
Status: Approved

## Goal

Add a Hub-owned `HubState` model for settings and maintenance surfaces that currently trigger many independent scan/query requests.

The Web app should be able to open settings pages from cached Hub state, refresh selected state sections, and run controlled section actions through one protocol shape. Registry remains a router and does not cache Hub state.

## Context

Several current settings surfaces use the same pattern:

- Load hubs through `project.list`.
- Fan out per-hub state requests.
- Poll the same request while a background operation is running.
- Store view-local loading, error, operation, and data state in App code.

Current examples are:

- `cmd.npm` `scan`, `install`, `install_many`, `uninstall`
- `cmd.update` `query`, `update-publish`
- `cmd.skills` `scan`, `list`, `install`, `uninstall`, `update`
- `cmd.token` `scan`
- `fs.index.status`
- `fs.index.rebuild`

These are Hub-level capabilities. They should be represented as Hub state sections instead of independent command methods exposed to the App.

## Confirmed Scope

- Add Hub-owned `HubState` cache.
- Add protocol methods `hub.state.get`, `hub.state.refresh`, `hub.state.action`, and event `hub.state.updated`.
- Put `hubId` on the Registry envelope for Hub-scoped requests, including batch subrequests.
- Keep Registry as a forwarder only. Registry does not cache, aggregate, or persist HubState.
- Let every `HubState` section carry its own status, timestamps, data, error, and optional running action.
- Let top-level `HubState` carry an aggregate status that tells whether the Hub has finished updating.
- Move NPM package scan and write operations into HubState.
- Move skills scan/source-list/write operations into HubState.
- Move WheelMaker update query and update-publish into HubState.
- Move token scan into HubState.
- Move file index status and rebuild into HubState.
- Return latest state or latest section state from `refresh` and `action`, so the App does not need a follow-up `get`.

## Non-Goals

- Do not cache HubState in Registry.
- Do not make Registry poll Hub operations.
- Do not expose generic command execution.
- Do not move project/session runtime methods into HubState.
- Do not move speech streaming into HubState.
- Do not move Registry-owned relay status into HubState.
- Do not require a persistent HubState database in the first version.
- Do not remove old `cmd.*` and `fs.index.*` methods in the same first slice unless all App callers have migrated.

## HubState Model

Hub owns one `HubState` instance per Hub process.

```ts
type HubStateStatus = 'empty' | 'ready' | 'refreshing' | 'partial' | 'error';

interface HubState {
  hubId: string;
  status: HubStateStatus;
  updatedAt?: string;
  sections: {
    agentPackages?: HubStateSection<NpmState>;
    wheelmakerUpdate?: HubStateSection<WheelMakerUpdateState>;
    skills?: HubStateSection<SkillsState>;
    tokenStats?: HubStateSection<TokenStatsState>;
    fileIndex?: HubStateSection<FileIndexState>;
  };
}
```

Top-level `status` is derived from section status:

- `empty`: no section has data, refresh result, or action result.
- `refreshing`: at least one requested or active section is refreshing, or at least one section has a running action.
- `ready`: all loaded sections are ready and no section is refreshing.
- `partial`: at least one section is ready and at least one section is empty or error.
- `error`: all loaded sections are error and no section is refreshing.

Top-level `updatedAt` is the newest section `updatedAt`.

## Section Model

Each section is independently readable, refreshable, and actionable.

```ts
type HubStateSectionStatus = 'empty' | 'ready' | 'refreshing' | 'error';

interface HubStateSection<T> {
  status: HubStateSectionStatus;
  updatedAt?: string;
  startedAt?: string;
  error?: string;
  data?: T;
  action?: HubStateActionSnapshot;
}

interface HubStateActionSnapshot {
  id: string;
  name: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}
```

Rules:

- `get` returns current cached sections without starting new work.
- `refresh` starts or performs collection for the requested sections.
- `action` runs a controlled operation for one section.
- A section can keep its last successful `data` while `status` is `refreshing`.
- A failed refresh sets section `status:"error"` and `error`, but may keep previous `data`.
- A running action is stored in the section `action` field and makes the section `status:"refreshing"`.
- Completed action snapshots stay visible until the next action replaces them or the Hub restarts.

## Protocol

### Envelope

Hub-scoped requests use top-level `hubId`.

```json
{
  "requestId": 1,
  "type": "request",
  "method": "hub.state.get",
  "hubId": "local-hub",
  "payload": {}
}
```

`projectId` remains top-level for project-scoped requests. Session IDs remain in payload for session-instance operations.

Batch subrequests also accept `hubId`:

```json
{
  "method": "batch",
  "payload": {
    "requests": [
      {
        "method": "hub.state.get",
        "hubId": "local-hub",
        "payload": {}
      }
    ]
  }
}
```

### `hub.state.get`

Reads cached HubState from the target Hub. It does not trigger scans.

Request payload:

```json
{
  "sections": ["agentPackages", "skills"]
}
```

If `sections` is omitted or empty, Hub returns all known sections.

Response payload:

```json
{
  "state": {
    "hubId": "local-hub",
    "status": "ready",
    "updatedAt": "2026-06-05T10:00:00Z",
    "sections": {}
  }
}
```

### `hub.state.refresh`

Refreshes selected sections on the target Hub and returns the updated state.

Request payload:

```json
{
  "sections": ["agentPackages", "wheelmakerUpdate", "fileIndex"],
  "force": true
}
```

Rules:

- `sections` is required and must be non-empty.
- `force` tells collectors to bypass section-specific freshness checks where supported.
- If a section already has a running refresh or action, the Hub returns the current section with `status:"refreshing"` instead of starting duplicate work.
- Long-running collectors may return immediately with `status:"refreshing"` and continue in background.
- Hub emits `hub.state.updated` after a background section changes.

Response payload:

```json
{
  "state": {},
  "sections": ["agentPackages", "wheelmakerUpdate", "fileIndex"]
}
```

### `hub.state.action`

Runs a controlled action against one section.

Request payload:

```json
{
  "section": "agentPackages",
  "action": "install",
  "params": {
    "packageName": "@openai/codex",
    "version": "latest"
  }
}
```

Rules:

- `section` and `action` are required.
- Hub validates action names per section.
- Hub validates params per action.
- Hub does not accept raw command, raw args, cwd, or env from the App.
- A section action updates that section's `action` snapshot.
- Accepted long-running actions return the updated state immediately.
- After action completion, the Hub refreshes the affected section data or marks it stale/error.
- Hub emits `hub.state.updated` when action status or section data changes.

Response payload:

```json
{
  "state": {},
  "section": "agentPackages",
  "action": {}
}
```

### `hub.state.updated`

Hub emits this event through Registry when HubState changes.

Event payload:

```json
{
  "state": {},
  "sections": ["agentPackages"],
  "reason": "action.completed"
}
```

Registry forwards the event to App clients scoped to the Hub. Registry does not store the payload.

## Sections

### `agentPackages`

Replaces App use of:

- `cmd.npm` `action:"scan"`
- `cmd.npm` `action:"install"`
- `cmd.npm` `action:"install_many"`
- `cmd.npm` `action:"uninstall"`

Refresh:

```json
{
  "sections": ["agentPackages"]
}
```

Actions:

- `install`
- `installMany`
- `uninstall`

Action params:

```json
{
  "packageName": "@openai/codex",
  "packageNames": ["@openai/codex", "@anthropic-ai/claude-code"],
  "version": "latest"
}
```

The existing package allowlist and operation concurrency rules remain Hub-owned. Runtime packages can be installed or updated through `install`. Deprecated packages can be removed through `uninstall`.

### `wheelmakerUpdate`

Replaces App use of:

- `cmd.update` `action:"query"`
- `cmd.update` `action:"update-publish"`

Refresh maps to update query.

Action:

- `updatePublish`

The section data keeps the existing update response shape: status, release, git snapshot, pending signal, remote refresh running, and update-publish capability.

### `skills`

Replaces App use of:

- `cmd.skills` `action:"scan"`
- `cmd.skills` `action:"list"`
- `cmd.skills` `action:"install"`
- `cmd.skills` `action:"uninstall"`
- `cmd.skills` `action:"update"`

Refresh maps to installed skill scan.

Actions:

- `listSource`
- `install`
- `uninstall`
- `update`

`listSource` is an action because it is scoped to the skills section and uses the same controlled CLI surface, even though it is read-like. Its response updates `section.action` and may also include action result data for source candidates.

The installed skills data remains separate from provider-visible `ProjectAgentProfile.skills`.

### `tokenStats`

Replaces App use of:

- `cmd.token` `action:"scan"`

Refresh maps to token scan.

No write actions are included in the first version.

### `fileIndex`

Replaces App use of:

- `fs.index.status`
- `fs.index.rebuild`

Refresh maps to file index status for all projects in the Hub.

Action:

- `rebuild`

Action params:

```json
{
  "projectId": "local-hub:WheelMaker"
}
```

`fs.index.search` remains a project-scoped search method and does not move into HubState.

## Registry Routing

Registry adds a `hubId` field to the shared envelope and raw envelope parser.

Routing rules:

- `hub.state.get`, `hub.state.refresh`, and `hub.state.action` require top-level `hubId`.
- Client role may call these methods.
- Registry checks client hub scope if the client is scoped.
- Registry checks the target Hub is known and online.
- Registry forwards the request to the Hub with the same `hubId`.
- Registry returns the Hub response to the App.
- Registry forwards `hub.state.updated` events from Hub to matching App clients.
- Registry does not persist HubState.

This should become the model for other Hub-scoped methods. Existing payload-level `hubId` usage can remain for compatibility during migration, but new HubState calls should not put routing IDs inside payload.

## Hub Architecture

Add a Hub-side `HubStateManager` behind `Reporter`.

Responsibilities:

- Own cached `HubState`.
- Dispatch section refreshes.
- Dispatch section actions.
- Maintain section status, timestamps, errors, and action snapshots.
- Reuse existing collectors and command handlers.
- Emit `hub.state.updated` through the Reporter publisher when state changes.

Initial adapters:

- `agentPackages` uses existing `tools.NPMCommand`.
- `wheelmakerUpdate` uses existing `tools.UpdateCommand`.
- `skills` uses existing `tools.SkillsCommand`.
- `tokenStats` uses existing `tools.TokenCommand`.
- `fileIndex` uses existing `projectFileIndexManager`.

The first version can keep the old command handlers and call the same underlying command objects. The important change is that App-facing settings workflows move to `HubStateManager`.

## App Data Flow

Opening a settings surface:

1. App calls the project catalog method to get hubs and projects. This is `project.list` today and can become `registry.project.list` during the broader protocol rename.
2. App batches `hub.state.get` for visible hubs.
3. App renders cached sections immediately.
4. If a visible section is empty, App may show an empty/stale state and offer refresh.

Manual refresh:

1. App calls `hub.state.refresh` with selected sections.
2. App merges the returned state.
3. If returned sections are still refreshing, App waits for `hub.state.updated` or polls `hub.state.get`.

Action:

1. App calls `hub.state.action` with section, action, and params.
2. App merges the returned state.
3. App renders `section.action`.
4. App receives `hub.state.updated` as action status and section data change.

The App should no longer keep separate bespoke scan polling loops for NPM, update, skills, token stats, and file index status once the migrated surfaces use HubState.

## Error Handling

- Missing `hubId`: `INVALID_ARGUMENT`.
- Unknown Hub: `NOT_FOUND`.
- Offline Hub: `UNAVAILABLE`.
- Missing `sections` for refresh: `INVALID_ARGUMENT`.
- Unknown section: `INVALID_ARGUMENT`.
- Unknown section action: `INVALID_ARGUMENT`.
- Invalid action params: `INVALID_ARGUMENT`.
- Concurrent section operation: return current section state when possible; use `CONFLICT` only when the action cannot be accepted or represented.
- Collector failure: section `status:"error"` with short `error`.
- Action failure: `section.action.status:"failed"` with short `error`; keep previous section data if available.

Full command output stays out of the App.

## Migration Plan

1. Add protocol constants, descriptors, and envelope `hubId`.
2. Add Registry routing for `hub.state.*` and batch `hubId`.
3. Add Hub `HubStateManager` with section status model.
4. Wire `agentPackages`, `wheelmakerUpdate`, `skills`, `tokenStats`, and `fileIndex`.
5. Add App repository methods for `hub.state.get`, `hub.state.refresh`, and `hub.state.action`.
6. Migrate settings pages to HubState one surface at a time.
7. Keep old `cmd.*` and `fs.index.status/rebuild` as compatibility paths until no App callers remain.
8. Remove or deprecate old public scan/query methods in a later cleanup.

## Testing Strategy

Server protocol tests:

- Method descriptors include `hub.state.get`, `hub.state.refresh`, `hub.state.action`, and `hub.state.updated`.
- HubState requests require top-level `hubId`.
- Batch subrequests carry `hubId`.
- Client role can call HubState methods.
- Registry forwards HubState methods by envelope `hubId`.
- Registry rejects missing, unknown, offline, or out-of-scope Hub IDs.
- Registry does not cache HubState.

Hub tests:

- `get` returns cached sections without starting collectors.
- `refresh` updates requested sections only.
- Top-level status derives from section statuses.
- Section refresh failure keeps previous data where available.
- Running section refresh emits `hub.state.updated`.
- `agentPackages` refresh and actions reuse NPM policy.
- `wheelmakerUpdate` refresh and `updatePublish` reuse update policy.
- `skills` refresh and actions reuse skills policy.
- `tokenStats` refresh uses token scanner.
- `fileIndex` refresh uses status and `rebuild` starts project index rebuild.
- `fs.index.search` remains project-scoped and unchanged.

App tests:

- Repository sends top-level `hubId` for HubState methods.
- Settings surfaces read cached state with `hub.state.get`.
- Refresh buttons call `hub.state.refresh` with expected sections.
- NPM package actions call `hub.state.action` under `agentPackages`.
- Skills actions call `hub.state.action` under `skills`.
- WheelMaker update-publish calls `hub.state.action` under `wheelmakerUpdate`.
- File index rebuild calls `hub.state.action` under `fileIndex`.
- Returned state is merged without follow-up `get`.
- `hub.state.updated` updates the visible section.

## Acceptance Criteria

- HubState cache lives in Hub, not Registry.
- Registry only routes HubState requests and events.
- App can read HubState through `hub.state.get`.
- App can refresh selected sections through `hub.state.refresh`.
- App can run controlled section operations through `hub.state.action`.
- Every section has independent status, timestamps, data, error, and action state.
- Top-level HubState exposes whether the Hub is empty, refreshing, ready, partial, or error.
- NPM scan and package operations are represented through HubState.
- Old command methods can remain temporarily for compatibility, but new settings flows use HubState.
