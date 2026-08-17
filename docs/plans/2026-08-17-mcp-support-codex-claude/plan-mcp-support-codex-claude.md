# Codex Claude MCP Support Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Hub-scoped MCP configuration for Codex and Claude series with STDIO/Streamable HTTP support, safe static secrets, one-time native-config import, isolated runtime failures, and Neo4j compatibility.

**Scope Source:** `docs/scope/2026-08-17-mcp-support-codex-claude.md`

**Architecture:** Store a provider-neutral MCP collection in the existing HubConfig store with sanitized snapshots. The Hub supplies effective enabled servers to new client sessions and rebuilds provider creators for new runtimes; Codex materializes server config in launch-time overrides/environment, while Claude receives ACP MCP server params. Runtime state stays transient and provider-owned.

**Tech Stack:** Go 1.26, ACP protocol DTOs, existing HubConfig/Registry RPC, Codex app-server, Claude ACP, React 19, Jest 30, Go table-driven tests.

**Verification:** Focused Go package tests, focused Jest tests, `go test ./server/internal/hub/... ./server/internal/hubconfig/...`, `npm test -- --runInBand` for affected web tests, `npm run tsc:web`, and `git diff --check`.

---

## Task 1: Add validated HubConfig MCP storage, snapshots, and import parsing

**Files:**
- Create: `server/internal/hubconfig/mcp.go`
- Create: `server/internal/hubconfig/mcp_import.go`
- Create: `server/internal/hubconfig/mcp_test.go`
- Create: `server/internal/hubconfig/mcp_import_test.go`
- Modify: `server/internal/hubconfig/store.go`
- Modify: `server/internal/hubconfig/store_test.go`

**Acceptance:** A HubConfig store can add/update/delete/enable/disable validated STDIO and HTTP entries, preserves secret values internally, returns sanitized snapshots, rejects unsupported transports/invalid fields, and imports the current Codex Neo4j shape without leaking its password.

- [x] **Step 1: Write the failing tests**
  - Add `TestStoreMCPAddReturnsSanitizedSnapshot` asserting command/args/non-secret env are visible while a secret env value is represented only by configured metadata.
  - Add `TestStoreMCPUpdatePreservesSecretWhenValueOmitted` and `TestStoreMCPUpdateClearSecret`.
  - Add `TestStoreMCPRejectsInvalidTransportAndMissingCommand`.
  - Add `TestImportCodexMCPConfigMapsNeo4jStdio` using a temporary TOML fixture with `python.exe`, `-m neo4j_mcp_server`, `NEO4J_URI`, and `NEO4J_PASSWORD`, asserting no secret appears in the sanitized result.
  - Add `TestImportClaudeMCPConfigSkipsSSEWithReason` and `TestImportMCPNameConflictRequiresResolution`.
- [x] **Step 2: Run tests to verify RED**
  - Run `go test ./server/internal/hubconfig -run 'Test(StoreMCP|Import)' -count=1`.
  - Expected: compile/test failure because MCP types, store methods, and import functions do not exist.
- [x] **Step 3: Write the minimal implementation**
  - Define normalized MCP config/value types and sanitized snapshot types in `mcp.go`.
  - Extend `hubconfig.Snapshot` with a sanitized MCP list and add store methods for CRUD, enable/disable, raw effective values, and stable fingerprints.
  - Preserve unknown root sections and existing API key/Flicker/DeepSeek behavior through the existing raw-root update pattern.
  - Validate server names, command/url, args, cwd, env/header names, duplicate IDs/names, transport-specific fields, secret size, and aggregate 64 KiB config size.
  - Parse Codex TOML using the existing BurntSushi TOML dependency and Claude JSON shapes without writing native files; produce preview records for unsupported SSE/OAuth fields and conflicts.
  - Keep secret raw values out of snapshots and error text.
