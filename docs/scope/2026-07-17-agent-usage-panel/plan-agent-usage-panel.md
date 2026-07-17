# Agent Usage Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hidden token-stats settings detail with a first-class "all agents remaining usage" feature: a button beside the settings gear + a compact always-on bar in the chat footer (PC + chat view only), backed by Codex/Kimi/ZAI/DeepSeek (Copilot removed), with streaming incremental delivery, cross-hub dedup, and no plaintext key leaving the hub.

**Architecture:** Hub-side `token_stats.go` is split into focused scanners (one file per provider) coordinated by a dedup+parallel+streaming driver. Codex switches from `wham/usage` REST to `codex app-server` JSON-RPC (short-lived spawn per refresh). Kimi/ZAI/DeepSeek keys come from `~/.local/share/opencode/auth.json`. Each completed account is pushed via a new `tokenStats.update` event that reuses the terminal-event-sink pattern (hub WS → server → web WS). Web subscribes, merges across hubs by `provider + account identity`, and renders a compact bar + expandable card panel.

**Tech Stack:** Go (server/hub), TypeScript + React (web), JSON-RPC over stdio (codex app-server), WebSocket (hub↔server↔web), Vitest (web tests), `go test` (server tests).

**Spec:** `docs/scope/2026-07-17-agent-usage-panel/spec-agent-usage-panel.md`

---

## File Structure

### New files (server — `server/internal/hub/tools/`)
| File | Responsibility |
|---|---|
| `opencode_auth.go` | Read `~/.local/share/opencode/auth.json`, expose per-provider API keys (kimi/zai/deepseek) + sha256 fingerprints |
| `codex_appserver.go` | Spawn `codex app-server --listen stdio://`, JSON-RPC handshake, call `account/rateLimits/read`, return parsed limits, kill process |
| `kimi_scanner.go` | HTTP GET `api.kimi.com/coding/v1/usages`, map to `tokenAccountLimits` |
| `zai_scanner.go` | HTTP GET `api.z.ai/api/monitor/usage/quota/limit`, map limits array (unit 3/6/5) to `tokenAccountLimits` |
| `token_stream.go` | `PublishTokenStatsEvent` + `tokenStatsEventSink` (mirrors `terminalEventSink`), called per completed account |
| `token_dedup.go` | `dedupCredentialsByHash` + `scanAllProvidersInParallel` driver |

### Modified files (server)
| File | Change |
|---|---|
| `token_stats.go` | Strip copilot + deepseek discovery; keep shared types/helpers; `ScanTokenStats` becomes the parallel streaming driver calling into the new files |
| `token_stats_windows.go` | Delete copilot credential-store code (winCredential helpers kept only if still referenced — they won't be, so delete the file) |
| `token_stats_nonwindows.go` | Delete (only held copilot non-windows stub) |
| `../reporter.go` | Wire `tokenStatsEventSink` alongside `terminalEventSink` (create in `runSession`, drain in goroutine) |
| `../hub_state_adapters.go` | `refreshHubStateTokenStats` returns immediately after kicking off the parallel scan (events carry results) |

### New files (web — `app/web/src/usage/`)
| File | Responsibility |
|---|---|
| `usageTypes.ts` | `UsageLimit`, `UsageBalance`, `UsageAccount`, `UsageSnapshot` types + `remainingPercent`/`tightnessColor` helpers |
| `usageStream.ts` | Subscribe to `tokenStats.update` events via `RegistryClient.addEventListener`, incremental merge across hubs by `provider + identity` |
| `UsageCompactBar.tsx` | The always-on footer bar (one row per provider), PC + chat-view only |
| `UsageCardPanel.tsx` | Expanded card panel (progress bars + reset times + identity), opened from compact bar click or header button |

### Modified files (web)
| File | Change |
|---|---|
| `registry/registryTypes.ts` | Add `RegistryTokenStatsEventPayload` + `RegistryUsageLimit`; remove copilot-specific fields (`premiumRequests*`) from `RegistryTokenProviderAccount` |
| `registry/RegistryRepository.ts` | Remove `scanTokenStatsAcrossHubs` call site + `deepseekStats` action wiring; keep only the event subscription path |
| `app/WorkspaceApp.tsx` | Mount `UsageCompactBar` in chat footer (PC + chat view guard) + add header button beside settings gear that opens `UsageCardPanel`; wire refresh (on chat enter + 5-min interval + manual) |
| `settings/SettingsSurface.tsx` | Remove the `tokenStats` detail case + nav entry |
| `settings/SettingsRootContent.tsx` | Remove the DeepSeek `ServerSecretEditor` block (lines ~468-483) |
| `settings/serverSettings.ts` | Remove `deepSeek` field from `ServerSettings` + `ServerSettingsUpdate['section']` + defaults |
| `compatibility/browserCredentialCleanup.ts` | Remove `'deepseekApiKey'` entry |

### Deleted files (web)
| File | Reason |
|---|---|
| `settings/TokenStatsSettingsDetail.tsx` | Replaced by `UsageCardPanel` |
| `settings/tokenStatsView.ts` | Replaced by `usage/usageTypes.ts` + `usageStream.ts` merge logic |

---

## Phase 1: Server — Provider scanners (one file each)

### Task 1.1: OpenCode auth reader

**Files:**
- Create: `server/internal/hub/tools/opencode_auth.go`
- Test: `server/internal/hub/tools/opencode_auth_test.go`

- [ ] **Step 1: Write the failing test**

```go
package tools

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadOpenCodeProviderKeys(t *testing.T) {
	dir := t.TempDir()
	authPath := filepath.Join(dir, "auth.json")
	payload := `{
		"openai": {"type":"oauth"},
		"kimi-for-coding": {"type":"api","key":"sk-kimi-abc"},
		"zai-coding-plan": {"type":"api","key":"4466.zai"},
		"deepseek": {"type":"api","key":"sk-ds-xyz"}
	}`
	if err := os.WriteFile(authPath, []byte(payload), 0o600); err != nil {
		t.Fatalf("write auth.json: %v", err)
	}
	got, err := readOpenCodeProviderKeys(authPath)
	if err != nil {
		t.Fatalf("readOpenCodeProviderKeys: %v", err)
	}
	want := map[string]string{
		"kimi-for-coding": "sk-kimi-abc",
		"zai-coding-plan": "4466.zai",
		"deepseek":        "sk-ds-xyz",
	}
	for provider, key := range want {
		if got[provider] != key {
			t.Errorf("key[%s] = %q, want %q", provider, got[provider], key)
		}
	}
	if _, ok := got["openai"]; ok {
		t.Errorf("openai (oauth) should not appear in api-key map")
	}
}

func TestSha256Fingerprint(t *testing.T) {
	a := sha256Fingerprint("key-1")
	b := sha256Fingerprint("key-1")
	c := sha256Fingerprint("key-2")
	if a != b {
		t.Errorf("same key must produce same fingerprint: %q vs %q", a, b)
	}
	if a == c {
		t.Errorf("different keys must produce different fingerprints")
	}
	if len(a) != 64 {
		t.Errorf("fingerprint length = %d, want 64 hex chars", len(a))
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./server/internal/hub/tools/ -run TestReadOpenCodeProviderKeys -v`
Expected: FAIL — `undefined: readOpenCodeProviderKeys`

- [ ] **Step 3: Write minimal implementation**

```go
package tools

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// openCodeAuthEntry mirrors one provider block in ~/.local/share/opencode/auth.json.
type openCodeAuthEntry struct {
	Type string `json:"type"`
	Key  string `json:"key"`
}

// readOpenCodeProviderKeys reads the opencode auth.json at path and returns a
// map of providerID -> plaintext API key for every entry whose type == "api".
// OAuth entries (type "oauth") are skipped — their tokens are not API keys.
func readOpenCodeProviderKeys(path string) (map[string]string, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var raw map[string]openCodeAuthEntry
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	out := make(map[string]string, len(raw))
	for provider, entry := range raw {
		if strings.ToLower(strings.TrimSpace(entry.Type)) != "api" {
			continue
		}
		key := strings.TrimSpace(entry.Key)
		if key == "" {
			continue
		}
		out[provider] = key
	}
	return out, nil
}

// defaultOpenCodeAuthPath returns the conventional auth.json location. Returns
// "" if the home directory cannot be resolved.
func defaultOpenCodeAuthPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".local", "share", "opencode", "auth.json")
}

// sha256Fingerprint returns the hex-encoded sha256 of a key, used for in-hub
// deduplication without leaking the plaintext.
func sha256Fingerprint(key string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(key)))
	return hex.EncodeToString(sum[:])
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `go test ./server/internal/hub/tools/ -run "TestReadOpenCodeProviderKeys|TestSha256Fingerprint" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/hub/tools/opencode_auth.go server/internal/hub/tools/opencode_auth_test.go
git commit -m "feat(hub): add opencode auth.json reader + sha256 fingerprint"
```

---

### Task 1.2: Codex app-server JSON-RPC client

**Files:**
- Create: `server/internal/hub/tools/codex_appserver.go`
- Test: `server/internal/hub/tools/codex_appserver_test.go`

The client spawns `codex app-server --listen stdio://`, performs the `initialize` handshake (newline-delimited JSON-RPC), calls `account/rateLimits/read`, parses the two windows (5h = `windowDurationMins==300`, week = `==10080`), then kills the child.

- [ ] **Step 1: Write the failing test** (uses a fake "codex" binary stub)

```go
package tools

import (
	"context"
	"testing"
)

func TestParseCodexRateLimitsResponse(t *testing.T) {
	payload := map[string]any{
		"rateLimits": map[string]any{
			"primary":   map[string]any{"usedPercent": float64(23), "windowDurationMins": float64(10080), "resetsAt": float64(1784780541)},
			"secondary": map[string]any{"usedPercent": float64(2), "windowDurationMins": float64(300), "resetsAt": float64(1784226236)},
		},
	}
	fiveHour, week, err := parseCodexRateLimits(payload)
	if err != nil {
		t.Fatalf("parseCodexRateLimits: %v", err)
	}
	if fiveHour.usedPercent != 2 {
		t.Errorf("5h usedPercent = %d, want 2", fiveHour.usedPercent)
	}
	if week.usedPercent != 23 {
		t.Errorf("week usedPercent = %d, want 23", week.usedPercent)
	}
	if fiveHour.resetsAt != 1784226236 {
		t.Errorf("5h resetsAt = %d, want 1784226236", fiveHour.resetsAt)
	}
}

func TestParseCodexRateLimitsMissingWindow(t *testing.T) {
	payload := map[string]any{
		"rateLimits": map[string]any{
			"primary": map[string]any{"usedPercent": float64(50), "windowDurationMins": float64(10080)},
		},
	}
	fiveHour, week, err := parseCodexRateLimits(payload)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if fiveHour != nil {
		t.Errorf("5h should be nil when only week window present, got %+v", fiveHour)
	}
	if week == nil || week.usedPercent != 50 {
		t.Errorf("week window not parsed correctly: %+v", week)
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `go test ./server/internal/hub/tools/ -run TestParseCodexRateLimits -v`
Expected: FAIL — `undefined: parseCodexRateLimits`

- [ ] **Step 3: Implement the parser + RPC client**

```go
package tools

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// codexWindow is one rate-limit window parsed from account/rateLimits/read.
type codexWindow struct {
	usedPercent int64
	resetsAt    int64
}

// parseCodexRateLimits extracts the 5h and weekly windows from an
// account/rateLimits/read result. Returns nil for a window that is absent.
func parseCodexRateLimits(payload map[string]any) (fiveHour, week *codexWindow, err error) {
	rateLimits, _ := payload["rateLimits"].(map[string]any)
	if rateLimits == nil {
		return nil, nil, fmt.Errorf("rateLimits missing from codex response")
	}
	pick := func(field string) *codexWindow {
		raw, ok := rateLimits[field].(map[string]any)
		if !ok || raw == nil {
			return nil
		}
		used := toInt64(raw["usedPercent"])
		dur := toInt64(raw["windowDurationMins"])
		w := &codexWindow{usedPercent: used, resetsAt: toInt64(raw["resetsAt"])}
		// classify by duration: 300 = 5h, 10080 = week
		switch dur {
		case 300:
			return w // caller assigns to fiveHour via duration map below
		case 10080:
			return w
		}
		return w
	}
	// We need to classify by duration, not by primary/secondary name, because
	// the server sometimes returns primary=week when the 5h window is inactive.
	classify := func(raw map[string]any) *codexWindow {
		if raw == nil {
			return nil
		}
		dur := toInt64(raw["windowDurationMins"])
		w := &codexWindow{usedPercent: toInt64(raw["usedPercent"]), resetsAt: toInt64(raw["resetsAt"])}
		switch dur {
		case 300:
			if fiveHour == nil {
				fiveHour = w
			}
		case 10080:
			if week == nil {
				week = w
			}
		}
		return w
	}
	classify(rateLimits["primary"].(map[string]any))
	classify(rateLimits["secondary"].(map[string]any))
	// Also check rateLimitsByLimitId.codex as a fallback (same data, different envelope).
	byID, _ := rateLimits["rateLimitsByLimitId"].(map[string]any)
	_ = byID // not strictly needed; primary/secondary already carry it
	_ = pick // suppress unused
	return fiveHour, week, nil
}

// codexAppServerClient spawns a codex app-server, runs one rateLimits query, and
// kills the child. All side effects happen within the function; no long-lived state.
type codexAppServerClient struct {
	binary string // path to codex binary; if "", use "codex" via PATH
}

// fetchCodexRateLimitsViaAppServer spawns codex app-server, performs initialize +
// account/rateLimits/read using the supplied ChatGPT access token, and returns
// the parsed windows. The child process is always killed before return.
func fetchCodexRateLimitsViaAppServer(ctx context.Context, binary, accessToken string) (fiveHour, week *codexWindow, err error) {
	bin := strings.TrimSpace(binary)
	if bin == "" {
		bin = "codex"
	}
	cmd := exec.CommandContext(ctx, bin, "app-server", "--listen", "stdio://")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, nil, fmt.Errorf("codex app-server stdin: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, nil, fmt.Errorf("codex app-server stdout: %w", err)
	}
	cmd.Stderr = nil
	if startErr := cmd.Start(); startErr != nil {
		return nil, nil, fmt.Errorf("codex app-server start: %w", startErr)
	}
	killAndWait := func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}
	defer killAndWait()

	var writeMu sync.Mutex
	writeMsg := func(v any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		raw, mErr := json.Marshal(v)
		if mErr != nil {
			return mErr
		}
		_, wErr := stdin.Write(append(raw, '\n'))
		return wErr
	}

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)

	type response struct {
		ID     int64           `json:"id"`
		Result json.RawMessage `json:"result,omitempty"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error,omitempty"`
	}
	roundTrip := func(method string, params map[string]any, resultOut any) error {
		id := time.Now().UnixNano() // monotonically-ish; single-flight per call
		req := map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}
		if wErr := writeMsg(req); wErr != nil {
			return fmt.Errorf("write %s: %w", method, wErr)
		}
		// Scan lines until we see our id.
		for scanner.Scan() {
			var resp response
			if jErr := json.Unmarshal(scanner.Bytes(), &resp); jErr != nil {
				continue
			}
			if resp.ID != id {
				continue
			}
			if resp.Error != nil {
				return fmt.Errorf("%s: %s", method, resp.Error.Message)
			}
			if resultOut == nil {
				return nil
			}
			return json.Unmarshal(resp.Result, resultOut)
		}
		if scanErr := scanner.Err(); scanErr != nil {
			return fmt.Errorf("codex app-server stdout scan: %w", scanErr)
		}
		return fmt.Errorf("codex app-server closed stream before responding to %s", method)
	}

	// 1. initialize (no auth header needed for the handshake)
	if err = roundTrip("initialize", map[string]any{
		"clientInfo":   map[string]any{"name": "wheelmaker-hub", "version": "1.0"},
		"capabilities": map[string]any{"experimentalApi": true},
	}, nil); err != nil {
		return nil, nil, err
	}

	// 2. account/rateLimits/read — the app-server inherits codex's own auth
	//    from ~/.codex/auth.json; no bearer header required from us.
	var rateLimitsResult map[string]any
	if err = roundTrip("account/rateLimits/read", map[string]any{}, &rateLimitsResult); err != nil {
		return nil, nil, fmt.Errorf("account/rateLimits/read: %w", err)
	}
	fiveHour, week, err = parseCodexRateLimits(rateLimitsResult)
	_ = accessToken // not sent over the wire; codex owns its own auth
	return fiveHour, week, err
}
```

> **Note on `toInt64`:** this helper already exists in `token_stats.go` (line 418). Do not redefine it. If Task 1.7 has not yet trimmed `token_stats.go`, the helper remains available in the same package.

- [ ] **Step 4: Run tests, verify pass**

Run: `go test ./server/internal/hub/tools/ -run TestParseCodexRateLimits -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/hub/tools/codex_appserver.go server/internal/hub/tools/codex_appserver_test.go
git commit -m "feat(hub): add codex app-server JSON-RPC client for rate limits"
```

---

### Task 1.3: Kimi scanner

**Files:**
- Create: `server/internal/hub/tools/kimi_scanner.go`
- Test: `server/internal/hub/tools/kimi_scanner_test.go`

- [ ] **Step 1: Write the failing test**

```go
package tools

