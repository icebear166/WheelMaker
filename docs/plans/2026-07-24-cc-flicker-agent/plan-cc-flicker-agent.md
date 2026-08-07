# cc-flicker Claude-compatible Agent Implementation Plan

> **Update (post-implementation):** cc-flicker later switched from the `availableModels` allowlist to **CLI gateway model discovery** (`env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`, no `availableModels`/`enforceAvailableModels`). Reason: the allowlist path strips non-Claude models' effort capability, so only Claude models could switch effort. The `profile.gatewayDiscovery` flag now gates this in `ensureClaudeCompatibleSettings`. Sections below that describe the 8-model whitelist / `enforceAvailableModels=true` are superseded by the spec's updated model decisions.

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth Claude-compatible provider `cc-flicker` that launches `claude-agent-acp` against the local MyFlickerBridge (`http://127.0.0.1:17888`), registers only when `api_keys.flicker` is set and the adapter binary is available, exposes the 8 MyFlicker whitelist models with `CLAUDE_OPUS_4_8` default, isolates its state/recovery under `<stateDir>/.data/cc-flicker`, and appears as a Claude child labeled `cc · flicker` in every App agent picker.

**Architecture:** cc-flicker reuses the existing Claude-compatible provider machinery verbatim. It adds one strict config key (`APIKeysConfig.Flicker`), one provider ID (`ACPProviderCCFlicker`), one preset + profile + constructor in `acp_provider.go`, one Hub factory wiring line, one recovery route, and two Web presentation entries. All shared helpers (`claudeCompatibleLaunchEnvironment`, `ensureClaudeCompatibleSettings`, `removeClaudeCompatibleManagedEnv`, redaction, `buildAgentChoiceNodes`) are consumed unchanged. Unlike other `cc-*`, `api_keys.flicker` is only the bridge's **local gate token** (byte-for-byte equal to bridge `MYFLICKER_BRIDGE_API_KEY`, default placeholder `00000000000000000000`); upstream auth stays inside the bridge and never touches WheelMaker. cc-flicker does **no** effort normalization (walks the generic config-option path like cc-qwen).

**Tech Stack:** Go 1.x server (`server/internal/...`), ACP subprocess bridge, strict JSON config, React 19, TypeScript 5.8, Jest 30, react-test-renderer, CSS.

**Spec:** [`spec-cc-flicker-agent.md`](../../scope/2026-07-24-cc-flicker-agent.md)

**Naming hazard (read before coding):** A different provider named `flicker` already exists — `ACPProviderFlicker = "flicker"`, `FlickerACPProviderPreset`, `NewFlickerProvider()`, Web variant `8`, launched via `launchFlicker`/node loader. The new provider is `cc-flicker` and MUST use distinct identifiers: `ACPProviderCCFlicker`, `ClaudeCompatibleFlickerProviderPreset`, `NewCCFlickerProvider()`, `claudeCompatibleFlickerProfile`, Web variant `2`. Never reuse the `"flicker"` Name/identifiers for `cc-flicker`, or `Launch()` will wrongly branch into `launchFlicker`.

---

## Task 1: Add strict config key, provider ID, redaction coverage, and example

**Files:**

- Modify: `server/internal/shared/config.go`
- Modify: `server/internal/shared/shared_test.go`
- Modify: `server/config.example.json`
- Modify: `server/internal/protocol/acp_const.go`
- Modify: `server/internal/hub/agent/agent_test.go`
- Modify: `server/internal/security/redact_test.go`

- [ ] **Step 1: Write failing config, provider-ID, and redaction tests**

In `server/internal/shared/shared_test.go`, extend the existing `TestLoadConfigAcceptsClaudeCompatibleAPIKeys` (around lines 198–217) so the loaded JSON includes a `flicker` key and asserts it round-trips:

```go
func TestLoadConfigAcceptsClaudeCompatibleAPIKeys(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	data := []byte(`{"projects":[],"api_keys":{"deepseek":"deepseek-test-key","kimi":"kimi-test-key","qwen":"qwen-test-key","zai":"zai-test-key","flicker":"flicker-test-key"}}`)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.APIKeys.DeepSeek != "deepseek-test-key" ||
		cfg.APIKeys.Kimi != "kimi-test-key" ||
		cfg.APIKeys.Qwen != "qwen-test-key" ||
		cfg.APIKeys.ZAI != "zai-test-key" ||
		cfg.APIKeys.Flicker != "flicker-test-key" {
		t.Fatalf("APIKeys = %#v", cfg.APIKeys)
	}
}
```