- [x] **Step 4: Run tests to verify GREEN**
  - Run `go test ./server/internal/hubconfig -run 'Test(StoreMCP|Import)' -count=1`.
  - Expected: PASS with no secret string in serialized snapshots.
- [x] **Step 5: Run focused regression checks**
  - Run `go test ./server/internal/hubconfig -count=1`.
  - Expected: existing HubConfig tests and MCP tests PASS.
- [x] **Step 6: Git checkpoint**
  - Run `git diff --check`, stage only Task 1 files, and commit with `git-workflow checkpoint`.

## Task 2: Expose MCP config through Hub RPC and inject effective servers into new clients

**Files:**
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub.go`
- Modify: `server/internal/hub/client/client.go`
- Modify: `server/internal/hub/client/session.go`
- Modify: `server/internal/hub/client/client_test.go`
- Modify: relevant Hub reporter/Hub tests discovered by `rg --files server/internal/hub -g '*_test.go'`

**Acceptance:** `hub.config.get/update` can manage MCP actions using existing Registry method/version; newly created or loaded sessions receive the current enabled MCP list, while an existing instance retains its launch/runtime configuration until replacement.

- [ ] **Step 1: Write the failing tests**
  - Add a reporter/config test for MCP add/update/disable/delete payloads returning sanitized config.
  - Add a client test with a fake ACP instance capturing `SessionNew` and `SessionLoad`, asserting the effective enabled MCP list is passed and disabled entries are omitted.
  - Add a regression assertion that legacy API key and Flicker updates still route through their existing reload paths.
- [ ] **Step 2: Run tests to verify RED**
  - Run `go test ./server/internal/hub/... -run 'Test.*MCP|Test.*HubConfig' -count=1`.
  - Expected: compile/test failure because the RPC actions and client runtime callback are absent.
- [ ] **Step 3: Write the minimal implementation**
  - Extend the existing `hubConfigUpdatePayload` handling with a typed MCP action/value decoder; keep `hub.config` as the wire method and do not change Registry protocol 2.7.
  - Make `replyHubConfigGet/update` return sanitized MCP config and trigger an agent-factory reload for new runtimes after MCP changes without closing existing instances.
  - Extend `client.RuntimeConfig` with a Hub-owned MCP snapshot callback; replace `emptyMCPServers()` at session/new, session/load, fork/probe paths with a defensive current snapshot.
  - Pass the MCP snapshot and raw runtime values into the factory construction path while ensuring the callback never exposes secrets to the frontend.
  - Reuse the existing HubState `wheelmakerUpdate` restart action as the explicit user-triggered runtime restart control; MCP save itself never invokes it.
- [ ] **Step 4: Run tests to verify GREEN**
  - Run `go test ./server/internal/hub/... -run 'Test.*MCP|Test.*HubConfig' -count=1`.
  - Expected: PASS; captured ACP params contain only enabled MCP servers.
- [ ] **Step 5: Run focused regression checks**
  - Run `go test ./server/internal/hub/... -count=1`.
  - Expected: PASS with no existing session lifecycle regressions.
- [ ] **Step 6: Git checkpoint**
  - Stage only Task 2 files and commit after `git diff --check` passes.

## Task 3: Materialize Codex MCP launch config and preserve Claude ACP behavior

**Files:**
- Create: `server/internal/hub/agent/mcp.go`
- Create: `server/internal/hub/agent/mcp_test.go`
- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Modify: `server/internal/hub/agent/codexapp_pool.go`
- Modify: `server/internal/hub/agent/factory.go`
- Modify: `server/internal/hub/agent/agent_test.go`

**Acceptance:** Codex launch args/env contain a safe materialization of enabled MCP servers, secret values never appear in args/fingerprint/logs, runtime fingerprints separate MCP configurations, Codex advertises HTTP-only MCP capability, and Claude ACP receives the same normalized ACP server variants.

- [ ] **Step 1: Write the failing tests**
  - Add `TestCodexMCPLaunchArgsEncodeNeo4jWithoutPassword` asserting command/args/cwd and env-variable references are present while the password is absent from args.
  - Add `TestCodexMCPLaunchFingerprintChangesWithMCPConfig` and `TestCodexMCPLaunchFingerprintDoesNotExposeSecrets`.
  - Add `TestCodexInitializeDeclaresHTTPMCPOnly`.
  - Add `TestCodexSessionNewAcceptsEffectiveMCPConfiguration` using the fake app-server transport and asserting the old rejection no longer occurs for the materialized runtime path.
  - Add a Claude adapter/session test asserting STDIO and HTTP ACP variants pass through unchanged and unsupported SSE is not materialized.
- [ ] **Step 2: Run tests to verify RED**
  - Run `go test ./server/internal/hub/agent -run 'Test(CodexMCP|Claude.*MCP)' -count=1`.
  - Expected: compile/test failure or the current Codex non-empty MCP rejection.
- [ ] **Step 3: Write the minimal implementation**
  - Add an internal conversion from HubConfig values to ACP MCP wire values and Codex launch materialization.
  - For Codex STDIO, use `-c` overrides for command/args/cwd and `env_vars`, placing actual env values in `ACPProcess` environment rather than command-line args.
  - For Codex HTTP, use URL plus static `http_headers` for non-secret values and `env_http_headers`/runtime environment for secrets; reject unsupported URL credential forms.
  - Include a canonical, secret-safe MCP digest in the Codex launch fingerprint and pass MCP env into process launch.
  - Set Codex `AgentCapabilities.MCPCapabilities` to HTTP true/SSE false and remove the blanket non-empty MCP rejection where the runtime has already materialized the Hub set.
  - Keep generic Claude/Claude-compatible providers on ACP session params and preserve provider-specific settings isolation.
- [ ] **Step 4: Run tests to verify GREEN**
  - Run `go test ./server/internal/hub/agent -run 'Test(CodexMCP|Claude.*MCP)' -count=1`.
  - Expected: PASS with no secret leakage assertions.
- [ ] **Step 5: Run focused regression checks**
  - Run `go test ./server/internal/hub/agent -count=1`.
  - Expected: all existing provider, Codex pool, ACP, and Claude tests PASS.
- [ ] **Step 6: Git checkpoint**
  - Stage only Task 3 files and commit after focused tests pass.

## Task 4: Add runtime status aggregation and safe error reporting

**Files:**
- Modify: `server/internal/hub/hub_state.go`
- Modify: `server/internal/hub/hub_state_adapters.go`
- Modify: `server/internal/hub/hub_state_test.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/protocol/registry.go` only for a new typed MCP state payload, without changing protocol version

**Acceptance:** MCP status is transient, reports disabled/not-started/starting/connected/failed, redacts credentials, and a failed server does not fail the ACP session or other MCP servers.

- [ ] **Step 1: Write the failing tests**
  - Add status transition tests for disabled, starting, connected, and failed states.
  - Add an error-redaction test containing a password, bearer token, and credential-bearing URL, asserting none appear in the exposed status.
  - Add a failure-isolation test where one server launch fails and another server/session remains usable.
- [ ] **Step 2: Run tests to verify RED**
  - Run the focused status package test command identified in Task 4 Step 1.
  - Expected: failure because MCP status has no implementation.
- [ ] **Step 3: Write the minimal implementation**
  - Store status outside HubConfig, keyed by Hub server ID and runtime attempt.
  - Map provider launch/connection callbacks to the five accepted status values.
  - Sanitize errors before state publication and keep status refresh compatible with existing HubState section requests.
  - Treat unsupported provider transport and failed startup as per-server state, not an overall session failure.
- [ ] **Step 4: Run tests to verify GREEN**
  - Run the focused status tests; expected PASS with sanitized output.
- [ ] **Step 5: Run focused regression checks**
  - Run `go test ./server/internal/hub/... -count=1`.
- [ ] **Step 6: Git checkpoint**
  - Stage only Task 4 files and commit after tests pass.

## Task 5: Replace the MCP empty panel with config/import/status UI

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/web/src/hubState/hubStore.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/app/ChatHubMenu.tsx`
- Modify: `app/web/src/app/ChatHubMenu.test.tsx`
- Modify: `app/web/src/styles/chat.css`

