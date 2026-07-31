# cx.deepseek Codex Responses Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated `cx-deepseek` provider that runs native `codex app-server` against DeepSeek's Responses API and appears in the UI as `cx.deepseek`.

**Architecture:** Parameterize the existing Codex App Server bridge with provider identity, prompt capabilities, and Session mapping ownership, then construct a DeepSeek-specific launcher around it. A focused `cxdeepseek` package owns the reviewed official catalog asset and atomic materialization into `<stateDir>/.data/cx-deepseek`; the Hub Factory, recovery scanner, Codex-native Session actions, and frontend consume the new stable agent ID without changing wire versions.

**Tech Stack:** Go 1.26, embedded JSON assets, Codex App Server JSON-RPC over stdio, ACP, React 19, TypeScript 5.8, Jest 30.

---

## Approved sources and invariants

- Product contract: [`spec-cx-deepseek-codex-mode.md`](spec-cx-deepseek-codex-mode.md).
- Official DeepSeek catalog/config source: <https://api-docs.deepseek.com/quick_start/agent_integrations/codex/>.
- Official Responses capability source: <https://api-docs.deepseek.com/guides/responses_api/>.
- Codex provider security semantics (`env_key`, `requires_openai_auth`, WebSocket flag): <https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs>.
- Wiki decisions are already synchronized in `docs/wiki/agents/codex.md`, `docs/wiki/protocols/acp.md`, and `docs/wiki/architecture/server-runtime.md`.
- Do not modify any ACP or Registry protocol version.
- Do not call DeepSeek `/models` and do not download or execute the remote setup script at runtime.
- Keep the native `codex` provider's home, process arguments, prompt capabilities, Session mapping path, recovery source, and pool behavior unchanged.

## File structure

### Create

- `server/internal/hub/agent/cxdeepseek/models.json` — reviewed, versioned DeepSeek official Codex catalog containing only the complete `deepseek-v4-flash` entry.
- `server/internal/hub/agent/cxdeepseek/catalog.go` — embedded catalog validation, keyed bootstrap serialization, and atomic `models.json` materialization.
- `server/internal/hub/agent/cxdeepseek/catalog_test.go` — catalog capability, failure preservation, and concurrency tests.
- `server/internal/hub/agent/codexapp_deepseek.go` — `cx-deepseek` Codex launcher, version gate, isolated home, launch overrides, and process environment.
- `app/web/src/chat/projectAgents.test.ts` — label and raw-ID choice tests.
- `app/web/src/chat/agentTagVariant.test.ts` — Codex color-slot parity test.

### Modify

- `server/internal/protocol/acp_const.go` — add the stable `ACPProviderCXDeepSeek` identity and parser/list membership.
- `server/internal/protocol/acp_test.go` — verify parsing and stable provider-list membership.
- `server/internal/hub/agent/acp_provider.go` — add a skills-discovery preset for the isolated Codex family member.
- `server/internal/hub/agent/skills.go` — resolve `cx-deepseek` to its skills preset without reading native `~/.codex` skills.
- `server/internal/hub/agent/codexapp_agent.go` — parameterize provider identity, prompt image support, fork-point identity, and Session mapping path.
- `server/internal/hub/agent/factory.go` — register `cx-deepseek` from the existing DeepSeek Key and expose Codex Session actions.
- `server/internal/hub/agent/agent_test.go` — extend existing provider, bridge, pool, skills, and Factory coverage.
- `server/internal/hub/client/session_recovery.go` — make Codex recovery source accept an explicit agent ID and Codex home.
- `server/internal/hub/client/client.go` — treat native Codex and `cx-deepseek` as Codex App Server providers for fork enrichment and native archive synchronization while preserving provider identity.
- `server/internal/hub/client/client_test.go` — test recovery isolation and provider-preserving native Session actions.
- `app/web/src/chat/projectAgents.ts` — display `cx-deepseek` as `cx.deepseek`.
- `app/web/src/chat/agentTagVariant.ts` — map `cx-deepseek` to Codex variant 0.

### Task 1: Add the stable provider identity and isolated skills preset

**Files:**
- Modify: `server/internal/protocol/acp_test.go`
- Modify: `server/internal/protocol/acp_const.go:102`
- Modify: `server/internal/hub/agent/agent_test.go:1171`
- Modify: `server/internal/hub/agent/acp_provider.go:46`
- Modify: `server/internal/hub/agent/skills.go:29`

- [x] **Step 1: Write the failing protocol identity test**

Add this test to `server/internal/protocol/acp_test.go`:

```go
func TestCXDeepSeekProviderIdentity(t *testing.T) {
	provider, ok := ParseACPProvider(" CX-DeepSeek ")
	if !ok || provider != ACPProviderCXDeepSeek {
		t.Fatalf("ParseACPProvider() = (%q, %v), want (%q, true)", provider, ok, ACPProviderCXDeepSeek)
	}

	count := 0
	for _, name := range ACPProviderNames() {
		if name == string(ACPProviderCXDeepSeek) {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("ACPProviderNames() = %v, want one %q", ACPProviderNames(), ACPProviderCXDeepSeek)
	}
}
```

- [x] **Step 2: Run the protocol test and verify the missing symbol failure**

Run from `server/`:

```powershell
go test ./internal/protocol -run TestCXDeepSeekProviderIdentity -count=1
```

Expected: compilation fails because `ACPProviderCXDeepSeek` does not exist.

- [x] **Step 3: Add the protocol constant, stable list entry, and parser branch**

Add the constant beside `ACPProviderCodex`, include it once in `acpProviders`, and parse it case-insensitively:

```go
const (
	ACPProviderCodex      ACPProvider = "codex"
	ACPProviderCXDeepSeek ACPProvider = "cx-deepseek"
)
```

```go
case string(ACPProviderCXDeepSeek):
	return ACPProviderCXDeepSeek, true
```

Keep `ACPProviderCodex` first and place `ACPProviderCXDeepSeek` immediately after it in the stable built-in list. Do not add a generic `cx` alias.

- [x] **Step 4: Write the failing skills-isolation test**

Add to the existing provider preset tests in `server/internal/hub/agent/agent_test.go`:

```go
func TestCXDeepSeekPresetUsesSharedAgentSkillsWithoutNativeCodexHome(t *testing.T) {
	preset, ok := providerPresetByName(string(protocol.ACPProviderCXDeepSeek))
	if !ok {
		t.Fatal("providerPresetByName(cx-deepseek) returned ok=false")
	}
	if preset.Name != string(protocol.ACPProviderCXDeepSeek) || preset.BinaryName != "codex" {
		t.Fatalf("preset = %#v", preset)
	}
	if !reflect.DeepEqual(preset.SkillProjectDirs, []string{".agents/skills"}) {
		t.Fatalf("project skill dirs = %v", preset.SkillProjectDirs)
	}
	if !reflect.DeepEqual(preset.SkillUserDirs, []string{"~/.agents/skills"}) {
		t.Fatalf("user skill dirs = %v, want isolated shared agent skills", preset.SkillUserDirs)
	}
}
```

