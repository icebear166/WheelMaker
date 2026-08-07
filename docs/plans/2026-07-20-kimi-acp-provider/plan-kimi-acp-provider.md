# Kimi ACP Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Kimi Code CLI (`kimi acp`) as the eighth built-in ACP provider and feed kimi-cli local credentials into the existing Kimi limits monitoring as a second account.

**Architecture:** Reuse the existing preset-driven provider chain (`ACPProviderPreset` → `acpProvider` → `ACPProcess`). Limits side refactors `KimiScanner` from a single credential to a list of credential sources, adding a read-only reader for `~/.kimi-code/credentials/kimi-code.json` (no OAuth refresh, no file writes).

**Tech Stack:** Go (server hub), React/TypeScript (app web UI).

**Spec:** [`spec-kimi-acp-provider.md`](../../scope/2026-07-20-kimi-acp-provider.md)

**Conventions:**
- Tests are merged into existing `*_test.go` files (`server/internal/hub/agent/agent_test.go`, `server/internal/hub/usage/providers_test.go`).
- Code comments and identifiers in English.
- Never write to `~/.kimi-code/credentials/`; never log credentials.
- Go commands run with `workdir` = `server/`; app commands with `workdir` = `app/`.

---

### Task 1: Protocol constant for the kimi provider

**Files:**
- Modify: `server/internal/protocol/acp_const.go:100-131`
- Test: `server/internal/hub/agent/agent_test.go` (append near `TestParseACPProviderCodexAliases`, line ~465)

- [ ] **Step 1: Write the failing test**

Append to `server/internal/hub/agent/agent_test.go`:

```go
func TestParseACPProviderKimi(t *testing.T) {
	provider, ok := protocol.ParseACPProvider("Kimi")
	if !ok || provider != protocol.ACPProviderKimi {
		t.Fatalf("ParseACPProvider(Kimi)=(%q,%v), want %q,true", provider, ok, protocol.ACPProviderKimi)
	}
	found := false
	for _, name := range protocol.ACPProviderNames() {
		if name == string(protocol.ACPProviderKimi) {
			found = true
		}
	}
	if !found {
		t.Fatalf("ACPProviderNames missing kimi: %v", protocol.ACPProviderNames())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/hub/agent/ -run TestParseACPProviderKimi -v`
Expected: FAIL — `protocol.ACPProviderKimi` undefined (compile error).

- [ ] **Step 3: Add the protocol constant**

In `server/internal/protocol/acp_const.go`, extend the const block:

```go
const (
	ACPProviderCodex     ACPProvider = "codex"
	ACPProviderClaude    ACPProvider = "claude"
	ACPProviderCopilot   ACPProvider = "copilot"
	ACPProviderOpenCode  ACPProvider = "opencode"
	ACPProviderMimo      ACPProvider = "mimo"
	ACPProviderCodeBuddy ACPProvider = "codebuddy"
	ACPProviderFlicker   ACPProvider = "flicker"
	ACPProviderKimi      ACPProvider = "kimi"
)

var acpProviders = []ACPProvider{ACPProviderCodex, ACPProviderClaude, ACPProviderCopilot, ACPProviderOpenCode, ACPProviderMimo, ACPProviderCodeBuddy, ACPProviderFlicker, ACPProviderKimi}
```

And in `ParseACPProvider`, add before `default:`:

```go
	case string(ACPProviderKimi):
		return ACPProviderKimi, true
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/hub/agent/ -run TestParseACPProviderKimi -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/protocol/acp_const.go server/internal/hub/agent/agent_test.go
git commit -m "feat(protocol): add kimi ACP provider constant"
```

---

### Task 2: Kimi provider preset, constructor, factory and skills registration

**Files:**
- Modify: `server/internal/hub/agent/acp_provider.go:91-100` (add preset after `FlickerACPProviderPreset`), `:141-147` (add constructor)
- Modify: `server/internal/hub/agent/factory.go:87-97`
- Modify: `server/internal/hub/agent/skills.go:27-44`
- Test: `server/internal/hub/agent/agent_test.go` (append near the other preset tests, line ~4186)

