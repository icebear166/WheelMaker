# MyFlicker CLI 0.3.14 Adaptation Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Adapt WheelMaker's V1 bridge, V2 Wanqing worker, and built-in Flicker ACP loader to the installed @myflicker/cli 0.3.14 contract without changing the ACP protocol version.

**Architecture:** V1 remains the legacy Go HTTP bridge and keeps dynamic model discovery, with its default Claude model moved to CLAUDE_OPUS_5. V2 becomes a hard-cut 0.3.14 bundle contract in both the Go probe and embedded Node worker; 0.3.13 is rejected. The built-in ACP loader keeps its launch arguments and access/resume shims, but matches the 0.3.14 ACP session class shape.

**Tech Stack:** Go, Go testing, Node ESM loader fixtures, Markdown wiki documentation.

---

### Task 1: Establish the synchronized implementation baseline

**Files:**
- Create: docs/plans/nospec/2026-08-07-myflicker-cli-0314-adaptation/plan-myflicker-cli-0314-adaptation.md
- Preserve: server/internal/hub/tools/npm.go
- Preserve: server/internal/hub/tools/tools_test.go

- [ ] Step 1: Verify the branch is synchronized and the two pre-existing npm changes are still isolated.

Run:

    git status --short --branch
    git diff --name-only

Expected: main tracks origin/main; only the two pre-existing server/internal/hub/tools files are modified before implementation.

- [ ] Step 2: Review the current Flicker contract locations before editing.

Inspect server/internal/flickerbridge/v2.go, server/internal/flickerbridge/flicker_bridge.go, server/internal/hub/agent/flicker_loader.go, server/internal/hub/agent/acp_provider.go, and their existing tests. Do not change ACP protocol constants or wire types.

### Task 2: Lock the V1 0.3.14 model default with failing tests

**Files:**
- Modify: server/internal/flickerbridge/flicker_bridge_test.go
- Modify: server/internal/hub/agent/agent_test.go

- [ ] Step 1: Add the V1 settings regression test.

Add a test in server/internal/flickerbridge/flicker_bridge_test.go that calls parseSettings(nil, map[string]string{}) and asserts settings.DefaultModel == CLAUDE_OPUS_5.

- [ ] Step 2: Update the existing V2-tier model expectation to the 0.3.14 Opus ID.

In TestApplyFlickerModelsUsesCurrentV2IDsForTierDefaults, keep the fixture containing claude-opus-5 and assert that the default, Fable, and Opus environment values select claude-opus-5 instead of claude-4.8-opus.

- [ ] Step 3: Run the new and changed tests to observe the red state.

Run:

    go test ./internal/flickerbridge -run TestParseSettingsDefaultsToMyFlickerOpus5 -count=1
    go test ./internal/hub/agent -run TestApplyFlickerModelsUsesCurrentV2IDsForTierDefaults -count=1

Expected: both tests fail because production still defaults to CLAUDE_OPUS_4_7 / CLAUDE_OPUS_4_8.

### Task 3: Implement the V1 model default and tier preference

**Files:**
- Modify: server/internal/flickerbridge/flicker_bridge.go:129
- Modify: server/internal/hub/agent/acp_provider.go:600-607,649-652
- Test: server/internal/flickerbridge/flicker_bridge_test.go
- Test: server/internal/hub/agent/agent_test.go

- [ ] Step 1: Change the legacy bridge fallback model.

Change the MYFLICKER_DEFAULT_MODEL fallback from CLAUDE_OPUS_4_7 to CLAUDE_OPUS_5. Keep the environment override and dynamic /eapi/kwaipilot/plugin/agent/models catalog unchanged.

- [ ] Step 2: Prefer the new Opus model in the Claude-compatible Flicker profile.

Set flickerTierModels.fable and flickerTierModels.opus to CLAUDE_OPUS_5. In applyFlickerModels, try the normalized 0.3.14 ID claude-opus-5 before the retained claude-4.8-opus fallback so V2 catalogs select the new native ID while older dynamic catalogs still have a deterministic fallback.