- [x] **Step 5: Run the skills test and verify it fails**

Run from `server/`:

```powershell
go test ./internal/hub/agent -run TestCXDeepSeekPresetUsesSharedAgentSkillsWithoutNativeCodexHome -count=1
```

Expected: FAIL because the new preset is not registered in `providerPresetByName`.

- [x] **Step 6: Add the focused skills preset and lookup branch**

Add this preset in `acp_provider.go`:

```go
CXDeepSeekProviderPreset = ACPProviderPreset{
	Name:             string(protocol.ACPProviderCXDeepSeek),
	BinaryName:       "codex",
	InstallHint:      "@openai/codex",
	SkillProjectDirs: []string{".agents/skills"},
	SkillUserDirs:    []string{"~/.agents/skills"},
}
```

Import `internal/protocol` in `acp_provider.go`, then add this branch to `providerPresetByName`:

```go
case CXDeepSeekProviderPreset.Name:
	return CXDeepSeekProviderPreset, true
```

The isolated preset intentionally excludes `~/.codex/skills` and `~/.copilot/installed-plugins`.

- [x] **Step 7: Run focused tests and commit the identity boundary**

Run from `server/`:

```powershell
gofmt -w internal/protocol/acp_const.go internal/protocol/acp_test.go internal/hub/agent/acp_provider.go internal/hub/agent/skills.go internal/hub/agent/agent_test.go
go test ./internal/protocol ./internal/hub/agent -run 'TestCXDeepSeekProviderIdentity|TestCXDeepSeekPresetUsesSharedAgentSkillsWithoutNativeCodexHome' -count=1
```

Expected: PASS.

```powershell
git add server/internal/protocol/acp_const.go server/internal/protocol/acp_test.go server/internal/hub/agent/acp_provider.go server/internal/hub/agent/skills.go server/internal/hub/agent/agent_test.go
git commit -m "feat(agent): add cx deepseek provider identity"
```

### Task 2: Vendor and atomically materialize the official Flash catalog

**Files:**
- Create: `server/internal/hub/agent/cxdeepseek/models.json`
- Create: `server/internal/hub/agent/cxdeepseek/catalog.go`
- Create: `server/internal/hub/agent/cxdeepseek/catalog_test.go`

- [x] **Step 1: Add the reviewed official catalog asset**

From the official DeepSeek Codex documentation, copy the complete `deepseek-v4-flash` object into `models.json` under the original top-level `models` array. Remove only the `deepseek-v4-pro` object. Preserve every Flash field, including the complete `model_messages.instructions_template`, `model_messages.instructions_variables`, `base_instructions`, and these exact capability values:

```json
{
  "slug": "deepseek-v4-flash",
  "prefer_websockets": false,
  "support_verbosity": true,
  "default_verbosity": "low",
  "apply_patch_tool_type": "freeform",
  "web_search_tool_type": "text",
  "input_modalities": ["text"],
  "supports_image_detail_original": false,
  "supports_parallel_tool_calls": true,
  "context_window": 1048576,
  "max_context_window": 1048576,
  "default_reasoning_level": "high",
  "supported_reasoning_levels": [
    {"effort": "low", "description": "Fast responses with lighter reasoning"},
    {"effort": "high", "description": "Extra high reasoning depth for complex problems"},
    {"effort": "max", "description": "Maximum reasoning depth for the hardest problems"}
  ],
  "minimal_client_version": "0.144.0",
  "supported_in_api": true,
  "supports_search_tool": true,
  "supports_reasoning_summaries": true
}
```

The excerpt above is the invariant subset, not a replacement for the full official object. The checked-in asset must not contain `deepseek-v4-pro`, an API key, or an abbreviated instruction field.

- [x] **Step 2: Write catalog validation tests**

Create `catalog_test.go` in package `cxdeepseek` with table-driven assertions equivalent to:

```go
func TestEmbeddedCatalogIsOfficialFlashOnly(t *testing.T) {
	doc, err := validateCatalog(embeddedCatalog)
	if err != nil {
		t.Fatalf("validateCatalog() error = %v", err)
	}
	if len(doc.Models) != 1 || doc.Models[0].Slug != ModelID {
		t.Fatalf("models = %#v, want only %q", doc.Models, ModelID)
	}
	model := doc.Models[0]
	if !reflect.DeepEqual(model.InputModalities, []string{"text"}) ||
		model.ApplyPatchToolType != "freeform" ||
		model.WebSearchToolType != "text" ||
		!model.SupportsParallelToolCalls ||
		model.ContextWindow != 1048576 ||
		model.DefaultReasoningLevel != "high" ||
		model.MinimalClientVersion != MinimumCodexVersion ||
		!model.SupportsSearchTool {
		t.Fatalf("model capability mismatch: %#v", model)
	}
	wantEfforts := []string{"low", "high", "max"}
	if got := reasoningEfforts(model); !reflect.DeepEqual(got, wantEfforts) {
		t.Fatalf("reasoning efforts = %v, want %v", got, wantEfforts)
	}
	if len(model.ModelMessages) == 0 || bytes.Equal(bytes.TrimSpace(model.ModelMessages), []byte("{}")) {
		t.Fatal("official model_messages are missing")
	}
	if bytes.Contains(embeddedCatalog, []byte("deepseek-v4-pro")) {
		t.Fatal("catalog exposes unsupported DeepSeek Pro model")
	}
}
```

Also add invalid-document cases for malformed JSON, zero models, a non-Flash slug, image input, a missing `apply_patch`/web-search capability, wrong context window, wrong effort set/default, wrong minimum version, and empty model instructions.

- [x] **Step 3: Run the catalog tests and verify the missing implementation failure**

Run from `server/`:

```powershell
go test ./internal/hub/agent/cxdeepseek -run TestEmbeddedCatalogIsOfficialFlashOnly -count=1
```

Expected: compilation fails because the catalog package implementation does not exist.

- [x] **Step 4: Implement embedded validation with exact public constants**

Create `catalog.go` with this public surface and focused validation types:

```go
package cxdeepseek

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
)

const (
	ModelID             = "deepseek-v4-flash"
	MinimumCodexVersion = "0.144.0"
	CatalogFileName     = "models.json"
)

//go:embed models.json
var embeddedCatalog []byte

type reasoningLevel struct {
	Effort string `json:"effort"`
}

type catalogModel struct {
	Slug                     string          `json:"slug"`
	ApplyPatchToolType       string          `json:"apply_patch_tool_type"`
	WebSearchToolType        string          `json:"web_search_tool_type"`
	InputModalities          []string        `json:"input_modalities"`
	SupportsParallelToolCalls bool           `json:"supports_parallel_tool_calls"`
	ContextWindow            int             `json:"context_window"`
	MaxContextWindow         int             `json:"max_context_window"`
	DefaultReasoningLevel    string          `json:"default_reasoning_level"`
	SupportedReasoningLevels []reasoningLevel `json:"supported_reasoning_levels"`
	MinimalClientVersion     string          `json:"minimal_client_version"`
	SupportedInAPI           bool            `json:"supported_in_api"`
	SupportsSearchTool       bool            `json:"supports_search_tool"`
	ModelMessages            json.RawMessage `json:"model_messages"`
	BaseInstructions         string          `json:"base_instructions"`
}

type catalogDocument struct {
	Models []catalogModel `json:"models"`
}

func validateCatalog(raw []byte) (catalogDocument, error) {
	var doc catalogDocument
	if err := json.Unmarshal(raw, &doc); err != nil {
		return doc, fmt.Errorf("decode DeepSeek Codex catalog: %w", err)
	}
	if len(doc.Models) != 1 {
		return doc, fmt.Errorf("DeepSeek Codex catalog must contain exactly one model")
	}
	model := doc.Models[0]
	if model.Slug != ModelID || !reflect.DeepEqual(model.InputModalities, []string{"text"}) {
		return doc, fmt.Errorf("DeepSeek Codex catalog has unsupported model or input modalities")
	}
	if model.ApplyPatchToolType != "freeform" || model.WebSearchToolType != "text" || !model.SupportsSearchTool || !model.SupportsParallelToolCalls {
		return doc, fmt.Errorf("DeepSeek Codex catalog is missing required tool capabilities")
	}
	if model.ContextWindow != 1048576 || model.MaxContextWindow != 1048576 || !model.SupportedInAPI {
		return doc, fmt.Errorf("DeepSeek Codex catalog has invalid API or context metadata")
	}
	if model.DefaultReasoningLevel != "high" || !reflect.DeepEqual(reasoningEfforts(model), []string{"low", "high", "max"}) {
		return doc, fmt.Errorf("DeepSeek Codex catalog has invalid reasoning metadata")
	}
	if model.MinimalClientVersion != MinimumCodexVersion {
		return doc, fmt.Errorf("DeepSeek Codex catalog requires unexpected Codex version %q", model.MinimalClientVersion)
	}
	if len(bytes.TrimSpace(model.ModelMessages)) == 0 || strings.TrimSpace(model.BaseInstructions) == "" {
		return doc, fmt.Errorf("DeepSeek Codex catalog is missing official instructions")
	}
	return doc, nil
}

func reasoningEfforts(model catalogModel) []string {
	out := make([]string, 0, len(model.SupportedReasoningLevels))
	for _, level := range model.SupportedReasoningLevels {
		out = append(out, level.Effort)
	}
	return out
}
```

- [x] **Step 5: Write atomic-write and keyed-concurrency tests**

Use a package-private `materializer` with injectable `rename` and `writeFile` operations. Cover these exact outcomes:

```go
func TestMaterializePreservesLastValidCatalogWhenRenameFails(t *testing.T) {
	home := t.TempDir()
	path := filepath.Join(home, CatalogFileName)
	old := append(append([]byte(nil), embeddedCatalog...), '\n')
	if err := os.WriteFile(path, old, 0o600); err != nil {
		t.Fatal(err)
	}
	m := newMaterializer(embeddedCatalog)
	m.rename = func(string, string) error { return errors.New("rename failed") }
	if _, err := m.materialize(home); err == nil {
		t.Fatal("materialize() error = nil, want rename failure")
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, old) {
		t.Fatalf("last valid catalog changed: %q", got)
	}
}
```

Add a no-prior-file variant that confirms failure leaves no final `models.json`, and a 16-goroutine test that counts one successful replacement and verifies every caller receives the same final path and complete bytes.

- [x] **Step 6: Implement keyed locking and atomic replacement**

Use one package-level lock registry keyed by the cleaned absolute target path. The production API is:

```go
var catalogLocks sync.Map

type materializer struct {
	catalog   []byte
	rename    func(string, string) error
	writeFile func(*os.File, []byte) error
}

func Materialize(homeDir string) (string, error) {
	return newMaterializer(embeddedCatalog).materialize(homeDir)
}

func newMaterializer(catalog []byte) *materializer {
	return &materializer{
		catalog: catalog,
		rename: os.Rename,
		writeFile: func(file *os.File, raw []byte) error {
			if _, err := file.Write(raw); err != nil {
				return err
			}
			return file.Sync()
		},
	}
}

func (m *materializer) materialize(homeDir string) (string, error) {
	homeDir = strings.TrimSpace(homeDir)
	if homeDir == "" {
		return "", errors.New("cx-deepseek CODEX_HOME is required")
	}
	if _, err := validateCatalog(m.catalog); err != nil {
		return "", err
	}
	absHome, err := filepath.Abs(homeDir)
	if err != nil {
		return "", fmt.Errorf("resolve cx-deepseek CODEX_HOME: %w", err)
	}
	target := filepath.Join(absHome, CatalogFileName)
	lockValue, _ := catalogLocks.LoadOrStore(filepath.Clean(target), &sync.Mutex{})
	lock := lockValue.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()

	if existing, readErr := os.ReadFile(target); readErr == nil && bytes.Equal(existing, m.catalog) {
		return target, nil
	}
	if err := os.MkdirAll(absHome, 0o700); err != nil {
		return "", fmt.Errorf("create cx-deepseek CODEX_HOME: %w", err)
	}
	temporary, err := os.CreateTemp(absHome, ".models-*.json")
	if err != nil {
		return "", fmt.Errorf("create temporary DeepSeek catalog: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return "", fmt.Errorf("protect temporary DeepSeek catalog: %w", err)
	}
	if err := m.writeFile(temporary, m.catalog); err != nil {
		temporary.Close()
		return "", fmt.Errorf("write temporary DeepSeek catalog: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return "", fmt.Errorf("close temporary DeepSeek catalog: %w", err)
	}
	if err := m.rename(temporaryPath, target); err != nil {
		return "", fmt.Errorf("replace DeepSeek catalog: %w", err)
	}
	return target, nil
}
```

Keep the single final `os.Rename` replacement under the keyed lock. The Windows test run is part of the required gate and must demonstrate that failed replacement leaves the existing final file intact.

- [x] **Step 7: Run package tests and commit the catalog boundary**

Run from `server/`:

```powershell
gofmt -w internal/hub/agent/cxdeepseek/catalog.go internal/hub/agent/cxdeepseek/catalog_test.go
go test ./internal/hub/agent/cxdeepseek -count=1
```

Expected: PASS, including race-free complete output under concurrent materialization.

```powershell
git add server/internal/hub/agent/cxdeepseek
git commit -m "feat(agent): add deepseek codex catalog bootstrap"
```

### Task 3: Parameterize the Codex bridge and implement the DeepSeek launcher

**Files:**
- Create: `server/internal/hub/agent/codexapp_deepseek.go`
- Modify: `server/internal/hub/agent/codexapp_agent.go:24`
- Modify: `server/internal/hub/agent/agent_test.go:137`

- [x] **Step 1: Write version parsing and launch-shape tests**

Add tests to `agent_test.go` that inject `lookPath`, `versionOutput`, and `materializeCatalog` before first availability check. Assert:

```go
func TestCXDeepSeekProviderLaunchUsesResponsesOverridesAndProcessOnlyKey(t *testing.T) {
	stateDir := t.TempDir()
	configPath := filepath.Join(stateDir, ".data", "cx-deepseek", "config.toml")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		t.Fatal(err)
	}
	configBefore := []byte("[projects.'D:\\\\Code\\\\WheelMaker']\ntrust_level = \"trusted\"\n")
	if err := os.WriteFile(configPath, configBefore, 0o600); err != nil {
		t.Fatal(err)
	}

	provider := NewCXDeepSeekProvider(stateDir, "secret-deepseek-key")
	provider.lookPath = func(string) (string, error) { return `C:\\bin\\codex.exe`, nil }
	provider.versionOutput = func(string) ([]byte, error) { return []byte("codex-cli 0.145.0\n"), nil }
	provider.materializeCatalog = func(home string) (string, error) {
		return filepath.Join(home, "models.json"), nil
	}

	exe, args, env, err := provider.Launch()
	if err != nil {
		t.Fatalf("Launch() error = %v", err)
	}
	if exe != `C:\\bin\\codex.exe` || provider.Name() != "cx-deepseek" {
		t.Fatalf("launch identity = %q %q", provider.Name(), exe)
	}
	for _, want := range []string{
		"app-server", "--listen", "stdio://",
		`model="deepseek-v4-flash"`,
		`model_provider="deepseek"`,
		`model_reasoning_effort="high"`,
		`model_providers.deepseek.base_url="https://api.deepseek.com/"`,
		`model_providers.deepseek.wire_api="responses"`,
		`model_providers.deepseek.env_key="DEEPSEEK_API_KEY"`,
		`model_providers.deepseek.requires_openai_auth=false`,
		`model_providers.deepseek.supports_websockets=false`,
	} {
		if !slices.Contains(args, want) {
			t.Fatalf("args = %v, missing %q", args, want)
		}
	}
	if !slices.Contains(env, "CODEX_HOME="+filepath.Join(stateDir, ".data", "cx-deepseek")) ||
		!slices.Contains(env, "DEEPSEEK_API_KEY=secret-deepseek-key") {
		t.Fatalf("env = %v", env)
	}
	if strings.Contains(strings.Join(args, "\n"), "secret-deepseek-key") {
		t.Fatal("API key leaked into launch arguments")
	}
	configAfter, err := os.ReadFile(configPath)
	if err != nil || !bytes.Equal(configAfter, configBefore) {
		t.Fatalf("config.toml changed: %q, %v", configAfter, err)
	}
}
```

Add a table for `codex-cli 0.143.9` (reject), `codex-cli 0.144.0` (accept), `codex-cli 1.0.0` (accept), malformed output (reject), and command failure (reject). Error messages must identify `cx-deepseek` and the required version without including the API key.

- [x] **Step 2: Run the launch tests and verify the missing constructor failure**

Run from `server/`:

```powershell
go test ./internal/hub/agent -run 'TestCXDeepSeekProviderLaunch|TestCXDeepSeekCodexVersion' -count=1
```

Expected: compilation fails because `NewCXDeepSeekProvider` is undefined.

- [x] **Step 3: Implement the versioned launcher in a focused file**

First parameterize `codexAppProvider` in `codexapp_agent.go` with this exact configuration boundary; the native constructor supplies native defaults and the DeepSeek constructor supplies isolated values:

```go
type codexAppProviderOptions struct {
	Provider       protocol.ACPProvider
	Title          string
	AllowImages    bool
	CodexHome      string
	SessionMapPath string
	Environment    []string
}

type codexAppProvider struct {
	options              codexAppProviderOptions
	lookPath             func(string) (string, error)
	minimumVersion       string
	versionOutput        func(string) ([]byte, error)
	materializeCatalog   func(string) (string, error)
	configArgs           func(string) []string
	configurationErr     error
	availabilityOnce     sync.Once
	availabilityErr      error
	resolvedExecutable   string
}

func newCodexAppProvider(options codexAppProviderOptions) *codexAppProvider {
	return &codexAppProvider{options: options, lookPath: exec.LookPath}
}

func NewCodexAppProvider() *codexAppProvider {
	return newCodexAppProvider(codexAppProviderOptions{
		Provider:    protocol.ACPProviderCodex,
		Title:       "Codex App Server",
		AllowImages: true,
	})
}

func codexVersionOutput(executable string) ([]byte, error) {
	return exec.Command(executable, "--version").CombinedOutput()
}

func (p *codexAppProvider) Name() string {
	return string(p.options.Provider)
}

func (p *codexAppProvider) CheckAvailable() error {
	p.availabilityOnce.Do(func() {
		if p.configurationErr != nil {
			p.availabilityErr = p.configurationErr
			return
		}
		executable, err := p.lookPath("codex")
		if err != nil {
			p.availabilityErr = fmt.Errorf("%s: codex not found: %w", p.Name(), err)
			return
		}
		p.resolvedExecutable = executable
		if p.minimumVersion == "" {
			return
		}
		output, err := p.versionOutput(executable)
		if err != nil {
			p.availabilityErr = fmt.Errorf("%s: codex --version: %w", p.Name(), err)
			return
		}
		version, err := parseCodexCLIVersion(output)
		if err != nil {
			p.availabilityErr = fmt.Errorf("%s: %w", p.Name(), err)
			return
		}
		minimum, err := parseSemanticVersion(p.minimumVersion)
		if err != nil {
			p.availabilityErr = fmt.Errorf("%s: invalid minimum Codex version: %w", p.Name(), err)
			return
		}
		if version.lessThan(minimum) {
			p.availabilityErr = fmt.Errorf("%s requires Codex CLI >= %s; found %s", p.Name(), p.minimumVersion, version)
		}
	})
	return p.availabilityErr
}

func (p *codexAppProvider) Launch() (string, []string, []string, error) {
	if err := p.CheckAvailable(); err != nil {
		return "", nil, nil, err
	}
	args := []string{"app-server", "--listen", "stdio://"}
	if p.materializeCatalog != nil {
		catalogPath, err := p.materializeCatalog(p.options.CodexHome)
		if err != nil {
			return "", nil, nil, fmt.Errorf("%s: prepare model catalog: %w", p.Name(), err)
		}
		args = append(args, p.configArgs(catalogPath)...)
	}
	return p.resolvedExecutable, args, append([]string(nil), p.options.Environment...), nil
}
```

Create `codexapp_deepseek.go` around these exact constants and overrides:

```go
const (
	cxDeepSeekAPIKeyEnv = "DEEPSEEK_API_KEY"
	cxDeepSeekBaseURL   = "https://api.deepseek.com/"
)

var codexCLIVersionPattern = regexp.MustCompile(`(?i)\bcodex(?:-cli)?\s+v?(\d+)\.(\d+)\.(\d+)\b`)

type semanticVersion struct {
	major int
	minor int
	patch int
}

func (v semanticVersion) String() string {
	return fmt.Sprintf("%d.%d.%d", v.major, v.minor, v.patch)
}

func (v semanticVersion) lessThan(other semanticVersion) bool {
	if v.major != other.major {
		return v.major < other.major
	}
	if v.minor != other.minor {
		return v.minor < other.minor
	}
	return v.patch < other.patch
}

func parseSemanticVersion(value string) (semanticVersion, error) {
	parts := strings.Split(value, ".")
	if len(parts) != 3 {
		return semanticVersion{}, fmt.Errorf("invalid semantic version %q", value)
	}
	values := [3]int{}
	for index, part := range parts {
		parsed, err := strconv.Atoi(part)
		if err != nil || parsed < 0 {
			return semanticVersion{}, fmt.Errorf("invalid semantic version %q", value)
		}
		values[index] = parsed
	}
	return semanticVersion{major: values[0], minor: values[1], patch: values[2]}, nil
}

func parseCodexCLIVersion(output []byte) (semanticVersion, error) {
	match := codexCLIVersionPattern.FindSubmatch(output)
	if len(match) != 4 {
		return semanticVersion{}, fmt.Errorf("cannot parse Codex CLI version from %q", strings.TrimSpace(string(output)))
	}
	return parseSemanticVersion(strings.Join([]string{string(match[1]), string(match[2]), string(match[3])}, "."))
}

func NewCXDeepSeekProvider(stateDir, apiKey string) *codexAppProvider {
	homeDir, homeErr := cxDeepSeekHomeDir(stateDir)
	provider := newCodexAppProvider(codexAppProviderOptions{
		Provider:       protocol.ACPProviderCXDeepSeek,
		Title:          "DeepSeek Codex",
		AllowImages:    false,
		CodexHome:      homeDir,
		SessionMapPath: filepath.Join(homeDir, "wheelmaker-sessions.json"),
		Environment: []string{
			"CODEX_HOME=" + homeDir,
			cxDeepSeekAPIKeyEnv + "=" + apiKey,
		},
	})
	provider.configurationErr = homeErr
	provider.minimumVersion = cxdeepseek.MinimumCodexVersion
	provider.versionOutput = codexVersionOutput
	provider.materializeCatalog = cxdeepseek.Materialize
	provider.configArgs = cxDeepSeekConfigArgs
	return provider
}

func cxDeepSeekHomeDir(stateDir string) (string, error) {
	if strings.TrimSpace(stateDir) == "" {
		return "", errors.New("cx-deepseek state directory is required")
	}
	homeDir, err := filepath.Abs(filepath.Join(stateDir, ".data", string(protocol.ACPProviderCXDeepSeek)))
	if err != nil {
		return "", fmt.Errorf("resolve cx-deepseek CODEX_HOME: %w", err)
	}
	return homeDir, nil
}
```

Build launch overrides only after `Materialize` returns the absolute catalog path:

```go
func cxDeepSeekConfigArgs(catalogPath string) []string {
	return []string{
		"-c", tomlStringOverride("model", cxdeepseek.ModelID),
		"-c", tomlStringOverride("model_provider", "deepseek"),
		"-c", tomlStringOverride("model_reasoning_effort", "high"),
		"-c", tomlStringOverride("model_catalog_json", catalogPath),
		"-c", tomlStringOverride("model_providers.deepseek.name", "deepseek"),
		"-c", tomlStringOverride("model_providers.deepseek.base_url", cxDeepSeekBaseURL),
		"-c", tomlStringOverride("model_providers.deepseek.wire_api", "responses"),
		"-c", tomlStringOverride("model_providers.deepseek.env_key", cxDeepSeekAPIKeyEnv),
		"-c", "model_providers.deepseek.requires_openai_auth=false",
		"-c", "model_providers.deepseek.supports_websockets=false",
	}
}

func tomlStringOverride(key, value string) string {
	return key + "=" + strconv.Quote(value)
}
```

`codexAppProvider.CheckAvailable()` resolves `codex`, executes `codex --version` once per provider object, parses semantic numeric components, and caches only executable/version availability. `Launch()` calls `CheckAvailable()`, materializes the catalog, then returns the base app-server arguments plus the config overrides. Catalog creation must not occur during Factory availability scanning.

- [x] **Step 4: Write failing bridge identity, image-gate, mapping, and fork tests**

Use `newFakeCodexappTransport` and a DeepSeek connection profile to assert:

```go
func TestCXDeepSeekCodexBridgeUsesProviderIdentityAndTextOnlyCapability(t *testing.T) {
	transport := newFakeCodexappTransport()
	runtime := newCodexappRuntimeWithTransport(transport)
	t.Cleanup(func() { _ = runtime.close() })
	conn := newCodexappConnWithRuntimeAndProfile(runtime, t.TempDir(), "proj", codexappConnProfile{
		Provider:       protocol.ACPProviderCXDeepSeek,
		Title:          "DeepSeek Codex",
		AllowImages:    false,
		SessionMapPath: func() (string, error) { return filepath.Join(t.TempDir(), "map.json"), nil },
	})

	resultCh := make(chan protocol.InitializeResult, 1)
	errCh := make(chan error, 1)
	go func() {
		var result protocol.InitializeResult
		errCh <- conn.Send(context.Background(), protocol.MethodInitialize, protocol.InitializeParams{}, &result)
		resultCh <- result
	}()
	request := transport.nextSent(t)
	if err := transport.emit(map[string]any{"id": request["id"], "result": map[string]any{}}); err != nil {
		t.Fatal(err)
	}
	_ = transport.nextSent(t)
	if err := <-errCh; err != nil {
		t.Fatal(err)
	}
	result := <-resultCh
	if result.AgentInfo == nil || result.AgentInfo.Name != "cx-deepseek" || result.AgentCapabilities.PromptCapabilities.Image {
		t.Fatalf("initialize result = %#v", result)
	}
}
```

Also assert that image ContentBlocks and image resource links are rejected before `turn/start`, while text prompts still reach `turn/start`; emitted prompt/fork points use `Provider: "cx-deepseek"`; and a DeepSeek connection reads/writes only its injected Session map path. Keep native-connection assertions for `Provider: "codex"`, `Image: true`, and the existing `~/.wheelmaker/codexapp-sessions.json` path.

- [x] **Step 5: Parameterize the existing bridge without changing native defaults**

Add a provider/profile boundary:

```go
type codexappConnProfile struct {
	Provider       protocol.ACPProvider
	Title          string
	AllowImages    bool
	SessionMapPath func() (string, error)
}

func nativeCodexappConnProfile() codexappConnProfile {
	return codexappConnProfile{
		Provider:       protocol.ACPProviderCodex,
		Title:          "Codex App Server",
		AllowImages:    true,
		SessionMapPath: codexappSessionMapPathFunc,
	}
}
```