- [ ] **Step 1: Write the failing tests**

Append to `server/internal/hub/agent/agent_test.go`:

```go
func TestKimiProviderPreset(t *testing.T) {
	preset := KimiACPProviderPreset
	if preset.Name != "kimi" || preset.BinaryName != "kimi" {
		t.Fatalf("preset=%+v", preset)
	}
	if len(preset.Args) != 1 || preset.Args[0] != "acp" {
		t.Fatalf("args=%v, want [acp]", preset.Args)
	}
	if !strings.Contains(preset.MissingPathErrTemplate, "%v") {
		t.Fatalf("missing-path template must consume the underlying error: %q", preset.MissingPathErrTemplate)
	}
	assertContainsDir := func(dirs []string, want string) {
		t.Helper()
		for _, dir := range dirs {
			if strings.EqualFold(strings.TrimSpace(dir), want) {
				return
			}
		}
		t.Fatalf("dirs %v missing %q", dirs, want)
	}
	assertContainsDir(preset.SkillProjectDirs, ".agents/skills")
	assertContainsDir(preset.SkillProjectDirs, ".kimi-code/skills")
	assertContainsDir(preset.SkillUserDirs, "~/.agents/skills")
	assertContainsDir(preset.SkillUserDirs, "~/.kimi-code/skills")

	provider := NewKimiProvider()
	if provider.Name() != "kimi" {
		t.Fatalf("provider name=%q, want kimi", provider.Name())
	}
}

func TestProviderPresetByNameKimi(t *testing.T) {
	preset, ok := providerPresetByName("kimi")
	if !ok || preset.Name != "kimi" {
		t.Fatalf("providerPresetByName(kimi)=(%#v,%v), want kimi,true", preset, ok)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/hub/agent/ -run 'TestKimiProviderPreset|TestProviderPresetByNameKimi' -v`
Expected: FAIL — `KimiACPProviderPreset` / `NewKimiProvider` undefined.

- [ ] **Step 3: Implement preset, constructor, factory candidate, skills lookup**

In `server/internal/hub/agent/acp_provider.go`, add after the `FlickerACPProviderPreset` block:

```go
	KimiACPProviderPreset = ACPProviderPreset{
		Name:                   "kimi",
		BinaryName:             "kimi",
		Args:                   []string{"acp"},
		MissingPathErrTemplate: "kimi: binary not found (install Kimi Code CLI: https://code.kimi.com/kimi-code): %v",
		SkillProjectDirs:       []string{".agents/skills", ".kimi-code/skills"},
		SkillUserDirs:          []string{"~/.agents/skills", "~/.kimi-code/skills"},
	}
```

Add after `NewFlickerProvider`:

```go
func NewKimiProvider() *acpProvider {
	return NewACPProvider(KimiACPProviderPreset)
}
```

In `server/internal/hub/agent/factory.go`, add to the `candidates` slice after the flicker entry:

```go
		{provider: protocol.ACPProviderKimi, build: func() ACPProvider { return NewKimiProvider() }},
```

In `server/internal/hub/agent/skills.go` `providerPresetByName`, add before `default:`:

```go
	case KimiACPProviderPreset.Name:
		return KimiACPProviderPreset, true
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/hub/agent/ -run 'TestKimiProviderPreset|TestProviderPresetByNameKimi' -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/hub/agent/acp_provider.go server/internal/hub/agent/factory.go server/internal/hub/agent/skills.go server/internal/hub/agent/agent_test.go
git commit -m "feat(agent): register kimi ACP provider preset"
```

---