In the `config.example.json` validation test (around lines 177–195), add an assertion that the committed example contains `"flicker": ""` and that after loading `cfg.APIKeys.Flicker == ""`.

In `server/internal/hub/agent/agent_test.go`, extend `TestParseACPProviderClaudeCompatible` (around line 996) with:

```go
provider, ok = protocol.ParseACPProvider("CC-FLICKER")
if !ok || provider != protocol.ACPProviderCCFlicker {
	t.Fatalf("ParseACPProvider(CC-FLICKER) = (%q, %v), want (%q, true)", provider, ok, protocol.ACPProviderCCFlicker)
}
```

Update the `ACPProviderNames` stable-order assertion (around lines 1019–1027) so the trailing Claude-compatible block is exactly `cc-deepseek, cc-glm, cc-kimi, cc-qwen, cc-flicker`, each appearing once.

In `server/internal/security/redact_test.go`, extend `TestRedactDiagnosticValueRedactsAPIKeysContainer` (around lines 43–65) so both the map and struct inputs include `"flicker": "flicker-test-secret"`; the expected output stays `map[string]any{"api_keys": RedactedValue}` (the whole container is redacted, so no per-key change is needed).

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run:

```powershell
cd server
go test ./internal/shared ./internal/hub/agent ./internal/security
```

Expected: FAIL — compile errors for `cfg.APIKeys.Flicker` and `protocol.ACPProviderCCFlicker` (undefined), plus the `ACPProviderNames` order assertion mismatch.

- [ ] **Step 3: Add the config field**

In `server/internal/shared/config.go`, add `Flicker` to `APIKeysConfig` (lines 19–24), keeping `DisallowUnknownFields()` unchanged:

```go
type APIKeysConfig struct {
	DeepSeek string `json:"deepseek,omitempty"`
	Kimi     string `json:"kimi,omitempty"`
	Qwen     string `json:"qwen,omitempty"`
	ZAI      string `json:"zai,omitempty"`
	Flicker  string `json:"flicker,omitempty"`
}
```

- [ ] **Step 4: Add the provider ID**

In `server/internal/protocol/acp_const.go`, append the constant at the end of the const block (after `ACPProviderCCQwen`, around line 112):

```go
	ACPProviderCCFlicker ACPProvider = "cc-flicker"
```

Append it to the `acpProviders` slice (line 115), after `ACPProviderCCQwen`:

```go
var acpProviders = []ACPProvider{ACPProviderCodex, ACPProviderClaude, ACPProviderCopilot, ACPProviderOpenCode, ACPProviderMimo, ACPProviderCodeBuddy, ACPProviderFlicker, ACPProviderKimi, ACPProviderCCDeepSeek, ACPProviderCCGLM, ACPProviderCCKimi, ACPProviderCCQwen, ACPProviderCCFlicker}
```

Add the parser case in `ParseACPProvider` (after the `ACPProviderCCQwen` case, around line 142):

```go
	case string(ACPProviderCCFlicker):
		return ACPProviderCCFlicker, true
```

- [ ] **Step 5: Add the example key**

In `server/config.example.json`, add `flicker` to the `api_keys` block (lines 8–12):

```json
  "api_keys": {
    "deepseek": "",
    "kimi": "",
    "qwen": "",
    "zai": "",
    "flicker": ""
  },
```

(JSON forbids comments; the semantics — "value must byte-for-byte equal the bridge's `MYFLICKER_BRIDGE_API_KEY`, default `00000000000000000000`" — live in the spec and wiki, synced in Task 6.)

- [ ] **Step 6: Run the focused tests and confirm they pass**

```powershell
cd server
go test ./internal/shared ./internal/hub/agent ./internal/security
```

Expected: PASS for all three packages.

- [ ] **Step 7: Commit**

```powershell
git add server/internal/shared/config.go server/internal/shared/shared_test.go server/config.example.json server/internal/protocol/acp_const.go server/internal/hub/agent/agent_test.go server/internal/security/redact_test.go
git commit -m "feat: add cc-flicker config key and provider id"
```

## Task 2: Add the cc-flicker preset, profile, and launch constructor

**Files:**