Store this profile on `codexappConn`; make mapping helpers accept `SessionMapPath`; return profile identity from `sendInitialize`, `matchForkPromptTurns`, and `sendSessionPrompt`; and route all three `codexappPromptToInputWithArtifacts` call sites through a connection method that rejects images when `AllowImages` is false. `newCodexappConnWithRuntime` and existing test constructors must continue to install `nativeCodexappConnProfile()`.

Change `codexappInstanceCreator` to accept the configured `*codexAppProvider` profile while still constructing a new local runtime pool per creator call. Add an injectable runtime starter helper for the independent-pool test; production continues to call `newCodexappRuntime`.

```go
func codexappInstanceCreator(provider *codexAppProvider) InstanceCreator {
	return codexappInstanceCreatorWithStarter(provider, func(_ context.Context, cwd, projectName string) (*codexappRuntime, error) {
		return newCodexappRuntime(provider, cwd, projectName)
	})
}

func codexappInstanceCreatorWithStarter(provider *codexAppProvider, starter codexappRuntimeStarter) InstanceCreator {
	if provider == nil {
		provider = NewCodexAppProvider()
	}
	pool := newCodexappRuntimePool(starter)
	return func(ctx context.Context, cwd string) (Instance, error) {
		executable, args, _, err := provider.Launch()
		if err != nil {
			return nil, err
		}
		projectName := ProjectNameFromContext(ctx)
		lease, err := pool.acquire(ctx, projectName, cwd, codexappLaunchFingerprint(executable, args))
		if err != nil {
			return nil, err
		}
		conn := newCodexappConnWithRuntimeAndProfile(lease.Runtime(), cwd, projectName, provider.connectionProfile())
		conn.lease = lease
		return NewInstance(provider.Name(), conn), nil
	}
}

func (p *codexAppProvider) connectionProfile() codexappConnProfile {
	profile := nativeCodexappConnProfile()
	profile.Provider = p.options.Provider
	profile.Title = p.options.Title
	profile.AllowImages = p.options.AllowImages
	if p.options.SessionMapPath != "" {
		path := p.options.SessionMapPath
		profile.SessionMapPath = func() (string, error) { return path, nil }
	}
	return profile
}
```

- [x] **Step 6: Run focused bridge and launch tests**

Run from `server/`:

```powershell
gofmt -w internal/hub/agent/codexapp_agent.go internal/hub/agent/codexapp_deepseek.go internal/hub/agent/agent_test.go
go test ./internal/hub/agent -run 'TestCodexProviderUsesAppServerStdio|TestCodexAppProviderLaunchUsesAppServerStdio|TestCXDeepSeek|TestCodexApp.*Fork|TestCodexAppPromptMapsImage' -count=1
```

Expected: PASS. Existing native Codex launch arguments remain exactly `app-server --listen stdio://` and native image tests remain green.

- [x] **Step 7: Commit the launcher and reusable bridge changes**

```powershell
git add server/internal/hub/agent/codexapp_agent.go server/internal/hub/agent/codexapp_deepseek.go server/internal/hub/agent/agent_test.go
git commit -m "feat(agent): launch deepseek through codex app server"
```

### Task 4: Register cx-deepseek in the Hub Factory with its own runtime pool

**Files:**
- Modify: `server/internal/hub/agent/factory.go:84`
- Modify: `server/internal/hub/agent/agent_test.go:5913`

- [x] **Step 1: Write the Factory registration matrix test**

Add a focused test that makes only the requested provider available:

```go
func TestConfiguredACPFactoryRegistersCXDeepSeekFromExistingKey(t *testing.T) {
	stateDir := t.TempDir()
	tests := []struct {
		name      string
		key       string
		available bool
		want      bool
	}{
		{name: "key and supported codex", key: "deepseek-key", available: true, want: true},
		{name: "missing key", available: true, want: false},
		{name: "unsupported codex", key: "deepseek-key", available: false, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			factory := newACPFactoryWithOptions(ACPFactoryOptions{
				StateDir:       stateDir,
				DeepSeekAPIKey: test.key,
			}, func(provider ACPProvider) bool {
				return test.available && provider.Name() == string(protocol.ACPProviderCXDeepSeek)
			})
			registered := factory.Creator(protocol.ACPProviderCXDeepSeek) != nil
			if registered != test.want {
				t.Fatalf("registered = %v, want %v; names=%v", registered, test.want, factory.Names())
			}
		})
	}
}
```

Extend the Session action assertion so `cx-deepseek` has `Status`, `Compact`, `Steer`, `Fork`, and `Goal`, and remains absent from `PreferredName()` ordering.

- [x] **Step 2: Write the independent creator-pool test**

Use `codexappInstanceCreatorWithStarter(provider, starter)` from Task 3 to create native and DeepSeek creators for the same project/cwd. Extract the package-private connection from each returned `*instance`, assert two runtime starts, sharing within each creator, and no runtime pointer shared across creators:

```go
func codexappConnFromInstance(t *testing.T, value Instance) *codexappConn {
	t.Helper()
	base, ok := value.(*instance)
	if !ok {
		t.Fatalf("instance type = %T", value)
	}
	conn, ok := base.conn.(*codexappConn)
	if !ok {
		t.Fatalf("connection type = %T", base.conn)
	}
	return conn
}

starts := map[string]int{}
starter := func(name string) codexappRuntimeStarter {
	return func(context.Context, string, string) (*codexappRuntime, error) {
		starts[name]++
		return newCodexappRuntimeWithTransport(newFakeCodexappTransport()), nil
	}
}
nativeProvider := NewCodexAppProvider()
nativeProvider.lookPath = func(string) (string, error) { return "/bin/codex-native", nil }
deepSeekProvider := newCodexAppProvider(codexAppProviderOptions{
	Provider:    protocol.ACPProviderCXDeepSeek,
	Title:       "DeepSeek Codex",
	AllowImages: false,
})
deepSeekProvider.lookPath = func(string) (string, error) { return "/bin/codex-deepseek", nil }
nativeCreator := codexappInstanceCreatorWithStarter(nativeProvider, starter("native"))
deepSeekCreator := codexappInstanceCreatorWithStarter(deepSeekProvider, starter("deepseek"))
ctx := WithProjectName(context.Background(), "project-a")
cwd := t.TempDir()

nativeInstanceA, err := nativeCreator(ctx, cwd)
if err != nil {
	t.Fatal(err)
}
t.Cleanup(func() { _ = nativeInstanceA.Close() })
nativeInstanceB, err := nativeCreator(ctx, cwd)
if err != nil {
	t.Fatal(err)
}
t.Cleanup(func() { _ = nativeInstanceB.Close() })
deepSeekInstanceA, err := deepSeekCreator(ctx, cwd)
if err != nil {
	t.Fatal(err)
}
t.Cleanup(func() { _ = deepSeekInstanceA.Close() })
deepSeekInstanceB, err := deepSeekCreator(ctx, cwd)
if err != nil {
	t.Fatal(err)
}
t.Cleanup(func() { _ = deepSeekInstanceB.Close() })

nativeA := codexappConnFromInstance(t, nativeInstanceA)
nativeB := codexappConnFromInstance(t, nativeInstanceB)
deepSeekA := codexappConnFromInstance(t, deepSeekInstanceA)
deepSeekB := codexappConnFromInstance(t, deepSeekInstanceB)
if starts["native"] != 1 || starts["deepseek"] != 1 {
	t.Fatalf("runtime starts = %v, want one per provider creator", starts)
}
if nativeA.runtime != nativeB.runtime {
	t.Fatal("native creator did not share its project runtime")
}
if deepSeekA.runtime != deepSeekB.runtime {
	t.Fatal("cx-deepseek creator did not share its project runtime")
}
if nativeA.runtime == deepSeekA.runtime {
	t.Fatal("native codex and cx-deepseek shared a runtime")
}
```