- [ ] Step 3: Run the V1 red tests as green tests.

Run:

    go test ./internal/flickerbridge -run TestParseSettingsDefaultsToMyFlickerOpus5 -count=1
    go test ./internal/hub/agent -run 'TestApplyFlickerModelsUsesCurrentV2IDsForTierDefaults|TestApplyFlickerModelsFallsBackToStrongestAvailableClaudeModel' -count=1

Expected: all selected tests pass.

### Task 4: Lock the V2 0.3.14 bundle contract with failing tests

**Files:**
- Modify: server/internal/flickerbridge/flicker_bridge_test.go

- [ ] Step 1: Add the 0.3.14 probe fixture.

Add TestProbeV2AcceptsMyFlicker0314Bundle using package version 0.3.14 and the exact 0.3.14 anchor DQ();var ks6=F0(bB(),1);import Qe9 from"fs";. Assert that ProbeV2 reports Available=true and version 0.3.14.

- [ ] Step 2: Make the old stable contract explicitly reject 0.3.13.

Change the old acceptance fixture into a rejection test using the 0.3.13 package metadata and old anchor, asserting unsupported @myflicker/cli version.

- [ ] Step 3: Move the worker contract fixture to 0.3.14.

Update the existing worker contract fixture metadata and exported minified identifiers to the 0.3.14 names: lc1 for wanqingPlugin, M5 for models, p4A for createOpenAI, MxA for createAnthropic, yf9 for login, gF for setContext, and p6 for getContext. Update expected ready/health versions to 0.3.14, while retaining a separate 0.3.13 rejection fixture.

- [ ] Step 4: Run the V2 tests to observe the red state.

Run:

    go test ./internal/flickerbridge -run 'TestProbeV2AcceptsMyFlicker0314Bundle|TestProbeV2RejectsMyFlicker0313|TestV2WorkerLoadsMyFlicker0314BundleContract' -count=1

Expected: the new 0.3.14 tests fail with the current unsupported-version/contract behavior, proving the tests cover the missing implementation.

### Task 5: Implement the V2 0.3.14 contract in Go and embedded Node

**Files:**
- Modify: server/internal/flickerbridge/v2.go:59-71
- Modify: server/internal/flickerbridge/v2.go:460-465
- Test: server/internal/flickerbridge/flicker_bridge_test.go

- [ ] Step 1: Replace the Go contract map with the 0.3.14 anchor and exports.

Use one supported entry:

    const v2BundleAnchor = DQ();var ks6=F0(bB(),1);import Qe9 from"fs";

    var v2BundleContracts = map[string]v2BundleContract{
        "0.3.14": {
            Anchor: v2BundleAnchor,
            Exports: "DQ();\nexport{lc1 as wanqingPlugin,M5 as models,p4A as createOpenAI,MxA as createAnthropic,yf9 as login,gF as setContext,p6 as getContext};",
        },
    }

Keep exact-one-anchor validation and all runtime request/model logic unchanged.

- [ ] Step 2: Mirror the same single-version contract in nodeWorkerSource.

Set BUNDLE_CONTRACTS to the 0.3.14 anchor and export string from Step 1, with no 0.3.13 entry.

- [ ] Step 3: Run the V2 tests as green tests.

Run:

    go test ./internal/flickerbridge -run 'TestProbeV2|TestV2Worker' -count=1

Expected: all V2 probe, worker, catalog, request, and diagnostic tests pass, including 0.3.14 acceptance and 0.3.13 rejection.

### Task 6: Lock the built-in ACP loader's 0.3.14 shape with a failing test

**Files:**
- Modify: server/internal/hub/agent/agent_test.go

- [ ] Step 1: Add a compact 0.3.14 ACP class fixture.