- Modify: `server/internal/hub/agent/acp_provider.go`
- Modify: `server/internal/hub/agent/agent_test.go`

- [ ] **Step 1: Write the failing launch-contract test row**

In `server/internal/hub/agent/agent_test.go`, add a `flicker` row to the table-driven launch env/settings test (same shape as the `glm` row around lines 270–303). It asserts the exact provider-owned launch env, that the fake key never appears in argv, and the exact `settings.json` contents:

```go
		{
			name:        "flicker",
			newProvider: NewCCFlickerProvider,
			key:         "flicker-test-key",
			wantArgs:    []string{"--hide-claude-auth"},
			wantEnv: map[string]string{
				"CLAUDE_CONFIG_DIR":       filepath.Join(stateDir, ".data", "cc-flicker"),
				"ANTHROPIC_BASE_URL":      "http://127.0.0.1:17888",
				"ANTHROPIC_AUTH_TOKEN":    "flicker-test-key",
				"ANTHROPIC_API_KEY":       "",
				"CLAUDE_CODE_USE_BEDROCK": "",
				"CLAUDE_CODE_USE_VERTEX":  "",
				"CLAUDE_CODE_USE_FOUNDRY": "",
			},
			wantSettings: map[string]any{
				"model":                  "CLAUDE_OPUS_4_8",
				"availableModels":        []any{"CLAUDE_OPUS_4_8", "CLAUDE_4_6", "GPT_5_6_SOL", "GPT_5_6_TERRA", "GPT_5_6_LUNA", "KIMI_K3", "GLM_5_2", "DEEPSEEK_V4_PRO"},
				"enforceAvailableModels": true,
				"env": map[string]any{
					"ANTHROPIC_DEFAULT_FABLE_MODEL":  "CLAUDE_OPUS_4_8",
					"ANTHROPIC_DEFAULT_OPUS_MODEL":   "CLAUDE_OPUS_4_8",
					"ANTHROPIC_DEFAULT_SONNET_MODEL": "CLAUDE_4_6",
					"ANTHROPIC_DEFAULT_HAIKU_MODEL":  "CLAUDE_4_6",
					"CLAUDE_CODE_SUBAGENT_MODEL":     "CLAUDE_4_6",
				},
			},
		},
```

Add a focused assertion (mirroring the GLM anti-`glm-5.2` guard at lines 412–418) that the `flicker` settings `env` contains **neither** `CLAUDE_CODE_MAX_CONTEXT_TOKENS` nor `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, and the top-level settings contains no `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`:

```go
			if tt.name == "flicker" {
				envMap := gotSettings["env"].(map[string]any)
				for _, forbidden := range []string{"CLAUDE_CODE_MAX_CONTEXT_TOKENS", "CLAUDE_CODE_AUTO_COMPACT_WINDOW"} {
					if _, present := envMap[forbidden]; present {
						t.Fatalf("cc-flicker settings.env unexpectedly contains %s", forbidden)
					}
				}
				if _, present := gotSettings["CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY"]; present {
					t.Fatal("cc-flicker settings unexpectedly enables gateway model discovery")
				}
			}
```

Add a launch-error leak-guard test (mirror `TestClaudeCompatibleProviderLaunchErrorDoesNotLeakKey` at lines 663–668) using `NewCCFlickerProvider` with key `"flicker-test-key"` and a `resolveBinary` that fails; assert the error mentions the provider but not the key.

- [ ] **Step 2: Run and confirm it fails**

```powershell
cd server
go test ./internal/hub/agent -run 'TestClaudeCompatibleProvider|TestParseACPProvider'
```

Expected: FAIL — `NewCCFlickerProvider` and `ClaudeCompatibleFlickerProviderPreset` are undefined.

- [ ] **Step 3: Add the preset, profile, and constructor**

In `server/internal/hub/agent/acp_provider.go`, add the preset to the same `var (...)` block that holds `ClaudeCompatibleGLMProviderPreset` (after the Qwen preset, around line 151):

```go
	ClaudeCompatibleFlickerProviderPreset = ACPProviderPreset{
		Name:                   "cc-flicker",
		BinaryName:             "claude-agent-acp",
		Args:                   []string{"--hide-claude-auth"},
		InstallHint:            "@agentclientprotocol/claude-agent-acp",
		SkillProjectDirs:       []string{".claude/skills"},
		SkillProjectParentDirs: []string{".claude/skills"},
		SkillUserDirs:          []string{"~/.claude/skills"},
	}