- [x] **Step 3: Run the Factory tests and verify registration is missing**

Run from `server/`:

```powershell
go test ./internal/hub/agent -run 'TestConfiguredACPFactoryRegistersCXDeepSeek|TestCodexAppProviderCreatorsUseIndependentPools' -count=1
```

Expected: the registration test fails because the Factory does not bind `ACPProviderCXDeepSeek`.

- [x] **Step 4: Register the provider from the existing DeepSeek Key**

Inside the existing non-empty DeepSeek Key branch:

```go
cxDeepSeekProvider := NewCXDeepSeekProvider(options.StateDir, deepseekKey)
if available(cxDeepSeekProvider) {
	f.Register(protocol.ACPProviderCXDeepSeek, codexappInstanceCreator(cxDeepSeekProvider))
	f.RegisterSessionActions(protocol.ACPProviderCXDeepSeek, SessionActionSupport{
		Status: true,
		Compact: true,
		Steer: true,
		Fork: true,
		Goal: true,
	})
}
```

Teach `isProviderAvailable` to call an optional `CheckAvailable() error` interface before falling back to `Launch()`. The DeepSeek implementation checks binary/version only; its catalog materializer remains on the first real `Launch()` path.

- [x] **Step 5: Run all agent tests and commit Factory integration**

Run from `server/`:

```powershell
gofmt -w internal/hub/agent/factory.go internal/hub/agent/agent_test.go
go test ./internal/hub/agent -count=1
```

Expected: PASS, including existing Claude-compatible registration tests.

```powershell
git add server/internal/hub/agent/factory.go server/internal/hub/agent/agent_test.go
git commit -m "feat(agent): register cx deepseek codex provider"
```

### Task 5: Isolate recovery and preserve provider identity in Codex-native Session actions

**Files:**
- Modify: `server/internal/hub/client/session_recovery.go:186`
- Modify: `server/internal/hub/client/client.go:836`
- Modify: `server/internal/hub/client/client_test.go:3168`

- [x] **Step 1: Write the Codex-home isolation test**

Refactor the fixture helper to accept a Codex home directly, then create one native and one DeepSeek rollout tree:

```go
func TestCodexFamilyRecoveryUsesIsolatedHomes(t *testing.T) {
	userDir := t.TempDir()
	stateDir := t.TempDir()
	cwd := t.TempDir()
	t.Setenv("HOME", userDir)
	t.Setenv("USERPROFILE", userDir)
	nativeHome := filepath.Join(userDir, ".codex")
	cxHome := filepath.Join(stateDir, ".data", "cx-deepseek")
	writeCodexSessionFixtureAtHome(t, nativeHome, "native-session", cwd, "Native", "native reply")
	writeCodexSessionFixtureAtHome(t, cxHome, "cx-session", cwd, "DeepSeek", "cx reply")

	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	client := NewWithRuntime(store, "project", cwd, RuntimeConfig{StateDir: stateDir})
	t.Cleanup(func() { _ = client.Close() })

	native, err := client.recovery().ListResumableSessions(context.Background(), "codex")
	if err != nil {
		t.Fatal(err)
	}
	cx, err := client.recovery().ListResumableSessions(context.Background(), "cx-deepseek")
	if err != nil {
		t.Fatal(err)
	}
	assertRecoverySessionIDs(t, native, "native-session")
	assertRecoverySessionIDs(t, cx, "cx-session")
}

func assertRecoverySessionIDs(t *testing.T, response map[string]any, want string) {
	t.Helper()
	sessions, ok := response["sessions"].([]recoverySession)
	if !ok {
		t.Fatalf("sessions = %#v, want []recoverySession", response["sessions"])
	}
	if len(sessions) != 1 || sessions[0].SessionID != want {
		t.Fatalf("sessions = %#v, want only %q", sessions, want)
	}
}
```

Also call `sourceFor("cx-deepseek")` with an empty `stateDir` and assert a diagnostic error.

- [x] **Step 2: Run the recovery test and verify unsupported-provider failure**

Run from `server/`:

```powershell
go test ./internal/hub/client -run TestCodexFamilyRecoveryUsesIsolatedHomes -count=1
```

Expected: FAIL with unsupported recovery agent `cx-deepseek`.

- [x] **Step 3: Parameterize the Codex recovery source**

Replace the empty source with explicit ownership:

```go
type codexRecoverySource struct {
	agentType string
	homeDir   string
}

func (s codexRecoverySource) AgentType() string { return s.agentType }
```

Use `s.homeDir/session_index.jsonl` and `s.homeDir/sessions`, and emit `AgentType: s.agentType`. Construct sources as follows:

```go
case "codex":
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	return codexRecoverySource{agentType: agentType, homeDir: filepath.Join(home, ".codex")}, nil
case "cx-deepseek":
	if r.client.stateDir == "" {
		return nil, fmt.Errorf("state directory is required for %s recovery", agentType)
	}
	return codexRecoverySource{
		agentType: agentType,
		homeDir:   filepath.Join(r.client.stateDir, ".data", agentType),
	}, nil
```

- [x] **Step 4: Write provider-preserving fork and archive tests**

Extend existing Codex fork/archive tests with `cx-deepseek`. The source summary, injected instance name, fork point provider, target Session agent type, and native archive creator lookup must all remain `cx-deepseek`. A fork point carrying `codex` for a `cx-deepseek` source must be rejected as a provider mismatch.

Use a shared helper assertion:

```go
func isCodexAppAgentType(agentType string) bool {
	switch strings.ToLower(strings.TrimSpace(agentType)) {
	case string(acp.ACPProviderCodex), string(acp.ACPProviderCXDeepSeek):
		return true
	default:
		return false
	}
}
```

The implementation helper belongs in `client.go`; tests call behavior, not the helper directly.

- [x] **Step 5: Run the Session action tests and verify the hard-coded Codex checks fail**

Run from `server/`:

```powershell
go test ./internal/hub/client -run 'Test.*CXDeepSeek.*Fork|Test.*CXDeepSeek.*Archive' -count=1
```

Expected: FAIL because `client.go` accepts only `codex`.

- [x] **Step 6: Generalize the three Codex-native call sites**

Use `isCodexAppAgentType` for legacy fork-point enrichment and native archive synchronization. In `forkSessionAtTurn`, require the selected fork point provider to equal the normalized source Session agent type:

```go
sourceAgentType := strings.ToLower(normalizeAgentType(sourceSummary.AgentType))
if !isCodexAppAgentType(sourceAgentType) {
	return nil, fmt.Errorf("%w: fork", agent.ErrSessionActionUnsupported)
}
if !strings.EqualFold(selectedPoint.Provider, sourceAgentType) {
	return nil, fmt.Errorf("fork point provider %s does not match source agent %s", selectedPoint.Provider, sourceAgentType)
}
```

Do not broaden these paths to CC providers or other ACP agents.

- [x] **Step 7: Run client tests and commit recovery/action isolation**

Run from `server/`:

```powershell
gofmt -w internal/hub/client/session_recovery.go internal/hub/client/client.go internal/hub/client/client_test.go
go test ./internal/hub/client -run 'TestCodexFamilyRecovery|TestCodexRecovery|Test.*Fork|Test.*Archive' -count=1
```

Expected: PASS for both native Codex and `cx-deepseek` paths.

```powershell
git add server/internal/hub/client/session_recovery.go server/internal/hub/client/client.go server/internal/hub/client/client_test.go
git commit -m "feat(hub): isolate cx deepseek session recovery"
```

### Task 6: Add the cx.deepseek label and Codex color mapping

**Files:**
- Create: `app/web/src/chat/projectAgents.test.ts`
- Create: `app/web/src/chat/agentTagVariant.test.ts`
- Modify: `app/web/src/chat/projectAgents.ts:8`
- Modify: `app/web/src/chat/agentTagVariant.ts:6`

- [x] **Step 1: Write frontend label and raw-ID tests**

Create `projectAgents.test.ts`:

```ts
import {agentDisplayLabel, buildAgentChoiceNodes, buildProjectAgentChoices} from './projectAgents';
import type {RegistryProject} from '../registry/registryTypes';

describe('cx.deepseek agent presentation', () => {
  it('uses the short display label while preserving the wire agent ID', () => {
    expect(agentDisplayLabel('cx-deepseek')).toBe('cx.deepseek');
    expect(buildAgentChoiceNodes(['cx-deepseek'])).toEqual([
      {agentType: 'cx-deepseek', label: 'cx.deepseek'},
    ]);
  });

  it('is selectable only when the Hub reports cx-deepseek', () => {
    const project = {
      id: 'project-1',
      agent: 'codex',
      agents: ['codex', 'cx-deepseek'],
    } as RegistryProject;
    expect(buildProjectAgentChoices(project, [])).toEqual(['codex', 'cx-deepseek']);
    expect(buildProjectAgentChoices({...project, agents: ['codex']}, [])).toEqual(['codex']);
  });
});
```

- [x] **Step 2: Write the Codex color parity test**

Create `agentTagVariant.test.ts`:

```ts
import {agentTagVariantClass} from './agentTagVariant';

describe('cx.deepseek agent color', () => {
  it('uses the native Codex variant', () => {
    expect(agentTagVariantClass('cx-deepseek')).toBe('wide-session-agent-0');
    expect(agentTagVariantClass('cx-deepseek')).toBe(agentTagVariantClass('codex'));
  });
});
```

- [x] **Step 3: Run the frontend tests and verify they fail**

Run from `app/`:

```powershell
npm test -- --runInBand web/src/chat/projectAgents.test.ts web/src/chat/agentTagVariant.test.ts
```

Expected: label test returns `cx-deepseek`, and color test returns a hash-derived variant.

- [x] **Step 4: Add the two explicit mappings**

In `agentDisplayLabel`:

```ts
case 'cx-deepseek':
  return 'cx.deepseek';
```

In `AGENT_TAG_VARIANT_INDEX`:

```ts
'cx-deepseek': 0,
```

Do not add a generic `cx` grouping or a new settings component.

- [x] **Step 5: Run focused tests and TypeScript checking**

Run from `app/`:

```powershell
npm test -- --runInBand web/src/chat/projectAgents.test.ts web/src/chat/agentTagVariant.test.ts
npm run tsc:web
```

Expected: PASS with no TypeScript errors.

- [x] **Step 6: Commit the frontend mapping**

```powershell
git add app/web/src/chat/projectAgents.ts app/web/src/chat/projectAgents.test.ts app/web/src/chat/agentTagVariant.ts app/web/src/chat/agentTagVariant.test.ts
git commit -m "feat(web): present cx deepseek agent"
```

### Task 7: Run full verification, rebase, and complete the branch

**Files:**
- Modify: `docs/scope/2026-07-31-cx-deepseek-codex-mode/plan-cx-deepseek-codex-mode.md` — mark executed checkboxes complete.

- [x] **Step 1: Run complete server tests**

Run from `server/`:

```powershell
go test ./...
```

Expected: PASS across all server packages without a real DeepSeek key or network request.

- [x] **Step 2: Run complete frontend tests and type checking**

Run from `app/`:

```powershell
npm test -- --runInBand
npm run tsc:web
```

Expected: PASS.

- [x] **Step 3: Verify security, catalog scope, and repository cleanliness**

Run from the repository root:

```powershell
rg -n "deepseek-v4-pro|experimental_bearer_token" server/internal/hub/agent/cxdeepseek server/internal/hub/agent/codexapp_deepseek.go
rg -n "secret-deepseek-key|\bsk-[A-Za-z0-9]{16,}\b" server/internal/hub/agent/cxdeepseek server/internal/hub/agent/codexapp_deepseek.go
git diff --check
git status --short
```

Expected: both secret/catalog-scope searches return no matches in production assets/code; `git diff --check` prints no errors. Test fixtures may use an obvious fake key only inside `_test.go` files.

- [ ] **Step 4: Optionally smoke-test a configured local Hub**

Skipped in this execution because no explicit DeepSeek test credential was available in the process environment. This remains a non-CI verification step.

When a developer already has a DeepSeek Key configured and Codex CLI `>= 0.144.0`, start the Hub from this worktree, create a `cx.deepseek` Session, verify `model/list` exposes only Flash with `low/high/max`, send one text prompt, restart the Hub, and resume the same Session. Skip this step when credentials are unavailable; it is not a CI gate.

- [x] **Step 5: Synchronize with the latest remote base and repeat the full gate if rebased**

From the repository root, with all task commits complete and the worktree clean:

```powershell
git fetch origin
git rebase origin/main
```

Expected: rebase succeeds. If commits changed, repeat Steps 1–3 before continuing.

- [x] **Step 6: Mark this plan complete using apply_patch**

Change every executed `- [ ]` marker in this plan to `- [x]`. Leave no implementation or verification step marked complete unless its command actually succeeded.

- [x] **Step 7: Execute the repository completion gate exactly**

From the repository root:

```powershell
git add -A
git commit -m "feat: add cx deepseek codex responses provider"
git push origin feature/cx-deepseek-codex-mode
```

Expected: all three commands succeed. Do not send the final implementation completion message before the push finishes.