**Acceptance:** The reserved MCP menu supports list/add/edit/delete/enable/disable/import, preserves secret-field UX, displays runtime states, and keeps current Flicker/NPM/Skills interactions intact.

- [ ] **Step 1: Write the failing tests**
  - Extend the existing MCP menu test to assert the configured-server list, enabled count, add action, and disabled/failed state labels.
  - Add tests for STDIO form fields (`command`, `args`, `cwd`, env rows) and HTTP fields (`url`, headers).
  - Add a test that a secret env/header is represented as configured without rendering its value.
  - Add repository normalization tests for the sanitized MCP snapshot and typed update payloads.
- [ ] **Step 2: Run tests to verify RED**
  - Run `npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx` from `app`.
  - Expected: failure because the panel is still the zero-state and types do not include MCP config.
- [ ] **Step 3: Write the minimal implementation**
  - Extend registry types and normalization for MCP config and runtime status while retaining tolerant defaults for older hubs.
  - Add typed CRUD/import update payloads and route them through WorkspaceApp busy/error state.
  - Replace `ChatHubMcpDetail` empty state with a compact list/editor using existing Hub menu visual primitives and `SecretEditor` patterns.
  - Add explicit import preview/conflict display and no standalone test button.
  - Keep the MCP count aligned with configured servers and make disabled/failed rows non-blocking.
