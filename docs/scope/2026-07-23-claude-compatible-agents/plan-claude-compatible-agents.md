# Claude-compatible GLM / Kimi Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Hub-local `cc-glm` and `cc-kimi` agents that run through `claude-agent-acp`, require only the matching API key, isolate provider state and recovery, expose provider-approved models, and appear as expandable Claude children in every App agent picker.

**Architecture:** Extend the strict Hub config with local API keys, then build one configured `ACPFactory` per Hub. The factory registers each Claude-compatible provider only when both its key and `claude-agent-acp` are available, and launches an owned adapter process with provider-specific environment variables and an isolated `CLAUDE_CONFIG_DIR`. Registry payloads remain a flat list of agent IDs; the App projects that list into a Claude split-button group. Session persistence keeps the existing agent ID boundary, while Claude recovery is parameterized with an agent ID and provider-specific projects directory.

**Tech Stack:** Go 1.x server, ACP subprocess bridge, strict JSON config, React 19, TypeScript 5.8, Jest 30, react-test-renderer, CSS.

**Spec:** [`spec-claude-compatible-agents.md`](./spec-claude-compatible-agents.md)

**Upstream contracts:** [claude-agent-acp model configuration](https://github.com/agentclientprotocol/claude-agent-acp/blob/main/docs/model-configuration.md), [Z.AI Claude Code setup](https://docs.z.ai/devpack/tool/claude), [Z.AI model list](https://docs.z.ai/devpack/latest-model), [Kimi Claude Code setup](https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html), [Kimi coding models](https://www.kimi.com/code/docs/en/kimi-code/models.html).

---

## Task 1: Add strict Hub API-key config, provider IDs, and diagnostic redaction

**Files:**

- Modify: `server/internal/shared/config.go`
- Modify: `server/internal/shared/shared_test.go`
- Modify: `server/config.example.json`
- Modify: `server/internal/protocol/acp_const.go`
- Modify: `server/internal/hub/agent/agent_test.go`
- Modify: `server/internal/security/redact.go`
- Modify: `server/internal/security/redact_test.go`

- [ ] **Step 1: Write failing config tests**

Add table-driven tests to `server/internal/shared/shared_test.go` which load temporary files and prove all of the following:

```go
func TestLoadConfigAcceptsClaudeCompatibleAPIKeys(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	data := []byte(`{"projects":[],"apiKeys":{"kimi":"kimi-test-key","zai":"zai-test-key"}}`)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.APIKeys.Kimi != "kimi-test-key" || cfg.APIKeys.ZAI != "zai-test-key" {
		t.Fatalf("APIKeys = %#v", cfg.APIKeys)
	}
}

func TestLoadConfigRejectsUnknownAPIKeyField(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	data := []byte(`{"projects":[],"apiKeys":{"unknown":"value"}}`)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := LoadConfig(path)
	if err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("LoadConfig() error = %v, want unknown field", err)
	}
}
```

Extend `TestLoadConfig_ConfigExampleIsValid` or add an adjacent assertion that the committed example contains no non-empty API key.

- [ ] **Step 2: Write failing provider-ID tests**

In the existing provider parsing section of `server/internal/hub/agent/agent_test.go`, add assertions that:

```go
provider, ok := protocol.ParseACPProvider("CC-GLM")
if !ok || provider != protocol.ACPProviderCCGLM {
	t.Fatalf("ParseACPProvider(CC-GLM) = %q, %v", provider, ok)
}

provider, ok = protocol.ParseACPProvider("cc-kimi")
if !ok || provider != protocol.ACPProviderCCKimi {
	t.Fatalf("ParseACPProvider(cc-kimi) = %q, %v", provider, ok)
}
```

Also assert `protocol.ACPProviderNames()` contains both IDs exactly once and in the declared stable order. Do not change the Registry protocol version; these remain string values in the existing flat agent list.

- [ ] **Step 3: Write the failing security regression**

Add a test proving both map and struct forms redact the entire `apiKeys` field:

```go
func TestRedactDiagnosticValueRedactsAPIKeysContainer(t *testing.T) {
	input := map[string]any{
		"apiKeys": map[string]any{
			"kimi": "kimi-test-secret",
			"zai":  "zai-test-secret",
		},
	}
	want := map[string]any{"apiKeys": RedactedValue}
	if got := RedactDiagnosticValue(input); !reflect.DeepEqual(got, want) {
		t.Fatalf("RedactDiagnosticValue() = %#v, want %#v", got, want)
	}
	type configWithAPIKeys struct {
		APIKeys map[string]string `json:"apiKeys"`
	}
	structInput := configWithAPIKeys{APIKeys: map[string]string{
		"kimi": "kimi-test-secret",
		"zai":  "zai-test-secret",
	}}
	if got := RedactDiagnosticValue(structInput); !reflect.DeepEqual(got, want) {
		t.Fatalf("RedactDiagnosticValue(struct) = %#v, want %#v", got, want)
	}
}
```

Run the focused tests and confirm they fail because the fields, provider IDs, and plural redaction key do not exist yet:

```powershell
cd server
go test ./internal/shared ./internal/hub/agent ./internal/security
```

Expected: non-zero exit with compile/assertion failures for `APIKeys`, `cc-glm` / `cc-kimi`, and `apiKeys` redaction.

- [ ] **Step 4: Implement the strict config schema**

Add the following concrete shape to `server/internal/shared/config.go`:

```go
type AppConfig struct {
	Projects []ProjectConfig `json:"projects"`
	Registry RegistryConfig  `json:"registry,omitempty"`
	Log      LogConfig       `json:"log,omitempty"`
	APIKeys  APIKeysConfig   `json:"apiKeys,omitempty"`
}

type APIKeysConfig struct {
	Kimi string `json:"kimi,omitempty"`
	ZAI  string `json:"zai,omitempty"`
}
```

Keep the existing `json.Decoder.DisallowUnknownFields()` behavior. Do not normalize or validate the key online during config load; key presence is evaluated once when the Hub factory is constructed.

Add an empty, safe example to `server/config.example.json`:

```json
"apiKeys": {
  "kimi": "",
  "zai": ""
}
```

- [ ] **Step 5: Implement provider constants and plural-key redaction**

Add constants and parser cases in `server/internal/protocol/acp_const.go`:

```go
ACPProviderCCGLM  ACPProvider = "cc-glm"
ACPProviderCCKimi ACPProvider = "cc-kimi"
```

Append them to `acpProviders` without reordering existing IDs. In `server/internal/security/redact.go`, explicitly classify normalized `apikeys` as sensitive (for example, add `"apikeys"` to `sensitiveKeySuffixes` before `"apikey"`). This ensures the container is replaced before traversal and neither `kimi` nor `zai` needs to be treated as globally sensitive field names.

- [ ] **Step 6: Run focused tests**

```powershell
cd server
go test ./internal/shared ./internal/hub/agent ./internal/security
```

Expected: all three packages pass, including strict nested-field rejection and whole-container redaction.

- [ ] **Step 7: Commit the config and protocol slice**

```powershell
git add server/internal/shared/config.go server/internal/shared/shared_test.go server/config.example.json server/internal/protocol/acp_const.go server/internal/hub/agent/agent_test.go server/internal/security/redact.go server/internal/security/redact_test.go
git commit -m "feat: add claude-compatible agent config"
```

## Task 2: Implement provider launch environments and model allowlists

**Files:**

- Modify: `server/internal/hub/agent/acp_provider.go`
- Modify: `server/internal/hub/agent/skills.go`
- Modify: `server/internal/hub/agent/agent_test.go`

- [ ] **Step 1: Write failing launch-contract tests**

Add table-driven cases to `server/internal/hub/agent/agent_test.go`. Inject a successful `resolveBinary` function into each returned `*acpProvider`, call `Launch()`, convert `env []string` into a map, and assert the executable, arguments, and complete provider-owned environment.

The Kimi case must assert:

```go
wantArgs := []string{"--hide-claude-auth"}
wantEnv := map[string]string{
	"CLAUDE_CONFIG_DIR":                    filepath.Join(stateDir, ".data", "cc-kimi"),
	"ANTHROPIC_BASE_URL":                   "https://api.kimi.com/coding/",
	"ANTHROPIC_API_KEY":                    "kimi-test-key",
	"ANTHROPIC_MODEL":                      "k3[1m]",
	"ANTHROPIC_DEFAULT_FABLE_MODEL":        "k3[1m]",
	"ANTHROPIC_DEFAULT_OPUS_MODEL":         "k3[1m]",
	"ANTHROPIC_DEFAULT_SONNET_MODEL":       "k3[1m]",
	"ANTHROPIC_DEFAULT_HAIKU_MODEL":        "k3[1m]",
	"CLAUDE_CODE_SUBAGENT_MODEL":           "k3[1m]",
	"CLAUDE_CODE_EFFORT_LEVEL":             "high",
	"CLAUDE_CODE_AUTO_COMPACT_WINDOW":      "1048576",
	"CLAUDE_CODE_MAX_CONTEXT_TOKENS":       "1048576",
	"CLAUDE_MODEL_CONFIG":                  `{"availableModels":["k3[1m]","k3","kimi-for-coding","kimi-for-coding-highspeed"]}`,
}
```

The GLM case must assert:

```go
wantArgs := []string{"--hide-claude-auth"}
wantEnv := map[string]string{
	"CLAUDE_CONFIG_DIR":                       filepath.Join(stateDir, ".data", "cc-glm"),
	"ANTHROPIC_BASE_URL":                      "https://api.z.ai/api/anthropic",
	"ANTHROPIC_AUTH_TOKEN":                    "zai-test-key",
	"ANTHROPIC_MODEL":                         "glm-5.2[1m]",
	"ANTHROPIC_DEFAULT_FABLE_MODEL":           "glm-5.2[1m]",
	"ANTHROPIC_DEFAULT_OPUS_MODEL":            "glm-5.2[1m]",
	"ANTHROPIC_DEFAULT_SONNET_MODEL":          "glm-5.2[1m]",
	"ANTHROPIC_DEFAULT_HAIKU_MODEL":           "glm-4.5-air",
	"CLAUDE_CODE_SUBAGENT_MODEL":              "glm-5.2[1m]",
	"CLAUDE_CODE_AUTO_COMPACT_WINDOW":         "1000000",
	"CLAUDE_CODE_MAX_CONTEXT_TOKENS":          "1000000",
	"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
	"API_TIMEOUT_MS":                          "3000000",
	"CLAUDE_MODEL_CONFIG":                     `{"availableModels":["glm-5.2[1m]","glm-5.2","glm-4.7","glm-4.5-air"]}`,
}
```

For both cases, assert the fake key is absent from the executable and every argument. Add a binary-resolution failure case that asserts the returned error contains the provider ID but not the fake key.

- [ ] **Step 2: Write failing preset/Skills isolation tests**

Extend the existing preset tests so `providerPresetByName("cc-glm")` and `providerPresetByName("cc-kimi")` succeed, each scans project/parent `.claude/skills`, and neither contains `~/.claude/skills` in `SkillUserDirs`. This preserves project Skills while avoiding native Claude's user-global Skills in WheelMaker profile reporting.

Run:

```powershell
cd server
go test ./internal/hub/agent -run 'Test.*(ClaudeCompatible|ProviderPreset|ProviderLaunch)'
```

Expected: failure until the presets and environment support are implemented.

- [ ] **Step 3: Add immutable preset environment support**

Add `Env []string` to `ACPProviderPreset`. In `acpProvider.Launch()`, clone both `Args` and `Env` before returning so callers cannot mutate shared preset state:

```go
defaultArgs := cloneArgs(p.preset.Args)
defaultEnv := cloneArgs(p.preset.Env)
return exePath, defaultArgs, defaultEnv, nil
```

Keep the Flicker special path unchanged. Never read keys from process-global environment in these constructors; the Hub passes the key explicitly.

- [ ] **Step 4: Add the two presets and constructors**

Define static presets with `Name`, `BinaryName: "claude-agent-acp"`, `Args: []string{"--hide-claude-auth"}`, the existing Claude install hint, project/parent `.claude/skills`, and no native Claude user directory. Add constructors with exact signatures:

```go
func NewCCKimiProvider(stateDir, apiKey string) *acpProvider
func NewCCGLMProvider(stateDir, apiKey string) *acpProvider
```

Each constructor copies its static preset and assigns a newly allocated `Env`. Build the `CLAUDE_MODEL_CONFIG` value with `encoding/json` from a typed struct or helper rather than hand-escaping JSON; tests assert its decoded `availableModels` array and stable order. Do not add endpoint or model parameters to public config.

Add both static presets to `providerPresetByName` for project profile/Skill discovery.

- [ ] **Step 5: Run and format the provider package**

```powershell
cd server
gofmt -w internal/hub/agent/acp_provider.go internal/hub/agent/skills.go internal/hub/agent/agent_test.go
go test ./internal/hub/agent
```

Expected: package passes; no real adapter process or upstream API is invoked.

- [ ] **Step 6: Commit provider launch support**

```powershell
git add server/internal/hub/agent/acp_provider.go server/internal/hub/agent/skills.go server/internal/hub/agent/agent_test.go
git commit -m "feat: add glm and kimi claude providers"
```

## Task 3: Build and inject one configured ACP factory per Hub

**Files:**

- Modify: `server/internal/hub/agent/factory.go`
- Modify: `server/internal/hub/agent/agent_test.go`
- Modify: `server/internal/hub/client/client.go`
- Modify: `server/internal/hub/client/client_test.go`
- Modify: `server/internal/hub/hub.go`
- Modify: `server/internal/hub/hub_test.go`

- [ ] **Step 1: Write failing factory registration-matrix tests**

Add tests around a private availability-injected builder so they do not depend on CLIs installed on the test machine. Cover this matrix:

| `claude-agent-acp` available | Kimi key | ZAI key | Expected new names |
|---|---:|---:|---|
| no | set | set | none |
| yes | empty | empty | none |
| yes | set | empty | `cc-kimi` |
| yes | empty | set | `cc-glm` |
| yes | set | set | both |

Use keys containing surrounding whitespace in one case to prove this one config-input boundary treats whitespace-only as absent and trims a real key exactly once before provider construction. Also assert `PreferredName()` never chooses `cc-glm` or `cc-kimi`; existing preferred-provider ordering remains unchanged.

- [ ] **Step 2: Implement configured factory construction**

Add:

```go
type ACPFactoryOptions struct {
	StateDir   string
	KimiAPIKey string
	ZAIAPIKey  string
}

func NewConfiguredACPFactory(options ACPFactoryOptions) *ACPFactory
```

Refactor the current default registration into a private helper that accepts `ACPFactoryOptions` and an `available func(ACPProvider) bool`. Production passes `isProviderAvailable`; tests pass a deterministic function. Register existing providers exactly as today, then conditionally register:

```go
if kimiKey := strings.TrimSpace(options.KimiAPIKey); kimiKey != "" {
	provider := NewCCKimiProvider(options.StateDir, kimiKey)
	if available(provider) {
		factory.Register(protocol.ACPProviderCCKimi, providerInstanceCreator(provider))
	}
}
```

Apply the equivalent logic for ZAI. Keep `DefaultACPFactory()` backed by zero-value options so legacy callers/tests do not inherit Hub keys or unexpectedly expose new agents.

- [ ] **Step 3: Write failing Client runtime-injection tests**

Add a test that creates an empty custom `ACPFactory`, constructs a Client with it, and asserts the Client uses that exact factory for provider lookup instead of `DefaultACPFactory()`. Also assert the configured `StateDir` is retained for later recovery routing.

- [ ] **Step 4: Add an explicit Client runtime constructor**

Preserve the existing constructor for tests and compatibility, and add:

```go
type RuntimeConfig struct {
	AgentFactory *agent.ACPFactory
	StateDir     string
}

func NewWithRuntime(store Store, projectName, cwd string, runtime RuntimeConfig) *Client
```

Move current initialization into `NewWithRuntime`. `New` supplies `agent.DefaultACPFactory()` and a safe default WheelMaker state directory; `NewWithRuntime` rejects nil by falling back to the default factory, cleans a non-empty state path once, and stores it on `Client`. Do not create adapter subprocesses here; creation remains lazy in Session `ensureInstance`.

- [ ] **Step 5: Write failing Hub wiring and snapshot tests**

Add a Hub test using an injected custom factory containing only `claude`, `cc-glm`, and `cc-kimi`. Assert:

- `collectProjectInfo` reports exactly that factory's sorted names.
- its preferred native `claude` value is used for `ProjectInfo.Agent`.
- a project Client built by the Hub receives the same factory pointer.
- neither API key appears in marshaled `ProjectInfo` or Registry snapshot data.

Expose only the smallest package-private seam needed by the test, such as `newWithFactory(cfg, dbPath, factory)`; production still calls `New`.

- [ ] **Step 6: Wire the Hub-scoped factory**

Add `agentFactory *agent.ACPFactory` and `stateDir string` to `Hub`. In `New`, derive the already-established state root as `filepath.Dir(filepath.Dir(dbPath))` and construct:

```go
factory := agent.NewConfiguredACPFactory(agent.ACPFactoryOptions{
	StateDir:   stateDir,
	KimiAPIKey: cfg.APIKeys.Kimi,
	ZAIAPIKey:  cfg.APIKeys.ZAI,
})
```

Guard a nil `cfg` if existing tests rely on it. This call occurs after `runHubWorker` augments `PATH`, so binary detection sees the same environment used by launched subprocesses.

Change `buildProjectClient` to call `client.NewWithRuntime` with `h.agentFactory` and `h.stateDir`. Change `collectProjectInfo` and profile collection to use `h.agentFactory`, never `agent.DefaultACPFactory()`. This guarantees registration, session creation, and Registry reporting share one immutable startup view; no watcher or hot reload is added.

- [ ] **Step 7: Run focused runtime tests**

```powershell
cd server
gofmt -w internal/hub/agent/factory.go internal/hub/agent/agent_test.go internal/hub/client/client.go internal/hub/client/client_test.go internal/hub/hub.go internal/hub/hub_test.go
go test ./internal/hub/agent ./internal/hub/client ./internal/hub
```

Expected: all packages pass; factory tests do not depend on the host PATH.

- [ ] **Step 8: Commit Hub-scoped factory wiring**

```powershell
git add server/internal/hub/agent/factory.go server/internal/hub/agent/agent_test.go server/internal/hub/client/client.go server/internal/hub/client/client_test.go server/internal/hub/hub.go server/internal/hub/hub_test.go
git commit -m "refactor: scope agent factories to each hub"
```

## Task 4: Isolate Claude-family Session recovery

**Files:**

- Modify: `server/internal/hub/client/session_recovery.go`
- Modify: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: Generalize the Claude test fixture and add failing isolation tests**

Refactor the existing `writeClaudeSessionFixture` helper to delegate to a helper accepting an explicit projects directory. Keep its current wrapper so native Claude tests remain readable:

```go
func writeClaudeSessionFixtureAtProjectsDir(
	t *testing.T,
	projectsDir, projectDirName, sessionID, cwd, title, assistant string,
)
```

Create one fixture under each path:

```text
<fake-home>/.claude/projects
<stateDir>/.data/cc-glm/projects
<stateDir>/.data/cc-kimi/projects
```

For each selected agent, assert `ListResumableSessions` sees only its own fixture and each returned item has the matching `AgentType`. Add `Find`/import coverage showing a Session ID that exists only in another provider directory is not found. Native Claude's existing home-directory behavior must still pass.

Run:

```powershell
cd server
go test ./internal/hub/client -run 'Test.*(Recovery|Resumable|Resume).*Claude'
```

Expected: new `cc-glm` / `cc-kimi` cases fail as unsupported recovery agents.

- [ ] **Step 2: Parameterize `claudeRecoverySource`**

Replace the hard-coded source with:

```go
type claudeRecoverySource struct {
	agentType  string
	projectsDir string
}

func (s claudeRecoverySource) AgentType() string { return s.agentType }
```

`List` reads only `s.projectsDir`, and every `recoverySession` emitted by the Claude JSONL reader is projected to `s.agentType` before return. Keep file parsing, CWD filtering, managed-ID filtering, title extraction, and timestamps unchanged.

- [ ] **Step 3: Route all three Claude-family agents**

In `sessionRecovery.sourceFor` return:

```go
case "claude":
	home, err := os.UserHomeDir()
	if err != nil { return nil, err }
	return claudeRecoverySource{
		agentType: "claude",
		projectsDir: filepath.Join(home, ".claude", "projects"),
	}, nil
case "cc-glm", "cc-kimi":
	if r.client.stateDir == "" {
		return nil, fmt.Errorf("state directory is required for %s recovery", agentType)
	}
	return claudeRecoverySource{
		agentType: agentType,
		projectsDir: filepath.Join(r.client.stateDir, ".data", agentType, "projects"),
	}, nil
```

Do not fall back from an empty/missing provider directory to `~/.claude`, and do not scan sibling provider directories.

- [ ] **Step 4: Run recovery and Client regressions**

```powershell
cd server
gofmt -w internal/hub/client/session_recovery.go internal/hub/client/client_test.go
go test ./internal/hub/client
```

Expected: native Claude, Codex, Copilot, GLM, and Kimi recovery tests all pass.

- [ ] **Step 5: Commit recovery isolation**

```powershell
git add server/internal/hub/client/session_recovery.go server/internal/hub/client/client_test.go
git commit -m "feat: isolate claude-compatible session recovery"
```

## Task 5: Add the App presentation tree and stable labels

**Files:**

- Modify: `app/web/src/chat/projectAgents.ts`
- Modify: `app/__tests__/web-project-agent-choices.test.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-ui.test.ts`

- [ ] **Step 1: Write failing projection and label tests**

Extend `app/__tests__/web-project-agent-choices.test.ts` with tests for the exact flat-to-display projection:

```ts
expect(buildProjectAgentChoices(
  {agents: ['codex', 'claude', 'cc-glm', 'cc-kimi', 'kimi']},
  [],
)).toEqual(['codex', 'claude', 'cc-glm', 'cc-kimi', 'kimi']);

expect(buildAgentChoiceNodes(['codex', 'claude', 'cc-glm', 'cc-kimi', 'kimi'])).toEqual([
  {kind: 'agent', agentType: 'codex', label: 'codex'},
  {
    kind: 'claude-group',
    agentType: 'claude',
    label: 'Claude',
    children: [
      {agentType: 'cc-glm', label: 'GLM'},
      {agentType: 'cc-kimi', label: 'Kimi'},
    ],
  },
  {kind: 'agent', agentType: 'kimi', label: 'kimi'},
]);
expect(agentDisplayLabel('cc-glm')).toBe('CC · GLM');
expect(agentDisplayLabel('cc-kimi')).toBe('CC · Kimi');
```

Add cases with only one child and with a reported `cc-*` ID but no `claude`; the fallback must render that child as a normal selectable node so an inconsistent snapshot cannot make an available agent disappear.

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-project-agent-choices.test.ts
```

Expected: failure because the projection and label helpers do not exist.

- [ ] **Step 2: Implement pure presentation helpers**

In `projectAgents.ts`, export discriminated types and helpers:

```ts
export type AgentChoiceNode =
  | {kind: 'agent'; agentType: string; label: string}
  | {
      kind: 'claude-group';
      agentType: 'claude';
      label: 'Claude';
      children: Array<{agentType: 'cc-glm' | 'cc-kimi'; label: 'GLM' | 'Kimi'}>;
    };

export function agentDisplayLabel(agentType?: string | null): string;
export function buildAgentChoiceNodes(agentTypes: string[]): AgentChoiceNode[];
```

Preserve the Hub-reported order for ordinary agents. Consume `cc-glm` and `cc-kimi` into the Claude node only when native `claude` is present. `agentDisplayLabel` changes display text only; session create/resume requests must continue sending the original `agentType` ID.

- [ ] **Step 3: Apply stable Session labels everywhere**

Import `agentDisplayLabel` into `WorkspaceApp.tsx`. Replace display-only uses of `normalizeAgentTypeName` for draft, live, recent, search, and archive Session badges with `agentDisplayLabel`. Keep normalization in request handlers such as `handleProjectCreateSession` and `handleWideProjectResumeAgent`.

Extend source-level assertions in `app/__tests__/web-chat-ui.test.ts` to require `agentDisplayLabel` at all Session tag call sites and to reject literal `cc-glm` / `cc-kimi` display branches inside `WorkspaceApp.tsx`.

- [ ] **Step 4: Run focused tests and typecheck**

```powershell
cd app
npm test -- --runInBand __tests__/web-project-agent-choices.test.ts __tests__/web-chat-ui.test.ts
npm run tsc:web
```

Expected: Jest and TypeScript pass.

- [ ] **Step 5: Commit presentation helpers**

```powershell
git add app/web/src/chat/projectAgents.ts app/__tests__/web-project-agent-choices.test.ts app/web/src/app/WorkspaceApp.tsx app/__tests__/web-chat-ui.test.ts
git commit -m "feat: group claude-compatible agent labels"
```

## Task 6: Add a reusable Claude split menu for desktop/mobile and new/resume

**Files:**

- Create: `app/web/src/chat/AgentChoiceMenu.tsx`
- Create: `app/__tests__/web-agent-choice-menu.test.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/__tests__/web-chat-ui.test.ts`

- [ ] **Step 1: Write failing component behavior tests**

Create `web-agent-choice-menu.test.tsx` with `react-test-renderer`. Render one reusable component with all three Claude-family IDs and assert:

- only the Claude main row is visible initially; GLM/Kimi children are collapsed.
- clicking the `Claude` primary button invokes `onSelect('claude')` and does not expand.
- clicking the adjacent button with `aria-label="Expand Claude agents"` exposes both children, updates `aria-expanded` to `true`, and does not invoke `onSelect`.
- clicking child `GLM` invokes `onSelect('cc-glm')`; clicking `Kimi` invokes `onSelect('cc-kimi')`.
- with one child reported, only that child appears.
- with no compatible children, Claude renders as a normal direct item and no expand button appears.
- `variant="wide"` and `variant="mobile"` preserve identical selection semantics while applying the expected variant classes.

The component contract should be:

```tsx
type AgentChoiceMenuProps = {
  agents: string[];
  variant: 'wide' | 'mobile';
  onSelect: (agentType: string) => void;
};
```

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-agent-choice-menu.test.tsx
```

Expected: failure because the component does not exist.

- [ ] **Step 2: Implement the accessible split menu**

Create `AgentChoiceMenu.tsx` using `buildAgentChoiceNodes`. Keep expansion local to this transient menu and initialize it to collapsed. For a Claude group, render one row containing:

```tsx
<button type="button" className="agent-choice-main" onClick={() => onSelect('claude')}>
  <span>Claude</span>
</button>
<button
  type="button"
  className="agent-choice-expand"
  aria-label={expanded ? 'Collapse Claude agents' : 'Expand Claude agents'}
  aria-expanded={expanded}
  onClick={() => setExpanded(value => !value)}
>
  <span className={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`} aria-hidden="true" />