```

Add the constructor next to `NewCCGLMProvider` (around line 240):

```go
func NewCCFlickerProvider(stateDir, apiKey string) *acpProvider {
	profile := claudeCompatibleFlickerProfile(stateDir)
	preset := ClaudeCompatibleFlickerProviderPreset
	preset.Env = claudeCompatibleLaunchEnvironment(profile, apiKey)
	provider := NewACPProvider(preset)
	provider.claudeSettings = &profile
	return provider
}
```

Add the profile next to `claudeCompatibleGLMProfile` (around line 379). Note: only the 5 tier-mapping variables go in `settingsEnv`; deliberately omit `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `API_TIMEOUT_MS`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `*_MODEL_NAME`, and `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`:

```go
func claudeCompatibleFlickerProfile(stateDir string) claudeCompatibleProfile {
	return claudeCompatibleProfile{
		configDir:       filepath.Join(stateDir, ".data", ClaudeCompatibleFlickerProviderPreset.Name),
		endpoint:        "http://127.0.0.1:17888",
		authName:        "ANTHROPIC_AUTH_TOKEN",
		defaultModel:    "CLAUDE_OPUS_4_8",
		availableModels: []string{"CLAUDE_OPUS_4_8", "CLAUDE_4_6", "GPT_5_6_SOL", "GPT_5_6_TERRA", "GPT_5_6_LUNA", "KIMI_K3", "GLM_5_2", "DEEPSEEK_V4_PRO"},
		settingsEnv: map[string]string{
			"ANTHROPIC_DEFAULT_FABLE_MODEL":  "CLAUDE_OPUS_4_8",
			"ANTHROPIC_DEFAULT_OPUS_MODEL":   "CLAUDE_OPUS_4_8",
			"ANTHROPIC_DEFAULT_SONNET_MODEL": "CLAUDE_4_6",
			"ANTHROPIC_DEFAULT_HAIKU_MODEL":  "CLAUDE_4_6",
			"CLAUDE_CODE_SUBAGENT_MODEL":     "CLAUDE_4_6",
		},
	}
}
```

Do not touch `claudeCompatibleLaunchEnvironment`, `ensureClaudeCompatibleSettings`, `removeClaudeCompatibleManagedEnv`, or the `Launch()` `FlickerACPProviderPreset.Name` branch — cc-flicker's Name is `"cc-flicker"`, so it correctly falls through to the `claudeSettings` path.

- [ ] **Step 4: Format, run, and confirm it passes**

```powershell
cd server
gofmt -w internal/hub/agent/acp_provider.go internal/hub/agent/agent_test.go
go test ./internal/hub/agent -run 'TestClaudeCompatibleProvider|TestParseACPProvider'
```

Expected: PASS; no real adapter process or bridge is invoked.

- [ ] **Step 5: Commit**

```powershell
git add server/internal/hub/agent/acp_provider.go server/internal/hub/agent/agent_test.go
git commit -m "feat: add cc-flicker provider preset and profile"
```

## Task 3: Wire the Hub factory, registration, and skills discovery

**Files:**

- Modify: `server/internal/hub/agent/factory.go`
- Modify: `server/internal/hub/agent/skills.go`
- Modify: `server/internal/hub/hub.go`
- Modify: `server/internal/hub/agent/agent_test.go`
- Modify: `server/internal/hub/hub_test.go`

- [ ] **Step 1: Write the failing registration-matrix and Hub-wiring tests**

In `server/internal/hub/agent/agent_test.go`, extend `TestConfiguredACPFactoryClaudeCompatibleRegistrationMatrix` (lines 4909–4948): add a `flickerKey` field to the test-case struct, add a `FlickerAPIKey` field when building options, extend the `available` predicate to accept `"cc-flicker"`, and add cases:

```go
		{name: "flicker only", flickerKey: "flicker-key", available: true, wantNames: []string{"cc-flicker"}},
		{name: "all", deepseekKey: "deepseek-key", kimiKey: "kimi-key", qwenKey: "qwen-key", zaiKey: "zai-key", flickerKey: "flicker-key", available: true, wantNames: []string{"cc-deepseek", "cc-flicker", "cc-glm", "cc-kimi", "cc-qwen"}},
```