- [ ] **Step 4: Run tests to verify GREEN**
  - Run `npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx`.
  - Expected: PASS including the old no-operation behavior tests updated to the new configured behavior.
- [ ] **Step 5: Run focused regression checks**
  - Run `npm test -- --runInBand web/src/registry app/__tests__/web-hub-flicker-bridge-menu.test.ts`.
  - Run `npm run tsc:web`.
  - Expected: PASS without regressions to Hub settings and other menu sections.
- [ ] **Step 6: Git checkpoint**
  - Stage only Task 5 files and commit after web tests/typecheck pass.

## Task 6: Complete verification and Git finalization

**Files:**
- Modify: plan checkboxes in this file
- Modify: `docs/wiki/frontend-interaction/hub-menu.md` only for implemented stable behavior
- Modify: `docs/wiki/agents/codex.md` only for implemented stable Codex MCP/runtime facts
- Create: `docs/wiki/features/mcp-management.md` for the implemented durable feature contract

**Acceptance:** Every spec acceptance item has evidence; the task branch is clean, committed, pushed, and not merged into a dirty `main` worktree.

- [ ] **Step 1: Run full server verification**
  - Run `go test ./server/internal/hub/... ./server/internal/hubconfig/... ./server/internal/protocol/...`.
  - Expected: PASS.
- [ ] **Step 2: Run full affected web verification**
  - Run `npm test -- --runInBand` from `app` and `npm run tsc:web`.
  - Expected: PASS.
- [ ] **Step 3: Run final hygiene checks**
  - Run `git diff --check`, inspect `git diff --stat`, verify no secret literal or generated artifact is staged, and verify the Neo4j import fixture contains only synthetic credentials.
- [ ] **Step 4: Update durable wiki knowledge**
  - Update only the confirmed MCP menu/runtime behavior after implementation is stable; do not document unimplemented OAuth/SSE/tool policy.
- [ ] **Step 5: Git finalize**
  - Run `git status -sb`, push the task branch, verify its remote SHA, and retain the worktree/branch because the original `main` worktree contains pre-existing user modifications and cannot be safely merged.