</button>
```

Render children immediately below with an indented child class. Use buttons, not clickable wrapper elements, and keep primary/expand hit targets independent. Ordinary agents and the fallback compatible-agent nodes call `onSelect` directly.

- [ ] **Step 3: Integrate all four menu entry points**

Replace both duplicated `agents.map(...)` blocks in `WorkspaceApp.tsx` with `AgentChoiceMenu`:

- wide `New Session` agents phase → `handleWideProjectCreateSession`.
- wide `Resume Session` agents phase → `handleWideProjectResumeAgent`.
- mobile `New Session` agents phase → `handleMobileProjectCreateSession`.
- mobile `Resume Session` agents phase → `handleMobileProjectResumeAgent`.

Pass the existing already-filtered `agents` / `sheetAgents` arrays. Keep the existing resume-results phase, back navigation, loading state, menu closing, and error handling unchanged. Give each mounted component a key containing project ID, menu kind, and variant so expansion resets when a different menu opens.

Add source-level tests in `web-chat-ui.test.ts` proving both wide and mobile blocks render `AgentChoiceMenu`, both `new` and `resume` handlers are still selected by menu kind, and the old duplicated `.map(agentType => ...)` menu rendering is gone.

- [ ] **Step 4: Add compact hierarchy styles**

In `app/web/src/styles/chat.css`, add classes for:

```css
.agent-choice-row { display: flex; align-items: stretch; }
.agent-choice-main { flex: 1 1 auto; min-width: 0; }
.agent-choice-expand { flex: 0 0 30px; }
.agent-choice-children { display: flex; flex-direction: column; }
.agent-choice-child { padding-left: 28px; }
```

Integrate the current `.wide-project-action-menu-item` and `.mobile-project-sheet-item` visual rules so the new primary, expand, ordinary, and child buttons retain existing heights, colors, hover treatment, touch width, and focus visibility. The hierarchy should be compact and must not turn the whole Claude row into an expansion-only target.

Add CSS source assertions for split layout, fixed expand hit area, and child indentation.

- [ ] **Step 5: Run component, integration, and build checks**

```powershell
cd app
npm test -- --runInBand __tests__/web-agent-choice-menu.test.tsx __tests__/web-project-agent-choices.test.ts __tests__/web-chat-ui.test.ts
npm run tsc:web
npm run build:web
```

Expected: all commands pass; the production Web build is emitted to the repository-configured WheelMaker Web output, not `app/dist`.

- [ ] **Step 6: Commit the four-entry menu integration**

```powershell
git add app/web/src/chat/AgentChoiceMenu.tsx app/__tests__/web-agent-choice-menu.test.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-chat-ui.test.ts
git commit -m "feat: add expandable claude agent menu"
```

## Task 7: Verify security, docs, and full regressions

**Files:**

- Verify/modify: `docs/scope/2026-07-23-claude-compatible-agents/spec-claude-compatible-agents.md`
- Verify/modify: `docs/wiki/protocols/acp.md`
- Verify/modify: `docs/wiki/architecture/server-runtime.md`
- Verify/modify: `docs/security.md`
- Verify/modify: `server/config.example.json`

- [ ] **Step 1: Audit secrets and runtime boundaries**

Use repository searches to verify keys are read only from Hub config and passed only into provider environment construction:

```powershell
rg -n "KimiAPIKey|ZAIAPIKey|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|apiKeys" server docs --glob '!**/dist/**'
rg -n "DefaultACPFactory\(\)" server/internal/hub --glob '!**/*_test.go'
```

Expected:

- no key value enters argv, `ProjectInfo`, Registry DTOs, Session snapshots, or logs.
- Hub production paths use `h.agentFactory`; only compatibility/default constructors may call `DefaultACPFactory()`.
- no real key appears in fixtures, examples, docs, or committed output.

If a diagnostic path can serialize `AppConfig`, route it through `security.RedactDiagnosticValue`; do not add ad-hoc partial masking.

- [ ] **Step 2: Verify the long-term documentation matches code**

Confirm the already-synchronized docs state all of these implemented facts:

- Hub-local `config.json.apiKeys` is the only key source and requires restart.
- registration requires both adapter binary and matching non-empty key.
- one Hub-scoped factory feeds project reporting and all project Clients.
- `CLAUDE_CONFIG_DIR` roots are `<stateDir>/.data/cc-glm` and `<stateDir>/.data/cc-kimi`.
- native Claude, GLM, and Kimi recovery directories do not overlap.
- provider model allowlists/defaults and the unavoidable adapter `Default` entry are documented.
- Registry keeps a flat agent list; App grouping is presentation-only.
- no protocol-version change was made.

Update wording only if implementation names changed; do not broaden scope into Web settings, hot reload, online key checks, endpoint config, model discovery, or cross-provider migration.

- [ ] **Step 3: Run complete server verification**

```powershell
cd server
go test ./...
go build ./cmd/wheelmaker/
```

Expected: all Go tests pass and the Hub command builds.

- [ ] **Step 4: Run complete App verification**

```powershell
cd app
npm test -- --runInBand
npm run tsc:web
npm run build:web
```

Expected: Jest, TypeScript, and Web production build all pass.

- [ ] **Step 5: Perform a config-only startup smoke check**

With a temporary Hub state directory and fake/empty keys, verify startup registration behavior without sending prompts to Z.AI or Kimi:

- no key: neither compatible agent is in the reported list.
- fake Kimi key plus discoverable `claude-agent-acp`: `cc-kimi` is reported and `cc-glm` is absent.
- both fake keys plus discoverable adapter: both are reported.
- after editing keys, the running Hub's list does not change; after restart, it does.

Do not create an upstream Session or call a real model. Capture no environment dump containing the fake keys.

- [ ] **Step 6: Review the final diff for scope and credential templates**

```powershell
git diff --check
git status --short
rg -n "your-api-key|kimi-test-secret|zai-test-secret" server app docs/wiki docs/security.md --glob '!**/dist/**'
```

Expected: `git diff --check` is clean; test-only fake-key matches are intentional and no template credential is present in production/example files.

- [ ] **Step 7: Commit any final verification/documentation adjustments**

If Task 7 changed tracked files:

```powershell
git add docs server/config.example.json
git commit -m "docs: document claude-compatible agents"
```

If it changed nothing, do not create an empty commit.

- [ ] **Step 8: Rebase, rerun gates if needed, and publish the feature branch**

```powershell
git fetch origin
git rebase origin/main
git status --short
git push -u origin feat-claude-compatible-agents
```

If the rebase changed executable code, rerun the complete server and App verification before pushing. Do not merge to `main` until the implementation diff and verification output have been reviewed.