Update the existing `"all"` case (currently without flicker) to the new one above, and update the `available` closure:

```go
			}, func(provider ACPProvider) bool {
				return tt.available && (provider.Name() == "cc-deepseek" || provider.Name() == "cc-glm" || provider.Name() == "cc-kimi" || provider.Name() == "cc-qwen" || provider.Name() == "cc-flicker")
			})
```

Add the shared-skills coverage: in the loop that walks `providerPresetByName` for `[]string{"cc-deepseek", "cc-glm", "cc-kimi", "cc-qwen"}` (around lines 4820–4853), append `"cc-flicker"`.

In `server/internal/hub/hub_test.go`, first read the existing `TestNewWiresQwenAPIKeyIntoHubFactory` (around line 3456) to learn how it constructs the Hub, whether it injects a deterministic factory or gates on binary availability, and which package-private seam (e.g. `newWithFactory`) and assertion style (e.g. `collectProjectInfo().Agents`) it uses. Copy that test body verbatim into a new `TestNewWiresFlickerAPIKeyIntoHubFactory`, changing only:

- the config field: `APIKeys: logger.APIKeysConfig{Flicker: "flicker-test-key"}`
- the injected/available provider set to include `protocol.ACPProviderCCFlicker`
- the expected agent name assertion to require `cc-flicker`
- a marshaled-`ProjectInfo`/Registry-snapshot assertion that the literal `"flicker-test-key"` does not appear (reuse the sibling's leak-check helper if it has one)

Do not introduce new helpers or availability guards not already used by the sibling; keeping the exact same structure guarantees the test is deterministic on machines without `claude-agent-acp`.

- [ ] **Step 2: Run and confirm it fails**

```powershell
cd server
go test ./internal/hub/agent ./internal/hub -run 'RegistrationMatrix|WiresFlicker|Skills'
```

Expected: FAIL — `FlickerAPIKey` field and `cc-flicker` registration do not exist.

- [ ] **Step 3: Add the factory option and registration**

In `server/internal/hub/agent/factory.go`, add the field to `ACPFactoryOptions` (lines 25–31), after `ZAIAPIKey`:

```go
	FlickerAPIKey  string
```

Add the registration block in `newACPFactoryWithOptions` (after the `zaiKey` block around line 143, before the `len(f.Names()) == 0` check):

```go
	if flickerKey := strings.TrimSpace(options.FlickerAPIKey); flickerKey != "" {
		registerConfiguredProvider(f, protocol.ACPProviderCCFlicker, NewCCFlickerProvider(options.StateDir, flickerKey), available)
	}
```

Do **not** add `cc-flicker` to `PreferredName()`'s `ordered` list — the spec requires `PreferredName()` never selects it.

- [ ] **Step 4: Add skills discovery**

In `server/internal/hub/agent/skills.go`, add the case to `providerPresetByName` (after the Qwen case around line 50):

```go
	case ClaudeCompatibleFlickerProviderPreset.Name:
		return ClaudeCompatibleFlickerProviderPreset, true
```

- [ ] **Step 5: Wire the Hub config injection**

In `server/internal/hub/hub.go`, add `FlickerAPIKey` to the `ACPFactoryOptions` literal in `New()` (after `ZAIAPIKey` around line 50):

```go
		ZAIAPIKey:      apiKeys.ZAI,
		FlickerAPIKey:  apiKeys.Flicker,
```

- [ ] **Step 6: Format, run, and confirm it passes**

```powershell
cd server
gofmt -w internal/hub/agent/factory.go internal/hub/agent/skills.go internal/hub/hub.go internal/hub/agent/agent_test.go internal/hub/hub_test.go
go test ./internal/hub/agent ./internal/hub
```

Expected: PASS; factory registration is deterministic and does not depend on host PATH.

- [ ] **Step 7: Commit**

```powershell
git add server/internal/hub/agent/factory.go server/internal/hub/agent/skills.go server/internal/hub/hub.go server/internal/hub/agent/agent_test.go server/internal/hub/hub_test.go
git commit -m "feat: register cc-flicker in hub factory"
```

## Task 4: Isolate cc-flicker recovery and confirm generic effort path

**Files:**

- Modify: `server/internal/hub/client/session_recovery.go`
- Modify: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: Write the failing recovery-isolation and effort tests**

In `server/internal/hub/client/client_test.go`, extend the Claude-family recovery isolation test (the one that writes fixtures under `<stateDir>/.data/cc-glm/projects` etc.) with a `cc-flicker` fixture under `<stateDir>/.data/cc-flicker/projects`. Assert `ListResumableSessions` for `cc-flicker` sees only its own fixture with `AgentType == "cc-flicker"`, and that a session ID living only in `cc-glm`'s dir is not found for `cc-flicker`.

Add a `cc-flicker` row to `TestCreateSession_AppliesClaudeCompatibleDefaultEffort` (around line 1540) using the cc-qwen precedent — no special effort, so no explicit set:

```go
		{name: "cc-flicker walks generic effort path", agent: acp.ACPProviderCCFlicker, wantEffort: "default", wantExplicitSet: false},
```

(Match the exact struct field names used by the surrounding cc-qwen row.)

- [ ] **Step 2: Run and confirm it fails**

```powershell
cd server
go test ./internal/hub/client -run 'Recovery|Resumable|DefaultEffort'
```

Expected: FAIL — `cc-flicker` recovery returns "unsupported recovery agent".

- [ ] **Step 3: Add the recovery route**

In `server/internal/hub/client/session_recovery.go`, add `"cc-flicker"` to the shared Claude-compatible case in `sourceFor` (line 193):

```go
	case "cc-deepseek", "cc-glm", "cc-kimi", "cc-qwen", "cc-flicker":
```

Do not modify `client.go` `configPreferencesWithAgentDefaults` or `session.go` `claudeCompatibleEffortValues` / `normalizeClaudeCompatibleEffortValue`; cc-flicker deliberately falls into their default (nil / no-op) branches, matching cc-qwen.

- [ ] **Step 4: Format, run, and confirm it passes**

```powershell
cd server
gofmt -w internal/hub/client/session_recovery.go internal/hub/client/client_test.go
go test ./internal/hub/client
```

Expected: PASS — native Claude, Codex, Copilot, and all cc-* recovery/effort tests pass.

- [ ] **Step 5: Commit**

```powershell
git add server/internal/hub/client/session_recovery.go server/internal/hub/client/client_test.go
git commit -m "feat: isolate cc-flicker session recovery"
```

## Task 5: Add App label and family accent

**Files:**

- Modify: `app/web/src/chat/projectAgents.ts`
- Modify: `app/web/src/chat/agentTagVariant.ts`
- Modify: `app/__tests__/web-project-agent-choices.test.ts`
- Modify: `app/__tests__/web-agent-choice-menu.test.tsx`

- [ ] **Step 1: Write the failing label and variant tests**

In `app/__tests__/web-project-agent-choices.test.ts` (around lines 56–80), add:

```ts
expect(agentDisplayLabel('cc-flicker')).toBe('cc · flicker');
expect(agentTagVariantClass('cc-flicker')).toBe('wide-session-agent-2');
```

And extend a `buildAgentChoiceNodes` assertion that includes `'cc-flicker'` in the input list to expect the projected child `{agentType: 'cc-flicker', label: 'cc · flicker'}` grouped under the Claude node when `claude` is present.

In `app/__tests__/web-agent-choice-menu.test.tsx` (around lines 12–38), add `'cc-flicker'` to the `agents` array and assert the rendered labels include `'cc · flicker'`.

- [ ] **Step 2: Run and confirm it fails**

```powershell
cd app
npm test -- --runInBand __tests__/web-project-agent-choices.test.ts __tests__/web-agent-choice-menu.test.tsx
```

Expected: FAIL — `agentDisplayLabel('cc-flicker')` returns the raw id and the variant is unmapped.

- [ ] **Step 3: Add the label and variant**

In `app/web/src/chat/projectAgents.ts`, add the case to `agentDisplayLabel` (after the `cc-qwen` case around line 20):

```ts
    case 'cc-flicker':
      return 'cc · flicker';
```

In `app/web/src/chat/agentTagVariant.ts`, add the entry to `AGENT_TAG_VARIANT_INDEX` (after `'cc-qwen': 2,` around line 19), riding the Claude family accent (variant 2 — distinct from the legacy `flicker: 8`):

```ts
  'cc-flicker': 2,
```

`buildAgentChoiceNodes` / `buildProjectAgentChoices` / `AgentChoiceMenu.tsx` are data-driven and need no change.

- [ ] **Step 4: Run tests, typecheck, and build**

```powershell
cd app
npm test -- --runInBand __tests__/web-project-agent-choices.test.ts __tests__/web-agent-choice-menu.test.tsx
npm run tsc:web
npm run build:web
```

Expected: Jest, TypeScript, and the Web production build (emitted to `~/.wheelmaker/web`, not `app/dist`) all pass.

- [ ] **Step 5: Commit**

```powershell
git add app/web/src/chat/projectAgents.ts app/web/src/chat/agentTagVariant.ts app/__tests__/web-project-agent-choices.test.ts app/__tests__/web-agent-choice-menu.test.tsx
git commit -m "feat: label cc-flicker as claude-family child"
```

## Task 6: Full regression, wiki sync, and branch publish

**Files:**

- Modify: `docs/wiki/protocols/acp.md`
- Modify: `docs/wiki/architecture/server-runtime.md`

- [ ] **Step 1: Audit the key never leaks**

```powershell
cd E:\_Code\WheelMaker
rg -n "FlickerAPIKey|api_keys|ANTHROPIC_AUTH_TOKEN|cc-flicker|17888" server docs --glob '!**/dist/**'
```

Expected: `FlickerAPIKey` / `apiKeys.Flicker` appear only in `config.go`, `hub.go`, `factory.go`, and tests; no key value flows into argv, `ProjectInfo`, Registry DTOs, Session snapshots, or logs. Confirm `TestClaudeCompatibleProviderLaunchErrorDoesNotLeakKey`-style coverage exists for cc-flicker (added in Task 2).

- [ ] **Step 2: Sync the wiki to match the shipped code**

In `docs/wiki/protocols/acp.md`, add `cc-flicker` to the Claude-compatible family listing alongside `cc-deepseek/cc-glm/cc-kimi/cc-qwen`. Record: endpoint `http://127.0.0.1:17888` (local MyFlickerBridge); the 8-model whitelist (`CLAUDE_OPUS_4_8`, `CLAUDE_4_6`, `GPT_5_6_SOL`, `GPT_5_6_TERRA`, `GPT_5_6_LUNA`, `KIMI_K3`, `GLM_5_2`, `DEEPSEEK_V4_PRO`) with default `CLAUDE_OPUS_4_8` and `enforceAvailableModels=true`; tier mapping Opus/Fable→`CLAUDE_OPUS_4_8`, Sonnet/Haiku/Subagent→`CLAUDE_4_6`; and the key distinction — **`api_keys.flicker` is only the bridge's local gate token (byte-for-byte equal to `MYFLICKER_BRIDGE_API_KEY`, default `00000000000000000000`), not an upstream credential; the bridge owns MyFlicker device-token/SSO auth and WheelMaker never touches it**. Note cc-flicker does no effort normalization.

In `docs/wiki/architecture/server-runtime.md`, add `cc-flicker` to the provider state-isolation diagram/list with its `CLAUDE_CONFIG_DIR` root `<stateDir>/.data/cc-flicker` and recovery dir `<stateDir>/.data/cc-flicker/projects`, sitting beside the other `cc-*` roots. Leave `docs/wiki/reference/limits-monitoring.md` unchanged (cc-flicker does not touch the MyFlicker quota link).

Keep wording within scope: no Web settings, hot reload, online key checks, endpoint config, model discovery, bridge health probing, or cross-provider migration.

- [ ] **Step 3: Run full server verification**

```powershell
cd server
go test ./...
go build ./cmd/wheelmaker/
```

Expected: all Go tests pass and the Hub command builds.

- [ ] **Step 4: Run full App verification**

```powershell
cd app
npm test -- --runInBand
npm run tsc:web
npm run build:web
```

Expected: Jest, TypeScript, and the Web production build all pass.

- [ ] **Step 5: Commit the wiki sync**

```powershell
cd E:\_Code\WheelMaker
git add docs/wiki/protocols/acp.md docs/wiki/architecture/server-runtime.md
git commit -m "docs: document cc-flicker claude-compatible provider"
```

- [ ] **Step 6: Publish per the CLAUDE.md completion gate**

```powershell
cd E:\_Code\WheelMaker
git add -A
git status --short
git push origin main
```

Expected: working tree clean, all commits pushed. If any gate (tests/build/push) fails, stop and resolve before claiming completion.