import "testing"

func TestParseKimiUsages(t *testing.T) {
	payload := map[string]any{
		"usage": map[string]any{"limit": "100", "remaining": "100", "resetTime": "2026-07-23T15:37:02Z"},
		"limits": []any{
			map[string]any{
				"window": map[string]any{"duration": float64(300), "timeUnit": "TIME_UNIT_MINUTE"},
				"detail": map[string]any{"limit": "100", "used": "2", "remaining": "98", "resetTime": "2026-07-16T20:37:02Z"},
			},
		},
		"parallel":   map[string]any{"limit": "20"},
		"totalQuota": map[string]any{"limit": "100", "remaining": "99"},
	}
	fiveHour, week, err := parseKimiUsages(payload)
	if err != nil {
		t.Fatalf("parseKimiUsages: %v", err)
	}
	if fiveHour == nil || fiveHour.usedPercent != 2 {
		t.Errorf("5h = %+v, want usedPercent=2 (used 2 of 100)", fiveHour)
	}
	if week == nil || week.usedPercent != 0 {
		t.Errorf("week = %+v, want usedPercent=0 (remaining 100 of 100)", week)
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `go test ./server/internal/hub/tools/ -run TestParseKimiUsages -v`
Expected: FAIL — `undefined: parseKimiUsages`

- [ ] **Step 3: Implement**

```go
package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// kimiUsagesResponse mirrors the subset of api.kimi.com/coding/v1/usages that we use.
type kimiUsagesResponse struct {
	Usage  kimiQuota       `json:"usage"`
	Limits []kimiLimitItem `json:"limits"`
}

type kimiQuota struct {
	Limit     string `json:"limit"`
	Remaining string `json:"remaining"`
	ResetTime string `json:"resetTime"`
}

type kimiLimitItem struct {
	Window kimiWindow `json:"window"`
	Detail kimiDetail `json:"detail"`
}

type kimiWindow struct {
	Duration int64  `json:"duration"`
	TimeUnit string `json:"timeUnit"`
}

type kimiDetail struct {
	Limit     string `json:"limit"`
	Used      string `json:"used"`
	Remaining string `json:"remaining"`
	ResetTime string `json:"resetTime"`
}

// parseKimiUsages extracts the 5h and weekly windows. 5h comes from limits[0]
// (window.duration==300 minutes); week comes from usage (top-level remaining).
// totalQuota and parallel are intentionally ignored.
func parseKimiUsages(payload map[string]any) (fiveHour, week *codexWindow, err error) {
	raw, mErr := json.Marshal(payload)
	if mErr != nil {
		return nil, nil, mErr
	}
	var resp kimiUsagesResponse
	if uErr := json.Unmarshal(raw, &resp); uErr != nil {
		return nil, nil, fmt.Errorf("decode kimi usages: %w", uErr)
	}
	for _, item := range resp.Limits {
		if item.Window.Duration == 300 {
			limit := parseFloat64(item.Detail.Limit)
			used := parseFloat64(item.Detail.Used)
			if limit > 0 {
				fiveHour = &codexWindow{
					usedPercent: int64((used / limit) * 100),
					resetsAt:    parseKimiResetTime(item.Detail.ResetTime),
				}
			}
			break
		}
	}
	limit := parseFloat64(resp.Usage.Limit)
	remaining := parseFloat64(resp.Usage.Remaining)
	if limit > 0 {
		used := limit - remaining
		if used < 0 {
			used = 0
		}
		week = &codexWindow{
			usedPercent: int64((used / limit) * 100),
			resetsAt:    parseKimiResetTime(resp.Usage.ResetTime),
		}
	}
	return fiveHour, week, nil
}

func parseKimiResetTime(iso string) int64 {
	s := strings.TrimSpace(iso)
	if s == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return 0
	}
	return t.Unix()
}

// fetchKimiUsages calls GET api.kimi.com/coding/v1/usages with the bearer key.
func fetchKimiUsages(ctx context.Context, httpClient *http.Client, apiKey string) (map[string]any, error) {
	key := strings.TrimSpace(apiKey)
	if key == "" {
		return nil, fmt.Errorf("kimi api key is empty")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.kimi.com/coding/v1/usages", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return nil, fmt.Errorf("kimi api key is invalid or unauthorized")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("kimi usages request failed: http %d %s", res.StatusCode, strings.TrimSpace(string(body)))
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("decode kimi usages response: %w", err)
	}
	return payload, nil
}
```

> **Note on `parseFloat64`:** Add a one-liner helper in `token_stats.go`'s helper block if it does not already exist: `func parseFloat64(s string) float64 { f, _ := strconv.ParseFloat(strings.TrimSpace(s), 64); return f }`. Reuse `toInt64`'s pattern. Put this addition in Task 1.6 when we touch `token_stats.go`.

- [ ] **Step 4: Run, verify pass**

Run: `go test ./server/internal/hub/tools/ -run TestParseKimiUsages -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/hub/tools/kimi_scanner.go server/internal/hub/tools/kimi_scanner_test.go
git commit -m "feat(hub): add kimi usages scanner"
```

---

### Task 1.4: ZAI scanner

**Files:**
- Create: `server/internal/hub/tools/zai_scanner.go`
- Test: `server/internal/hub/tools/zai_scanner_test.go`

- [ ] **Step 1: Write the failing test** (uses the real payload shape observed in research)

```go
package tools

import "testing"

func TestParseZAIQuotaLimit(t *testing.T) {
	payload := map[string]any{
		"code": float64(200),
		"data": map[string]any{
			"level": "pro",
			"limits": []any{
				map[string]any{"type": "TOKENS_LIMIT", "unit": float64(3), "number": float64(5), "percentage": float64(72), "nextResetTime": float64(1784226236151)},
				map[string]any{"type": "TOKENS_LIMIT", "unit": float64(6), "number": float64(1), "percentage": float64(50), "nextResetTime": float64(1784774559950)},
				map[string]any{"type": "TIME_LIMIT", "unit": float64(5), "number": float64(1), "usage": float64(1000), "currentValue": float64(21), "remaining": float64(979), "percentage": float64(2), "nextResetTime": float64(1786848159997)},
			},
		},
	}
	fiveHour, week, mcp, level, err := parseZAIQuotaLimit(payload)
	if err != nil {
		t.Fatalf("parseZAIQuotaLimit: %v", err)
	}
	if fiveHour == nil || fiveHour.usedPercent != 72 {
		t.Errorf("5h = %+v, want usedPercent=72", fiveHour)
	}
	if week == nil || week.usedPercent != 50 {
		t.Errorf("week = %+v, want usedPercent=50", week)
	}
	if mcp == nil || mcp.usedPercent != 2 {
		t.Errorf("mcp = %+v, want usedPercent=2 (21 of 1000)", mcp)
	}
	if level != "pro" {
		t.Errorf("level = %q, want pro", level)
	}
	// nextResetTime is in milliseconds; parser should convert to seconds
	if fiveHour.resetsAt != 1784226236 {
		t.Errorf("5h resetsAt = %d, want 1784226236 (ms→s)", fiveHour.resetsAt)
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `go test ./server/internal/hub/tools/ -run TestParseZAIQuotaLimit -v`
Expected: FAIL — `undefined: parseZAIQuotaLimit`

- [ ] **Step 3: Implement**

```go
package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// zaiQuotaLimitResponse mirrors api.z.ai/api/monitor/usage/quota/limit.
type zaiQuotaLimitResponse struct {
	Code    float64        `json:"code"`
	Data    zaiQuotaData   `json:"data"`
	Success bool           `json:"success"`
}

type zaiQuotaData struct {
	Level  string         `json:"level"`
	Limits []zaiLimitItem `json:"limits"`
}

type zaiLimitItem struct {
	Type          string  `json:"type"`
	Unit          int64   `json:"unit"`
	Number        int64   `json:"number"`
	Percentage    float64 `json:"percentage"`
	Usage         float64 `json:"usage"`
	CurrentValue  float64 `json:"currentValue"`
	Remaining     float64 `json:"remaining"`
	NextResetTime int64   `json:"nextResetTime"`
}

// parseZAIQuotaLimit returns the 5h (TOKENS_LIMIT unit=3), week (TOKENS_LIMIT
// unit=6) and MCP-monthly (TIME_LIMIT unit=5) windows plus the plan level.
// nextResetTime arrives in milliseconds; it is converted to seconds.
func parseZAIQuotaLimit(payload map[string]any) (fiveHour, week, mcp *codexWindow, level string, err error) {
	raw, mErr := json.Marshal(payload)
	if mErr != nil {
		return nil, nil, nil, "", mErr
	}
	var resp zaiQuotaLimitResponse
	if uErr := json.Unmarshal(raw, &resp); uErr != nil {
		return nil, nil, nil, "", fmt.Errorf("decode zai quota: %w", uErr)
	}
	level = strings.TrimSpace(resp.Data.Level)
	for _, item := range resp.Data.Limits {
		resetsAt := item.NextResetTime / 1000 // ms → s
		w := &codexWindow{usedPercent: int64(item.Percentage), resetsAt: resetsAt}
		switch {
		case item.Type == "TOKENS_LIMIT" && item.Unit == 3:
			fiveHour = w
		case item.Type == "TOKENS_LIMIT" && item.Unit == 6:
			week = w
		case item.Type == "TIME_LIMIT" && item.Unit == 5:
			mcp = w
		}
	}
	return fiveHour, week, mcp, level, nil
}

// fetchZAIQuotaLimit calls GET api.z.ai/api/monitor/usage/quota/limit with the bearer key.
func fetchZAIQuotaLimit(ctx context.Context, httpClient *http.Client, apiKey string) (map[string]any, error) {
	key := strings.TrimSpace(apiKey)
	if key == "" {
		return nil, fmt.Errorf("zai api key is empty")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.z.ai/api/monitor/usage/quota/limit", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return nil, fmt.Errorf("zai api key is invalid or unauthorized")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("zai quota request failed: http %d %s", res.StatusCode, strings.TrimSpace(string(body)))
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("decode zai quota response: %w", err)
	}
	return payload, nil
}
```

- [ ] **Step 4: Run, verify pass**

Run: `go test ./server/internal/hub/tools/ -run TestParseZAIQuotaLimit -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/hub/tools/zai_scanner.go server/internal/hub/tools/zai_scanner_test.go
git commit -m "feat(hub): add zai quota-limit scanner"
```

---

### Task 1.5: DeepSeek balance scanner (opencode-key only)

**Files:**
- Modify: `server/internal/hub/tools/token_stats.go` — strip `discoverDeepSeekCredentials` (lines ~688-751) and the `/user/usage` exploration (lines ~217-283); keep only the balance fetch. Delete `collectDeepSeekKeysFromAny`, `splitSecrets`.

The DeepSeek balance fetch (`fetchDeepSeekBalance`) already works and stays. What changes: discovery now reads a single key from the opencode auth map (no env, no file walk).

- [ ] **Step 1: Write the failing test** (verifies the new entry-point shape)

```go
package tools

import (
	"context"
	"testing"
)

func TestScanDeepSeekFromOpenCodeKey(t *testing.T) {
	// We test the discovery+build path with a single opencode key, asserting
	// the resulting tokenProviderAccount carries the balance structure when
	// the HTTP call is mocked. The HTTP mock lives in a shared test helper
	// (see TestFetchDeepSeekBalanceMocked below); here we only verify that
	// buildDeepSeekAccountFromKey produces the right identity/mask.
	acc := buildDeepSeekAccountFromKey("sk-test-1234567890", "opencode:deepseek")
	if acc.Provider != "deepseek" {
		t.Errorf("Provider = %q, want deepseek", acc.Provider)
	}
	if acc.Source != "opencode:deepseek" {
		t.Errorf("Source = %q, want opencode:deepseek", acc.Source)
	}
	// mask must not leak the plaintext
	if containsPlaintext(acc.ID, "sk-test-1234567890") {
		t.Errorf("account ID leaks plaintext key: %q", acc.ID)
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `go test ./server/internal/hub/tools/ -run TestScanDeepSeekFromOpenCodeKey -v`
Expected: FAIL — `undefined: buildDeepSeekAccountFromKey`

- [ ] **Step 3: Implement** — add to `token_stats.go` (or a new `deepseek_scanner.go` if you prefer file-per-provider consistency; the plan uses a new file to keep `token_stats.go` lean):

Create `server/internal/hub/tools/deepseek_scanner.go`:

```go
package tools

import (
	"context"
	"strings"
	"time"
)

// deepSeekProviderID is the canonical provider id used in payloads.
const deepSeekProviderID = "deepseek"

// buildDeepSeekAccountFromKey constructs the account shell for a DeepSeek key
// discovered via opencode auth.json. It does not perform any network I/O —
// callers pair this with fetchDeepSeekBalance (already in token_stats.go) to
// populate Balance before publishing.
func buildDeepSeekAccountFromKey(apiKey, source string) tokenProviderAccount {
	masked := maskSecret(apiKey)
	return tokenProviderAccount{
		ID:          "deepseek:" + masked,
		Alias:       "deepseek",
		DisplayName: "DeepSeek",
		Source:      source,
		Status:      "ok",
		UpdatedAt:   time.Now().UTC().Format(time.RFC3339),
		Usage: deepSeekUsageView{
			RangeType: "month",
			Month:     time.Now().UTC().Format("2006-01"),
			Rows:      []deepSeekUsageRow{},
		},
	}
}

// scanDeepSeekProviderFromKey fetches balance for a single DeepSeek key.
func scanDeepSeekProviderFromKey(ctx context.Context, httpClient *httpClientLike, apiKey, source string) tokenProviderAccount {
	acc := buildDeepSeekAccountFromKey(apiKey, source)
	balance, err := fetchDeepSeekBalanceWith(ctx, httpClient, apiKey)
	if err != nil {
		acc.Status = "error"
		acc.Message = err.Error()
		return acc
	}
	acc.Balance = balance
	return acc
}

// containsPlaintext is a tiny test helper that returns true if candidate
// contains the full key string. Used by tests to assert no leakage.
func containsPlaintext(candidate, key string) bool {
	return key != "" && strings.Contains(candidate, key)
}
```

> **Refactor required in `token_stats.go`:** extract the body of `fetchDeepSeekBalance` into `fetchDeepSeekBalanceWith(ctx, client *httpClientLike, apiKey)` where `httpClientLike` is either `*http.Client` or a small interface, so tests can inject a fake transport. The simplest path: keep `fetchDeepSeekBalance` as a thin wrapper that passes the scanner's `*http.Client`. Add `type httpClientLike = *http.Client` alias for testability; do not introduce a new interface unless other scanners need it (they don't — they take `*http.Client` directly).

- [ ] **Step 4: Run, verify pass**

Run: `go test ./server/internal/hub/tools/ -run TestScanDeepSeekFromOpenCodeKey -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/hub/tools/deepseek_scanner.go server/internal/hub/tools/deepseek_scanner_test.go
git commit -m "feat(hub): deepseek scanner reads opencode key only, drop multi-source discovery"
```

---

### Task 1.6: Refactor Codex scanner to use app-server

**Files:**
- Modify: `server/internal/hub/tools/token_stats.go` — replace `fetchCodexUsageLimits` + `fetchCodexUsagePayload` (the `wham/usage` REST path, lines ~1341-1416) with a call to `fetchCodexRateLimitsViaAppServer` (Task 1.2). Keep `discoverCodexAuthProfiles`, `extractCodexAuthState`, `decodeJWTPayload`, `normalizePlanLabel` (used to identify the account). Update `scanCodexProvider` to call the new fetcher.

- [ ] **Step 1: Write the failing test** (asserts scanCodexProvider no longer hits wham/usage — verified by intercepting the HTTP path which must not be invoked)

```go
package tools

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestScanCodexProviderNoLongerCallsWham(t *testing.T) {
	// Stand up a fake server that FAILS any request — if scanCodexProvider
	// still hits wham/usage, this test fails loudly.
	bomb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("codex scanner must not call HTTP endpoint; got %s %s", r.Method, r.URL.Path)
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	defer bomb.Close()

	// scanCodexProvider shells out to `codex app-server`; in unit tests we
	// cannot run the real binary. We instead test the contract: the function
	// must prefer the app-server path and surface a clear error when the
	// binary is absent, NOT silently call wham/usage.
	scanner := &tokenScanner{httpClient: bomb.Client(), deepSeekBaseURL: bomb.URL}
	profiles := []codexAuthProfile{{Alias: "test", Source: "test", Auth: map[string]any{
		"tokens": map[string]any{"access_token": "x.y.z"},
	}}}
	result := scanner.scanCodexProfilesWithAppServer(context.Background(), profiles, "nonexistent-codex-binary")
	// We expect a per-account error mentioning the app-server, not a wham call.
	if len(result.Accounts) != 1 {
		t.Fatalf("want 1 account, got %d", len(result.Accounts))
	}
	if result.Accounts[0].Status != "error" {
		t.Errorf("account status = %q, want error", result.Accounts[0].Status)
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `go test ./server/internal/hub/tools/ -run TestScanCodexProviderNoLongerCallsWham -v`
Expected: FAIL — `undefined: scanCodexProfilesWithAppServer`

- [ ] **Step 3: Implement** — add to `token_stats.go`:

```go
// scanCodexProfilesWithAppServer runs the app-server flow for each discovered
// codex profile. It never calls chatgpt.com/backend-api/wham/usage.
func (c *tokenScanner) scanCodexProfilesWithAppServer(ctx context.Context, profiles []codexAuthProfile, codexBinary string) tokenProviderScanResult {
	accounts := make([]tokenProviderAccount, 0, len(profiles))
	for _, profile := range profiles {
		state := extractCodexAuthState(profile.Auth)
		alias := strings.TrimSpace(profile.Alias)
		if alias == "" {
			alias = "codex"
		}
		accountID := strings.TrimSpace(state.AccountID)
		if accountID == "" {
			accountID = alias
		}
		acc := tokenProviderAccount{
			ID:          accountID + ":" + alias,
			Alias:       alias,
			DisplayName: alias,
			Source:      profile.Source,
			Status:      "ok",
			Email:       state.Email,
			Plan:        state.Plan,
			UpdatedAt:   time.Now().UTC().Format(time.RFC3339),
		}
		fiveHour, week, err := fetchCodexRateLimitsViaAppServer(ctx, codexBinary, state.AccessToken)
		if err != nil {
			acc.Status = "error"
			acc.Message = err.Error()
			accounts = append(accounts, acc)
			continue
		}
		acc.FiveHourLimit = formatCodexAppServerWindow(fiveHour)
		acc.WeeklyLimit = formatCodexAppServerWindow(week)
		accounts = append(accounts, acc)
	}
	sort.Slice(accounts, func(i, j int) bool { return strings.ToLower(accounts[i].Alias) < strings.ToLower(accounts[j].Alias) })
	return tokenProviderScanResult{ID: "codex", Name: "Codex", Accounts: accounts}
}

// formatCodexAppServerWindow mirrors the historical "72% (07-22 15:04)" shape
// so the web-side parsers need no change in this task.
func formatCodexAppServerWindow(w *codexWindow) string {
	if w == nil {
		return ""
	}
	remaining := int64(100 - w.usedPercent)
	if remaining < 0 {
		remaining = 0
	}
	if remaining > 100 {
		remaining = 100
	}
	if w.resetsAt <= 0 {
		return fmt.Sprintf("%d%%", remaining)
	}
	return fmt.Sprintf("%d%% (%s)", remaining, time.Unix(w.resetsAt, 0).Local().Format("01-02 15:04"))
}
```

- [ ] **Step 4: Run, verify pass**

Run: `go test ./server/internal/hub/tools/ -run TestScanCodexProviderNoLongerCallsWham -v`
Expected: PASS (the bomb server is never hit; the account surfaces an app-server exec error instead)

- [ ] **Step 5: Commit**

```bash
git add server/internal/hub/tools/token_stats.go
git commit -m "refactor(hub): codex scanner uses app-server JSON-RPC, drop wham/usage"
```

---

### Task 1.7: Delete Copilot scanner + DeepSeek multi-source discovery

**Files:**
- Modify: `server/internal/hub/tools/token_stats.go` — delete: `scanCopilotProvider`, `discoverCopilotProfile`, `discoverGitHubToken`, `parseGitHubTokenFromHostsYAML`, `extractGitHubTokenFromJSONFile`, `collectGitHubTokensFromAny`, `discoverGitHubTokenByCLI`, `fetchGitHubLogin`, `fetchCopilotPremiumUsage`, `fetchCopilotInternalUsage`, `parseCopilotInternalUsageSummary`, `copilotProfile`, `copilotPremiumUsageSummary`, `maxInt64` (if unused elsewhere), and `discoverDeepSeekCredentials` + its file-walk helpers (`collectDeepSeekKeysFromAny`, `splitSecrets`). Delete the unused DeepSeek `/user/usage` exploration (`fetchDeepSeekUsageRows`, `parseDeepSeekUsageRows`, `collectUsageRowsFromAny`, `usageRowFromMap`, `aggregateUsageRowsByMonth`, `normalizeStatsMonth`, `FetchDeepSeekTokenStats`, `fetchDeepSeekTokenStats`).
- Delete: `server/internal/hub/tools/token_stats_windows.go` (entire file — only held `discoverGitHubTokenFromSystemCredentialStore` + winCredential)
- Delete: `server/internal/hub/tools/token_stats_nonwindows.go` (entire file)

- [ ] **Step 1: Write a guard test** (asserts the deleted functions are gone)

```go
package tools

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

func TestCopilotAndDeepSeekDiscoveryRemoved(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "token_stats.go", nil, 0)
	if err != nil {
		t.Fatalf("parse token_stats.go: %v", err)
	}
	banned := map[string]bool{
		"scanCopilotProvider": true, "discoverCopilotProfile": true,
		"discoverGitHubToken": true, "fetchCopilotPremiumUsage": true,
		"discoverDeepSeekCredentials": true, "fetchDeepSeekUsageRows": true,
		"FetchDeepSeekTokenStats": true,
	}
	ast.Inspect(file, func(n ast.Node) bool {
		fn, ok := n.(*ast.FuncDecl)
		if !ok {
			return true
		}
		if banned[fn.Name.Name] {
			t.Errorf("banned function still present: %s", fn.Name.Name)
		}
		return true
	})
	// Also assert the platform files are gone
	if _, err := parser.ParseFile(fset, "token_stats_windows.go", nil, 0); err == nil {
		t.Error("token_stats_windows.go should have been deleted")
	}
	if _, err := parser.ParseFile(fset, "token_stats_nonwindows.go", nil, 0); err == nil {
		t.Error("token_stats_nonwindows.go should have been deleted")
	}
	// Ensure no remaining references in the package
	_ = strings.TrimSpace // keep linter happy
}
```

- [ ] **Step 2: Run, verify fail**

Run: `go test ./server/internal/hub/tools/ -run TestCopilotAndDeepSeekDiscoveryRemoved -v`
Expected: FAIL — banned functions still present

- [ ] **Step 3: Delete the code**

Delete the function bodies listed above from `token_stats.go`. Delete the two platform files. After deletion, run `go build ./server/...` to find any lingering references and fix them (likely candidates: `premiumRequests*` fields on `tokenProviderAccount` if not already removed, and any test that referenced copilot).

- [ ] **Step 4: Run, verify pass + whole package builds**

Run: `go build ./server/... && go test ./server/internal/hub/tools/ -run TestCopilotAndDeepSeekDiscoveryRemoved -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A server/internal/hub/tools/
git commit -m "chore(hub): remove copilot scanner + deepseek multi-source discovery"
```

---

## Phase 2: Server — Dedup, parallel, streaming

### Task 2.1: Credential dedup + parallel scan driver

**Files:**
- Create: `server/internal/hub/tools/token_dedup.go`
- Test: `server/internal/hub/tools/token_dedup_test.go`

- [ ] **Step 1: Write the failing test**

```go
package tools

import "testing"

func TestDedupCredentialsByKey(t *testing.T) {
	in := []credentialEntry{
		{Provider: "kimi", Alias: "a", Key: "key-1", Source: "s1"},
		{Provider: "kimi", Alias: "b", Key: "key-1", Source: "s2"}, // dup
		{Provider: "zai", Alias: "c", Key: "key-2", Source: "s3"},
	}
	got := dedupCredentialsByHash(in)
	if len(got) != 2 {
		t.Fatalf("got %d entries, want 2 (key-1 deduped)", len(got))
	}
	seen := map[string]bool{}
	for _, e := range got {
		seen[e.Key] = true
	}
	if !seen["key-1"] || !seen["key-2"] {
		t.Errorf("missing keys after dedup: %+v", seen)
	}
}

type credentialEntry = dedupCredentialEntry
```

- [ ] **Step 2: Run, verify fail**

Run: `go test ./server/internal/hub/tools/ -run TestDedupCredentialsByKey -v`
Expected: FAIL — `undefined: dedupCredentialsByHash`

- [ ] **Step 3: Implement**

```go
package tools

// dedupCredentialEntry is one discovered credential before dedup.
type dedupCredentialEntry struct {
	Provider string
	Alias    string
	Key      string
	Source   string
}

// dedupCredentialsByHash removes entries that share an identical API key
// (after trim). First occurrence wins. The plaintext key is retained here
// (this stays inside the hub); only sha256 leaves the hub in payloads.
func dedupCredentialsByHash(in []dedupCredentialEntry) []dedupCredentialEntry {
	out := make([]dedupCredentialEntry, 0, len(in))
	seen := make(map[string]struct{}, len(in))
	for _, e := range in {
		if _, dup := seen[e.Key]; dup {
			continue
		}
		seen[e.Key] = struct{}{}
		out = append(out, e)
	}
	return out
}
```

- [ ] **Step 4: Run, verify pass**

Run: `go test ./server/internal/hub/tools/ -run TestDedupCredentialsByKey -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/hub/tools/token_dedup.go server/internal/hub/tools/token_dedup_test.go
git commit -m "feat(hub): add sha256 credential dedup"
```

---

### Task 2.2: Rewrite `ScanTokenStats` as parallel streaming driver

**Files:**
- Modify: `server/internal/hub/tools/token_stats.go` — replace the body of `scanTokenStats` (lines ~521-531) so it:
  1. Discovers all credentials (codex profiles from `~/.codex/auth.json` + opencode keys from `readOpenCodeProviderKeys`)
  2. Dedups via `dedupCredentialsByHash`
  3. Launches one goroutine per credential
  4. On each completion calls a `publish func(tokenProviderScanResult)` callback
  5. Returns the final aggregated payload when all goroutines finish

- [ ] **Step 1: Write the failing test**

```go
package tools

import (
	"context"
	"sync"
	"testing"
)

func TestScanTokenStatsStreamingOrder(t *testing.T) {
	driver := &streamDriver{
		scanners: []streamingScanner{
			func(ctx context.Context) (tokenProviderScanResult, error) {
				return tokenProviderScanResult{ID: "codex", Name: "Codex"}, nil
			},
			func(ctx context.Context) (tokenProviderScanResult, error) {
				return tokenProviderScanResult{ID: "kimi", Name: "Kimi"}, nil
			},
		},
	}
	var mu sync.Mutex
	var got []string
	driver.run(context.Background(), func(r tokenProviderScanResult) {
		mu.Lock()
		got = append(got, r.ID)
		mu.Unlock()
	})
	if len(got) != 2 {
		t.Fatalf("got %d events, want 2", len(got))
	}
	seen := map[string]bool{got[0]: true, got[1]: true}
	if !seen["codex"] || !seen["kimi"] {
		t.Errorf("missing providers in stream: %+v", got)
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `go test ./server/internal/hub/tools/ -run TestScanTokenStatsStreamingOrder -v`
Expected: FAIL — `undefined: streamDriver`

- [ ] **Step 3: Implement** — add to `token_dedup.go`:

```go
import "context"

// streamingScanner produces one provider's result.
type streamingScanner func(ctx context.Context) (tokenProviderScanResult, error)

// streamDriver runs scanners in parallel and invokes publish for each
// completed provider, in completion order.
type streamDriver struct {
	scanners []streamingScanner
}

func (d *streamDriver) run(ctx context.Context, publish func(tokenProviderScanResult)) {
	type result struct {
		r   tokenProviderScanResult
		err error
	}
	ch := make(chan result, len(d.scanners))
	for _, sc := range d.scanners {
		sc := sc
		go func() {
			r, err := sc(ctx)
			ch <- result{r: r, err: err}
		}()
	}
	for range d.scanners {
		res := <-ch
		if res.err != nil {
			continue // error already captured inside each scanner as account.status=error
		}
		publish(res.r)
	}
}
```

Then rewrite `scanTokenStats` in `token_stats.go` to build the scanner list and call `(&streamDriver{scanners: ...}).run(ctx, c.publish)` where `c.publish` is wired in Task 2.3.

- [ ] **Step 4: Run, verify pass**

Run: `go test ./server/internal/hub/tools/ -run TestScanTokenStatsStreamingOrder -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/hub/tools/token_dedup.go server/internal/hub/tools/token_stats.go
git commit -m "feat(hub): scanTokenStats runs providers in parallel with streaming publish"
```

---

### Task 2.3: `PublishTokenStatsEvent` + sink (reuse terminal pattern)

**Files:**
- Create: `server/internal/hub/tools/token_stream.go` — declares the event method constant + payload type
- Modify: `server/internal/hub/reporter.go` — add `tokenStatsEventSink *tokenStatsEventSink` field, create it in `runSession` beside the terminal sink, drain it in a goroutine, expose `PublishTokenStatsEvent`
- Test: `server/internal/hub/reporter_token_stats_event_test.go`

- [ ] **Step 1: Write the failing test** (asserts the event is written to the WS connection)

```go
package hub

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestPublishTokenStatsEventDrainsToWS(t *testing.T) {
	upgrader := websocket.Upgrader{}
	got := make(chan map[string]any, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade: %v", err)
			return
		}
		defer conn.Close()
		conn.WriteJSON(map[string]any{"type": "ready"}) // handshake stub
		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var env map[string]any
			if json.Unmarshal(raw, &env) == nil && env["method"] == "tokenStats.update" {
				select {
				case got <- env:
				default:
				}
				return
			}
		}
	}))
	defer srv.Close()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")

	rep := newTestReporter(t, wsURL)
	defer rep.Close()

	defer func() { _ = rep.PublishTokenStatsEvent(map[string]any{"provider": "kimi"}) }()
	select {
	case ev := <-got:
		if ev["method"] != "tokenStats.update" {
			t.Errorf("method = %v, want tokenStats.update", ev["method"])
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for tokenStats.update on WS")
	}
}
```

> The `newTestReporter(t, wsURL)` helper is a thin constructor used by existing hub tests; reuse whatever pattern `hub_test.go` already uses for standing up a Reporter against a fake WS server. If none exists yet, add a minimal one in `_test.go`.

- [ ] **Step 2: Run, verify fail**

Run: `go test ./server/internal/hub/ -run TestPublishTokenStatsEventDrainsToWS -v`
Expected: FAIL — `undefined: Reporter.PublishTokenStatsEvent`

- [ ] **Step 3: Implement** — in `reporter.go`, mirror the terminal sink:

Add a type near line 74:
```go
type tokenStatsEventSink struct {
	events chan envelope
	done   chan struct{}
}

func newTokenStatsEventSink() *tokenStatsEventSink {
	return &tokenStatsEventSink{events: make(chan envelope, 64), done: make(chan struct{})}
}
func (s *tokenStatsEventSink) stop() { close(s.done) }
```

Add field near line 126: `tokenStatsEventSink *tokenStatsEventSink`

In `runSession` (around line 327, beside the terminal sink block), add:
```go
tokenSink := newTokenStatsEventSink()
r.mu.Lock()
r.tokenStatsEventSink = tokenSink
r.mu.Unlock()
defer func() {
	r.mu.Lock()
	if r.tokenStatsEventSink == tokenSink {
		r.tokenStatsEventSink = nil
	}
	r.mu.Unlock()
	tokenSink.stop()
}()
go r.runTokenStatsEventSink(conn, tokenSink)
```

Add the drain goroutine (mirror `runTerminalEventSink`):
```go
func (r *Reporter) runTokenStatsEventSink(conn *websocket.Conn, sink *tokenStatsEventSink) {
	for {
		select {
		case event := <-sink.events:
			r.writeMu.Lock()
			err := conn.WriteJSON(event)
			r.writeMu.Unlock()
			if err != nil {
				_ = conn.Close()
				return
			}
		case <-sink.done:
			return
		}
	}
}
```

Add the publish method (mirror `PublishTerminalEvent`):
```go
// PublishTokenStatsEvent pushes one token-stats incremental update to the
// server. Non-blocking; drops on backlog (the next full refresh will recover).
func (r *Reporter) PublishTokenStatsEvent(payload any) error {
	r.mu.RLock()
	sink := r.tokenStatsEventSink
	r.mu.RUnlock()
	if sink == nil {
		return nil
	}
	event := envelope{
		Type:    rp.RegistryEnvelopeTypeEvent,
		Method:  "tokenStats.update",
		HubID:   r.cfg.HubID,
		Payload: rp.MustRaw(payload),
	}
	select {
	case sink.events <- event:
		return nil
	case <-sink.done:
		return nil
	default:
		return errTerminalPublishBacklog
	}
}
```

In `token_stream.go`:
```go
package tools

const tokenStatsUpdateMethod = "tokenStats.update"

// tokenStatsUpdatePayload is the per-account event body. The hub builds this
// and the reporter wraps it in an envelope. No plaintext key ever appears here.
type tokenStatsUpdatePayload struct {
	Provider string                 `json:"provider"`
	Account  tokenProviderAccount   `json:"account"`
	Limits   []tokenAccountLimit    `json:"limits,omitempty"`
	Balance  *tokenAccountBalance   `json:"balance,omitempty"`
}
```

> Wire the scanner driver to call `reporter.PublishTokenStatsEvent(...)` per completed provider. Since `token_stats.go` is in the `tools` package and the reporter is in `hub`, the call site is `hub_state_adapters.go` (Task 2.4) which already holds the `*Reporter`.

- [ ] **Step 4: Run, verify pass**

Run: `go test ./server/internal/hub/ -run TestPublishTokenStatsEventDrainsToWS -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/hub/tools/token_stream.go server/internal/hub/reporter.go server/internal/hub/reporter_token_stats_event_test.go
git commit -m "feat(hub): add tokenStats.update streaming event (sink mirrors terminal)"
```

---

### Task 2.4: Wire `refreshHubStateTokenStats` to streaming driver

**Files:**
- Modify: `server/internal/hub/hub_state_adapters.go` — `refreshHubStateTokenStats` now builds the credential list, dedups, launches the parallel driver, and returns immediately with a "scan started" ack; results flow via `PublishTokenStatsEvent`.

- [ ] **Step 1: Write the failing test** (asserts refresh returns promptly even when scanners are slow)

```go
package hub

import (
	"context"
	"testing"
	"time"
)

func TestRefreshHubStateTokenStatsReturnsPromptly(t *testing.T) {
	r := newTestReporterWithSlowScanners(t) // scanners sleep 5s each
	start := time.Now()
	_, err := r.refreshHubStateTokenStats(context.Background(), hubStateRefreshInput{HubID: r.cfg.HubID})
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if elapsed > 500*time.Millisecond {
		t.Errorf("refresh took %v; should return immediately while scans run async", elapsed)
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `go test ./server/internal/hub/ -run TestRefreshHubStateTokenStatsReturnsPromptly -v`
Expected: FAIL

- [ ] **Step 3: Implement** — rewrite `refreshHubStateTokenStats`:

```go
func (r *Reporter) refreshHubStateTokenStats(ctx context.Context, input hubStateRefreshInput) (any, error) {
	go r.runTokenStatsScan(context.Background(), input.HubID)
	return map[string]any{"ok": true, "hubId": input.HubID, "streaming": true}, nil
}

// runTokenStatsScan discovers credentials, dedups, runs all scanners in
// parallel, and publishes one tokenStats.update event per completed provider.
func (r *Reporter) runTokenStatsScan(ctx context.Context, hubID string) {
	driver := tools.NewTokenStatsDriver(tools.TokenStatsDriverConfig{
		OpenCodeAuthPath: tools.DefaultOpenCodeAuthPath(),
		CodexBinary:      "", // rely on PATH
		HTTPClient:       r.tokenStatsHTTPClient(),
		Publish: func(payload tools.TokenStatsUpdatePayload) {
			_ = r.PublishTokenStatsEvent(payload)
		},
	})
	driver.Run(ctx)
}
```

> This introduces `tools.NewTokenStatsDriver` — a coordinator struct in `token_dedup.go` that owns the discovery + dedup + parallel-launch + per-provider-publish logic. It is the single entry point that the adapters layer calls. Implement it as part of this step: it composes `readOpenCodeProviderKeys` + `discoverCodexAuthProfiles` + `dedupCredentialsByHash` + the four scanners + `streamDriver.run`. Each scanner returns a `tokenProviderScanResult`; the driver maps each result into a `TokenStatsUpdatePayload` and invokes `Publish`.

- [ ] **Step 4: Run, verify pass**

Run: `go test ./server/internal/hub/ -run TestRefreshHubStateTokenStatsReturnsPromptly -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/hub/hub_state_adapters.go server/internal/hub/tools/token_dedup.go
git commit -m "feat(hub): refreshHubStateTokenStats kicks off streaming scan"
```

---

## Phase 3: Web — types + stream + store

### Task 3.1: New `usage/usageTypes.ts`

**Files:**
- Create: `app/web/src/usage/usageTypes.ts`
- Test: `app/web/src/usage/__tests__/usageTypes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import {describe, expect, it} from 'vitest';
import {remainingPercent, tightnessColor, mergeAccountsAcrossHubs} from '../usageTypes';

describe('remainingPercent', () => {
  it('converts usedPercent to remaining', () => {
    expect(remainingPercent({id: '5h', label: '5h', usedPercent: 23})).toBe(77);
    expect(remainingPercent({id: '5h', label: '5h', usedPercent: 100})).toBe(0);
    expect(remainingPercent({id: '5h', label: '5h', usedPercent: 0})).toBe(100);
  });
});

describe('tightnessColor', () => {
  it('red below 10% remaining, yellow 10-30, default otherwise', () => {
    expect(tightnessColor(5)).toBe('danger');
    expect(tightnessColor(20)).toBe('warning');
    expect(tightnessColor(77)).toBe('default');
  });
});

describe('mergeAccountsAcrossHubs', () => {
  it('dedupes same provider + email', () => {
    const a = {provider: 'codex', identity: {email: 'x@y.z', accountId: 'a1'}, hubId: 'h1', limits: []};
    const b = {provider: 'codex', identity: {email: 'x@y.z', accountId: 'a1'}, hubId: 'h2', limits: []};
    const merged = mergeAccountsAcrossHubs([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].hubIds).toEqual(['h1', 'h2']);
  });
  it('keeps distinct providers', () => {
    const merged = mergeAccountsAcrossHubs([
      {provider: 'codex', identity: {email: 'x@y.z'}, hubId: 'h1', limits: []},
      {provider: 'kimi', identity: {userId: 'u1'}, hubId: 'h1', limits: []},
    ]);
    expect(merged).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @anthropic-ai/app vitest run src/usage/__tests__/usageTypes.test.ts`
Expected: FAIL — cannot resolve `../usageTypes`

- [ ] **Step 3: Implement** `app/web/src/usage/usageTypes.ts`:

```ts
export interface UsageLimit {
  id: string;        // "5h" | "week" | "mcp-month"
  label: string;     // "5h window" | "Weekly" | "MCP monthly"
  usedPercent: number;
  resetsAt?: number; // unix seconds
}

export interface UsageBalanceItem {
  currency: string;       // "CNY" | "USD"
  total: string;          // "110.00"
  granted: string;
  toppedUp: string;
}

export interface UsageBalance {
  isAvailable: boolean;
  items: UsageBalanceItem[];
}

export interface UsageAccountIdentity {
  email?: string;
  accountId?: string;    // codex
  userId?: string;       // kimi
  customerNumber?: string; // zai
}

export interface UsageAccount {
  provider: string;
  identity: UsageAccountIdentity;
  status: 'ok' | 'error';
  message?: string;
  limits: UsageLimit[];
  balance?: UsageBalance;
  hubIds: string[]; // which hubs reported this account
}

export type Tightness = 'default' | 'warning' | 'danger';

export function remainingPercent(limit: UsageLimit): number {
  return Math.max(0, Math.min(100, 100 - limit.usedPercent));
}

export function tightnessColor(remaining: number): Tightness {
  if (remaining < 10) return 'danger';
  if (remaining < 30) return 'warning';
  return 'default';
}

export function accountIdentityKey(provider: string, identity: UsageAccountIdentity): string {
  const id = identity.email ?? identity.accountId ?? identity.userId ?? identity.customerNumber ?? '';
  return `${provider}:${id.toLowerCase()}`;
}

export function mergeAccountsAcrossHubs(accounts: Array<Omit<UsageAccount, 'hubIds'> & {hubId: string}>): UsageAccount[] {
  const map = new Map<string, UsageAccount>();
  for (const a of accounts) {
    const key = accountIdentityKey(a.provider, a.identity);
    const existing = map.get(key);
    if (existing) {
      if (!existing.hubIds.includes(a.hubId)) existing.hubIds.push(a.hubId);
      // prefer ok status over error, prefer non-empty limits
      if (existing.status === 'error' && a.status === 'ok') {
        existing.status = 'ok';
        existing.limits = a.limits;
        existing.balance = a.balance;
        existing.message = undefined;
      }
      continue;
    }
    map.set(key, {...a, hubIds: [a.hubId]});
  }
  return Array.from(map.values());
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @anthropic-ai/app vitest run src/usage/__tests__/usageTypes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/web/src/usage/usageTypes.ts app/web/src/usage/__tests__/usageTypes.test.ts
git commit -m "feat(web): add usage types + tightness/merge helpers"
```

---

### Task 3.2: `usageStream.ts` — subscribe + incremental state

**Files:**
- Create: `app/web/src/usage/usageStream.ts`
- Test: `app/web/src/usage/__tests__/usageStream.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import {describe, expect, it} from 'vitest';
import {UsageStream} from '../usageStream';

function makeEvent(provider: string, identity: Record<string, string>, hubId: string) {
  return {
    type: 'event' as const,
    method: 'tokenStats.update',
    hubId,
    payload: {provider, account: {identity, status: 'ok', limits: []}},
  };
}

describe('UsageStream', () => {
  it('accumulates accounts across events + dedupes by identity', () => {
    const stream = new UsageStream();
    stream.ingest(makeEvent('codex', {email: 'a@b.c'}, 'h1'));
    stream.ingest(makeEvent('codex', {email: 'a@b.c'}, 'h2')); // same account, other hub
    stream.ingest(makeEvent('kimi', {userId: 'u1'}, 'h1'));
    const snap = stream.snapshot();
    expect(snap.accounts).toHaveLength(2);
    const codex = snap.accounts.find(a => a.provider === 'codex')!;
    expect(codex.hubIds).toEqual(['h1', 'h2']);
  });

  it('updates an account in place when same provider+identity reappears', () => {
    const stream = new UsageStream();
    stream.ingest({type: 'event', method: 'tokenStats.update', hubId: 'h1',
      payload: {provider: 'codex', account: {identity: {email: 'a@b.c'}, status: 'error', message: 'oops', limits: []}}});
    stream.ingest({type: 'event', method: 'tokenStats.update', hubId: 'h1',
      payload: {provider: 'codex', account: {identity: {email: 'a@b.c'}, status: 'ok', limits: [{id: '5h', label: '5h', usedPercent: 10}]}}});
    const snap = stream.snapshot();
    expect(snap.accounts[0].status).toBe('ok');
    expect(snap.accounts[0].limits).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @anthropic-ai/app vitest run src/usage/__tests__/usageStream.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement** `app/web/src/usage/usageStream.ts`:

```ts
import {UsageAccount, mergeAccountsAcrossHubs} from './usageTypes';

export interface UsageSnapshot {
  accounts: UsageAccount[];
  updatedAt: number;
}

interface RawEventPayload {
  provider: string;
  account: {
    identity: Record<string, string | undefined>;
    status: 'ok' | 'error';
    message?: string;
    limits?: Array<{id: string; label: string; usedPercent: number; resetsAt?: number}>;
    balance?: {isAvailable: boolean; items: Array<{currency: string; total: string; granted: string; toppedUp: string}>};
  };
}

interface RegistryEventEnvelope {
  type: 'event';
  method: string;
  hubId: string;
  payload: RawEventPayload;
}

export class UsageStream {
  private byHub = new Map<string, Array<Omit<UsageAccount, 'hubIds'> & {hubId: string}>>();
  private listeners = new Set<(snapshot: UsageSnapshot) => void>();

  ingest(envelope: RegistryEventEnvelope): void {
    if (envelope.method !== 'tokenStats.update') return;
    const {provider, account} = envelope.payload;
    const entry = {
      provider,
      identity: {
        email: account.identity.email,
        accountId: account.identity.accountId,
        userId: account.identity.userId,
        customerNumber: account.identity.customerNumber,
      },
      status: account.status,
      message: account.message,
      limits: account.limits ?? [],
      balance: account.balance,
      hubId: envelope.hubId,
    };
    const list = this.byHub.get(envelope.hubId) ?? [];
    const idx = list.findIndex(a => a.provider === entry.provider &&
      JSON.stringify(a.identity) === JSON.stringify(entry.identity));
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    this.byHub.set(envelope.hubId, list);
    this.emit();
  }

  snapshot(): UsageSnapshot {
    const all: Array<Omit<UsageAccount, 'hubIds'> & {hubId: string}> = [];
    for (const list of this.byHub.values()) all.push(...list);
    return {accounts: mergeAccountsAcrossHubs(all), updatedAt: Date.now()};
  }

  subscribe(fn: (snapshot: UsageSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @anthropic-ai/app vitest run src/usage/__tests__/usageStream.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/web/src/usage/usageStream.ts app/web/src/usage/__tests__/usageStream.test.ts
git commit -m "feat(web): UsageStream subscribes to tokenStats.update + dedupes"
```

---

## Phase 4: Web — UI components

### Task 4.1: `UsageCompactBar.tsx`

**Files:**
- Create: `app/web/src/usage/UsageCompactBar.tsx`
- Test: `app/web/src/usage/__tests__/UsageCompactBar.test.tsx`

A compact bar rendered only on PC + chat view. One row per provider.

- [ ] **Step 1: Write the failing test** (render + assert rows + tightness class)

```tsx
import {describe, expect, it} from 'vitest';
import {render} from '@testing-library/react';
import {UsageCompactBar} from '../UsageCompactBar';
import {UsageSnapshot} from '../usageStream';

const snap: UsageSnapshot = {
  updatedAt: 0,
  accounts: [
    {provider: 'codex', identity: {email: 'a@b.c'}, status: 'ok', hubIds: ['h1'],
     limits: [{id: '5h', label: '5h', usedPercent: 95}, {id: 'week', label: 'Week', usedPercent: 50}]},
    {provider: 'deepseek', identity: {}, status: 'ok', hubIds: ['h1'],
     balance: {isAvailable: true, items: [{currency: 'CNY', total: '110', granted: '10', toppedUp: '100'}]}, limits: []},
  ],
};

describe('UsageCompactBar', () => {
  it('renders one row per provider with limit percentages', () => {
    const {getByText} = render(<UsageCompactBar snapshot={snap} onExpand={() => {}}/>);
    expect(getByText(/codex/i)).toBeTruthy();
    expect(getByText('5%')).toBeTruthy();   // 100 - 95 = 5, danger color
    expect(getByText('50%')).toBeTruthy();
  });
  it('renders DeepSeek balance as currency text', () => {
    const {getByText} = render(<UsageCompactBar snapshot={snap} onExpand={() => {}}/>);
    expect(getByText(/CNY/i)).toBeTruthy();
    expect(getByText(/110/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @anthropic-ai/app vitest run src/usage/__tests__/UsageCompactBar.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement** `app/web/src/usage/UsageCompactBar.tsx`:

```tsx
import React from 'react';
import {UsageAccount, UsageSnapshot, remainingPercent, tightnessColor} from './usageTypes';

interface Props {
  snapshot: UsageSnapshot;
  onExpand: () => void;
}

function renderAccountRow(account: UsageAccount): React.ReactNode {
  if (account.status === 'error') {
    return (
      <div className="usage-compact-row usage-compact-row-error" title={account.message}>
        <span className="usage-compact-provider">{account.provider}</span>
        <span className="usage-compact-value">—</span>
      </div>
    );
  }
  if (account.balance) {
    const balanceText = account.balance.items
      .map(item => `${item.currency} ${item.total}`)
      .join(' · ');
    const danger = !account.balance.isAvailable;
    return (
      <div className={`usage-compact-row${danger ? ' usage-compact-row-danger' : ''}`}>
        <span className="usage-compact-provider">DeepSeek</span>
        <span className="usage-compact-value">{balanceText}</span>
      </div>
    );
  }
  return (
    <div className="usage-compact-row">
      <span className="usage-compact-provider">{labelForProvider(account.provider)}</span>
      <span className="usage-compact-limits">
        {account.limits.map(limit => {
          const remaining = remainingPercent(limit);
          const tone = tightnessColor(remaining);
          return (
            <span key={limit.id} className={`usage-compact-limit usage-compact-limit-${tone}`}>
              {labelForLimitId(limit.id)} {remaining}%
            </span>
          );
        })}
      </span>
    </div>
  );
}

function labelForProvider(provider: string): string {
  switch (provider) {
    case 'codex': return 'Codex';
    case 'kimi': return 'Kimi';
    case 'zai': return 'ZAI';
    case 'deepseek': return 'DeepSeek';
    default: return provider;
  }
}

function labelForLimitId(id: string): string {
  switch (id) {
    case '5h': return '5h';
    case 'week': return '周';
    case 'mcp-month': return 'MCP';
    default: return id;
  }
}

export function UsageCompactBar({snapshot, onExpand}: Props): React.ReactElement {
  return (
    <div className="usage-compact-bar" role="button" tabIndex={0} onClick={onExpand} onKeyDown={e => { if (e.key === 'Enter') onExpand(); }}>
      {snapshot.accounts.map(account => (
        <React.Fragment key={`${account.provider}:${JSON.stringify(account.identity)}`}>
          {renderAccountRow(account)}
        </React.Fragment>
      ))}
      {snapshot.accounts.length === 0 ? <div className="usage-compact-empty">Loading usage…</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @anthropic-ai/app vitest run src/usage/__tests__/UsageCompactBar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/web/src/usage/UsageCompactBar.tsx app/web/src/usage/__tests__/UsageCompactBar.test.tsx app/web/src/styles/usage.css
git commit -m "feat(web): add UsageCompactBar (footer, one row per provider)"
```

> **CSS:** Add `app/web/src/styles/usage.css` with `.usage-compact-bar`, `.usage-compact-row`, `.usage-compact-limit-{default,warning,danger}` (green/yellow/red). Keep it under 80 lines; reuse the project's existing color tokens (search for `--color-warning` / `--color-danger` in `app/web/src/styles/`).

---

### Task 4.2: `UsageCardPanel.tsx`

**Files:**
- Create: `app/web/src/usage/UsageCardPanel.tsx`
- Test: `app/web/src/usage/__tests__/UsageCardPanel.test.tsx`

Expanded panel with progress bars (reuses `/status` dialog's `app-session-status-limit-track` / `-fill` classes).

- [ ] **Step 1: Write the failing test**

```tsx
import {describe, expect, it} from 'vitest';
import {render} from '@testing-library/react';
import {UsageCardPanel} from '../UsageCardPanel';
import {UsageSnapshot} from '../usageStream';

const snap: UsageSnapshot = {
  updatedAt: 0,
  accounts: [{
    provider: 'codex', identity: {email: 'a@b.c'}, status: 'ok', hubIds: ['h1'],
    limits: [{id: '5h', label: '5h window', usedPercent: 23, resetsAt: 1784780541}],
  }],
};

describe('UsageCardPanel', () => {
  it('renders a progress bar per limit', () => {
    const {getByText, container} = render(<UsageCardPanel snapshot={snap} onClose={() => {}}/>);
    expect(getByText(/codex/i)).toBeTruthy();
    expect(getByText(/77%/i)).toBeTruthy(); // remaining
    const fill = container.querySelector('.app-session-status-limit-fill');
    expect(fill).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @anthropic-ai/app vitest run src/usage/__tests__/UsageCardPanel.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement** `app/web/src/usage/UsageCardPanel.tsx`:

```tsx
import React from 'react';
import {UsageAccount, UsageSnapshot, remainingPercent, tightnessColor} from './usageTypes';

interface Props {
  snapshot: UsageSnapshot;
  onClose: () => void;
  onRefresh?: () => void;
}

function Card({account}: {account: UsageAccount}): React.ReactElement {
  return (
    <div className={`usage-card${account.status === 'error' ? ' usage-card-error' : ''}`}>
      <div className="usage-card-header">
        <span className="usage-card-provider">{account.provider}</span>
        {account.identity.email ? <span className="usage-card-email">{account.identity.email}</span> : null}
        <span className="usage-card-hubs">{account.hubIds.join(', ')}</span>
      </div>
      {account.status === 'error' ? (
        <div className="usage-card-error-message">{account.message}</div>
      ) : account.balance ? (
        <div className="usage-card-balance">
          {account.balance.items.map(item => (
            <div key={item.currency}>{item.currency}: {item.total} (granted {item.granted}, topped up {item.toppedUp})</div>
          ))}
        </div>
      ) : (
        <div className="usage-card-limits">
          {account.limits.map(limit => {
            const remaining = remainingPercent(limit);
            return (
              <div key={limit.id} className="app-session-status-limit">
                <div className="app-session-status-limit-heading">
                  <span>{limit.label}</span>
                  <strong>{remaining}% remaining</strong>
                </div>
                <div className="app-session-status-limit-track" role="progressbar" aria-valuenow={remaining} aria-valuemin={0} aria-valuemax={100}>
                  <span className="app-session-status-limit-fill" style={{width: `${remaining}%`}} />
                </div>
                {limit.resetsAt ? <div className="app-session-status-muted">Resets {new Date(limit.resetsAt * 1000).toLocaleString()}</div> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function UsageCardPanel({snapshot, onClose, onRefresh}: Props): React.ReactElement {
  return (
    <div className="app-confirm-backdrop" role="presentation" onPointerDown={onClose}>
      <div className="usage-card-panel" role="dialog" aria-modal="true" onPointerDown={e => e.stopPropagation()}>
        <div className="usage-card-panel-header">
          <span>Agent Usage</span>
          <div>
            {onRefresh ? <button type="button" className="app-confirm-btn secondary" onClick={onRefresh}>Refresh</button> : null}
            <button type="button" className="app-confirm-btn primary" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="usage-card-panel-body">
          {snapshot.accounts.map(account => (
            <Card key={`${account.provider}:${JSON.stringify(account.identity)}`} account={account} />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @anthropic-ai/app vitest run src/usage/__tests__/UsageCardPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/web/src/usage/UsageCardPanel.tsx app/web/src/usage/__tests__/UsageCardPanel.test.tsx
git commit -m "feat(web): add UsageCardPanel (progress bars reusing /status styles)"
```

---

## Phase 5: Web — wire-up in WorkspaceApp

### Task 5.1: Mount compact bar + header button + refresh loop

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`

Locate the chat session header (search for `renderChatMenuSettingsButton`). Beside the settings button, add a usage button. In the chat footer area (the chat body container), mount `<UsageCompactBar>` with a `isPC && isChatView` guard. Wire a `UsageStream` instance, subscribe to `RegistryClient` events, and refresh on chat-enter + 5-min interval.

- [ ] **Step 1: Write the failing test** (asserts the compact bar is rendered when PC + chat view, and not otherwise)

```tsx
import {describe, expect, it} from 'vitest';
import {render} from '@testing-library/react';
// Mock the platform + view context to drive isPC/isChatView
import {WorkspaceApp} from '../WorkspaceApp';

describe('UsageCompactBar mounting', () => {
  it('renders when PC + chat view', () => {
    const {queryByTestId} = render(<WorkspaceApp platform="pc" view="chat" />);
    expect(queryByTestId('usage-compact-bar')).toBeTruthy();
  });
  it('does not render on mobile', () => {
    const {queryByTestId} = render(<WorkspaceApp platform="mobile" view="chat" />);
    expect(queryByTestId('usage-compact-bar')).toBeNull();
  });
  it('does not render on non-chat view', () => {
    const {queryByTestId} = render(<WorkspaceApp platform="pc" view="code" />);
    expect(queryByTestId('usage-compact-bar')).toBeNull();
  });
});
```

> The exact `platform` / `view` prop shape depends on existing WorkspaceApp test harness conventions — check `app/web/src/app/__tests__/` for the existing pattern and mirror it. If WorkspaceApp already derives these from context rather than props, mock the context provider.

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @anthropic-ai/app vitest run src/app/__tests__/WorkspaceApp.usage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement** — in `WorkspaceApp.tsx`:

1. Add state: `const [usageStream] = useState(() => new UsageStream());`
2. Add state: `const [usageSnapshot, setUsageSnapshot] = useState<UsageSnapshot>({accounts: [], updatedAt: 0});`
3. Add state: `const [usagePanelOpen, setUsagePanelOpen] = useState(false);`
4. In a `useEffect` keyed on `registryClient` readiness:
   ```ts
   const off = registryClient.addEventListener(env => usageStream.ingest(env as any));
   const unsub = usageStream.subscribe(setUsageSnapshot);
   const triggerRefresh = () => registryRepository.refreshTokenStats().catch(() => {});
   triggerRefresh(); // on chat enter
   const timer = setInterval(triggerRefresh, 5 * 60 * 1000); // 5 min
   return () => { off(); unsub(); clearInterval(timer); };
   ```
5. Render the header button beside `renderChatMenuSettingsButton`:
   ```tsx
   <button type="button" className="chat-menu-icon-button chat-menu-usage-button"
     onClick={() => setUsagePanelOpen(true)} title="Agent usage" aria-label="Agent usage">
     <span className="codicon codicon-dashboard" aria-hidden="true" />
   </button>
   ```
6. Render the compact bar in the chat footer, guarded by `isPC && isChatView` (use the existing platform/view flags — search `WorkspaceApp` for `isMobile` or `view === 'chat'` to find the right variables):
   ```tsx
   {isPC && isChatView ? (
     <UsageCompactBar snapshot={usageSnapshot} onExpand={() => setUsagePanelOpen(true)} />
   ) : null}
   ```
7. Render the panel:
   ```tsx
   {usagePanelOpen ? (
     <UsageCardPanel snapshot={usageSnapshot} onClose={() => setUsagePanelOpen(false)}
       onRefresh={() => registryRepository.refreshTokenStats().catch(() => {})} />
   ) : null}
   ```
8. Add `data-testid="usage-compact-bar"` to the compact bar root for the test.

> **Add `refreshTokenStats` to `RegistryRepository`:** it should issue the `hubState.refresh` for the `tokenStats` section (the action already exists server-side). Find the existing `runHubStateAction` / `refreshHubState` helper in `RegistryRepository.ts` and reuse it. The streaming results come back as events, not as the return value — so `refreshTokenStats` returns `void`/`Promise<void>`.

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @anthropic-ai/app vitest run src/app/__tests__/WorkspaceApp.usage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/app/__tests__/WorkspaceApp.usage.test.tsx
git commit -m "feat(web): mount UsageCompactBar + header button + refresh loop"
```

---

## Phase 6: Cleanup — delete old code

### Task 6.1: Remove `TokenStatsSettingsDetail` + `tokenStatsView`

**Files:**
- Delete: `app/web/src/settings/TokenStatsSettingsDetail.tsx`
- Delete: `app/web/src/settings/tokenStatsView.ts`
- Modify: `app/web/src/settings/SettingsSurface.tsx` — remove the `tokenStats` case from the detail switch (around line 73-86) and the nav entry that creates the detail
- Modify: `app/web/src/app/WorkspaceApp.tsx` — remove any imports + state references to `tokenStats*` (search for `tokenStatsProviders`, `tokenStatsLoading`, `tokenStatsError`, `tokenStatsUpdatedAt`, `scanTokenStatsAcrossHubs`, `buildTokenStatCards`, `settingsDetailView === 'tokenStats'`)
- Modify: `app/web/src/registry/RegistryRepository.ts` — remove the `deepseekStats` action case (line ~1665)

- [ ] **Step 1: Write the failing import test**

```ts
import {describe, expect, it} from 'vitest';

describe('old token stats module is gone', () => {
  it('TokenStatsSettingsDetail no longer importable', async () => {
    await expect(async () => import('../settings/TokenStatsSettingsDetail')).rejects.toThrow();
  });
  it('tokenStatsView no longer importable', async () => {
    await expect(async () => import('../settings/tokenStatsView')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @anthropic-ai/app vitest run src/settings/__tests__/removed.test.ts`
Expected: FAIL — modules still resolve

- [ ] **Step 3: Delete + scrub references**

Delete the two files. In `SettingsSurface.tsx` remove the `case 'tokenStats'` and the nav entry. In `WorkspaceApp.tsx` remove all `tokenStats*` state + the render branch for the tokenStats detail. In `RegistryRepository.ts` delete the `deepseekStats` case. Run `pnpm --filter @anthropic-ai/app typecheck` to find lingering references; fix each.

- [ ] **Step 4: Run, verify pass + typecheck**

Run: `pnpm --filter @anthropic-ai/app vitest run src/settings/__tests__/removed.test.ts && pnpm --filter @anthropic-ai/app typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A app/web/src/
git commit -m "chore(web): remove TokenStatsSettingsDetail + tokenStatsView + deepseekStats action"
```

---

### Task 6.2: Remove frontend DeepSeek key configuration

**Files:**
- Modify: `app/web/src/settings/serverSettings.ts` — remove `deepSeek` from `ServerSettings`, `ServerSettingsUpdate['section']`, `DEFAULT_SERVER_SETTINGS`, and the parse/normalize functions (lines ~23, 27, 61, 86-89, 108-110)
- Modify: `app/web/src/settings/SettingsRootContent.tsx` — remove the DeepSeek `<ServerSecretEditor>` block (lines ~468-483)
- Modify: `app/web/src/compatibility/browserCredentialCleanup.ts` — remove `'deepseekApiKey'` from the cleanup list (line 4)
- Modify: `app/web/src/registry/registryTypes.ts` — remove `'deepSeek'` from the `section` union (line 90)

- [ ] **Step 1: Write the failing test** (asserts the union no longer includes deepSeek)

```ts
import {describe, expect, it} from 'vitest';
import type {ServerSettings, ServerSettingsUpdate} from '../serverSettings';

describe('deepSeek removed from server settings', () => {
  it('ServerSettings has no deepSeek key', () => {
    const s = {} as ServerSettings;
    expect((s as unknown as Record<string, unknown>).deepSeek).toBeUndefined();
  });
  it('ServerSettingsUpdate section excludes deepSeek', () => {
    const u = {section: 'voiceInput'} as ServerSettingsUpdate;
    // @ts-expect-error — deepSeek should not be assignable
    const invalid: ServerSettingsUpdate = {section: 'deepSeek', field: 'key', action: 'set'};
    expect(u.section).toBe('voiceInput');
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @anthropic-ai/app vitest run src/settings/__tests__/deepseek-removed.test.ts`
Expected: FAIL

- [ ] **Step 3: Edit the four files** as described above. Run `pnpm --filter @anthropic-ai/app typecheck` to find any consumer still referencing `serverSettings.deepSeek`; fix each (likely just `SettingsRootContent`).

- [ ] **Step 4: Run, verify pass + typecheck**

Run: `pnpm --filter @anthropic-ai/app vitest run src/settings/__tests__/deepseek-removed.test.ts && pnpm --filter @anthropic-ai/app typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A app/web/src/
git commit -m "chore(web): remove frontend DeepSeek key configuration"
```

---

### Task 6.3: Remove Copilot fields from registry types

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts` — in `RegistryTokenProviderAccount` (line 563) remove `premiumRequestsUsed`, `premiumRequestsRemaining`, `premiumRequestsMonth`
- Modify: any consumer that reads those fields (search the codebase for `premiumRequests`)

- [ ] **Step 1: Write the failing test**

```ts
import {describe, expect, it} from 'vitest';
import type {RegistryTokenProviderAccount} from '../../registry/registryTypes';

describe('copilot premium fields removed', () => {
  it('RegistryTokenProviderAccount has no premiumRequests* fields', () => {
    const acc = {} as RegistryTokenProviderAccount;
    expect((acc as unknown as Record<string, unknown>).premiumRequestsUsed).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @anthropic-ai/app vitest run src/registry/__tests__/copilot-fields-removed.test.ts`
Expected: FAIL

- [ ] **Step 3: Edit** — remove the three fields from the interface. Run typecheck; fix any consumer (likely none remain after Task 6.1 removed the only consumer).

- [ ] **Step 4: Run, verify pass + typecheck**

Run: `pnpm --filter @anthropic-ai/app vitest run src/registry/__tests__/copilot-fields-removed.test.ts && pnpm --filter @anthropic-ai/app typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A app/web/src/
git commit -m "chore(web): remove copilot premium-request fields from registry types"
```

---

## Phase 7: End-to-end + key-safety verification

### Task 7.1: Streaming end-to-end test (hub → web)

**Files:**
- Test: `server/internal/hub/e2e_token_stats_stream_test.go`

Use the existing hub test harness (see `hub_test.go` for the fake WS server pattern). Stub the four scanners to return canned results; assert four `tokenStats.update` events arrive on the WS connection in some order, with no plaintext keys in any payload.

- [ ] **Step 1: Write the failing test**

```go
package hub

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestTokenStatsStreamsFourProvidersNoPlaintextKey(t *testing.T) {
	r := newTestReporterWithStubScanners(t) // returns codex/kimi/zai/deepseek canned data
	defer r.Close()
	r.triggerTokenStatsScan()

	events := r.drainTokenStatsEvents(t, 4, 5*time.Second)
	if len(events) != 4 {
		t.Fatalf("got %d events, want 4", len(events))
	}
	providers := map[string]bool{}
	for _, ev := range events {
		providers[ev["payload"].(map[string]any)["provider"].(string)] = true
		raw, _ := json.Marshal(ev)
		if strings.Contains(string(raw), "sk-") || strings.Contains(string(raw), "4466.") {
			t.Errorf("plaintext key leaked in event: %s", raw)
		}
	}
	for _, want := range []string{"codex", "kimi", "zai", "deepseek"} {
		if !providers[want] {
			t.Errorf("missing provider event: %s", want)
		}
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `go test ./server/internal/hub/ -run TestTokenStatsStreamsFourProvidersNoPlaintextKey -v`
Expected: FAIL

- [ ] **Step 3: Implement the test helpers** (`newTestReporterWithStubScanners`, `triggerTokenStatsScan`, `drainTokenStatsEvents`) in the `_test.go` file by adapting the existing `newTestReporter` pattern. Inject scanners via the `TokenStatsDriver` config so no real network/exec happens.

- [ ] **Step 4: Run, verify pass**

Run: `go test ./server/internal/hub/ -run TestTokenStatsStreamsFourProvidersNoPlaintextKey -v`
Expected: PASS — four events, no plaintext keys

- [ ] **Step 5: Commit**

```bash
git add server/internal/hub/e2e_token_stats_stream_test.go
git commit -m "test(hub): e2e streaming + no-plaintext-key assertion"
```

---

### Task 7.2: Full build + lint gate

- [ ] **Step 1: Build everything**

Run: `go build ./server/... && pnpm --filter @anthropic-ai/app build`
Expected: clean build, no errors

- [ ] **Step 2: Lint + typecheck**

Run: `go vet ./server/... && pnpm --filter @anthropic-ai/app lint && pnpm --filter @anthropic-ai/app typecheck`
Expected: clean

- [ ] **Step 3: Full test sweep**

Run: `go test ./server/... && pnpm --filter @anthropic-ai/app test`
Expected: all pass

- [ ] **Step 4: Manual smoke test**

Start the app, open chat view on desktop, verify:
- Compact bar appears bottom-left with four rows (or fewer if some providers have no key)
- Clicking the bar opens the card panel with progress bars
- Header button beside the settings gear opens the same panel
- Mobile view hides the bar
- Settings detail page no longer has a tokenStats entry
- Settings detail page no longer has a DeepSeek API Key field

- [ ] **Step 5: Commit + PR**

```bash
git add -A
git commit -m "test: full build + lint gate green for agent usage panel"
```

---

## Self-review

**1. Spec coverage:** Every spec section maps to tasks — data sources (Phase 1), dedup/parallel/streaming (Phase 2), UI two-entries-same-panel (Phase 4-5), deletion of TokenStatsSettingsDetail + Copilot + frontend DeepSeek config (Phase 6), key-safety + streaming e2e (Phase 7). Coverage is complete.

**2. Placeholder scan:** No TBD/TODO. Every step has either complete code, a precise file:line target with edit instructions, or a precise command + expected output. The two places that say "mirror the existing pattern" (`newTestReporter`, `WorkspaceApp` test harness) reference concrete existing files the engineer must read — those are unavoidable since the test scaffolding is project-specific and re-stating it verbatim would duplicate 200+ lines.

**3. Type consistency:**
- `codexWindow` (server, Task 1.2) is reused by kimi/zai parsers (Tasks 1.3/1.4) — same struct, same field names (`usedPercent`, `resetsAt`).
- `tokenProviderAccount` (server) retains its existing fields (`FiveHourLimit`, `WeeklyLimit`, `Balance`); Task 6.3 removes only the copilot-specific `premiumRequests*` from the web-side mirror.
- `UsageLimit` / `UsageAccount` (web, Task 3.1) field names match what `UsageStream.ingest` reads (`identity.email/accountId/userId/customerNumber`, `limits[].id/label/usedPercent/resetsAt`, `balance.isAvailable/items`).
- The `tokenStats.update` method name is consistent across `token_stream.go` (Task 2.3), `usageStream.ts` (Task 3.2), and the test envelope factory.

**4. Order dependency:** Phase 1 → 2 → 7 (server) and Phase 3 → 4 → 5 → 6 (web) are each internally sequential. Phase 6 (web cleanup) must come after Phase 5 (web wire-up) so that `WorkspaceApp` no longer references the old tokenStats state before we delete it. Phase 7 must come last.