### Task 3: Frontend agent tag variant for kimi

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx:1312-1320`

- [ ] **Step 1: Add the mapping**

In `AGENT_TAG_VARIANT_INDEX`, insert `kimi: 6` (indices 6 and 7 are unused; 0-5 and 8 are taken):

```ts
const AGENT_TAG_VARIANT_INDEX: Record<string, number> = {
  codex: 0,
  copilot: 1,
  claude: 2,
  opencode: 3,
  codebuddy: 4,
  mimo: 5,
  kimi: 6,
  flicker: 8,
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run tsc:web`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx
git commit -m "feat(app): assign kimi agent tag color variant"
```

---

### Task 4: Read-only kimi-cli credentials reader

**Files:**
- Create: `server/internal/hub/usage/kimi_code_auth.go`
- Test: `server/internal/hub/usage/providers_test.go` (append)

- [ ] **Step 1: Write the failing tests**

Append to `server/internal/hub/usage/providers_test.go`:

```go
func TestReadKimiCodeCredentialValidToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "kimi-code.json")
	body := `{"access_token":"kimi-code-token","refresh_token":"ignored","expires_at":4102444800,"token_type":"Bearer"}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := readKimiCodeCredential(path, time.Unix(1784519757, 0)); got != "kimi-code-token" {
		t.Fatalf("credential=%q, want kimi-code-token", got)
	}
}

func TestReadKimiCodeCredentialRejectsExpiredToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "kimi-code.json")
	body := `{"access_token":"kimi-code-token","expires_at":1784520447}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := readKimiCodeCredential(path, time.Unix(1784520447, 0)); got != "" {
		t.Fatalf("expired credential=%q, want empty", got)
	}
}

func TestReadKimiCodeCredentialHandlesMissingAndInvalidFiles(t *testing.T) {
	if got := readKimiCodeCredential(filepath.Join(t.TempDir(), "absent.json"), time.Now()); got != "" {
		t.Fatalf("missing file credential=%q, want empty", got)
	}
	path := filepath.Join(t.TempDir(), "broken.json")
	if err := os.WriteFile(path, []byte(`{"access_token":`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := readKimiCodeCredential(path, time.Now()); got != "" {
		t.Fatalf("invalid JSON credential=%q, want empty", got)
	}
	empty := filepath.Join(t.TempDir(), "empty.json")
	if err := os.WriteFile(empty, []byte(`{"expires_at":4102444800}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := readKimiCodeCredential(empty, time.Now()); got != "" {
		t.Fatalf("empty token credential=%q, want empty", got)
	}
}

func TestDefaultKimiCodeCredentialsPathRespectsHomeOverride(t *testing.T) {
	override := t.TempDir()
	t.Setenv("KIMI_CODE_HOME", override)
	got := defaultKimiCodeCredentialsPath()
	want := filepath.Join(override, "credentials", "kimi-code.json")
	if got != want {
		t.Fatalf("path=%q, want %q", got, want)
	}
	t.Setenv("KIMI_CODE_HOME", "")
	if path := defaultKimiCodeCredentialsPath(); path == "" || !strings.HasSuffix(path, filepath.Join("credentials", "kimi-code.json")) {
		t.Fatalf("default path=%q", path)
	}
}
```

Note: `providers_test.go` already imports `os`, `path/filepath`, `strings`; add `"time"` to its import block.

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/hub/usage/ -run 'KimiCodeCredential|KimiCodeCredentialsPath' -v`
Expected: FAIL — `readKimiCodeCredential` / `defaultKimiCodeCredentialsPath` undefined.

- [ ] **Step 3: Implement the reader**

Create `server/internal/hub/usage/kimi_code_auth.go`:

```go
package usage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type kimiCodeCredentialsFile struct {
	AccessToken string `json:"access_token"`
	ExpiresAt   int64  `json:"expires_at"`
}

func defaultKimiCodeCredentialsPath() string {
	if home := strings.TrimSpace(os.Getenv("KIMI_CODE_HOME")); home != "" {
		return filepath.Join(home, "credentials", "kimi-code.json")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".kimi-code", "credentials", "kimi-code.json")
}

// readKimiCodeCredential returns the access token only while it is still
// valid. WheelMaker never refreshes OAuth tokens and never writes this file;
// kimi-cli refreshes it on its own runs.
func readKimiCodeCredential(path string, now time.Time) string {
	if strings.TrimSpace(path) == "" {
		return ""
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var creds kimiCodeCredentialsFile
	if json.Unmarshal(body, &creds) != nil {
		return ""
	}
	token := strings.TrimSpace(creds.AccessToken)
	if token == "" || creds.ExpiresAt <= now.Unix() {
		return ""
	}
	return token
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/hub/usage/ -run 'KimiCodeCredential|KimiCodeCredentialsPath' -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/hub/usage/kimi_code_auth.go server/internal/hub/usage/providers_test.go
git commit -m "feat(usage): read kimi-cli credentials without refresh"
```