Add a fixture containing the exact class prefix class ...{connection;sessions=new Map;sessionModelMap=new Map;messageBus;nodeBridge;context;defaultCwd;contextCreateOpts;clientFsCapabilities;, a buildSessionConfigOptions(A){...return Q} method, the implemented async unstable_setSessionConfigOption signature used by 0.3.14, and the existing unimplemented unstable_resumeSession stub.

- [ ] Step 2: Add the loader regression test.

Run the fixture through runFlickerLoaderPatchCommand and assert that it contains the WheelMaker access helper, return WMFA(Q,this.__wmfConfig), the access handler, and the async resume shim. Keep TestFlickerLoaderRejectsLegacyMyFlickerBundleShape to prove the pre-0.3.14 class shape is not silently patched.

- [ ] Step 3: Run the loader fixture test to observe the red state.

Run:

    go test ./internal/hub/agent -run TestFlickerLoaderPatchesMyFlicker0314BundleShape -count=1

Expected: failure at the access-helper/class-shape matcher because the loader still expects sessions=new Map;messageBus without sessionModelMap.

### Task 7: Implement and verify the built-in 0.3.14 ACP loader

**Files:**
- Modify: server/internal/hub/agent/flicker_loader.go:95-101
- Modify: server/internal/hub/agent/agent_test.go

- [ ] Step 1: Match the 0.3.14 session class shape.

Change the access-helper regex boundary to require sessions=new Map;sessionModelMap=new Map;messageBus;..., and update its diagnostic label to identify the current 0.3.14 shape. Leave launch arguments unchanged.

- [ ] Step 2: Keep the existing 0.3.14 method patches intact.

Continue to patch buildSessionConfigOptions, add the access branch to unstable_setSessionConfigOption, and replace unstable_resumeSession with async unstable_resumeSession(A){return await this.loadSession(A)}. Do not add an environment variable or change --approval-mode, --thinking-level, or acp.

- [ ] Step 3: Run fixture and installed-bundle verification.

Run:

    go test ./internal/hub/agent -run 'TestFlickerLoader|TestFlickerACPProvider_LaunchArgs' -count=1

Expected: the compact 0.3.14 fixture, installed @myflicker/cli 0.3.14 patch, legacy-shape rejection, and unchanged launch-argument tests pass. The installed test must exercise the real dist/cli.mjs when myflicker is available.

### Task 8: Document the compatibility boundary and run final verification

**Files:**
- Modify: docs/wiki/protocols/acp.md

- [ ] Step 1: Update the ACP provider notes.

Document that V1 defaults to CLAUDE_OPUS_5 while retaining dynamic legacy catalog discovery; V2 supports only @myflicker/cli 0.3.14 and its exact bundle contract; the built-in loader targets the 0.3.14 session shape while retaining the existing ACP launch flags. State that no ACP protocol version changed.

- [ ] Step 2: Format the changed Go files.

Run:

    gofmt -w server/internal/flickerbridge/flicker_bridge.go server/internal/flickerbridge/flicker_bridge_test.go server/internal/flickerbridge/v2.go server/internal/hub/agent/acp_provider.go server/internal/hub/agent/agent_test.go

- [ ] Step 3: Run focused verification.

Run:

    go test ./internal/flickerbridge ./internal/hub/agent -count=1

Expected: exit code 0 with no test failures.

- [ ] Step 4: Run the complete server test suite.

Run from server/:

    go test ./...

Expected: exit code 0. Read the complete output and record any environment-only skips or failures rather than inferring success.

- [ ] Step 5: Review scope and Git state.

Run from the repository root:

    git diff --check
    git status --short --branch
    git diff --stat

Confirm only the planned Flicker files, ACP wiki/plan, and the two preserved pre-existing npm files are present.

- [ ] Step 6: Commit and push after verification.

Use the repository completion gate exactly:

    git add -A
    git commit -m "fix: adapt flicker integrations to cli 0.3.14"
    git push origin main

The two preserved pre-existing npm changes will be included by the repository-required git add -A gate and must be called out in the final report.
