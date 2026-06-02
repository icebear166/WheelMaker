# Flicker ACP Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `flicker` ACP provider backed by `myflicker acp`.

**Architecture:** Reuse the existing generic ACP provider preset pipeline. `flicker` is the canonical provider name; `myflicker` is only the executable name.

**Tech Stack:** Go, WheelMaker ACP provider presets, Go unit tests.

---

### Task 1: Provider Tests

**Files:**
- Modify: `server/internal/hub/agent/agent_test.go`

- [ ] **Step 1: Write the failing test**

Add a test next to the other provider launch tests:

```go
func TestFlickerACPProvider_LaunchArgs(t *testing.T) {
	p := NewFlickerProvider()
	p.resolveBinary = func(name string, configuredPath string) (string, error) {
		if name != "myflicker" {
			t.Fatalf("resolveBinary name=%q, want myflicker", name)
		}
		if configuredPath != "" {
			t.Fatalf("resolveBinary configuredPath=%q, want empty", configuredPath)
		}
		return "/usr/bin/myflicker", nil
	}

	exe, args, env, err := p.Launch()
	if err != nil {
		t.Fatalf("launch: %v", err)
	}
	if exe != "/usr/bin/myflicker" {
		t.Fatalf("exe=%q", exe)
	}
	if !reflect.DeepEqual(args, []string{"acp"}) {
		t.Fatalf("args=%v", args)
	}
	if len(env) != 0 {
		t.Fatalf("env=%v, want empty", env)
	}
}
```

Update provider parsing and preset tests so `flicker` is accepted and `myflicker` is rejected.

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/hub/agent -run "TestFlickerACPProvider|TestParseACPProviderCodexAliases|TestProviderPresetByName" -count=1`

Expected: fail because `NewFlickerProvider` and `ACPProviderFlicker` are not implemented yet.

### Task 2: Provider Implementation

**Files:**
- Modify: `server/internal/protocol/acp_const.go`
- Modify: `server/internal/hub/agent/acp_provider.go`
- Modify: `server/internal/hub/agent/factory.go`
- Modify: `server/internal/hub/agent/skills.go`
- Modify: `app/web/src/main.tsx`
- Modify: `app/__tests__/web-agent-package-update-settings.test.ts`

- [ ] **Step 1: Add protocol enum**

Add `ACPProviderFlicker ACPProvider = "flicker"`, include it in `acpProviders`, and parse only `"flicker"`.

- [ ] **Step 2: Add provider preset**

Add:

```go
FlickerACPProviderPreset = ACPProviderPreset{
	Name:                   "flicker",
	BinaryName:             "myflicker",
	Args:                   []string{"acp"},
	MissingPathErrTemplate: "flicker: myflicker binary not found in PATH: %v",
	SkillProjectDirs:       []string{".agents/skills"},
	SkillUserDirs:          []string{"~/.agents/skills"},
}
```

Add `NewFlickerProvider()`.

- [ ] **Step 3: Register factory and skills preset**

Add flicker to `newACPFactoryWithDefaults`, `PreferredName`, and `providerPresetByName`.

- [ ] **Step 4: Run targeted tests**

Run: `go test ./internal/hub/agent ./internal/protocol -run "TestFlickerACPProvider|TestParseACPProviderCodexAliases|TestProviderPresetByName" -count=1`

Expected: pass.

### Task 3: Verification

**Files:**
- Verify package tests only.

- [ ] **Step 1: Verify app tag variant**

Run: `npm test -- web-agent-package-update-settings.test.ts --runInBand` from `app/`

Expected: pass.

- [ ] **Step 2: Run web TypeScript check**

Run: `npm run tsc:web` from `app/`

Expected: pass.

- [ ] **Step 3: Run broader package tests**

Run: `go test ./internal/hub/agent ./internal/protocol -count=1`

Expected: pass.

- [ ] **Step 4: Inspect diff**

Run: `git diff -- server/internal/protocol/acp_const.go server/internal/hub/agent/acp_provider.go server/internal/hub/agent/factory.go server/internal/hub/agent/skills.go server/internal/hub/agent/agent_test.go app/web/src/main.tsx app/__tests__/web-agent-package-update-settings.test.ts`

Expected: only flicker provider integration and tests changed.