---

### Task 5: Multi-source KimiScanner and collector wiring

**Files:**
- Modify: `server/internal/hub/usage/provider_kimi.go:14-48`
- Modify: `server/internal/hub/usage/local_collector.go:9-46`
- Test: `server/internal/hub/usage/providers_test.go` (update lines 32-45 and 176-182, append new test)

- [ ] **Step 1: Update existing tests and add the failing multi-account test**

In `server/internal/hub/usage/providers_test.go`, change `TestSnapshotJSONNeverContainsProviderCredential` (line 34) to:

```go
	scanner := NewKimiScanner([]KimiCredentialSource{{LocalID: "opencode", Label: "OpenCode", Credential: secret}}, &http.Client{}, "https://unused.invalid")
```

Change `TestKimiMissingCredentialIsUnavailable` (line 177) to:

```go
	scanner := NewKimiScanner(nil, &http.Client{}, "https://unused.invalid")
```

Append the new multi-account test:

```go
func TestKimiScannerReportsOneAccountPerCredentialSource(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"limits":[{"window":{"duration":300},"detail":{"limit":100,"used":25,"resetTime":"2026-07-20T20:00:00Z"}}],"usage":{"limit":1000,"remaining":750,"resetTime":"2026-07-27T00:00:00Z"}}`)
	}))
	defer server.Close()
	scanner := NewKimiScanner([]KimiCredentialSource{
		{LocalID: "opencode", Label: "OpenCode", Credential: "token-a"},
		{LocalID: "kimi-code", Label: "Kimi Code", Credential: "token-b"},
	}, server.Client(), server.URL)
	got := scanner.Scan(context.Background())
	if got.Status != ProviderOK || len(got.Accounts) != 2 {
		t.Fatalf("snapshot=%+v", got)
	}
	if got.Accounts[0].LocalID != "opencode" || got.Accounts[1].LocalID != "kimi-code" {
		t.Fatalf("account order=%q,%q", got.Accounts[0].LocalID, got.Accounts[1].LocalID)
	}
	if got.Accounts[1].Identity.Label != "Kimi Code" {
		t.Fatalf("kimi-code identity=%+v", got.Accounts[1].Identity)
	}
	if len(got.Accounts[0].Limits) != 2 || got.Accounts[0].Limits[0].RemainingPercent != 75 {
		t.Fatalf("limits=%+v", got.Accounts[0].Limits)
	}
}
```

Add `"fmt"` and `"net/http/httptest"` to the `providers_test.go` import block.

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/hub/usage/ -run 'TestKimi' -v`
Expected: FAIL — `KimiCredentialSource` undefined / signature mismatch.

- [ ] **Step 3: Refactor KimiScanner to credential sources**

Replace the top of `server/internal/hub/usage/provider_kimi.go` (type + constructor + Scan, lines 14-48) with:

```go
// KimiCredentialSource is one local credential origin feeding the Kimi
// usage endpoint. Each source becomes one account in the snapshot.
type KimiCredentialSource struct {
	LocalID    string
	Label      string
	Credential string
}

type KimiScanner struct {
	sources  []KimiCredentialSource
	client   *http.Client
	endpoint string
}

func NewKimiScanner(sources []KimiCredentialSource, client *http.Client, endpoint string) *KimiScanner {
	if client == nil {
		client = http.DefaultClient
	}
	if strings.TrimSpace(endpoint) == "" {
		endpoint = defaultKimiEndpoint
	}
	filtered := make([]KimiCredentialSource, 0, len(sources))
	for _, source := range sources {
		source.Credential = strings.TrimSpace(source.Credential)
		if source.Credential == "" {
			continue
		}
		filtered = append(filtered, source)
	}
	return &KimiScanner{sources: filtered, client: client, endpoint: endpoint}
}

func (s *KimiScanner) Scan(ctx context.Context) ProviderSnapshot {
	result := ProviderSnapshot{ID: ProviderKimi, Name: "Kimi", Accounts: []Account{}}
	if s == nil || len(s.sources) == 0 {
		result.Status, result.Message = ProviderUnavailable, "not authenticated"
		return result
	}
	for _, source := range s.sources {
		payload, message := fetchProviderJSON(ctx, s.client, s.endpoint, source.Credential)
		account := Account{LocalID: source.LocalID, Identity: Identity{Kind: "source", Label: source.Label}, Limits: []Limit{}}
		if message != "" {
			account.Status, account.Message = ProviderError, message
		} else if limits, err := parseKimiLimits(payload); err != nil {
			account.Status, account.Message = ProviderError, "invalid response"
		} else {
			account.Status, account.Limits = ProviderOK, limits
		}
		result.Accounts = append(result.Accounts, account)
	}
	result.Status = providerStatus(result.Accounts)
	return result
}
```

- [ ] **Step 4: Wire the kimi-code source into LocalCollector**

In `server/internal/hub/usage/local_collector.go`, add a field to `LocalCollector`:

```go
type LocalCollector struct {
	AuthPath                 string
	KimiCodeCredentialsPath  string
	Client                   *http.Client
	Binary                   string
	Timeout                  time.Duration
}
```

And replace the scanner construction in `Scan`:

```go
	kimiSources := make([]KimiCredentialSource, 0, 2)
	if credential := credentials[ProviderKimi]; credential != "" {
		kimiSources = append(kimiSources, KimiCredentialSource{LocalID: "opencode", Label: "OpenCode", Credential: credential})
	}
	kimiCodePath := c.KimiCodeCredentialsPath
	if kimiCodePath == "" {
		kimiCodePath = defaultKimiCodeCredentialsPath()
	}
	if credential := readKimiCodeCredential(kimiCodePath, time.Now()); credential != "" {
		kimiSources = append(kimiSources, KimiCredentialSource{LocalID: "kimi-code", Label: "Kimi Code", Credential: credential})
	}
	return (Collector{Scanners: []ProviderScanner{
		NewCodexScanner(c.Binary),
		NewKimiScanner(kimiSources, client, ""),
		NewZAIScanner(credentials[ProviderZAI], client, ""),
		NewDeepSeekScanner(credentials[ProviderDeepSeek], client, ""),
	}}).Scan(scanContext)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `go test ./internal/hub/usage/ -v`
Expected: PASS (all tests in the package, including updated ones).

- [ ] **Step 6: Commit**

```bash
git add server/internal/hub/usage/provider_kimi.go server/internal/hub/usage/local_collector.go server/internal/hub/usage/providers_test.go
git commit -m "feat(usage): report kimi limits per credential source"
```

---

### Task 6: Full verification and completion gate

- [ ] **Step 1: Server tests and build**

Run (workdir `server/`): `go test ./...`
Expected: PASS, no failures.

Run (workdir `server/`): `go build ./...`
Expected: exit 0.

- [ ] **Step 2: App typecheck and tests**

Run (workdir `app/`): `npm run tsc:web`
Expected: exit 0.

Run (workdir `app/`): `npx jest`
Expected: all suites pass.

- [ ] **Step 3: Completion gate (repo root CLAUDE.md)**

```bash
git add -A
git commit -m "chore: finalize kimi ACP provider integration" 
git push origin <current-branch>
```

If any step fails, fix and retry until resolved. Do not claim completion before push succeeds.

---

## Self-review notes

- Spec coverage: protocol const (Task 1), preset/factory/skills scan dirs (Task 2), npm list exclusion (no task — nothing to change), frontend tag (Task 3), credentials reader read-only + `KIMI_CODE_HOME` (Task 4), multi-account limits + collector wiring (Task 5), verification incl. completion gate (Task 6). Out-of-scope items (login flow, OAuth refresh, kimi-specific UI) have no tasks by design.
- Type consistency: `KimiCredentialSource`, `readKimiCodeCredential`, `defaultKimiCodeCredentialsPath`, `KimiACPProviderPreset`, `NewKimiProvider` are defined once and referenced with identical names across tasks.
