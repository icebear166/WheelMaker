package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/swm8023/wheelmaker/internal/protocol"
	logger "github.com/swm8023/wheelmaker/internal/shared"
)

func TestFormatACPLogLine_MinimalShape(t *testing.T) {
	payload := []byte(`{"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"sess-1","token":"abc","prompt":"hello"}}`)
	line := formatACPLogLine('>', "codex", payload)
	if !strings.HasPrefix(line, "[acp] >[codex] [Req 3 session/prompt] ") {
		t.Fatalf("line=%q", line)
	}
	if strings.Contains(line, "jsonrpc") {
		t.Fatalf("line contains verbose metadata: %q", line)
	}
	if strings.Contains(line, `"token":"abc"`) {
		t.Fatalf("line should redact sensitive fields: %q", line)
	}
}

func TestCodexAppStopReasonPreservesFailedPromptStatus(t *testing.T) {
	if got := codexappStopReason("failed"); got != protocol.SessionTurnStopReasonFailed {
		t.Fatalf("codexappStopReason(failed) = %q, want %q", got, protocol.SessionTurnStopReasonFailed)
	}
	if got := codexappStopReason("error"); got != protocol.SessionTurnStopReasonFailed {
		t.Fatalf("codexappStopReason(error) = %q, want %q", got, protocol.SessionTurnStopReasonFailed)
	}
}

func TestRedactACPPayload_JSONKeys(t *testing.T) {
	raw := []byte(`{"authorization":"Bearer X","nested":{"token":"abc","password":"p"}}`)
	redacted := redactACPPayload(raw)
	s := string(redacted)
	if strings.Contains(s, "Bearer X") || strings.Contains(s, "abc") || strings.Contains(s, "\"p\"") {
		t.Fatalf("redaction failed: %s", s)
	}
	if !strings.Contains(s, "[redacted]") {
		t.Fatalf("expected masked marker: %s", s)
	}
	var obj map[string]any
	if err := json.Unmarshal(redacted, &obj); err != nil {
		t.Fatalf("redacted json invalid: %v", err)
	}
}

func TestRedactACPPayload_Truncate64KB(t *testing.T) {
	base := strings.Repeat("x", acpDebugPayloadMaxBytes+1024)
	raw := []byte(`{"method":"session/prompt","params":{"sessionId":"s","content":"` + base + `"}}`)
	out := redactAndTrimACPPayload(raw)
	if len(out) > acpDebugPayloadMaxBytes {
		t.Fatalf("len=%d, want <=%d", len(out), acpDebugPayloadMaxBytes)
	}
}

func TestLogOutboundACPDebugLine(t *testing.T) {
	debugLog := filepath.Join(t.TempDir(), "hub.debug.log")
	if err := logger.Setup(logger.LoggerConfig{Level: logger.LevelDebug, DebugLogFile: debugLog}); err != nil {
		t.Fatalf("setup logger: %v", err)
	}

	raw := []byte(`{"method":"session/prompt","params":{"sessionId":"sess-1","token":"abc"}}`)
	newACPProcessLogSink("codex").Frame('>', raw)
	logger.Close()

	data, err := os.ReadFile(debugLog)
	if err != nil {
		t.Fatalf("read debug log: %v", err)
	}

	got := string(data)
	if got == "" || !strings.Contains(got, "[acp] >[codex] [Notify session/prompt]") {
		t.Fatalf("unexpected outbound log: %q", got)
	}
	if strings.Contains(got, "abc") {
		t.Fatalf("outbound log should redact payload: %q", got)
	}
}

func TestLogACPStderrLineSuppressedAtWarn(t *testing.T) {
	var buf bytes.Buffer
	if err := logger.Setup(logger.LoggerConfig{Level: logger.LevelWarn}); err != nil {
		t.Fatalf("setup logger: %v", err)
	}
	defer logger.Close()
	logger.SetOutput(&buf)
	defer logger.SetOutput(os.Stderr)

	newACPProcessLogSink("codex").StderrLine("panic: worker crashed")
	got := buf.String()
	if got != "" {
		t.Fatalf("ordinary stderr should be suppressed at warn level: %q", got)
	}
}

func TestLogACPStderrLineAtDebug(t *testing.T) {
	debugLog := filepath.Join(t.TempDir(), "hub.debug.log")
	if err := logger.Setup(logger.LoggerConfig{Level: logger.LevelDebug, DebugLogFile: debugLog}); err != nil {
		t.Fatalf("setup logger: %v", err)
	}

	newACPProcessLogSink("codex").StderrLine("panic: worker crashed")
	logger.Close()

	data, err := os.ReadFile(debugLog)
	if err != nil {
		t.Fatalf("read debug log: %v", err)
	}
	if got := string(data); !strings.Contains(got, "[acp] ![codex] panic: worker crashed") {
		t.Fatalf("unexpected debug stderr log: %q", got)
	}
}

func TestFormatACPLogLine_ResponseShape(t *testing.T) {
	payload := []byte(`{"jsonrpc":"2.0","id":7,"result":{"ok":true}}`)
	line := formatACPLogLine('<', "claude", payload)
	if !strings.Contains(line, "[acp] <[claude] [Resp 7]") {
		t.Fatalf("line=%q", line)
	}
	if strings.Contains(line, "jsonrpc") {
		t.Fatalf("line contains verbose metadata: %q", line)
	}
}

func TestFormatACPLogLine_NotifySessionUpdateFilter(t *testing.T) {
	payload := []byte(`{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"session-1234567890","update":{"sessionUpdate":"tool_call_update","status":"completed","title":"Edit file"}}}`)
	line := formatACPLogLine('<', "copilot", payload)
	if !strings.Contains(line, "[acp] <[copilot] [Notify session/update]") {
		t.Fatalf("line=%q", line)
	}
	if !strings.Contains(line, "sessio...7890, tool_call_update {") {
		t.Fatalf("filtered body missing: %q", line)
	}
	if strings.Contains(line, `"sessionId":"session-1234567890"`) {
		t.Fatalf("session/update filter should replace raw params: %q", line)
	}
}

func TestCodexProviderUsesAppServerStdio(t *testing.T) {
	p := NewCodexProvider()
	p.lookPath = func(bin string) (string, error) {
		if bin != "codex" {
			t.Fatalf("lookPath bin=%q, want codex", bin)
		}
		return "/usr/bin/codex", nil
	}

	exe, args, env, err := p.Launch()
	if err != nil {
		t.Fatalf("launch: %v", err)
	}
	if p.Name() != "codex" {
		t.Fatalf("Name()=%q, want codex", p.Name())
	}
	if exe != "/usr/bin/codex" {
		t.Fatalf("exe=%q", exe)
	}
	if !reflect.DeepEqual(args, []string{"app-server", "--listen", "stdio://"}) {
		t.Fatalf("args=%v", args)
	}
	if len(env) != 0 {
		t.Fatalf("env=%v, want empty", env)
	}
}

func TestClaudeACPProvider_UsesGlobalBinaryByDefault(t *testing.T) {
	p := NewClaudeProvider()
	p.resolveBinary = func(name string, configuredPath string, installHint string) (string, error) {
		if name != "claude-agent-acp" {
			t.Fatalf("resolveBinary name=%q, want claude-agent-acp", name)
		}
		if configuredPath != "" {
			t.Fatalf("resolveBinary configuredPath=%q, want empty", configuredPath)
		}
		return "/usr/bin/claude-agent-acp", nil
	}
	p.lookPath = func(bin string) (string, error) {
		t.Fatalf("lookPath should not be called: bin=%q", bin)
		return "", nil
	}

	exe, args, _, err := p.Launch()
	if err != nil {
		t.Fatalf("launch: %v", err)
	}
	if exe != "/usr/bin/claude-agent-acp" {
		t.Fatalf("exe=%q", exe)
	}
	if len(args) != 0 {
		t.Fatalf("args=%v, want empty", args)
	}
}

func TestClaudeCompatibleProvidersLaunchEnvironment(t *testing.T) {
	stateDir := filepath.Join(t.TempDir(), "state")
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	globalSkillDir := filepath.Join(homeDir, ".claude", "skills", "shared-skill")
	if err := os.MkdirAll(globalSkillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll global skill: %v", err)
	}
	if err := os.WriteFile(filepath.Join(globalSkillDir, "SKILL.md"), []byte("# Shared skill\n"), 0o600); err != nil {
		t.Fatalf("WriteFile global skill: %v", err)
	}
	tests := []struct {
		name         string
		newProvider  func(string, string) *acpProvider
		key          string
		wantArgs     []string
		wantEnv      map[string]string
		wantSettings map[string]any
	}{
		{
			name:        "deepseek",
			newProvider: NewCCDeepSeekProvider,
			key:         "deepseek-test-key",
			wantArgs:    []string{"--hide-claude-auth"},
			wantEnv: map[string]string{
				"CLAUDE_CONFIG_DIR":       filepath.Join(stateDir, ".data", "cc-deepseek"),
				"ANTHROPIC_BASE_URL":      "https://api.deepseek.com/anthropic",
				"ANTHROPIC_AUTH_TOKEN":    "deepseek-test-key",
				"ANTHROPIC_API_KEY":       "",
				"CLAUDE_CODE_USE_BEDROCK": "",
				"CLAUDE_CODE_USE_VERTEX":  "",
				"CLAUDE_CODE_USE_FOUNDRY": "",
			},
			wantSettings: map[string]any{
				"model":                  "deepseek-v4-pro[1m]",
				"availableModels":        []any{"deepseek-v4-pro[1m]", "deepseek-v4-flash"},
				"enforceAvailableModels": true,
				"env": map[string]any{
					"ANTHROPIC_DEFAULT_OPUS_MODEL":             "deepseek-v4-pro[1m]",
					"ANTHROPIC_DEFAULT_SONNET_MODEL":           "deepseek-v4-pro[1m]",
					"ANTHROPIC_DEFAULT_HAIKU_MODEL":            "deepseek-v4-flash",
					"CLAUDE_CODE_SUBAGENT_MODEL":               "deepseek-v4-flash",
					"CLAUDE_CODE_EFFORT_LEVEL":                 "max",
					"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
				},
			},
		},
		{
			name:        "kimi",
			newProvider: NewCCKimiProvider,
			key:         "kimi-test-key",
			wantArgs:    []string{"--hide-claude-auth"},
			wantEnv: map[string]string{
				"CLAUDE_CONFIG_DIR":       filepath.Join(stateDir, ".data", "cc-kimi"),
				"ANTHROPIC_BASE_URL":      "https://api.kimi.com/coding/",
				"ANTHROPIC_API_KEY":       "kimi-test-key",
				"ANTHROPIC_AUTH_TOKEN":    "",
				"CLAUDE_CODE_USE_BEDROCK": "",
				"CLAUDE_CODE_USE_VERTEX":  "",
				"CLAUDE_CODE_USE_FOUNDRY": "",
			},
			wantSettings: map[string]any{
				"model":                  "k3[1m]",
				"availableModels":        []any{"k3[1m]"},
				"enforceAvailableModels": true,
				"env": map[string]any{
					"ANTHROPIC_DEFAULT_FABLE_MODEL":       "k3[1m]",
					"ANTHROPIC_DEFAULT_FABLE_MODEL_NAME":  "Kimi K3 (1M)",
					"ANTHROPIC_DEFAULT_OPUS_MODEL":        "k3[1m]",
					"ANTHROPIC_DEFAULT_OPUS_MODEL_NAME":   "Kimi K3 (1M)",
					"ANTHROPIC_DEFAULT_SONNET_MODEL":      "k3[1m]",
					"ANTHROPIC_DEFAULT_SONNET_MODEL_NAME": "Kimi K3 (1M)",
					"ANTHROPIC_DEFAULT_HAIKU_MODEL":       "k3[1m]",
					"ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME":  "Kimi K3 (1M)",
					"CLAUDE_CODE_SUBAGENT_MODEL":          "k3[1m]",
					"CLAUDE_CODE_AUTO_COMPACT_WINDOW":     "1048576",
					"CLAUDE_CODE_MAX_CONTEXT_TOKENS":      "1048576",
				},
			},
		},
		{
			name:        "glm",
			newProvider: NewCCGLMProvider,
			key:         "zai-test-key",
			wantArgs:    []string{"--hide-claude-auth"},
			wantEnv: map[string]string{
				"CLAUDE_CONFIG_DIR":       filepath.Join(stateDir, ".data", "cc-glm"),
				"ANTHROPIC_BASE_URL":      "https://api.z.ai/api/anthropic",
				"ANTHROPIC_AUTH_TOKEN":    "zai-test-key",
				"ANTHROPIC_API_KEY":       "",
				"CLAUDE_CODE_USE_BEDROCK": "",
				"CLAUDE_CODE_USE_VERTEX":  "",
				"CLAUDE_CODE_USE_FOUNDRY": "",
			},
			wantSettings: map[string]any{
				"model":                  "glm-5.2[1m]",
				"availableModels":        []any{"glm-5.2[1m]", "glm-5-turbo", "glm-5v-turbo", "glm-5.1", "glm-4.7", "glm-4.5-air"},
				"enforceAvailableModels": true,
				"env": map[string]any{
					"ANTHROPIC_DEFAULT_FABLE_MODEL":            "glm-5.2[1m]",
					"ANTHROPIC_DEFAULT_FABLE_MODEL_NAME":       "GLM-5.2 (1M)",
					"ANTHROPIC_DEFAULT_OPUS_MODEL":             "glm-5.2[1m]",
					"ANTHROPIC_DEFAULT_OPUS_MODEL_NAME":        "GLM-5.2 (1M)",
					"ANTHROPIC_DEFAULT_SONNET_MODEL":           "glm-5.2[1m]",
					"ANTHROPIC_DEFAULT_SONNET_MODEL_NAME":      "GLM-5.2 (1M)",
					"ANTHROPIC_DEFAULT_HAIKU_MODEL":            "glm-4.5-air",
					"ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME":       "GLM-4.5-Air",
					"CLAUDE_CODE_SUBAGENT_MODEL":               "glm-5.2[1m]",
					"CLAUDE_CODE_AUTO_COMPACT_WINDOW":          "1000000",
					"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
					"API_TIMEOUT_MS":                           "3000000",
				},
			},
		},
		{
			name:        "qwen",
			newProvider: NewCCQwenProvider,
			key:         "qwen-test-key",
			wantArgs:    []string{"--hide-claude-auth"},
			wantEnv: map[string]string{
				"CLAUDE_CONFIG_DIR":       filepath.Join(stateDir, ".data", "cc-qwen"),
				"ANTHROPIC_BASE_URL":      "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
				"ANTHROPIC_AUTH_TOKEN":    "qwen-test-key",
				"ANTHROPIC_API_KEY":       "",
				"CLAUDE_CODE_USE_BEDROCK": "",
				"CLAUDE_CODE_USE_VERTEX":  "",
				"CLAUDE_CODE_USE_FOUNDRY": "",
			},
			wantSettings: map[string]any{
				"model": "qwen3.8-max",
				"availableModels": []any{
					"qwen3.8-max",
					"qwen3.7-max",
					"qwen3.7-plus",
					"qwen3.6-flash",
					"glm-5.2",
					"deepseek-v4-pro",
				},
				"enforceAvailableModels": true,
				"env": map[string]any{
					"ANTHROPIC_DEFAULT_FABLE_MODEL":       "qwen3.8-max",
					"ANTHROPIC_DEFAULT_FABLE_MODEL_NAME":  "qwen3.8-max",
					"ANTHROPIC_DEFAULT_OPUS_MODEL":        "qwen3.8-max",
					"ANTHROPIC_DEFAULT_OPUS_MODEL_NAME":   "qwen3.8-max",
					"ANTHROPIC_DEFAULT_SONNET_MODEL":      "qwen3.8-max",
					"ANTHROPIC_DEFAULT_SONNET_MODEL_NAME": "qwen3.8-max",
					"ANTHROPIC_DEFAULT_HAIKU_MODEL":       "deepseek-v4-pro",
					"ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME":  "DeepSeek V4 Pro",
					"CLAUDE_CODE_SUBAGENT_MODEL":          "qwen3.8-max",
					"CLAUDE_CODE_MAX_CONTEXT_TOKENS":      "983616",
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			provider := tt.newProvider(stateDir, tt.key)
			provider.resolveBinary = func(name, configuredPath, installHint string) (string, error) {
				if name != "claude-agent-acp" {
					t.Fatalf("resolveBinary name=%q, want claude-agent-acp", name)
				}
				if configuredPath != "" {
					t.Fatalf("resolveBinary configuredPath=%q, want empty", configuredPath)
				}
				return "/usr/bin/claude-agent-acp", nil
			}

			exe, args, env, err := provider.Launch()
			if err != nil {
				t.Fatalf("Launch() error = %v", err)
			}
			if exe != "/usr/bin/claude-agent-acp" {
				t.Fatalf("executable = %q", exe)
			}
			if !reflect.DeepEqual(args, tt.wantArgs) {
				t.Fatalf("args = %v, want %v", args, tt.wantArgs)
			}
			gotEnv := testEnvironmentMap(t, env)
			for name, want := range tt.wantEnv {
				got, ok := gotEnv[name]
				if !ok {
					t.Fatalf("env[%q] is missing, want %q; env=%v", name, want, gotEnv)
				}
				if got != want {
					t.Fatalf("env[%q] = %q, want %q; env=%v", name, got, want, gotEnv)
				}
			}
			for _, forbidden := range []string{
				"ANTHROPIC_MODEL",
				"CLAUDE_MODEL_CONFIG",
				"CLAUDE_CODE_EFFORT_LEVEL",
				"CLAUDE_CODE_AUTO_COMPACT_WINDOW",
				"CLAUDE_CODE_MAX_CONTEXT_TOKENS",
			} {
				if _, ok := gotEnv[forbidden]; ok {
					t.Fatalf("launch environment unexpectedly contains %s", forbidden)
				}
			}
			settingsPath := filepath.Join(gotEnv["CLAUDE_CONFIG_DIR"], "settings.json")
			settingsData, err := os.ReadFile(settingsPath)
			if err != nil {
				t.Fatalf("read generated settings: %v", err)
			}
			if strings.Contains(string(settingsData), tt.key) {
				t.Fatalf("generated settings leaked provider API key: %s", settingsData)
			}
			var gotSettings map[string]any
			if err := json.Unmarshal(settingsData, &gotSettings); err != nil {
				t.Fatalf("generated settings are invalid JSON: %v", err)
			}
			if !reflect.DeepEqual(gotSettings, tt.wantSettings) {
				t.Fatalf("settings = %#v, want %#v", gotSettings, tt.wantSettings)
			}
			sharedSkillPath := filepath.Join(gotEnv["CLAUDE_CONFIG_DIR"], "skills", "shared-skill", "SKILL.md")
			sharedSkillData, err := os.ReadFile(sharedSkillPath)
			if err != nil {
				t.Fatalf("read shared global skill through provider config: %v", err)
			}
			if string(sharedSkillData) != "# Shared skill\n" {
				t.Fatalf("shared global skill = %q, want %q", sharedSkillData, "# Shared skill\n")
			}
			if tt.name == "glm" {
				for _, model := range gotSettings["availableModels"].([]any) {
					if model == "glm-5.2" {
						t.Fatal("GLM model picker unexpectedly contains the non-1M glm-5.2 variant")
					}
				}
			}
			joinedArgs := strings.Join(args, " ")
			if strings.Contains(joinedArgs, tt.key) || strings.Contains(exe, tt.key) {
				t.Fatalf("provider key leaked into executable/args: exe=%q args=%v", exe, args)
			}
		})
	}
}

func TestEnsureClaudeCompatibleSkillsSharesWholeNativeDirectory(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	nativeSkillsDir := filepath.Join(homeDir, ".claude", "skills")
	if err := os.MkdirAll(nativeSkillsDir, 0o755); err != nil {
		t.Fatalf("MkdirAll native skills: %v", err)
	}

	configDir := filepath.Join(t.TempDir(), "state", ".data", "cc-glm")
	if err := ensureClaudeCompatibleSkills(configDir); err != nil {
		t.Fatalf("ensureClaudeCompatibleSkills() error = %v", err)
	}
	if err := ensureClaudeCompatibleSkills(configDir); err != nil {
		t.Fatalf("ensureClaudeCompatibleSkills() second call error = %v", err)
	}

	skillDir := filepath.Join(nativeSkillsDir, "added-after-link")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll skill: %v", err)
	}
	want := []byte("# Added after link\n")
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), want, 0o600); err != nil {
		t.Fatalf("WriteFile skill: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(configDir, "skills", "added-after-link", "SKILL.md"))
	if err != nil {
		t.Fatalf("read skill through shared directory: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("shared skill = %q, want %q", got, want)
	}
}

func TestEnsureClaudeCompatibleSkillsReplacesEmptyDirectory(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	nativeSkillsDir := filepath.Join(homeDir, ".claude", "skills")
	if err := os.MkdirAll(nativeSkillsDir, 0o755); err != nil {
		t.Fatalf("MkdirAll native skills: %v", err)
	}

	configDir := filepath.Join(t.TempDir(), "state", ".data", "cc-kimi")
	sharedSkillsDir := filepath.Join(configDir, "skills")
	if err := os.MkdirAll(sharedSkillsDir, 0o755); err != nil {
		t.Fatalf("MkdirAll empty provider skills: %v", err)
	}
	if err := ensureClaudeCompatibleSkills(configDir); err != nil {
		t.Fatalf("ensureClaudeCompatibleSkills() error = %v", err)
	}

	skillDir := filepath.Join(nativeSkillsDir, "visible-after-migration")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll skill: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("# Visible\n"), 0o600); err != nil {
		t.Fatalf("WriteFile skill: %v", err)
	}
	if _, err := os.ReadFile(filepath.Join(sharedSkillsDir, "visible-after-migration", "SKILL.md")); err != nil {
		t.Fatalf("read skill through migrated directory: %v", err)
	}
}

func TestEnsureClaudeCompatibleSkillsPreservesNonEmptyDirectory(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)

	configDir := filepath.Join(t.TempDir(), "state", ".data", "cc-deepseek")
	sharedSkillsDir := filepath.Join(configDir, "skills")
	if err := os.MkdirAll(sharedSkillsDir, 0o755); err != nil {
		t.Fatalf("MkdirAll provider skills: %v", err)
	}
	localSkillPath := filepath.Join(sharedSkillsDir, "local-only", "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(localSkillPath), 0o755); err != nil {
		t.Fatalf("MkdirAll local skill: %v", err)
	}
	if err := os.WriteFile(localSkillPath, []byte("# Keep me\n"), 0o600); err != nil {
		t.Fatalf("WriteFile local skill: %v", err)
	}

	err := ensureClaudeCompatibleSkills(configDir)
	if err == nil || !strings.Contains(err.Error(), "not empty") {
		t.Fatalf("ensureClaudeCompatibleSkills() error = %v, want non-empty directory error", err)
	}
	got, readErr := os.ReadFile(localSkillPath)
	if readErr != nil {
		t.Fatalf("read preserved local skill: %v", readErr)
	}
	if string(got) != "# Keep me\n" {
		t.Fatalf("preserved local skill = %q, want %q", got, "# Keep me\n")
	}
}

func TestEnsureClaudeCompatibleSkillsPreservesDifferentLink(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	nativeSkillsDir := filepath.Join(homeDir, ".claude", "skills")
	if err := os.MkdirAll(nativeSkillsDir, 0o755); err != nil {
		t.Fatalf("MkdirAll native skills: %v", err)
	}

	configDir := filepath.Join(t.TempDir(), "state", ".data", "cc-qwen")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatalf("MkdirAll config: %v", err)
	}
	otherSkillsDir := filepath.Join(t.TempDir(), "other-skills")
	if err := os.MkdirAll(otherSkillsDir, 0o755); err != nil {
		t.Fatalf("MkdirAll other skills: %v", err)
	}
	sharedSkillsDir := filepath.Join(configDir, "skills")
	if err := createDirectoryLink(otherSkillsDir, sharedSkillsDir); err != nil {
		t.Fatalf("createDirectoryLink: %v", err)
	}

	err := ensureClaudeCompatibleSkills(configDir)
	if err == nil || !strings.Contains(err.Error(), "links to") {
		t.Fatalf("ensureClaudeCompatibleSkills() error = %v, want different link error", err)
	}
	if _, readlinkErr := os.Readlink(sharedSkillsDir); readlinkErr != nil {
		t.Fatalf("different link was not preserved: %v", readlinkErr)
	}
}

func TestClaudeCompatibleProviderSettingsMergePreservesUserFields(t *testing.T) {
	stateDir := filepath.Join(t.TempDir(), "state")
	settingsDir := filepath.Join(stateDir, ".data", "cc-glm")
	if err := os.MkdirAll(settingsDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	settingsPath := filepath.Join(settingsDir, "settings.json")
	existing := `{
  "permissions": {"allow": ["Bash(go test ./...)"]},
  "model": "old-model",
  "availableModels": ["old-model"],
  "env": {
    "CUSTOM_SETTING": "keep-me",
    "CLAUDE_CODE_EFFORT_LEVEL": "low",
    "ANTHROPIC_MODEL": "old-model"
  }
}`
	if err := os.WriteFile(settingsPath, []byte(existing), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	provider := NewCCGLMProvider(stateDir, "secret-key")
	provider.resolveBinary = func(string, string, string) (string, error) {
		return "/usr/bin/claude-agent-acp", nil
	}
	if _, _, _, err := provider.Launch(); err != nil {
		t.Fatalf("Launch: %v", err)
	}

	data, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	var settings map[string]any
	if err := json.Unmarshal(data, &settings); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	permissions, ok := settings["permissions"].(map[string]any)
	if !ok || !reflect.DeepEqual(permissions["allow"], []any{"Bash(go test ./...)"}) {
		t.Fatalf("permissions were not preserved: %#v", settings["permissions"])
	}
	env, ok := settings["env"].(map[string]any)
	if !ok {
		t.Fatalf("env = %#v, want object", settings["env"])
	}
	if env["CUSTOM_SETTING"] != "keep-me" {
		t.Fatalf("custom env was not preserved: %#v", env)
	}
	for _, removed := range []string{"CLAUDE_CODE_EFFORT_LEVEL", "ANTHROPIC_MODEL"} {
		if _, exists := env[removed]; exists {
			t.Fatalf("obsolete managed env %s was not removed: %#v", removed, env)
		}
	}
}

func TestClaudeCompatibleProviderSettingsRejectMalformedJSONWithoutOverwrite(t *testing.T) {
	stateDir := filepath.Join(t.TempDir(), "state")
	settingsDir := filepath.Join(stateDir, ".data", "cc-kimi")
	if err := os.MkdirAll(settingsDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	settingsPath := filepath.Join(settingsDir, "settings.json")
	malformed := []byte(`{"model":`)
	if err := os.WriteFile(settingsPath, malformed, 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	provider := NewCCKimiProvider(stateDir, "secret-key")
	provider.resolveBinary = func(string, string, string) (string, error) {
		return "/usr/bin/claude-agent-acp", nil
	}
	if _, _, _, err := provider.Launch(); err == nil {
		t.Fatal("Launch error = nil, want malformed settings error")
	}
	got, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if !bytes.Equal(got, malformed) {
		t.Fatalf("malformed settings were overwritten: got %q, want %q", got, malformed)
	}
}

func TestClaudeCompatibleProviderSettingsWriteIsIdempotent(t *testing.T) {
	stateDir := filepath.Join(t.TempDir(), "state")
	provider := NewCCDeepSeekProvider(stateDir, "secret-key")
	provider.resolveBinary = func(string, string, string) (string, error) {
		return "/usr/bin/claude-agent-acp", nil
	}
	if _, _, _, err := provider.Launch(); err != nil {
		t.Fatalf("first Launch: %v", err)
	}
	settingsPath := filepath.Join(stateDir, ".data", "cc-deepseek", "settings.json")
	before, err := os.Stat(settingsPath)
	if err != nil {
		t.Fatalf("Stat before: %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	if _, _, _, err := provider.Launch(); err != nil {
		t.Fatalf("second Launch: %v", err)
	}
	after, err := os.Stat(settingsPath)
	if err != nil {
		t.Fatalf("Stat after: %v", err)
	}
	if !after.ModTime().Equal(before.ModTime()) {
		t.Fatalf("settings file was rewritten: before=%v after=%v", before.ModTime(), after.ModTime())
	}
}

func TestClaudeCompatibleFlickerSettingsWriteStaticModelsWithGatewayDiscovery(t *testing.T) {
	configDir := filepath.Join(t.TempDir(), "cc-flicker")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	profile := claudeCompatibleProfile{
		configDir:        configDir,
		endpoint:         "http://127.0.0.1:17999",
		authName:         "ANTHROPIC_AUTH_TOKEN",
		defaultModel:     "CLAUDE_OPUS_4_8",
		gatewayDiscovery: true,
		staticModels: []claudeModelEntry{
			{ID: "CLAUDE_OPUS_4_8", Name: "MF Claude Opus 4.8"},
			{ID: "CLAUDE-MYFLICKER-GPT_5_4", Name: "MF GPT-5.4"},
		},
		settingsEnv: map[string]string{"CLAUDE_CODE_SUBAGENT_MODEL": "CLAUDE_4_6"},
	}
	if err := ensureClaudeCompatibleSettings(profile); err != nil {
		t.Fatalf("ensureClaudeCompatibleSettings: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(configDir, "settings.json"))
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	var settings map[string]any
	if err := json.Unmarshal(data, &settings); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	env, ok := settings["env"].(map[string]any)
	if !ok || env[gatewayModelDiscoveryEnv] != "1" {
		t.Fatalf("gateway discovery env not set: %#v", settings["env"])
	}
	if _, exists := settings["enforceAvailableModels"]; exists {
		t.Fatalf("gateway discovery must not write enforceAvailableModels: %#v", settings)
	}
	availableModels, ok := settings["availableModels"].([]any)
	if !ok || len(availableModels) != 2 ||
		availableModels[0] != "CLAUDE_OPUS_4_8" ||
		availableModels[1] != "CLAUDE-MYFLICKER-GPT_5_4" {
		t.Fatalf("availableModels = %#v, want dynamic bridge model ids", settings["availableModels"])
	}
	models, ok := settings["models"].([]any)
	if !ok || len(models) != 2 {
		t.Fatalf("models = %#v, want 2-entry object array", settings["models"])
	}
	found := false
	for _, entry := range models {
		object, ok := entry.(map[string]any)
		if !ok || object["id"] == "" || object["name"] == "" {
			t.Fatalf("model entry missing id/name: %#v", entry)
		}
		if object["id"] == "CLAUDE-MYFLICKER-GPT_5_4" {
			found = true
		}
	}
	if !found {
		t.Fatalf("static models did not survive: %#v", models)
	}
}

func TestClaudeCompatibleFlickerSettingsDropStaleModelsWhenEmpty(t *testing.T) {
	configDir := filepath.Join(t.TempDir(), "cc-flicker")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	settingsPath := filepath.Join(configDir, "settings.json")
	existing := `{"models": [{"id": "STALE", "name": "stale"}], "availableModels": ["STALE"], "env": {}}`
	if err := os.WriteFile(settingsPath, []byte(existing), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	profile := claudeCompatibleProfile{
		configDir:        configDir,
		endpoint:         "http://127.0.0.1:17999",
		authName:         "ANTHROPIC_AUTH_TOKEN",
		defaultModel:     "CLAUDE_OPUS_4_8",
		gatewayDiscovery: true,
	}
	if err := ensureClaudeCompatibleSettings(profile); err != nil {
		t.Fatalf("ensureClaudeCompatibleSettings: %v", err)
	}
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	var settings map[string]any
	if err := json.Unmarshal(data, &settings); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if _, exists := settings["models"]; exists {
		t.Fatalf("stale models must be dropped when no static models: %#v", settings)
	}
	if _, exists := settings["availableModels"]; exists {
		t.Fatalf("stale availableModels must be dropped when no static models: %#v", settings)
	}
}

func TestClaudeCompatibleProviderLaunchErrorDoesNotLeakKey(t *testing.T) {
	const key = "zai-test-key"
	provider := NewCCGLMProvider(filepath.Join(t.TempDir(), "state"), key)
	provider.resolveBinary = func(name, configuredPath, installHint string) (string, error) {
		return "", fmt.Errorf("binary %s is unavailable", name)
	}

	_, _, _, err := provider.Launch()
	if err == nil {
		t.Fatal("Launch() error = nil, want binary resolution error")
	}
	if strings.Contains(err.Error(), key) {
		t.Fatalf("Launch() error leaked provider key: %v", err)
	}
}

func TestCCFlickerProviderLaunchErrorDoesNotLeakKey(t *testing.T) {
	const key = "flicker-test-key"
	provider := NewCCFlickerProvider(filepath.Join(t.TempDir(), "state"), key, nil)
	provider.resolveBinary = func(name, configuredPath, installHint string) (string, error) {
		return "", fmt.Errorf("binary %s is unavailable", name)
	}

	_, _, _, err := provider.Launch()
	if err == nil {
		t.Fatal("Launch() error = nil, want binary resolution error")
	}
	if strings.Contains(err.Error(), key) {
		t.Fatalf("Launch() error leaked provider key: %v", err)
	}
}

func TestCCFlickerProviderLaunchRegistersEffortCapabilityLoader(t *testing.T) {
	provider := NewCCFlickerProvider(filepath.Join(t.TempDir(), "state"), "flicker-test-key", nil)
	provider.resolveBinary = func(name, configuredPath, installHint string) (string, error) {
		return "/usr/bin/claude-agent-acp", nil
	}

	_, _, env, err := provider.Launch()
	if err != nil {
		t.Fatalf("Launch: %v", err)
	}
	values := testEnvironmentMap(t, env)
	if got := values["NODE_OPTIONS"]; !strings.Contains(got, "--import=data:text/javascript;base64,") {
		t.Fatalf("NODE_OPTIONS = %q, want registered cc-flicker effort loader", got)
	}
}

func TestCCFlickerEffortLoaderAddsCapabilitiesToAllowlistedModels(t *testing.T) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Skipf("node not available: %v", err)
	}
	tempDir := t.TempDir()
	loaderPath := filepath.Join(tempDir, "cc_flicker_effort_loader.mjs")
	if err := os.WriteFile(loaderPath, []byte(ccFlickerEffortLoaderSource), 0o644); err != nil {
		t.Fatalf("write loader: %v", err)
	}
	fixturePath := filepath.Join(tempDir, "acp-agent.js")
	fixture := `
export function applyAvailableModelsAllowlist(sdkModels, allowlist, settingsModelOverrides) {
  const defaultModel = sdkModels[0];
  const result = [defaultModel];
  const seen = new Set([defaultModel.value]);
  const sdkModelsWithoutDefault = sdkModels.filter((m) => m.value !== "default");
  for (const entry of allowlist) {
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    const overridden = settingsModelOverrides?.[trimmed];
    const effective = overridden ?? trimmed;
    if (seen.has(effective)) continue;
    const sdkMatch = sdkModelsWithoutDefault.find((model) => model.value === trimmed);
    if (sdkMatch) {
      result.push({ ...sdkMatch, value: effective });
    }
    else {
      result.push({ value: effective, displayName: trimmed, description: "" });
    }
    seen.add(effective);
  }
  return result;
}
`
	if err := os.WriteFile(fixturePath, []byte(fixture), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	runnerPath := filepath.Join(tempDir, "runner.mjs")
	runner := `
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const loader = await import(pathToFileURL(process.argv[2]));
const source = readFileSync(process.argv[3], "utf8");
const patched = await loader.load(
  "file:///tmp/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js",
  {},
  async () => ({ format: "module", source })
);
const moduleURL = "data:text/javascript;base64," + Buffer.from(patched.source).toString("base64");
const module = await import(moduleURL);
const models = module.applyAvailableModelsAllowlist(
  [
    { value: "default", displayName: "Default" },
    { value: "claude-opus", displayName: "Claude Opus" }
  ],
  ["claude-opus", "kimi-k3"],
  {}
);
process.stdout.write(JSON.stringify(models));
`
	if err := os.WriteFile(runnerPath, []byte(runner), 0o644); err != nil {
		t.Fatalf("write runner: %v", err)
	}
	output, err := exec.Command(nodePath, runnerPath, loaderPath, fixturePath).CombinedOutput()
	if err != nil {
		t.Fatalf("run loader fixture: %v\n%s", err, output)
	}
	var models []struct {
		Value                 string   `json:"value"`
		SupportsEffort        bool     `json:"supportsEffort"`
		SupportedEffortLevels []string `json:"supportedEffortLevels"`
	}
	if err := json.Unmarshal(output, &models); err != nil {
		t.Fatalf("decode patched models: %v\n%s", err, output)
	}
	wantLevels := []string{"low", "medium", "high", "xhigh", "max"}
	if len(models) != 3 {
		t.Fatalf("models = %#v, want default plus two allowlisted models", models)
	}
	for _, model := range models[1:] {
		if !model.SupportsEffort || !reflect.DeepEqual(model.SupportedEffortLevels, wantLevels) {
			t.Fatalf("model %q effort capabilities = %v/%v, want true/%v",
				model.Value, model.SupportsEffort, model.SupportedEffortLevels, wantLevels)
		}
	}
}

func testEnvironmentMap(t *testing.T, values []string) map[string]string {
	t.Helper()
	result := make(map[string]string, len(values))
	for _, value := range values {
		name, content, ok := strings.Cut(value, "=")
		if !ok || name == "" {
			t.Fatalf("invalid environment entry %q", value)
		}
		result[name] = content
	}
	return result
}

func TestCopilotACPProvider_LaunchArgs(t *testing.T) {
	p := NewCopilotProvider()
	p.resolveBinary = func(name string, configuredPath string, installHint string) (string, error) {
		if name != "copilot" {
			t.Fatalf("resolveBinary name=%q, want copilot", name)
		}
		if configuredPath != "" {
			t.Fatalf("resolveBinary configuredPath=%q, want empty", configuredPath)
		}
		return "/usr/bin/copilot", nil
	}

	exe, args, env, err := p.Launch()
	if err != nil {
		t.Fatalf("launch: %v", err)
	}
	if exe != "/usr/bin/copilot" {
		t.Fatalf("exe=%q", exe)
	}
	if !reflect.DeepEqual(args, []string{"--acp", "--stdio"}) {
		t.Fatalf("args=%v", args)
	}
	if len(env) != 0 {
		t.Fatalf("env=%v, want empty", env)
	}
}

func TestOpenCodeACPProvider_LaunchArgs(t *testing.T) {
	p := NewOpenCodeProvider()
	p.resolveBinary = func(name string, configuredPath string, installHint string) (string, error) {
		if name != "opencode" {
			t.Fatalf("resolveBinary name=%q, want opencode", name)
		}
		if configuredPath != "" {
			t.Fatalf("resolveBinary configuredPath=%q, want empty", configuredPath)
		}
		return "/usr/bin/opencode", nil
	}

	exe, args, env, err := p.Launch()
	if err != nil {
		t.Fatalf("launch: %v", err)
	}
	if exe != "/usr/bin/opencode" {
		t.Fatalf("exe=%q", exe)
	}
	if !reflect.DeepEqual(args, []string{"acp"}) {
		t.Fatalf("args=%v", args)
	}
	if len(env) != 0 {
		t.Fatalf("env=%v, want empty", env)
	}
}

func TestCodeBuddyACPProvider_LaunchArgs(t *testing.T) {
	p := NewCodeBuddyProvider()
	p.resolveBinary = func(name string, configuredPath string, installHint string) (string, error) {
		if name != "codebuddy" {
			t.Fatalf("resolveBinary name=%q, want codebuddy", name)
		}
		if configuredPath != "" {
			t.Fatalf("resolveBinary configuredPath=%q, want empty", configuredPath)
		}
		return "/usr/bin/codebuddy", nil
	}

	exe, args, env, err := p.Launch()
	if err != nil {
		t.Fatalf("launch: %v", err)
	}
	if exe != "/usr/bin/codebuddy" {
		t.Fatalf("exe=%q", exe)
	}
	if !reflect.DeepEqual(args, []string{"--acp"}) {
		t.Fatalf("args=%v", args)
	}
	if len(env) != 0 {
		t.Fatalf("env=%v, want empty", env)
	}
}

func TestFlickerACPProvider_LaunchArgs(t *testing.T) {
	tempDir := t.TempDir()
	binDir := filepath.Join(tempDir, "bin")
	cliPath := filepath.Join(binDir, "node_modules", "@myflicker", "cli", "cli.mjs")
	if err := os.MkdirAll(filepath.Dir(cliPath), 0o755); err != nil {
		t.Fatalf("mkdir cli dir: %v", err)
	}
	if err := os.WriteFile(cliPath, []byte(""), 0o644); err != nil {
		t.Fatalf("write cli: %v", err)
	}
	myflickerPath := filepath.Join(binDir, "myflicker.cmd")
	if err := os.WriteFile(myflickerPath, []byte("@echo off\r\n"), 0o755); err != nil {
		t.Fatalf("write shim: %v", err)
	}

	p := NewFlickerProvider()
	p.resolveBinary = func(name string, configuredPath string, installHint string) (string, error) {
		if name != "myflicker" {
			t.Fatalf("resolveBinary name=%q, want myflicker", name)
		}
		if configuredPath != "" {
			t.Fatalf("resolveBinary configuredPath=%q, want empty", configuredPath)
		}
		return myflickerPath, nil
	}
	p.lookPath = func(file string) (string, error) {
		if file != "node" {
			t.Fatalf("lookPath file=%q, want node", file)
		}
		return filepath.Join(tempDir, "node"), nil
	}
	p.ensureFlickerLoader = func() (string, error) {
		return filepath.Join(tempDir, "flicker_acp_loader.mjs"), nil
	}

	exe, args, env, err := p.Launch()
	if err != nil {
		t.Fatalf("launch: %v", err)
	}
	if exe != filepath.Join(tempDir, "node") {
		t.Fatalf("exe=%q", exe)
	}
	loaderURL, err := nodeFileURL(filepath.Join(tempDir, "flicker_acp_loader.mjs"))
	if err != nil {
		t.Fatalf("loader url: %v", err)
	}
	wantArgs := []string{
		"--import", nodeRegisterImportArg(loaderURL),
		cliPath,
		"--approval-mode", "yolo",
		"--thinking-level", "xhigh",
		"acp",
	}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("args=%v", args)
	}
	if len(env) != 0 {
		t.Fatalf("env=%v, want empty", env)
	}
}

func TestFlickerLoaderRejectsLegacyMyFlickerBundleShape(t *testing.T) {
	tempDir := t.TempDir()
	fixturePath := filepath.Join(tempDir, "myflicker-legacy-fragment.mjs")
	if err := os.WriteFile(fixturePath, []byte(myFlickerLatestBundleFragment), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	out, err := runFlickerLoaderPatchCommand(t, fixturePath)
	if err == nil {
		t.Fatal("0.3.14-only loader unexpectedly patched the legacy bundle shape")
	}
	if !strings.Contains(string(out), "0.3.14 access config helpers") {
		t.Fatalf("legacy bundle failed for an unexpected reason: %s", out)
	}
}

func TestFlickerLoaderPatchesMyFlicker0314BundleShape(t *testing.T) {
	tempDir := t.TempDir()
	fixturePath := filepath.Join(tempDir, "myflicker-0314-fragment.mjs")
	if err := os.WriteFile(fixturePath, []byte(myFlicker0314BundleFragment), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	patched := runFlickerLoaderPatch(t, fixturePath)
	for _, marker := range []string{
		"function WMFA(",
		"return WMFA(Q,this.__wmfConfig)",
		"if(Q===\"access\")return await WMFS(this,B);",
		"async unstable_resumeSession(A){return await this.loadSession(A)}",
	} {
		if !strings.Contains(patched, marker) {
			t.Fatalf("patched 0.3.14 fixture missing %q", marker)
		}
	}
}

func TestFlickerLoaderPatchesInstalledMyFlickerBundleWhenAvailable(t *testing.T) {
	binaryPath, err := exec.LookPath("myflicker")
	if err != nil {
		t.Skipf("myflicker not available: %v", err)
	}
	cliPath, err := resolveFlickerCLIEntry(binaryPath)
	if err != nil {
		t.Skipf("installed myflicker CLI entry not available: %v", err)
	}
	distPath := filepath.Join(filepath.Dir(cliPath), "dist", "cli.mjs")
	if !exists(distPath) {
		t.Skipf("installed myflicker dist bundle not available at %s", distPath)
	}

	patched := runFlickerLoaderPatch(t, distPath)
	// Resume must be shimmed for every known bundle shape.
	if !strings.Contains(patched, "async unstable_resumeSession(A){return await this.loadSession(A)}") {
		t.Fatalf("patched installed bundle missing resume shim")
	}
	if !strings.Contains(patched, "function WMFA(") {
		t.Fatal("patched installed bundle missing WheelMaker access config option")
	}
	if !strings.Contains(patched, "return WMFA(Q,this.__wmfConfig)") {
		t.Fatal("patched installed bundle does not augment native config options with access")
	}
	if !strings.Contains(patched, "if(Q===\"access\")return await WMFS(this,B);") {
		t.Fatal("patched installed bundle missing access config handler")
	}
	if !strings.Contains(patched, "configOptions:this.buildSessionConfigOptions") {
		t.Fatalf("patched installed bundle missing native config options")
	}
	// The unimplemented stubs must be gone after patching.
	if strings.Contains(patched, "unstable_resumeSession(A){throw Error(\"Method not implemented.\")}") {
		t.Fatalf("patched installed bundle still has unimplemented resume stub")
	}
	if strings.Contains(patched, "unstable_setSessionConfigOption(A){throw Error(\"Method not implemented.\")}") {
		t.Fatalf("patched installed bundle still has unimplemented setSessionConfigOption stub")
	}
	if strings.Contains(patched, "this.connection.sessionUpdate({sessionId:Q,update:{sessionUpdate:w,content:{type:\"text\",text:z}}})") {
		t.Fatalf("latest patch should preserve upstream loadSession flow")
	}
}

func TestFlickerLoaderTargetsMyFlicker0314Only(t *testing.T) {
	for _, legacySnippet := range []string{
		"legacyConfigShape",
		"legacySetConfigStub",
		"function WMF(A,Q)",
	} {
		if strings.Contains(flickerACPLoaderSource, legacySnippet) {
			t.Fatalf("0.3.14-only loader still contains legacy compatibility code %q", legacySnippet)
		}
	}
}

func runFlickerLoaderPatch(t *testing.T, sourcePath string) string {
	t.Helper()
	out, err := runFlickerLoaderPatchCommand(t, sourcePath)
	if err != nil {
		t.Fatalf("patch runner failed: %v\n%s", err, out)
	}
	return string(out)
}

func runFlickerLoaderPatchCommand(t *testing.T, sourcePath string) ([]byte, error) {
	t.Helper()
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Skipf("node not available: %v", err)
	}

	tempDir := t.TempDir()
	loaderPath := filepath.Join(tempDir, "flicker_acp_loader.mjs")
	if err := os.WriteFile(loaderPath, []byte(flickerACPLoaderSource), 0o644); err != nil {
		t.Fatalf("write loader: %v", err)
	}
	runnerPath := filepath.Join(tempDir, "patch_runner.mjs")
	runner := `
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const loader = await import(pathToFileURL(process.argv[2]));
const source = readFileSync(process.argv[3], "utf8");
const result = await loader.load(
  "file:///tmp/node_modules/@myflicker/cli/dist/cli.mjs",
  {},
  async () => ({ format: "module", source })
);
process.stdout.write(result.source);
`
	if err := os.WriteFile(runnerPath, []byte(runner), 0o644); err != nil {
		t.Fatalf("write runner: %v", err)
	}

	return exec.Command(nodePath, runnerPath, loaderPath, sourcePath).CombinedOutput()
}

const myFlicker0314BundleFragment = `function pre(){}class pG0{connection;sessions=new Map;sessionModelMap=new Map;messageBus;nodeBridge;context;defaultCwd;contextCreateOpts;clientFsCapabilities;buildSessionConfigOptions(A){let Q=[];return Q}async unstable_setSessionConfigOption(A){if(!this.messageBus)throw Error("Agent not initialized");let{configId:Q,value:B}=A,$=this.sessions.get(A.sessionId);if(Q==="model")return $.setModel(B)}unstable_resumeSession(A){throw Error("Method not implemented.")}}`

const myFlickerLatestBundleFragment = `function IN4(){return{loadSession:!0,sessionCapabilities:{list:{}}}}class pG0{connection;sessions=new Map;messageBus;nodeBridge;context;defaultCwd;contextCreateOpts;clientFsCapabilities;runtimeMcpServers={};constructor(A,Q){this.connection=A,this.contextCreateOpts=Q,this.defaultCwd=Q.cwd||process.cwd()}async initialize(A){rG("Initializing ACP agent"),qMA("Initialize params: %O",A);let Q=A.clientCapabilities?.fs,B=Q?.readTextFile===!0,D=Q?.writeTextFile===!0;if(B||D)rG("Client supports file system capabilities:",Q),this.clientFsCapabilities=Q;else rG("Client did NOT enable any fs capability, using local fs only:",Q);rG("Creating Neovate context");let J=[...this.contextCreateOpts.plugins||[]];if(this.clientFsCapabilities){rG("Adding ACP file system plugin");let X=$V1({connection:this.connection,fsCaps:this.clientFsCapabilities});J.push(X)}rG("Creating NodeBridge and MessageBus");let $=new A9({contextCreateOpts:{...this.contextCreateOpts,cwd:this.defaultCwd,plugins:J}}),[Y,E]=D7.createPair(),G=new f9;return G.setTransport(Y),$.messageBus.setTransport(E),this.messageBus=G,this.nodeBridge=$,rG("Agent initialized successfully"),{protocolVersion:gH1,agentCapabilities:IN4()}}async getCanUseModels(){if(!this.messageBus)return;try{let B=(await this.messageBus.request("providers.list",{cwd:this.defaultCwd})).data.providers.filter((Y)=>Y.hasApiKey);if(B.length===0)return;let D=await this.messageBus.request("models.list",{cwd:this.defaultCwd});return{availableModels:D.data.groupedModels.filter((Y)=>B.some((E)=>E.id===Y.providerId)).flatMap((Y)=>Y.models).map((Y)=>({modelId:Y.value,name:Y.name})),currentModelId:` + "`" + `${D.data.currentModel.provider.id}/${D.data.currentModelInfo?.modelId??""}` + "`" + `}}catch(A){console.error("Failed to get available models:",A);return}}async registerRuntimeMcpServers(A){if(!this.messageBus)throw Error("Agent not initialized");if(Object.entries(A).length===0)return;this.runtimeMcpServers={...this.runtimeMcpServers,...A},await this.messageBus.request("mcp.addRuntimeServers",{cwd:this.defaultCwd,mcpServers:A})}async restoreRuntimeMcpServers(){if(!this.messageBus)throw Error("Agent not initialized");if(Object.keys(this.runtimeMcpServers).length===0)return;await this.messageBus.request("mcp.addRuntimeServers",{cwd:this.defaultCwd,mcpServers:this.runtimeMcpServers})}async newSession(A){if(!this.messageBus)throw Error("Agent not initialized");let Q=Array.from(VN4.getRandomValues(new Uint8Array(16))).map(($)=>$.toString(16).padStart(2,"0")).join("");rG("Creating new session:",Q),qMA("Session params: %O",A);let B=UV1(A.mcpServers),D=await this.getCanUseModels();await this.registerRuntimeMcpServers(B);let J=new zMA(Q,this.messageBus,this.connection,this.clientFsCapabilities);return this.sessions.set(Q,J),await J.init(),rG("Session created successfully:",Q),{sessionId:Q,models:D||void 0}}async loadSession(A){if(!this.messageBus)throw Error("Agent not initialized");rG("Loading session:",A.sessionId),qMA("Load session params: %O",A);let Q=await this.messageBus.request("sessions.resume",{cwd:A.cwd,sessionId:A.sessionId});if(!Q.success)throw t4.internalError({method:"sessions.resume",sessionId:A.sessionId});let B=Q.data.logFile;if(!HN4.existsSync(B))throw t4.resourceNotFound(` + "`" + `session:${A.sessionId}` + "`" + `);let D=UV1(A.mcpServers),J=await this.getCanUseModels();await this.registerRuntimeMcpServers(D);let $=this.sessions.get(A.sessionId);if(!$)$=new zMA(A.sessionId,this.messageBus,this.connection,this.clientFsCapabilities),this.sessions.set(A.sessionId,$),await $.init();return await $.replay(B),rG("Session loaded successfully:",A.sessionId),{models:J||void 0}}async setSessionModelValue(A){if(!this.messageBus)throw Error("Agent not initialized");await this.messageBus.request("config.set",{cwd:this.defaultCwd,key:"model",value:A,isGlobal:!0}),await this.restoreRuntimeMcpServers()}unstable_forkSession(A){throw Error("Method not implemented.")}async unstable_listSessions(A){if(!this.messageBus)throw Error("Agent not initialized");let Q=A.cwd??null,B=await this.messageBus.request("sessions.list",{cwd:Q??this.defaultCwd,allProjects:Q===null,includeBranch:!1});if(!B.success)throw t4.internalError({method:"sessions.list",cwd:Q??this.defaultCwd});return{sessions:(B.data?.sessions??[]).filter(($)=>$.messageCount>0).map(($)=>({sessionId:$.sessionId,cwd:$.projectCwd??Q??this.defaultCwd,title:$.summary||null,updatedAt:$.modified?.toISOString?.()??null})),nextCursor:null}}unstable_resumeSession(A){throw Error("Method not implemented.")}async setSessionMode(A){throw Error("Method not implemented.")}async unstable_setSessionModel(A){await this.setSessionModelValue(A.modelId)}unstable_setSessionConfigOption(A){throw Error("Method not implemented.")}authenticate(A){throw Error("Method not implemented.")}async prompt(A){let{sessionId:Q}=A;rG("Received prompt for session:",Q),qMA("Prompt params: %O",A);let B=this.sessions.get(Q);if(!B)throw Error(` + "`" + `Session ${Q} not found` + "`" + `);let D=await B.prompt(A);return rG("Prompt completed for session:",Q,"result:",D.stopReason),D}async cancel(A){let Q=this.sessions.get(A.sessionId);if(!Q)throw Error(` + "`" + `Session ${A.sessionId} not found` + "`" + `);await Q.abort()}extMethod(A,Q){throw Error("Method not implemented.")}extNotification(A,Q){throw Error("Method not implemented.")}}`

func TestParseACPProviderCodexAliases(t *testing.T) {
	removedProviderName := strings.Join([]string{"my", "flicker"}, "")

	provider, ok := protocol.ParseACPProvider("codex")
	if !ok {
		t.Fatal("ParseACPProvider(codex) returned ok=false")
	}
	if provider != protocol.ACPProviderCodex {
		t.Fatalf("provider=%q, want %q", provider, protocol.ACPProviderCodex)
	}
	if _, ok := protocol.ParseACPProvider("codexapp"); ok {
		t.Fatal("ParseACPProvider accepted removed codexapp alias")
	}
	if _, ok := protocol.ParseACPProvider("codex-app"); ok {
		t.Fatal("ParseACPProvider accepted legacy codex-app alias")
	}
	if _, ok := protocol.ParseACPProvider(removedProviderName); ok {
		t.Fatal("ParseACPProvider accepted removed provider")
	}
	if provider, ok := protocol.ParseACPProvider("flicker"); !ok || provider != protocol.ACPProviderFlicker {
		t.Fatalf("ParseACPProvider(flicker)=(%q,%v), want %q,true", provider, ok, protocol.ACPProviderFlicker)
	}
	for _, name := range protocol.ACPProviderNames() {
		if name == "codexapp" {
			t.Fatalf("ACPProviderNames exposes codexapp alias: %v", protocol.ACPProviderNames())
		}
		if name == removedProviderName {
			t.Fatalf("ACPProviderNames exposes removed provider: %v", protocol.ACPProviderNames())
		}
	}
}

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

func TestParseACPProviderQoder(t *testing.T) {
	provider, ok := protocol.ParseACPProvider("Qoder")
	if !ok || provider != protocol.ACPProviderQoder {
		t.Fatalf("ParseACPProvider(Qoder)=(%q,%v), want %q,true", provider, ok, protocol.ACPProviderQoder)
	}
	found := false
	for _, name := range protocol.ACPProviderNames() {
		if name == string(protocol.ACPProviderQoder) {
			found = true
		}
	}
	if !found {
		t.Fatalf("ACPProviderNames missing qoder: %v", protocol.ACPProviderNames())
	}
}

func TestParseACPProviderClaudeCompatible(t *testing.T) {
	provider, ok := protocol.ParseACPProvider("CC-GLM")
	if !ok || provider != protocol.ACPProviderCCGLM {
		t.Fatalf("ParseACPProvider(CC-GLM) = (%q, %v), want (%q, true)", provider, ok, protocol.ACPProviderCCGLM)
	}

	provider, ok = protocol.ParseACPProvider("cc-kimi")
	if !ok || provider != protocol.ACPProviderCCKimi {
		t.Fatalf("ParseACPProvider(cc-kimi) = (%q, %v), want (%q, true)", provider, ok, protocol.ACPProviderCCKimi)
	}

	provider, ok = protocol.ParseACPProvider("CC-DeepSeek")
	if !ok || string(provider) != "cc-deepseek" {
		t.Fatalf("ParseACPProvider(CC-DeepSeek) = (%q, %v), want (%q, true)", provider, ok, "cc-deepseek")
	}

	provider, ok = protocol.ParseACPProvider("CC-Qwen")
	if !ok || provider != protocol.ACPProviderCCQwen {
		t.Fatalf("ParseACPProvider(CC-Qwen) = (%q, %v), want (%q, true)", provider, ok, protocol.ACPProviderCCQwen)
	}

	provider, ok = protocol.ParseACPProvider("CC-FLICKER")
	if !ok || provider != protocol.ACPProviderCCFlicker {
		t.Fatalf("ParseACPProvider(CC-FLICKER) = (%q, %v), want (%q, true)", provider, ok, protocol.ACPProviderCCFlicker)
	}

	names := protocol.ACPProviderNames()
	counts := map[string]int{}
	for _, name := range names {
		counts[name]++
	}
	if counts[string(protocol.ACPProviderCCGLM)] != 1 || counts[string(protocol.ACPProviderCCKimi)] != 1 || counts[string(protocol.ACPProviderCCQwen)] != 1 || counts["cc-deepseek"] != 1 || counts[string(protocol.ACPProviderCCFlicker)] != 1 {
		t.Fatalf("ACPProviderNames() = %v, want one entry for each Claude-compatible provider", names)
	}
	if names[len(names)-5] != "cc-deepseek" || names[len(names)-4] != string(protocol.ACPProviderCCGLM) || names[len(names)-3] != string(protocol.ACPProviderCCKimi) || names[len(names)-2] != string(protocol.ACPProviderCCQwen) || names[len(names)-1] != string(protocol.ACPProviderCCFlicker) {
		t.Fatalf("ACPProviderNames() = %v, want Claude-compatible IDs at the end in stable order", names)
	}
}

func TestProviderPresetByNameRejectsRemovedProvider(t *testing.T) {
	removedProviderName := strings.Join([]string{"my", "flicker"}, "")
	if _, ok := providerPresetByName("codexapp"); ok {
		t.Fatal("providerPresetByName accepted removed codexapp alias")
	}
	if _, ok := providerPresetByName(removedProviderName); ok {
		t.Fatal("providerPresetByName accepted removed provider")
	}
	if preset, ok := providerPresetByName("flicker"); !ok || preset.Name != "flicker" {
		t.Fatalf("providerPresetByName(flicker)=(%#v,%v), want flicker,true", preset, ok)
	}
}

func TestFlickerConnPassesThroughStandardConfigOptions(t *testing.T) {
	base := &testFlickerBaseConn{
		sendFn: func(_ context.Context, method string, _ any, result any) error {
			if method != protocol.MethodSessionNew {
				t.Fatalf("method=%q, want session/new", method)
			}
			return assignResult(result, map[string]any{
				"sessionId": "session-1",
				"configOptions": []map[string]any{
					{
						"id":           protocol.ConfigOptionIDModel,
						"name":         "Model",
						"category":     protocol.ConfigOptionCategoryModel,
						"type":         "select",
						"currentValue": "wanqing/glm-5.1",
						"options": []map[string]any{
							{"value": "wanqing/glm-5.1", "name": "GLM-5.1"},
							{"value": "wanqing/deepseek-v4-pro", "name": "DeepSeek V4 Pro"},
						},
					},
				},
			})
		},
	}
	conn := newFlickerConn(base)

	var got protocol.SessionNewResult
	if err := conn.Send(context.Background(), protocol.MethodSessionNew, protocol.SessionNewParams{}, &got); err != nil {
		t.Fatalf("send: %v", err)
	}
	if got.SessionID != "session-1" {
		t.Fatalf("sessionId=%q", got.SessionID)
	}
	if len(got.ConfigOptions) != 1 {
		t.Fatalf("configOptions=%#v, want one", got.ConfigOptions)
	}
	option := got.ConfigOptions[0]
	if option.ID != protocol.ConfigOptionIDModel || option.CurrentValue != "wanqing/glm-5.1" {
		t.Fatalf("model option=%#v", option)
	}
	if len(option.Options) != 2 || option.Options[0].Value != "wanqing/glm-5.1" {
		t.Fatalf("model values=%#v", option.Options)
	}
}

func TestFlickerConnPassesThroughSetConfigOption(t *testing.T) {
	var capturedMethod string
	var capturedParams protocol.SetSessionConfigOptionRequest
	base := &testFlickerBaseConn{
		sendFn: func(_ context.Context, method string, params any, result any) error {
			capturedMethod = method
			if err := remarshal(params, &capturedParams); err != nil {
				t.Fatalf("params: %v", err)
			}
			return assignResult(result, map[string]any{"configOptions": []map[string]any{}})
		},
	}
	conn := newFlickerConn(base)

	var response protocol.SetSessionConfigOptionResponse
	if err := conn.Send(context.Background(), protocol.MethodSetConfigOption, protocol.SetSessionConfigOptionRequest{
		SessionID: "session-1",
		ConfigID:  protocol.ConfigOptionIDModel,
		Variant:   protocol.SetSessionConfigValueID{Type: "value_id", Value: "wanqing/glm-5.1"},
	}, &response); err != nil {
		t.Fatalf("set config: %v", err)
	}
	if capturedMethod != protocol.MethodSetConfigOption {
		t.Fatalf("capturedMethod=%q", capturedMethod)
	}
	value, ok := capturedParams.Variant.(protocol.SetSessionConfigValueID)
	if !ok || capturedParams.SessionID != "session-1" || capturedParams.ConfigID != protocol.ConfigOptionIDModel || value.Value != "wanqing/glm-5.1" {
		t.Fatalf("capturedParams=%#v", capturedParams)
	}
}

func TestFlickerConnPassesThroughNonModelConfigOption(t *testing.T) {
	var capturedMethod string
	base := &testFlickerBaseConn{
		sendFn: func(_ context.Context, method string, _ any, result any) error {
			capturedMethod = method
			return assignResult(result, map[string]any{"configOptions": []any{}})
		},
	}
	conn := newFlickerConn(base)
	var response protocol.SetSessionConfigOptionResponse
	if err := conn.Send(context.Background(), protocol.MethodSetConfigOption, protocol.SetSessionConfigOptionRequest{
		SessionID: "session-1",
		ConfigID:  protocol.ConfigOptionIDMode,
		Variant:   protocol.SetSessionConfigValueID{Type: "value_id", Value: "default"},
	}, &response); err != nil {
		t.Fatalf("set config: %v", err)
	}
	if capturedMethod != protocol.MethodSetConfigOption {
		t.Fatalf("capturedMethod=%q, want %q", capturedMethod, protocol.MethodSetConfigOption)
	}
}

type testFlickerBaseConn struct {
	sendFn func(context.Context, string, any, any) error
}

func (c *testFlickerBaseConn) Send(ctx context.Context, method string, params any, result any) error {
	return c.sendFn(ctx, method, params, result)
}

func (c *testFlickerBaseConn) Notify(string, any) error { return nil }

func (c *testFlickerBaseConn) OnACPRequest(ACPRequestHandler) {}

func (c *testFlickerBaseConn) OnACPResponse(ACPResponseHandler) {}

func (c *testFlickerBaseConn) Close() error { return nil }

func TestCodexAppProviderLaunchUsesAppServerStdio(t *testing.T) {
	p := NewCodexAppProvider()
	p.lookPath = func(bin string) (string, error) {
		if bin != "codex" {
			t.Fatalf("lookPath bin=%q, want codex", bin)
		}
		return "/usr/bin/codex", nil
	}

	exe, args, env, err := p.Launch()
	if err != nil {
		t.Fatalf("launch: %v", err)
	}
	if exe != "/usr/bin/codex" {
		t.Fatalf("exe=%q", exe)
	}
	if !reflect.DeepEqual(args, []string{"app-server", "--listen", "stdio://"}) {
		t.Fatalf("args=%v", args)
	}
	if len(env) != 0 {
		t.Fatalf("env=%v, want empty", env)
	}
}

func TestCXDeepSeekProviderLaunchUsesResponsesOverridesAndProcessOnlyKey(t *testing.T) {
	stateDir := t.TempDir()
	homeDir := filepath.Join(stateDir, ".data", "cx-deepseek")
	configPath := filepath.Join(homeDir, "config.toml")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		t.Fatal(err)
	}
	configBefore := []byte("[projects.'D:\\\\Code\\\\WheelMaker']\ntrust_level = \"trusted\"\n")
	if err := os.WriteFile(configPath, configBefore, 0o600); err != nil {
		t.Fatal(err)
	}

	provider := NewCXDeepSeekProvider(stateDir, "secret-deepseek-key")
	provider.lookPath = func(string) (string, error) { return `C:\bin\codex.exe`, nil }
	provider.versionOutput = func(string) ([]byte, error) { return []byte("codex-cli 0.145.0\n"), nil }
	provider.materializeCatalog = func(home string) (string, error) {
		if home != homeDir {
			t.Fatalf("materialize home = %q, want %q", home, homeDir)
		}
		return filepath.Join(home, "models.json"), nil
	}

	exe, args, env, err := provider.Launch()
	if err != nil {
		t.Fatalf("Launch() error = %v", err)
	}
	if exe != `C:\bin\codex.exe` || provider.Name() != "cx-deepseek" {
		t.Fatalf("launch identity = %q %q", provider.Name(), exe)
	}
	for _, want := range []string{
		"app-server", "--listen", "stdio://",
		`model="deepseek-v4-flash"`,
		`model_provider="deepseek"`,
		`model_reasoning_effort="high"`,
		`model_catalog_json="` + strings.ReplaceAll(filepath.Join(homeDir, "models.json"), `\`, `\\`) + `"`,
		`model_providers.deepseek.name="deepseek"`,
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
	if !slices.Contains(env, "CODEX_HOME="+homeDir) ||
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

func TestCXDeepSeekCodexVersionGate(t *testing.T) {
	tests := []struct {
		name       string
		output     string
		versionErr error
		wantErr    bool
	}{
		{name: "below minimum", output: "codex-cli 0.143.9\n", wantErr: true},
		{name: "minimum", output: "codex-cli 0.144.0\n"},
		{name: "new major", output: "codex-cli 1.0.0\n"},
		{name: "malformed", output: "codex development build\n", wantErr: true},
		{name: "command failure", versionErr: errors.New("version failed"), wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			provider := NewCXDeepSeekProvider(t.TempDir(), "secret-deepseek-key")
			provider.lookPath = func(string) (string, error) { return "/bin/codex", nil }
			provider.versionOutput = func(string) ([]byte, error) {
				return []byte(test.output), test.versionErr
			}
			materializeCalls := 0
			provider.materializeCatalog = func(home string) (string, error) {
				materializeCalls++
				return filepath.Join(home, "models.json"), nil
			}

			availabilityErr := provider.CheckAvailable()
			if materializeCalls != 0 {
				t.Fatalf("CheckAvailable() materialized catalog %d times", materializeCalls)
			}
			_, _, _, launchErr := provider.Launch()
			if test.wantErr {
				if availabilityErr == nil || launchErr == nil {
					t.Fatalf("errors = (%v, %v), want availability and launch failure", availabilityErr, launchErr)
				}
				for _, err := range []error{availabilityErr, launchErr} {
					message := err.Error()
					if !strings.Contains(message, "cx-deepseek") || strings.Contains(message, "secret-deepseek-key") {
						t.Fatalf("unsafe or unidentified error = %q", message)
					}
				}
				return
			}
			if availabilityErr != nil || launchErr != nil {
				t.Fatalf("errors = (%v, %v), want nil", availabilityErr, launchErr)
			}
			if materializeCalls != 1 {
				t.Fatalf("Launch() materialized catalog %d times, want 1", materializeCalls)
			}
		})
	}
}

func TestCXDeepSeekCodexBridgeUsesProviderIdentityAndTextOnlyCapability(t *testing.T) {
	transport := newFakeCodexappTransport()
	runtime := newCodexappRuntimeWithTransport(transport)
	t.Cleanup(func() { _ = runtime.close() })
	mapPath := filepath.Join(t.TempDir(), "cx-session-map.json")
	conn := newCodexappConnWithRuntimeAndProfile(runtime, t.TempDir(), "proj", codexappConnProfile{
		Provider:       protocol.ACPProviderCXDeepSeek,
		Title:          "DeepSeek Codex",
		AllowImages:    false,
		SessionMapPath: func() (string, error) { return mapPath, nil },
	})

	type initializeOutcome struct {
		result protocol.InitializeResult
		err    error
	}
	done := make(chan initializeOutcome, 1)
	go func() {
		var result protocol.InitializeResult
		err := conn.Send(context.Background(), protocol.MethodInitialize, protocol.InitializeParams{}, &result)
		done <- initializeOutcome{result: result, err: err}
	}()
	request := transport.nextSent(t)
	if request["method"] != "initialize" {
		t.Fatalf("first app-server message = %#v", request)
	}
	if err := transport.emit(map[string]any{"id": request["id"], "result": map[string]any{}}); err != nil {
		t.Fatal(err)
	}
	if notification := transport.nextSent(t); notification["method"] != "initialized" {
		t.Fatalf("initialized notification = %#v", notification)
	}
	outcome := <-done
	if outcome.err != nil {
		t.Fatal(outcome.err)
	}
	result := outcome.result
	if result.AgentInfo == nil || result.AgentInfo.Name != "cx-deepseek" || result.AgentInfo.Title != "DeepSeek Codex" {
		t.Fatalf("agent info = %#v", result.AgentInfo)
	}
	if result.AgentCapabilities.PromptCapabilities == nil || result.AgentCapabilities.PromptCapabilities.Image {
		t.Fatalf("prompt capabilities = %#v", result.AgentCapabilities.PromptCapabilities)
	}
}

func TestCXDeepSeekCodexBridgeRejectsImageInputsBeforeTurnStart(t *testing.T) {
	tests := []struct {
		name  string
		block protocol.ContentBlock
	}{
		{
			name:  "image block",
			block: protocol.ContentBlock{Type: protocol.ContentBlockTypeImage, MimeType: "image/png", Data: "aW1hZ2U="},
		},
		{
			name: "image resource link",
			block: protocol.ContentBlock{
				Type:     protocol.ContentBlockTypeResourceLink,
				URI:      "file:///D:/tmp/pixel.png",
				MimeType: "image/png",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			transport := newFakeCodexappTransport()
			runtime := newCodexappRuntimeWithTransport(transport)
			t.Cleanup(func() { _ = runtime.close() })
			turnStarted := false
			transport.onSend = func(msg map[string]any) {
				if msg["method"] == "turn/start" {
					turnStarted = true
				}
			}
			mapPath := filepath.Join(t.TempDir(), "map.json")
			conn := newCodexappConnWithRuntimeAndProfile(runtime, t.TempDir(), "proj", codexappConnProfile{
				Provider:       protocol.ACPProviderCXDeepSeek,
				Title:          "DeepSeek Codex",
				AllowImages:    false,
				SessionMapPath: func() (string, error) { return mapPath, nil },
			})
			conn.BindSessionID("thread-1")
			var result protocol.SessionPromptResult
			err := conn.Send(context.Background(), protocol.MethodSessionPrompt, protocol.SessionPromptParams{
				SessionID: "thread-1",
				Prompt: []protocol.ContentBlock{
					{Type: protocol.ContentBlockTypeText, Text: "describe"},
					test.block,
				},
			}, &result)
			if err == nil || !strings.Contains(strings.ToLower(err.Error()), "image") {
				t.Fatalf("SessionPrompt() error = %v, want image rejection", err)
			}
			if turnStarted {
				t.Fatal("turn/start was sent for a text-only provider")
			}
		})
	}
}

func TestCXDeepSeekCodexBridgeSendsTextAndPreservesForkProvider(t *testing.T) {
	transport := newFakeCodexappTransport()
	runtime := newCodexappRuntimeWithTransport(transport)
	t.Cleanup(func() { _ = runtime.close() })
	transport.onSend = func(msg map[string]any) {
		if msg["method"] != "turn/start" {
			t.Errorf("unexpected app-server method %q", msg["method"])
			return
		}
		params := msg["params"].(map[string]any)
		input := params["input"].([]any)
		if len(input) != 1 || input[0].(map[string]any)["text"] != "hello" {
			t.Errorf("turn/start input = %#v", input)
		}
		_ = transport.emit(map[string]any{"id": msg["id"], "result": map[string]any{
			"turn": map[string]any{"id": "turn-cx"},
		}})
		_ = transport.emit(map[string]any{
			"method": "turn/completed",
			"params": map[string]any{
				"threadId": "thread-cx",
				"turn":     map[string]any{"id": "turn-cx", "status": "completed"},
			},
		})
	}
	mapPath := filepath.Join(t.TempDir(), "map.json")
	conn := newCodexappConnWithRuntimeAndProfile(runtime, t.TempDir(), "proj", codexappConnProfile{
		Provider:       protocol.ACPProviderCXDeepSeek,
		Title:          "DeepSeek Codex",
		AllowImages:    false,
		SessionMapPath: func() (string, error) { return mapPath, nil },
	})
	conn.BindSessionID("thread-cx")
	var result protocol.PromptOutcome
	if err := conn.Send(context.Background(), protocol.MethodSessionPrompt, protocol.SessionPromptParams{
		SessionID: "thread-cx",
		Prompt:    []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "hello"}},
	}, &result); err != nil {
		t.Fatal(err)
	}
	if result.ForkPoint == nil || result.ForkPoint.Provider != "cx-deepseek" || result.ForkPoint.Ref != "turn-cx" {
		t.Fatalf("fork point = %#v", result.ForkPoint)
	}

	var turn appServerTurn
	if err := remarshal(codexappTestPromptTurn("turn-native", "hello"), &turn); err != nil {
		t.Fatal(err)
	}
	points, matched, err := conn.matchForkPromptTurns("thread-cx", []protocol.SessionForkPrompt{{
		DoneTurnIndex: 3,
		ContentBlocks: []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "hello"}},
	}}, []appServerTurn{turn})
	if err != nil || !matched || points[3].Provider != "cx-deepseek" || points[3].Ref != "turn-native" {
		t.Fatalf("matched fork points = (%#v, %v, %v)", points, matched, err)
	}
}

func TestCXDeepSeekCodexBridgeUsesOnlyInjectedSessionMap(t *testing.T) {
	nativePath := filepath.Join(t.TempDir(), "native.json")
	cxPath := filepath.Join(t.TempDir(), "cx.json")
	oldMapPath := codexappSessionMapPathFunc
	codexappSessionMapPathFunc = func() (string, error) { return nativePath, nil }
	t.Cleanup(func() { codexappSessionMapPathFunc = oldMapPath })
	writeMap := func(path string, sessions map[string]string) {
		t.Helper()
		raw, err := json.Marshal(codexappSessionMapFile{Sessions: sessions})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	writeMap(nativePath, map[string]string{"stable": "native-thread"})
	writeMap(cxPath, map[string]string{"stable": "cx-thread"})

	nativeConn := newCodexappConnWithRuntime(nil, t.TempDir())
	cxConn := newCodexappConnWithRuntimeAndProfile(nil, t.TempDir(), "proj", codexappConnProfile{
		Provider:       protocol.ACPProviderCXDeepSeek,
		Title:          "DeepSeek Codex",
		AllowImages:    false,
		SessionMapPath: func() (string, error) { return cxPath, nil },
	})
	if got := nativeConn.mappedThreadID("stable"); got != "native-thread" {
		t.Fatalf("native mapped thread = %q", got)
	}
	if got := cxConn.mappedThreadID("stable"); got != "cx-thread" {
		t.Fatalf("cx mapped thread = %q", got)
	}
	cxConn.storeThreadMapping("new-stable", "new-cx-thread")

	readMap := func(path string) codexappSessionMapFile {
		t.Helper()
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var file codexappSessionMapFile
		if err := json.Unmarshal(raw, &file); err != nil {
			t.Fatal(err)
		}
		return file
	}
	if _, exists := readMap(nativePath).Sessions["new-stable"]; exists {
		t.Fatal("cx mapping leaked into native map")
	}
	if got := readMap(cxPath).Sessions["new-stable"]; got != "new-cx-thread" {
		t.Fatalf("cx stored mapping = %q", got)
	}
}

func TestCodexAppRuntimeRequestMatchesNumberAndStringResponseIDs(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })

	var got appServerModelListResponse
	errCh := make(chan error, 1)
	go func() {
		errCh <- rt.request(context.Background(), "model/list", nil, &got)
	}()

	first := tr.nextSent(t)
	if _, ok := first["jsonrpc"]; ok {
		t.Fatalf("app-server request must not include jsonrpc: %#v", first)
	}
	if first["method"] != "model/list" {
		t.Fatalf("method=%v, want model/list", first["method"])
	}
	if params, ok := first["params"].(map[string]any); !ok || len(params) != 0 {
		t.Fatalf("model/list params=%#v, want empty object", first["params"])
	}
	id, ok := first["id"]
	if !ok {
		t.Fatalf("request missing id: %#v", first)
	}

	if err := tr.emit(map[string]any{
		"id": id,
		"result": map[string]any{
			"data": []map[string]any{{
				"id":                        "gpt-5",
				"displayName":               "GPT-5",
				"supportedReasoningEfforts": []string{"low", "high"},
				"defaultReasoningEffort":    "high",
			}},
		},
	}); err != nil {
		t.Fatalf("emit response: %v", err)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("request: %v", err)
	}
	if len(got.Models) != 1 || got.Models[0].ID != "gpt-5" {
		t.Fatalf("models=%#v", got.Models)
	}

	var got2 appServerModelListResponse
	errCh = make(chan error, 1)
	go func() {
		errCh <- rt.request(context.Background(), "model/list", nil, &got2)
	}()
	second := tr.nextSent(t)
	stringID := "req-string"
	if err := tr.emit(map[string]any{
		"id":     stringID,
		"result": map[string]any{"data": []map[string]any{{"id": "ignored"}}},
	}); err != nil {
		t.Fatalf("emit unrelated string response: %v", err)
	}
	select {
	case err := <-errCh:
		t.Fatalf("request completed for unrelated string response: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	if err := tr.emit(map[string]any{
		"id":     second["id"],
		"result": map[string]any{"data": []map[string]any{{"id": "gpt-5-mini"}}},
	}); err != nil {
		t.Fatalf("emit matching response: %v", err)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("request 2: %v", err)
	}
	if len(got2.Models) != 1 || got2.Models[0].ID != "gpt-5-mini" {
		t.Fatalf("models2=%#v", got2.Models)
	}
}

func TestCodexAppRuntimeRoutesNotificationsByThread(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })

	connA := newCodexappConnWithRuntime(rt, t.TempDir())
	connB := newCodexappConnWithRuntime(rt, t.TempDir())
	chA := make(chan protocol.SessionUpdateParams, 1)
	chB := make(chan protocol.SessionUpdateParams, 1)
	connA.OnACPResponse(captureSessionUpdate(t, chA))
	connB.OnACPResponse(captureSessionUpdate(t, chB))
	rt.register("thread-a", connA)
	rt.register("thread-b", connB)

	if err := tr.emit(map[string]any{
		"method": "item/agentMessage/delta",
		"params": map[string]any{"threadId": "thread-b", "turnId": "turn-1", "delta": "hello"},
	}); err != nil {
		t.Fatalf("emit notification: %v", err)
	}

	select {
	case got := <-chB:
		if got.SessionID != "thread-b" || got.Update.SessionUpdate != protocol.SessionUpdateAgentMessageChunk {
			t.Fatalf("unexpected routed update: %#v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("thread-b did not receive routed update")
	}
	select {
	case got := <-chA:
		t.Fatalf("thread-a received cross-thread update: %#v", got)
	case <-time.After(20 * time.Millisecond):
	}
}

func TestCodexAppRuntimePoolSharesMatchingProjectRuntime(t *testing.T) {
	var starts int
	var startedCWD string
	pool := newCodexappRuntimePool(func(_ context.Context, cwd string, _ string) (*codexappRuntime, error) {
		starts++
		startedCWD = cwd
		return newCodexappRuntimeWithTransport(newFakeCodexappTransport()), nil
	})
	cwd := t.TempDir() + string(filepath.Separator) + "."

	leaseA, err := pool.acquire(context.Background(), "project-a", cwd, "launch-a")
	if err != nil {
		t.Fatalf("acquire A: %v", err)
	}
	t.Cleanup(func() { _ = leaseA.Release() })
	leaseB, err := pool.acquire(context.Background(), "project-a", cwd, "launch-a")
	if err != nil {
		t.Fatalf("acquire B: %v", err)
	}
	t.Cleanup(func() { _ = leaseB.Release() })

	if starts != 1 {
		t.Fatalf("starts = %d, want 1", starts)
	}
	if leaseA.Runtime() != leaseB.Runtime() {
		t.Fatal("matching project runtime leases must share a runtime")
	}
	if startedCWD != cwd {
		t.Fatalf("runtime cwd = %q, want original %q", startedCWD, cwd)
	}
}

func TestCodexAppRuntimePoolSeparatesProjectAndRuntimeMetadata(t *testing.T) {
	var starts int
	pool := newCodexappRuntimePool(func(context.Context, string, string) (*codexappRuntime, error) {
		starts++
		return newCodexappRuntimeWithTransport(newFakeCodexappTransport()), nil
	})
	cwd := t.TempDir()

	leaseA, err := pool.acquire(context.Background(), "project-a", cwd, "launch-a")
	if err != nil {
		t.Fatalf("acquire A: %v", err)
	}
	t.Cleanup(func() { _ = leaseA.Release() })
	leaseB, err := pool.acquire(context.Background(), "project-b", cwd, "launch-a")
	if err != nil {
		t.Fatalf("acquire B: %v", err)
	}
	t.Cleanup(func() { _ = leaseB.Release() })
	leaseC, err := pool.acquire(context.Background(), "project-a", filepath.Join(cwd, "other"), "launch-a")
	if err != nil {
		t.Fatalf("acquire C: %v", err)
	}
	t.Cleanup(func() { _ = leaseC.Release() })
	leaseD, err := pool.acquire(context.Background(), "project-a", cwd, "launch-b")
	if err != nil {
		t.Fatalf("acquire D: %v", err)
	}
	t.Cleanup(func() { _ = leaseD.Release() })

	if starts != 4 {
		t.Fatalf("starts = %d, want 4", starts)
	}
	if leaseA.Runtime() == leaseB.Runtime() || leaseA.Runtime() == leaseC.Runtime() || leaseA.Runtime() == leaseD.Runtime() {
		t.Fatal("different project or runtime metadata must not share a runtime")
	}
	if !leaseA.Runtime().alive() {
		t.Fatal("acquiring a metadata variant must not close the existing runtime")
	}
}

func TestCodexAppRuntimePoolDoesNotShareWithoutProjectID(t *testing.T) {
	var starts int
	pool := newCodexappRuntimePool(func(context.Context, string, string) (*codexappRuntime, error) {
		starts++
		return newCodexappRuntimeWithTransport(newFakeCodexappTransport()), nil
	})
	cwd := t.TempDir()

	leaseA, err := pool.acquire(context.Background(), "", cwd, "launch-a")
	if err != nil {
		t.Fatalf("acquire A: %v", err)
	}
	t.Cleanup(func() { _ = leaseA.Release() })
	leaseB, err := pool.acquire(context.Background(), "", cwd, "launch-a")
	if err != nil {
		t.Fatalf("acquire B: %v", err)
	}
	t.Cleanup(func() { _ = leaseB.Release() })

	if starts != 2 {
		t.Fatalf("starts = %d, want 2", starts)
	}
	if leaseA.Runtime() == leaseB.Runtime() {
		t.Fatal("unscoped leases must not share a runtime")
	}
}

func TestCodexAppSharedRuntimeInitializesOnce(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	connA := newCodexappConnWithRuntime(rt, t.TempDir())
	connB := newCodexappConnWithRuntime(rt, t.TempDir())
	initializeSent := make(chan map[string]any, 2)
	tr.onSend = func(msg map[string]any) {
		if msg["method"] == "initialize" {
			initializeSent <- msg
		}
	}

	errA := make(chan error, 1)
	go func() {
		errA <- connA.Send(context.Background(), protocol.MethodInitialize, nil, &protocol.InitializeResult{})
	}()
	first := <-initializeSent
	errB := make(chan error, 1)
	go func() {
		errB <- connB.Send(context.Background(), protocol.MethodInitialize, nil, &protocol.InitializeResult{})
	}()
	select {
	case second := <-initializeSent:
		t.Fatalf("initialize sent twice: first=%v second=%v", first["id"], second["id"])
	case <-time.After(50 * time.Millisecond):
	}
	if err := tr.emit(map[string]any{"id": first["id"], "result": map[string]any{}}); err != nil {
		t.Fatalf("emit initialize response: %v", err)
	}

	if err := <-errA; err != nil {
		t.Fatalf("initialize A: %v", err)
	}
	if err := <-errB; err != nil {
		t.Fatalf("initialize B: %v", err)
	}
	var initialized int
	for len(tr.sent) > 0 {
		if msg := <-tr.sent; msg["method"] == "initialized" {
			initialized++
		}
	}
	if initialized != 1 {
		t.Fatalf("initialized notifications = %d, want 1", initialized)
	}
}

func TestCodexAppSharedRuntimeKeepsThreadConfigAndEventsIsolated(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	connA := newCodexappConnWithRuntime(rt, t.TempDir())
	connB := newCodexappConnWithRuntime(rt, t.TempDir())
	models := []appServerModel{{ID: "model-a", SupportedReasoningEfforts: []string{"low", "high"}}, {ID: "model-b", SupportedReasoningEfforts: []string{"low", "high"}}}
	connA.config.setModels(models)
	connB.config.setModels(models)
	set := func(conn *codexappConn, configID string, value string) {
		t.Helper()
		if err := conn.Send(context.Background(), protocol.MethodSetConfigOption, protocol.SetSessionConfigOptionRequest{
			ConfigID: configID, Variant: protocol.SetSessionConfigValueID{Type: "value_id", Value: value},
		}, &protocol.SetSessionConfigOptionResponse{}); err != nil {
			t.Fatalf("set %s=%s: %v", configID, value, err)
		}
	}
	set(connA, protocol.ConfigOptionIDModel, "model-a")
	set(connA, protocol.ConfigOptionIDReasoningEffort, "low")
	set(connA, protocol.ConfigOptionIDApprovalPreset, "read_only")
	set(connB, protocol.ConfigOptionIDModel, "model-b")
	set(connB, protocol.ConfigOptionIDReasoningEffort, "high")
	set(connB, protocol.ConfigOptionIDApprovalPreset, "full")

	threadA := connA.config.threadStartParams(connA.cwd)
	threadB := connB.config.threadStartParams(connB.cwd)
	turnA := connA.config.turnStartParams("thread-a", connA.cwd, nil)
	turnB := connB.config.turnStartParams("thread-b", connB.cwd, nil)
	if threadA.Model != "model-a" || threadB.Model != "model-b" || threadA.ApprovalPolicy == threadB.ApprovalPolicy {
		t.Fatalf("thread configs leaked: A=%+v B=%+v", threadA, threadB)
	}
	if turnA.Model != "model-a" || turnA.Effort != "low" || turnB.Model != "model-b" || turnB.Effort != "high" || turnA.ApprovalPolicy == turnB.ApprovalPolicy {
		t.Fatalf("turn configs leaked: A=%+v B=%+v", turnA, turnB)
	}

	updatesA := make(chan protocol.SessionUpdateParams, 1)
	updatesB := make(chan protocol.SessionUpdateParams, 1)
	connA.OnACPResponse(captureSessionUpdate(t, updatesA))
	connB.OnACPResponse(captureSessionUpdate(t, updatesB))
	connA.bindSessionIDs("session-a", "thread-a")
	connB.bindSessionIDs("session-b", "thread-b")
	if err := tr.emit(map[string]any{
		"method": "item/agentMessage/delta",
		"params": map[string]any{"threadId": "thread-b", "turnId": "turn-b", "delta": "only B"},
	}); err != nil {
		t.Fatalf("emit B update: %v", err)
	}
	select {
	case <-updatesB:
	case <-time.After(time.Second):
		t.Fatal("connection B did not receive its update")
	}
	select {
	case got := <-updatesA:
		t.Fatalf("connection A received connection B update: %#v", got)
	case <-time.After(20 * time.Millisecond):
	}
	if err := tr.emit(map[string]any{
		"method": "item/agentMessage/delta",
		"params": map[string]any{"threadId": "unknown", "turnId": "turn-unknown", "delta": "drop"},
	}); err != nil {
		t.Fatalf("emit unknown update: %v", err)
	}
	select {
	case got := <-updatesA:
		t.Fatalf("connection A received unknown-thread update: %#v", got)
	case got := <-updatesB:
		t.Fatalf("connection B received unknown-thread update: %#v", got)
	case <-time.After(20 * time.Millisecond):
	}
}

func TestCodexAppSharedRuntimeCloseOneConnectionKeepsOtherAliveAndClosesOnLastRelease(t *testing.T) {
	var transport *fakeCodexappTransport
	pool := newCodexappRuntimePool(func(context.Context, string, string) (*codexappRuntime, error) {
		transport = newFakeCodexappTransport()
		return newCodexappRuntimeWithTransport(transport), nil
	})
	cwd := t.TempDir()
	leaseA, err := pool.acquire(context.Background(), "project-a", cwd, "launch-a")
	if err != nil {
		t.Fatalf("acquire A: %v", err)
	}
	leaseB, err := pool.acquire(context.Background(), "project-a", cwd, "launch-a")
	if err != nil {
		t.Fatalf("acquire B: %v", err)
	}
	connA := newCodexappConnWithRuntime(leaseA.Runtime(), t.TempDir())
	connA.lease = leaseA
	connB := newCodexappConnWithRuntime(leaseB.Runtime(), t.TempDir())
	connB.lease = leaseB
	connA.bindSessionIDs("session-a", "thread-a")
	connB.bindSessionIDs("session-b", "thread-b")
	updatesB := make(chan protocol.SessionUpdateParams, 1)
	connB.OnACPResponse(captureSessionUpdate(t, updatesB))

	if err := connA.Close(); err != nil {
		t.Fatalf("close A: %v", err)
	}
	if !transport.Alive() {
		t.Fatal("closing one pooled connection closed the sibling runtime")
	}
	if err := transport.emit(map[string]any{
		"method": "item/agentMessage/delta",
		"params": map[string]any{"threadId": "thread-b", "turnId": "turn-b", "delta": "still alive"},
	}); err != nil {
		t.Fatalf("emit B update: %v", err)
	}
	select {
	case <-updatesB:
	case <-time.After(time.Second):
		t.Fatal("connection B did not receive an update after A closed")
	}
	if err := connB.Close(); err != nil {
		t.Fatalf("close B: %v", err)
	}
	if transport.Alive() {
		t.Fatal("last pooled connection did not close its runtime")
	}
}

func TestCodexAppRuntimeExitClosesOnlyItsRuntimeAndEvictsPoolEntry(t *testing.T) {
	var transports []*fakeCodexappTransport
	pool := newCodexappRuntimePool(func(context.Context, string, string) (*codexappRuntime, error) {
		transport := newFakeCodexappTransport()
		transports = append(transports, transport)
		return newCodexappRuntimeWithTransport(transport), nil
	})
	cwdA := t.TempDir()
	leaseA, err := pool.acquire(context.Background(), "project-a", cwdA, "launch-a")
	if err != nil {
		t.Fatalf("acquire A: %v", err)
	}
	t.Cleanup(func() { _ = leaseA.Release() })
	leaseB, err := pool.acquire(context.Background(), "project-a", cwdA, "launch-a")
	if err != nil {
		t.Fatalf("acquire B: %v", err)
	}
	t.Cleanup(func() { _ = leaseB.Release() })
	connA := newCodexappConnWithRuntime(leaseA.Runtime(), cwdA)
	connA.bindSessionIDs("session-a", "thread-a")
	promptDone := make(chan codexappPromptResult, 1)
	connA.mu.Lock()
	connA.promptDone = promptDone
	connA.mu.Unlock()
	connB := newCodexappConnWithRuntime(leaseB.Runtime(), cwdA)
	connB.bindSessionIDs("session-b", "thread-b")
	compactDone := make(chan SessionCompactResult, 1)
	connB.mu.Lock()
	connB.compactDone = compactDone
	connB.mu.Unlock()
	leaseC, err := pool.acquire(context.Background(), "project-c", t.TempDir(), "launch-a")
	if err != nil {
		t.Fatalf("acquire C: %v", err)
	}
	t.Cleanup(func() { _ = leaseC.Release() })

	if err := transports[0].Close(); err != nil {
		t.Fatalf("stop A runtime: %v", err)
	}
	select {
	case <-leaseA.Runtime().done:
	case <-time.After(time.Second):
		t.Fatal("runtime did not terminate after its transport stopped")
	}
	select {
	case result := <-promptDone:
		if result.err == nil {
			t.Fatal("active prompt did not fail when its runtime stopped")
		}
	case <-time.After(time.Second):
		t.Fatal("active prompt did not complete when its runtime stopped")
	}
	select {
	case result := <-compactDone:
		if result.Err == nil {
			t.Fatal("active compact did not fail when its runtime stopped")
		}
	case <-time.After(time.Second):
		t.Fatal("active compact did not complete when its runtime stopped")
	}
	if !leaseC.Runtime().alive() {
		t.Fatal("stopping project A runtime affected project C")
	}
	leaseRecovered, err := pool.acquire(context.Background(), "project-a", cwdA, "launch-a")
	if err != nil {
		t.Fatalf("recover acquire: %v", err)
	}
	t.Cleanup(func() { _ = leaseRecovered.Release() })
	if leaseRecovered.Runtime() == leaseA.Runtime() {
		t.Fatal("recovered lease reused stopped runtime")
	}
}

func TestCodexAppRuntimeRejectsNotificationsAfterStop(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	if err := tr.Close(); err != nil {
		t.Fatalf("stop transport: %v", err)
	}
	select {
	case <-rt.done:
	case <-time.After(time.Second):
		t.Fatal("runtime did not observe transport stop")
	}
	if err := rt.notify("initialized", nil); err == nil {
		t.Fatal("notify after stop succeeded")
	}
}

func TestCodexAppSessionGoalSetPreservesNullableBudgetPatch(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		if msg["method"] != "thread/goal/set" {
			return
		}
		params, _ := msg["params"].(map[string]any)
		if params["threadId"] != "thread-runtime" {
			t.Errorf("threadId = %v", params["threadId"])
		}
		if value, ok := params["tokenBudget"]; !ok || value != nil {
			t.Errorf("tokenBudget = %#v, present=%t", value, ok)
		}
		if _, ok := params["objective"]; ok {
			t.Error("objective must be omitted")
		}
		_ = tr.emit(map[string]any{
			"id": msg["id"],
			"result": map[string]any{"goal": map[string]any{
				"threadId": "thread-runtime", "objective": "ship", "status": "active",
				"tokenBudget": nil, "tokensUsed": 42, "timeUsedSeconds": 7,
				"createdAt": 10, "updatedAt": 11,
			}},
		})
	}
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.bindSessionIDs("session-stable", "thread-runtime")
	got, err := conn.SessionGoalSet(context.Background(), protocol.SessionGoalSetParams{
		SessionID:   "session-stable",
		TokenBudget: protocol.OptionalInt64{Present: true},
	})
	if err != nil {
		t.Fatalf("SessionGoalSet(): %v", err)
	}
	if got.SessionID != "session-stable" || got.Objective != "ship" || got.TokenBudget != nil {
		t.Fatalf("goal = %#v", got)
	}
}

func TestCodexAppSessionGoalGetReturnsNilGoal(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		if msg["method"] == "thread/goal/get" {
			_ = tr.emit(map[string]any{"id": msg["id"], "result": map[string]any{"goal": nil}})
		}
	}
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	got, err := conn.SessionGoalGet(context.Background(), "thread-1")
	if err != nil {
		t.Fatalf("SessionGoalGet(): %v", err)
	}
	if got != nil {
		t.Fatalf("goal = %#v, want nil", got)
	}
}

func TestCodexAppSessionGoalClear(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		if msg["method"] != "thread/goal/clear" {
			return
		}
		params, _ := msg["params"].(map[string]any)
		if params["threadId"] != "thread-1" {
			t.Errorf("threadId = %v", params["threadId"])
		}
		_ = tr.emit(map[string]any{"id": msg["id"], "result": map[string]any{"cleared": true}})
	}
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	if err := conn.SessionGoalClear(context.Background(), "thread-1"); err != nil {
		t.Fatalf("SessionGoalClear(): %v", err)
	}
}

func TestCodexAppGoalNotificationsDriveAutomaticTurnLifecycle(t *testing.T) {
	conn := newCodexappConnWithRuntime(nil, t.TempDir())
	conn.bindSessionIDs("session-stable", "thread-runtime")
	updates := make(chan protocol.SessionUpdateParams, 8)
	conn.OnACPResponse(captureSessionUpdate(t, updates))

	conn.handleAppServerNotification("thread/goal/updated", mustRaw(map[string]any{
		"threadId": "thread-runtime",
		"turnId":   nil,
		"goal": map[string]any{
			"threadId": "thread-runtime", "objective": "ship", "status": "active",
			"tokenBudget": nil, "tokensUsed": 42, "timeUsedSeconds": 7,
			"createdAt": 10, "updatedAt": 11,
		},
	}))
	goalUpdate := waitForCodexappUpdate(t, updates)
	if goalUpdate.Update.SessionUpdate != protocol.SessionUpdateGoalUpdated ||
		goalUpdate.Update.Goal == nil ||
		goalUpdate.Update.Goal.SessionID != "session-stable" {
		t.Fatalf("goal update = %#v", goalUpdate)
	}

	conn.handleAppServerNotification("turn/started", mustRaw(map[string]any{
		"threadId": "thread-runtime",
		"turn":     map[string]any{"id": "turn-goal-1", "status": "inProgress"},
	}))
	started := waitForCodexappUpdate(t, updates)
	if started.Update.SessionUpdate != protocol.SessionUpdateGoalTurnStarted || started.Update.TurnID != "turn-goal-1" {
		t.Fatalf("turn started = %#v", started)
	}
	conn.handleAppServerNotification("item/agentMessage/delta", mustRaw(map[string]any{
		"threadId": "thread-runtime", "turnId": "turn-goal-1", "delta": "working",
	}))
	if got := waitForCodexappUpdate(t, updates); got.Update.SessionUpdate != protocol.SessionUpdateAgentMessageChunk {
		t.Fatalf("agent update = %#v", got)
	}
	conn.handleAppServerNotification("turn/completed", mustRaw(map[string]any{
		"threadId": "thread-runtime",
		"turn":     map[string]any{"id": "turn-goal-1", "status": "completed"},
	}))
	completed := waitForCodexappUpdate(t, updates)
	if completed.Update.SessionUpdate != protocol.SessionUpdateGoalTurnCompleted || completed.Update.TurnID != "turn-goal-1" {
		t.Fatalf("turn completed = %#v", completed)
	}
}

func TestCodexAppAgentMessageDeltaCarriesMessagePhaseMeta(t *testing.T) {
	conn := newCodexappConnWithRuntime(nil, t.TempDir())
	conn.bindSessionIDs("session-stable", "thread-runtime")
	updates := make(chan protocol.SessionUpdateParams, 4)
	conn.OnACPResponse(captureSessionUpdate(t, updates))

	conn.handleAppServerNotification("item/started", mustRaw(map[string]any{
		"threadId": "thread-runtime",
		"turnId":   "turn-1",
		"item": map[string]any{
			"id": "message-1", "type": "agentMessage", "phase": "commentary",
		},
	}))
	conn.handleAppServerNotification("item/agentMessage/delta", mustRaw(map[string]any{
		"threadId": "thread-runtime", "turnId": "turn-1", "itemId": "message-1", "delta": "working",
	}))
	commentary := waitForCodexappUpdate(t, updates)
	if commentary.Update.MessageID != "message-1" {
		t.Fatalf("messageId=%q, want message-1", commentary.Update.MessageID)
	}
	if got := protocol.SessionUpdateMetaMessagePhase(commentary.Update.Meta); got != protocol.SessionMessagePhaseCommentary {
		t.Fatalf("commentary phase = %q, meta=%s", got, commentary.Update.Meta)
	}

	conn.handleAppServerNotification("item/completed", mustRaw(map[string]any{
		"threadId": "thread-runtime",
		"turnId":   "turn-1",
		"item": map[string]any{
			"id": "message-1", "type": "agentMessage", "phase": "final_answer", "text": "working",
		},
	}))
	completed := waitForCodexappUpdate(t, updates)
	var completedContent protocol.ContentBlock
	if err := json.Unmarshal(completed.Update.Content, &completedContent); err != nil {
		t.Fatal(err)
	}
	if completed.Update.MessageID != "message-1" || completedContent.Text != "" {
		t.Fatalf("completed=%#v, want metadata-only message-1", completed.Update)
	}
	if got := protocol.SessionUpdateMetaMessagePhase(completed.Update.Meta); got != protocol.SessionMessagePhaseFinalAnswer {
		t.Fatalf("completed phase=%q, meta=%s", got, completed.Update.Meta)
	}
	if !protocol.SessionUpdateMetaMessageComplete(completed.Update.Meta) {
		t.Fatalf("completed meta=%s", completed.Update.Meta)
	}
	conn.handleAppServerNotification("item/agentMessage/delta", mustRaw(map[string]any{
		"threadId": "thread-runtime", "turnId": "turn-1", "itemId": "message-1", "delta": "late",
	}))
	select {
	case late := <-updates:
		t.Fatalf("late delta emitted %#v", late)
	case <-time.After(25 * time.Millisecond):
	}

	conn.handleAppServerNotification("item/started", mustRaw(map[string]any{
		"threadId": "thread-runtime",
		"turnId":   "turn-1",
		"item": map[string]any{
			"id": "message-2", "type": "agentMessage", "phase": "final_answer",
		},
	}))
	conn.handleAppServerNotification("item/agentMessage/delta", mustRaw(map[string]any{
		"threadId": "thread-runtime", "turnId": "turn-1", "itemId": "message-2", "delta": "done",
	}))
	final := waitForCodexappUpdate(t, updates)
	if got := protocol.SessionUpdateMetaMessagePhase(final.Update.Meta); got != protocol.SessionMessagePhaseFinalAnswer {
		t.Fatalf("final phase = %q, meta=%s", got, final.Update.Meta)
	}
}

func TestCodexAppGoalTurnCanSteerWithoutPromptDone(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		if msg["method"] != "turn/steer" {
			return
		}
		params, _ := msg["params"].(map[string]any)
		if params["expectedTurnId"] != "turn-goal-1" {
			t.Errorf("expectedTurnId = %v", params["expectedTurnId"])
		}
		_ = tr.emit(map[string]any{"id": msg["id"], "result": map[string]any{"turnId": "turn-goal-1"}})
		_ = tr.emit(map[string]any{
			"method": "item/started",
			"params": map[string]any{
				"threadId": "thread-runtime", "turnId": "turn-goal-1",
				"item": map[string]any{
					"id": "user-steer", "type": "userMessage", "clientId": "queued-1",
					"content": []map[string]any{{"type": "text", "text": "fix tests"}},
				},
			},
		})
	}
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.bindSessionIDs("session-stable", "thread-runtime")
	conn.handleAppServerNotification("thread/goal/updated", mustRaw(map[string]any{
		"threadId": "thread-runtime",
		"goal": map[string]any{
			"threadId": "thread-runtime", "objective": "ship", "status": "active",
			"tokenBudget": nil, "tokensUsed": 0, "timeUsedSeconds": 0,
			"createdAt": 10, "updatedAt": 11,
		},
	}))
	conn.handleAppServerNotification("turn/started", mustRaw(map[string]any{
		"threadId": "thread-runtime", "turn": map[string]any{"id": "turn-goal-1"},
	}))
	result, err := conn.SteerSession(context.Background(), "session-stable", "queued-1", []protocol.ContentBlock{{
		Type: protocol.ContentBlockTypeText,
		Text: "fix tests",
	}})
	if err != nil {
		t.Fatalf("SteerSession(): %v", err)
	}
	if result.ProviderTurnID != "turn-goal-1" {
		t.Fatalf("result = %#v", result)
	}
}

func TestCodexappCompactTracksContextCompaction(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		if msg["method"] != "thread/compact/start" {
			return
		}
		params, _ := msg["params"].(map[string]any)
		if params["threadId"] != "thread-runtime" {
			t.Errorf("threadId = %v", params["threadId"])
		}
		_ = tr.emit(map[string]any{"id": msg["id"], "result": map[string]any{}})
		_ = tr.emit(map[string]any{
			"method": "item/started",
			"params": map[string]any{
				"threadId": "thread-runtime",
				"turnId":   "turn-compact",
				"item":     map[string]any{"id": "compact-1", "type": "contextCompaction", "status": "inProgress"},
			},
		})
		_ = tr.emit(map[string]any{
			"method": "item/completed",
			"params": map[string]any{
				"threadId": "thread-runtime",
				"turnId":   "turn-compact",
				"item":     map[string]any{"id": "compact-1", "type": "contextCompaction", "status": "completed"},
			},
		})
	}

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.bindSessionIDs("session-stable", "thread-runtime")
	done, err := conn.CompactSession(context.Background(), "session-stable")
	if err != nil {
		t.Fatalf("CompactSession(): %v", err)
	}
	select {
	case result := <-done:
		if result.Err != nil {
			t.Fatalf("compact result: %v", result.Err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for compaction completion")
	}
}

func TestCodexappCompactFailsOnTurnFailure(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		if msg["method"] != "thread/compact/start" {
			return
		}
		_ = tr.emit(map[string]any{"id": msg["id"], "result": map[string]any{}})
		_ = tr.emit(map[string]any{
			"method": "turn/completed",
			"params": map[string]any{
				"threadId": "thread-1",
				"turn":     map[string]any{"id": "turn-compact", "status": "failed"},
			},
		})
	}

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	done, err := conn.CompactSession(context.Background(), "thread-1")
	if err != nil {
		t.Fatalf("CompactSession(): %v", err)
	}
	select {
	case result := <-done:
		if result.Err == nil || !strings.Contains(result.Err.Error(), "failed") {
			t.Fatalf("compact result = %+v", result)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for failed compaction")
	}
}

func TestCodexappCompactFailsWhenRuntimeCloses(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	tr.onSend = func(msg map[string]any) {
		if msg["method"] == "thread/compact/start" {
			_ = tr.emit(map[string]any{"id": msg["id"], "result": map[string]any{}})
		}
	}
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	done, err := conn.CompactSession(context.Background(), "thread-1")
	if err != nil {
		t.Fatalf("CompactSession(): %v", err)
	}
	if err := rt.close(); err != nil {
		t.Fatalf("runtime close: %v", err)
	}
	select {
	case result := <-done:
		if result.Err == nil || !strings.Contains(result.Err.Error(), "closed") {
			t.Fatalf("compact result = %+v", result)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for runtime-close compaction result")
	}
}

func TestCodexappCompactTimesOut(t *testing.T) {
	previousTimeout := codexappCompactCompletionTimeout
	codexappCompactCompletionTimeout = 10 * time.Millisecond
	t.Cleanup(func() { codexappCompactCompletionTimeout = previousTimeout })

	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		if msg["method"] == "thread/compact/start" {
			_ = tr.emit(map[string]any{"id": msg["id"], "result": map[string]any{}})
		}
	}
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	done, err := conn.CompactSession(context.Background(), "thread-1")
	if err != nil {
		t.Fatalf("CompactSession(): %v", err)
	}
	select {
	case result := <-done:
		if result.Err == nil || !strings.Contains(result.Err.Error(), "timed out") {
			t.Fatalf("compact result = %+v", result)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for compaction timeout")
	}
}

func TestCodexAppRuntimeDispatchesNotificationsAsynchronously(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })

	unblock := make(chan struct{})
	defer close(unblock)

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.OnACPResponse(func(context.Context, string, json.RawMessage) {
		<-unblock
	})
	rt.register("thread-1", conn)

	emitDone := make(chan error, 1)
	go func() {
		emitDone <- tr.emit(map[string]any{
			"method": "item/agentMessage/delta",
			"params": map[string]any{"threadId": "thread-1", "turnId": "turn-1", "delta": "hello"},
		})
	}()

	select {
	case err := <-emitDone:
		if err != nil {
			t.Fatalf("emit notification: %v", err)
		}
	case <-time.After(20 * time.Millisecond):
		t.Fatal("notification dispatch blocked the transport read-loop")
	}
}

func TestCodexAppRuntimeKeepsPromptResultBehindBlockedPriorUpdate(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		if msg["method"] == "turn/start" {
			_ = tr.emit(map[string]any{
				"id": msg["id"],
				"result": map[string]any{
					"turn": map[string]any{"id": "turn-1"},
				},
			})
		}
	}

	unblockUpdate := make(chan struct{})
	defer close(unblockUpdate)
	updateStarted := make(chan struct{})
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.OnACPResponse(func(context.Context, string, json.RawMessage) {
		close(updateStarted)
		<-unblockUpdate
	})
	conn.BindSessionID("thread-1")

	var promptRes protocol.PromptOutcome
	errCh := make(chan error, 1)
	go func() {
		errCh <- conn.Send(context.Background(), protocol.MethodSessionPrompt, protocol.SessionPromptParams{
			SessionID: "thread-1",
			Prompt:    []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "ping"}},
		}, &promptRes)
	}()
	waitForActiveTurn(t, conn, "turn-1")

	if err := tr.emit(map[string]any{
		"method": "item/agentMessage/delta",
		"params": map[string]any{"threadId": "thread-1", "turnId": "turn-1", "delta": "pong"},
	}); err != nil {
		t.Fatalf("emit delta: %v", err)
	}
	select {
	case <-updateStarted:
	case <-time.After(time.Second):
		t.Fatal("blocked update handler was not reached")
	}

	if err := tr.emit(map[string]any{
		"method": "turn/completed",
		"params": map[string]any{"threadId": "thread-1", "turn": map[string]any{"id": "turn-1", "status": "completed"}},
	}); err != nil {
		t.Fatalf("emit completion: %v", err)
	}
	select {
	case err := <-errCh:
		t.Fatalf("prompt completed before prior update callback returned: err=%v result=%#v", err, promptRes)
	case <-time.After(20 * time.Millisecond):
	}
	unblockUpdate <- struct{}{}
	if err := <-errCh; err != nil {
		t.Fatalf("prompt after unblocking update: %v", err)
	}
	if promptRes.StopReason != protocol.StopReasonEndTurn {
		t.Fatalf("stopReason=%q, want end_turn", promptRes.StopReason)
	}
}

func TestCodexAppRuntimeRoutesServerRequestAndRoundTripsStringID(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.OnACPRequest(func(_ context.Context, _ int64, method string, params json.RawMessage) (any, error) {
		if method != protocol.MethodRequestPermission {
			t.Fatalf("method=%q, want request permission", method)
		}
		var p protocol.PermissionRequestParams
		if err := json.Unmarshal(params, &p); err != nil {
			t.Fatalf("unmarshal permission params: %v", err)
		}
		if p.SessionID != "thread-1" || p.ToolCall.ToolCallID != "item-1" {
			t.Fatalf("permission params=%#v", p)
		}
		return protocol.PermissionResponse{
			Outcome: protocol.PermissionResult{Outcome: "allow_always", OptionID: "allow_always"},
		}, nil
	})
	rt.register("thread-1", conn)

	if err := tr.emit(map[string]any{
		"id":     "approval-req-1",
		"method": "item/commandExecution/requestApproval",
		"params": map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"itemId":   "item-1",
			"command":  "go test ./...",
		},
	}); err != nil {
		t.Fatalf("emit request: %v", err)
	}

	resp := tr.nextSent(t)
	if resp["id"] != "approval-req-1" {
		t.Fatalf("response id=%#v, want original string id", resp["id"])
	}
	result := resp["result"].(map[string]any)
	if result["decision"] != "acceptForSession" {
		t.Fatalf("decision=%#v", result["decision"])
	}
}

func TestCodexAppRuntimeUnsupportedKnownThreadServerRequestReturnsMethodNotFound(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	rt.register("thread-1", conn)

	if err := tr.emit(map[string]any{
		"id":     "unknown-req-1",
		"method": "session/unsupported",
		"params": map[string]any{"threadId": "thread-1"},
	}); err != nil {
		t.Fatalf("emit request: %v", err)
	}

	resp := tr.nextSent(t)
	if resp["id"] != "unknown-req-1" {
		t.Fatalf("response id=%#v, want original string id", resp["id"])
	}
	errObj, ok := resp["error"].(map[string]any)
	if !ok {
		t.Fatalf("response error=%#v, want object", resp["error"])
	}
	if code := int(errObj["code"].(float64)); code != -32601 {
		t.Fatalf("error code=%d, want -32601", code)
	}
}

func TestCodexAppRuntimeCancelsMcpElicitationWithOfficialShape(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	rt.register("thread-1", conn)

	if err := tr.emit(map[string]any{
		"id":     "elicitation-req-1",
		"method": "mcpServer/elicitation/request",
		"params": map[string]any{
			"threadId":   "thread-1",
			"turnId":     "turn-1",
			"serverName": "test-mcp",
			"mode":       "form",
			"message":    "Need input",
			"requestedSchema": map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
	}); err != nil {
		t.Fatalf("emit request: %v", err)
	}

	resp := tr.nextSent(t)
	if resp["id"] != "elicitation-req-1" {
		t.Fatalf("response id=%#v, want original string id", resp["id"])
	}
	result := resp["result"].(map[string]any)
	if result["action"] != "cancel" {
		t.Fatalf("action=%#v, want cancel", result["action"])
	}
	if _, ok := result["content"]; !ok {
		t.Fatalf("result=%#v, want content:null field", result)
	}
	if _, ok := result["_meta"]; !ok {
		t.Fatalf("result=%#v, want _meta:null field", result)
	}
}

func TestCodexAppRuntimeMapsPermissionsApprovalRequest(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.bindSessionIDs("acp-session", "runtime-thread")
	conn.OnACPRequest(func(_ context.Context, _ int64, method string, params json.RawMessage) (any, error) {
		if method != protocol.MethodRequestPermission {
			t.Fatalf("method=%q, want request permission", method)
		}
		var p protocol.PermissionRequestParams
		if err := json.Unmarshal(params, &p); err != nil {
			t.Fatalf("unmarshal permission params: %v", err)
		}
		if p.SessionID != "acp-session" || p.ToolCall.ToolCallID != "perm-1" || p.ToolCall.Kind != protocol.ToolKindOther {
			t.Fatalf("permission params=%#v", p)
		}
		return protocol.PermissionResponse{
			Outcome: protocol.PermissionResult{Outcome: "allow_always", OptionID: "allow_always"},
		}, nil
	})
	rt.register("runtime-thread", conn)

	if err := tr.emit(map[string]any{
		"id":     "permissions-req-1",
		"method": "item/permissions/requestApproval",
		"params": map[string]any{
			"threadId": "runtime-thread",
			"turnId":   "turn-1",
			"itemId":   "perm-1",
			"cwd":      "D:/Code/WheelMaker",
			"reason":   "Need workspace write",
			"permissions": map[string]any{
				"fileSystem": map[string]any{"write": []string{"D:/Code/WheelMaker"}},
				"network":    map[string]any{"enabled": true},
			},
		},
	}); err != nil {
		t.Fatalf("emit permissions request: %v", err)
	}

	resp := tr.nextSent(t)
	if resp["id"] != "permissions-req-1" {
		t.Fatalf("response id=%#v, want original string id", resp["id"])
	}
	result := resp["result"].(map[string]any)
	if result["scope"] != "session" {
		t.Fatalf("scope=%#v, want session", result["scope"])
	}
	permissions := result["permissions"].(map[string]any)
	if permissions["fileSystem"] == nil || permissions["network"] == nil {
		t.Fatalf("permissions=%#v, want requested subset", permissions)
	}
}

func TestCodexAppPromptIgnoresStaleTurnCompletedForDifferentTurnID(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		if msg["method"] == "turn/start" {
			_ = tr.emit(map[string]any{
				"id": msg["id"],
				"result": map[string]any{
					"turn": map[string]any{"id": "turn-current"},
				},
			})
		}
	}

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")

	var promptRes protocol.SessionPromptResult
	errCh := make(chan error, 1)
	go func() {
		errCh <- conn.Send(context.Background(), protocol.MethodSessionPrompt, protocol.SessionPromptParams{
			SessionID: "thread-1",
			Prompt:    []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "ping"}},
		}, &promptRes)
	}()

	waitForActiveTurn(t, conn, "turn-current")
	if err := tr.emit(map[string]any{
		"method": "turn/completed",
		"params": map[string]any{"threadId": "thread-1", "turn": map[string]any{"id": "turn-stale", "status": "completed"}},
	}); err != nil {
		t.Fatalf("emit stale completion: %v", err)
	}
	select {
	case err := <-errCh:
		t.Fatalf("prompt completed for stale turn: err=%v result=%#v", err, promptRes)
	case <-time.After(20 * time.Millisecond):
	}

	if err := tr.emit(map[string]any{
		"method": "turn/completed",
		"params": map[string]any{"threadId": "thread-1", "turn": map[string]any{"id": "turn-current", "status": "completed"}},
	}); err != nil {
		t.Fatalf("emit current completion: %v", err)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("prompt: %v", err)
	}
	if promptRes.StopReason != protocol.StopReasonEndTurn {
		t.Fatalf("stopReason=%q, want end_turn", promptRes.StopReason)
	}
}

func TestCodexAppPromptCompletesWhenTurnCompletedArrivesBeforeTurnIDStored(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	releaseResponse := make(chan struct{})
	tr.onSend = func(msg map[string]any) {
		if msg["method"] == "turn/start" {
			_ = tr.emit(map[string]any{
				"id": msg["id"],
				"result": map[string]any{
					"turn": map[string]any{"id": "turn-fast"},
				},
			})
			_ = tr.emit(map[string]any{
				"method": "turn/completed",
				"params": map[string]any{"threadId": "thread-1", "turn": map[string]any{"id": "turn-fast", "status": "completed"}},
			})
			<-releaseResponse
		}
	}

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")

	var promptRes protocol.SessionPromptResult
	errCh := make(chan error, 1)
	go func() {
		errCh <- conn.Send(context.Background(), protocol.MethodSessionPrompt, protocol.SessionPromptParams{
			SessionID: "thread-1",
			Prompt:    []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "ping"}},
		}, &promptRes)
	}()

	close(releaseResponse)
	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("prompt: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("prompt did not complete after early turn/completed")
	}
	if promptRes.StopReason != protocol.StopReasonEndTurn {
		t.Fatalf("stopReason=%q, want end_turn", promptRes.StopReason)
	}
}

func TestCodexAppPromptFiltersStaleStreamingDeltas(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		if msg["method"] == "turn/start" {
			_ = tr.emit(map[string]any{
				"id": msg["id"],
				"result": map[string]any{
					"turn": map[string]any{"id": "turn-current"},
				},
			})
		}
	}

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	updates := make(chan protocol.SessionUpdateParams, 4)
	conn.OnACPResponse(captureSessionUpdate(t, updates))

	errCh := make(chan error, 1)
	go func() {
		var promptRes protocol.SessionPromptResult
		errCh <- conn.Send(context.Background(), protocol.MethodSessionPrompt, protocol.SessionPromptParams{
			SessionID: "thread-1",
			Prompt:    []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "ping"}},
		}, &promptRes)
	}()

	waitForActiveTurn(t, conn, "turn-current")
	if err := tr.emit(map[string]any{
		"method": "item/agentMessage/delta",
		"params": map[string]any{"threadId": "thread-1", "turnId": "turn-stale", "delta": "stale"},
	}); err != nil {
		t.Fatalf("emit stale delta: %v", err)
	}
	if err := tr.emit(map[string]any{
		"method": "item/agentMessage/delta",
		"params": map[string]any{"threadId": "thread-1", "turnId": "turn-current", "delta": "current"},
	}); err != nil {
		t.Fatalf("emit current delta: %v", err)
	}
	deadline := time.After(time.Second)
	var sawCurrent bool
	for !sawCurrent {
		select {
		case update := <-updates:
			if update.Update.SessionUpdate == protocol.SessionUpdateUserMessageChunk {
				continue
			}
			var content protocol.ContentBlock
			if err := json.Unmarshal(update.Update.Content, &content); err != nil {
				t.Fatalf("unmarshal content: %v", err)
			}
			if content.Text == "stale" {
				t.Fatal("stale delta was emitted")
			}
			if content.Text == "current" {
				sawCurrent = true
			}
		case <-deadline:
			t.Fatal("current delta was not emitted")
		}
	}
	if err := tr.emit(map[string]any{
		"method": "turn/completed",
		"params": map[string]any{"threadId": "thread-1", "turn": map[string]any{"id": "turn-current", "status": "completed"}},
	}); err != nil {
		t.Fatalf("emit completion: %v", err)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("prompt: %v", err)
	}
	drain := time.After(50 * time.Millisecond)
	for {
		select {
		case update := <-updates:
			if update.Update.SessionUpdate == protocol.SessionUpdateUserMessageChunk {
				continue
			}
			var content protocol.ContentBlock
			if err := json.Unmarshal(update.Update.Content, &content); err != nil {
				t.Fatalf("unmarshal content: %v", err)
			}
			if content.Text == "stale" {
				t.Fatal("stale delta was emitted")
			}
		case <-drain:
			return
		}
	}
}

func TestCodexAppPromptDoesNotEchoUserMessageChunk(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		switch msg["method"] {
		case "turn/start":
			_ = tr.emit(map[string]any{
				"id":     msg["id"],
				"result": map[string]any{"turn": map[string]any{"id": "turn-1"}},
			})
			_ = tr.emit(map[string]any{
				"method": "item/agentMessage/delta",
				"params": map[string]any{"threadId": "thread-1", "turnId": "turn-1", "delta": "pong"},
			})
			_ = tr.emit(map[string]any{
				"method": "turn/completed",
				"params": map[string]any{"threadId": "thread-1", "turn": map[string]any{"id": "turn-1", "status": "completed"}},
			})
		}
	}

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	updates := make(chan protocol.SessionUpdateParams, 4)
	conn.OnACPResponse(captureSessionUpdate(t, updates))

	var promptRes protocol.SessionPromptResult
	if err := conn.Send(context.Background(), protocol.MethodSessionPrompt, protocol.SessionPromptParams{
		SessionID: "thread-1",
		Prompt:    []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "ping"}},
	}, &promptRes); err != nil {
		t.Fatalf("prompt: %v", err)
	}

	deadline := time.After(100 * time.Millisecond)
	for {
		select {
		case update := <-updates:
			if update.Update.SessionUpdate == protocol.SessionUpdateUserMessageChunk {
				t.Fatalf("codexapp echoed user_message_chunk: %#v", update)
			}
		case <-deadline:
			return
		}
	}
}

func TestCodexAppSteerAcceptsCorrelatedUserMessageBeforeResponse(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")

	updates := make(chan protocol.SessionUpdateParams, 8)
	conn.OnACPResponse(captureSessionUpdate(t, updates))
	setActiveCodexPromptForTest(conn, "turn-1")

	tr.onSend = func(msg map[string]any) {
		if msg["method"] != "turn/steer" {
			return
		}
		params := msg["params"].(map[string]any)
		if params["expectedTurnId"] != "turn-1" || params["clientUserMessageId"] != "queued-1" {
			t.Fatalf("turn/steer params = %#v", params)
		}
		_ = tr.emit(map[string]any{
			"method": "item/started",
			"params": map[string]any{
				"threadId": "thread-1",
				"turnId":   "turn-1",
				"item": map[string]any{
					"id":       "user-2",
					"type":     "userMessage",
					"clientId": "queued-1",
					"content":  []any{map[string]any{"type": "text", "text": "steer me"}},
				},
			},
		})
		_ = tr.emit(map[string]any{
			"id":     msg["id"],
			"result": map[string]any{"turnId": "turn-1"},
		})
	}

	result, err := conn.SteerSession(context.Background(), "thread-1", "queued-1", []protocol.ContentBlock{{
		Type: protocol.ContentBlockTypeText,
		Text: "steer me",
	}})
	if err != nil {
		t.Fatalf("SteerSession(): %v", err)
	}
	if result.ProviderTurnID != "turn-1" {
		t.Fatalf("provider turn = %q", result.ProviderTurnID)
	}
	update := waitForCodexappUpdate(t, updates)
	if update.Update.SessionUpdate != protocol.SessionUpdateUserMessageChunk ||
		update.Update.MessageID != "queued-1" ||
		!protocol.SessionUpdateMetaSteered(update.Update.Meta) ||
		!protocol.SessionUpdateMetaMessageComplete(update.Update.Meta) {
		t.Fatalf("steer update = %#v", update.Update)
	}
	var steerContent protocol.ContentBlock
	if err := json.Unmarshal(update.Update.Content, &steerContent); err != nil || steerContent.Text != "steer me" {
		t.Fatalf("steer content = %#v err=%v", steerContent, err)
	}
	if len(update.Update.ContentBlocks) != 0 || update.Update.ClientMessageID != "" || update.Update.Steered {
		t.Fatalf("steer update retained private roots = %#v", update.Update)
	}
}

func TestCodexAppSteerResponseBeforeUserMessage(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	setActiveCodexPromptForTest(conn, "turn-1")

	tr.onSend = func(msg map[string]any) {
		if msg["method"] != "turn/steer" {
			return
		}
		_ = tr.emit(map[string]any{"id": msg["id"], "result": map[string]any{"turnId": "turn-1"}})
		_ = tr.emit(map[string]any{
			"method": "item/started",
			"params": map[string]any{
				"threadId": "thread-1",
				"turnId":   "turn-1",
				"item": map[string]any{
					"id":       "user-2",
					"type":     "userMessage",
					"clientId": "queued-1",
					"content":  []any{map[string]any{"type": "text", "text": "steer me"}},
				},
			},
		})
	}

	result, err := conn.SteerSession(context.Background(), "thread-1", "queued-1", []protocol.ContentBlock{{
		Type: protocol.ContentBlockTypeText,
		Text: "steer me",
	}})
	if err != nil || result.ProviderTurnID != "turn-1" {
		t.Fatalf("SteerSession() result=%#v err=%v", result, err)
	}
}

func TestCodexAppSteerReturnsAfterControlAcceptanceBeforeUserMessage(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	setActiveCodexPromptForTest(conn, "turn-1")
	updates := make(chan protocol.SessionUpdateParams, 1)
	conn.OnACPResponse(captureSessionUpdate(t, updates))

	responseSent := make(chan struct{})
	tr.onSend = func(msg map[string]any) {
		if msg["method"] != "turn/steer" {
			return
		}
		_ = tr.emit(map[string]any{"id": msg["id"], "result": map[string]any{"turnId": "turn-1"}})
		close(responseSent)
	}

	type steerCallResult struct {
		result SessionSteerResult
		err    error
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	resultCh := make(chan steerCallResult, 1)
	go func() {
		result, err := conn.SteerSession(ctx, "thread-1", "queued-1", []protocol.ContentBlock{{
			Type: protocol.ContentBlockTypeText,
			Text: "steer me",
		}})
		resultCh <- steerCallResult{result: result, err: err}
	}()

	select {
	case <-responseSent:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for turn/steer response")
	}
	select {
	case got := <-resultCh:
		if got.err != nil || got.result.ProviderTurnID != "turn-1" {
			t.Fatalf("SteerSession() result=%#v err=%v", got.result, got.err)
		}
	case <-time.After(time.Second):
		t.Fatal("SteerSession did not return after Codex accepted the control request")
	}

	if err := tr.emit(map[string]any{
		"method": "item/started",
		"params": map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":       "user-2",
				"type":     "userMessage",
				"clientId": "queued-1",
				"content":  []any{map[string]any{"type": "text", "text": "steer me"}},
			},
		},
	}); err != nil {
		t.Fatalf("emit item/started: %v", err)
	}
	update := waitForCodexappUpdate(t, updates)
	if update.Update.SessionUpdate != protocol.SessionUpdateUserMessageChunk ||
		update.Update.MessageID != "queued-1" ||
		!protocol.SessionUpdateMetaSteered(update.Update.Meta) ||
		!protocol.SessionUpdateMetaMessageComplete(update.Update.Meta) ||
		len(update.Update.ContentBlocks) != 0 || update.Update.ClientMessageID != "" || update.Update.Steered {
		t.Fatalf("steer update = %#v", update.Update)
	}
}

func TestCodexAppSteerKeepsSameTurnUpdatesFlowingBeforeAcceptance(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	setActiveCodexPromptForTest(conn, "turn-1")
	updates := make(chan protocol.SessionUpdateParams, 8)
	conn.OnACPResponse(captureSessionUpdate(t, updates))

	tr.onSend = func(msg map[string]any) {
		if msg["method"] != "turn/steer" {
			return
		}
		_ = tr.emit(map[string]any{
			"method": "item/agentMessage/delta",
			"params": map[string]any{"threadId": "thread-1", "turnId": "turn-1", "delta": "before"},
		})
		_ = tr.emit(map[string]any{
			"method": "item/started",
			"params": map[string]any{
				"threadId": "thread-1",
				"turnId":   "turn-1",
				"item": map[string]any{
					"id":       "user-2",
					"type":     "userMessage",
					"clientId": "queued-1",
					"content":  []any{map[string]any{"type": "text", "text": "change"}},
				},
			},
		})
		_ = tr.emit(map[string]any{"id": msg["id"], "result": map[string]any{"turnId": "turn-1"}})
	}

	if _, err := conn.SteerSession(context.Background(), "thread-1", "queued-1", []protocol.ContentBlock{{
		Type: protocol.ContentBlockTypeText,
		Text: "change",
	}}); err != nil {
		t.Fatalf("SteerSession(): %v", err)
	}
	first := waitForCodexappUpdate(t, updates)
	second := waitForCodexappUpdate(t, updates)
	if first.Update.SessionUpdate != protocol.SessionUpdateAgentMessageChunk ||
		second.Update.SessionUpdate != protocol.SessionUpdateUserMessageChunk ||
		!protocol.SessionUpdateMetaSteered(second.Update.Meta) ||
		!protocol.SessionUpdateMetaMessageComplete(second.Update.Meta) {
		t.Fatalf("update order = %#v then %#v", first.Update, second.Update)
	}
}

func TestCodexAppSteerNoActiveTurnReturnsInactive(t *testing.T) {
	conn := newCodexappConnWithRuntime(newCodexappRuntimeWithTransport(newFakeCodexappTransport()), t.TempDir())
	conn.BindSessionID("thread-1")
	_, err := conn.SteerSession(context.Background(), "thread-1", "queued-1", []protocol.ContentBlock{{
		Type: protocol.ContentBlockTypeText,
		Text: "change",
	}})
	if !errors.Is(err, ErrSessionSteerInactive) {
		t.Fatalf("SteerSession() err=%v, want inactive", err)
	}
}

func TestCodexAppSteerNonSteerableTurnReturnsUnavailable(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	setActiveCodexPromptForTest(conn, "turn-1")
	tr.onSend = func(msg map[string]any) {
		if msg["method"] == "turn/steer" {
			_ = tr.emit(map[string]any{
				"id": msg["id"],
				"error": map[string]any{
					"code":    -32600,
					"message": "active turn is not steerable",
				},
			})
		}
	}
	_, err := conn.SteerSession(context.Background(), "thread-1", "queued-1", []protocol.ContentBlock{{
		Type: protocol.ContentBlockTypeText,
		Text: "change",
	}})
	if !errors.Is(err, ErrSessionSteerUnavailable) {
		t.Fatalf("SteerSession() err=%v, want unavailable", err)
	}
}

func TestCodexAppReplayMarksAdditionalUserMessagesSteered(t *testing.T) {
	conn := newCodexappConnWithRuntime(nil, t.TempDir())
	updates := make(chan protocol.SessionUpdateParams, 4)
	conn.OnACPResponse(captureSessionUpdate(t, updates))
	conn.replayThreadTurns("thread-1", []appServerTurn{{
		ID: "turn-1",
		Items: []appServerThreadItem{
			{ID: "user-1", Type: "userMessage", Content: mustRaw([]appServerUserInput{{Type: "text", Text: "initial"}})},
			{ID: "user-2", ClientID: "queued-1", Type: "userMessage", Content: mustRaw([]appServerUserInput{{Type: "text", Text: "change"}})},
		},
	}})
	first := waitForCodexappUpdate(t, updates)
	second := waitForCodexappUpdate(t, updates)
	if protocol.SessionUpdateMetaSteered(first.Update.Meta) {
		t.Fatalf("initial user message marked steered: %#v", first.Update)
	}
	if !protocol.SessionUpdateMetaSteered(second.Update.Meta) || second.Update.MessageID != "queued-1" || !protocol.SessionUpdateMetaMessageComplete(second.Update.Meta) {
		t.Fatalf("additional user message = %#v", second.Update)
	}
}

func TestInstanceSteerRoutesThroughNegotiatedExtension(t *testing.T) {
	conn := &fakeConn{agentMeta: protocol.BuildWMAgentCapabilitiesMeta(nil, protocol.WMAgentExtensionCapabilities{
		SessionActions: protocol.WMSessionActionCapabilities{Steer: true},
	})}
	inst := NewInstance("test", conn)
	if _, err := inst.Initialize(context.Background(), protocol.InitializeParams{ClientCapabilities: protocol.ClientCapabilities{Meta: protocol.BuildWMClientCapabilitiesMeta(nil)}}); err != nil {
		t.Fatal(err)
	}
	steerer, ok := inst.(SessionSteerer)
	if !ok {
		t.Fatalf("instance type %T does not implement SessionSteerer", inst)
	}
	result, err := steerer.SteerSession(context.Background(), "session-1", "queued-1", []protocol.ContentBlock{{
		Type: protocol.ContentBlockTypeText,
		Text: "change",
	}})
	if err != nil {
		t.Fatalf("SteerSession(): %v", err)
	}
	if result.ProviderTurnID != "turn-1" ||
		conn.lastMethod != protocol.MethodWMSessionSteer {
		t.Fatalf("delegation result=%#v conn=%#v", result, conn)
	}
}

func TestInstanceSteerUsesNativeClaudeMethodAndPromptRequiredFallback(t *testing.T) {
	fc := &fakeConn{
		initializeMeta:     json.RawMessage(`{"steering":{"supported":true}}`),
		nativeSteerOutcome: "promptRequired",
	}
	inst := NewInstance("claude", fc)
	if _, err := inst.Initialize(context.Background(), protocol.InitializeParams{ProtocolVersion: 1}); err != nil {
		t.Fatal(err)
	}
	steerer := inst.(SessionSteerer)
	_, err := steerer.SteerSession(context.Background(), "s1", "m1", []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "change"}})
	if !errors.Is(err, ErrSessionSteerInactive) {
		t.Fatalf("native promptRequired error=%v, want inactive", err)
	}
	if fc.lastMethod != protocol.MethodSessionSteering {
		t.Fatalf("native steering method=%q, want %q", fc.lastMethod, protocol.MethodSessionSteering)
	}
	params, ok := fc.lastParams.(protocol.SessionSteeringParams)
	if !ok || params.SessionID != "s1" || len(params.Prompt) != 1 || !bytes.Contains(params.Meta, []byte(`"idleBehavior":"promptRequired"`)) {
		t.Fatalf("native steering params=%#v", fc.lastParams)
	}

	fc.nativeSteerOutcome = "injected"
	result, err := steerer.SteerSession(context.Background(), "s1", "m2", []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "again"}})
	if err != nil {
		t.Fatalf("native injected error=%v", err)
	}
	if result.Outcome != "injected" || fc.lastMethod != protocol.MethodSessionSteering {
		t.Fatalf("native injected result=%#v method=%q", result, fc.lastMethod)
	}
	if !result.AcceptedInput {
		t.Fatalf("native injected result=%#v, want accepted input acknowledgement", result)
	}
}

func TestInstanceNativeSteeringRejectsEmptyPrompt(t *testing.T) {
	fc := &fakeConn{
		initializeMeta:     json.RawMessage(`{"steering":{"supported":true}}`),
		nativeSteerOutcome: protocol.SessionSteeringOutcomeInjected,
	}
	inst := NewInstance("claude", fc)
	if _, err := inst.Initialize(context.Background(), protocol.InitializeParams{ProtocolVersion: 1}); err != nil {
		t.Fatal(err)
	}
	_, err := inst.(SessionSteerer).SteerSession(context.Background(), "s1", "m1", nil)
	if !errors.Is(err, ErrSessionActionInvalid) {
		t.Fatalf("empty native prompt error=%v, want %v", err, ErrSessionActionInvalid)
	}
	if fc.lastMethod != protocol.MethodInitialize {
		t.Fatalf("empty native prompt sent method=%q", fc.lastMethod)
	}
}

func TestInstanceDoesNotRelabelUserChunkAfterNativeSteeringAcceptance(t *testing.T) {
	fc := &fakeConn{
		initializeMeta:     json.RawMessage(`{"steering":{"supported":true}}`),
		nativeSteerOutcome: protocol.SessionSteeringOutcomeInjected,
	}
	inst := NewInstance("claude", fc)
	if _, err := inst.Initialize(context.Background(), protocol.InitializeParams{ProtocolVersion: 1}); err != nil {
		t.Fatal(err)
	}
	callbacks := &fakeCallbacks{}
	inst.SetCallbacks(callbacks)
	result, err := inst.(SessionSteerer).SteerSession(context.Background(), "s1", "queued-1", []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "change"}})
	if err != nil {
		t.Fatalf("native steer: %v", err)
	}
	if !result.AcceptedInput {
		t.Fatalf("native steer result=%#v, want accepted input acknowledgement", result)
	}
	inst.HandleACPResponse(context.Background(), protocol.MethodSessionUpdate, json.RawMessage(`{"sessionId":"s1","update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"later"},"messageId":"provider-message","_meta":{"vendor":{"trace":1}}}}`))
	if callbacks.lastMessageID != "provider-message" {
		t.Fatalf("provider messageId=%q, want provider-message", callbacks.lastMessageID)
	}
	message, ok := callbacks.lastEvent.Update.(protocol.AgentMessageEvent)
	if !ok || message.ClientMessageID != "" || message.Steered {
		t.Fatalf("later user chunk was relabeled as steering echo: %#v", callbacks.lastEvent)
	}
	if !bytes.Contains(message.Meta, []byte(`"trace":1`)) {
		t.Fatalf("provider metadata was lost: %#v", message.Meta)
	}
}

func TestInstanceForkUsesStandardSessionForkForClaude(t *testing.T) {
	fc := &fakeConn{
		agentCapabilities: protocol.AgentCapabilities{
			SessionCapabilities: &protocol.SessionCapabilities{Fork: &protocol.SessionForkCapability{}},
		},
		standardForkSessionID: "child-1",
	}
	inst := NewInstance("claude", fc)
	if _, err := inst.Initialize(context.Background(), protocol.InitializeParams{ProtocolVersion: 1}); err != nil {
		t.Fatal(err)
	}
	type currentForker interface {
		ForkCurrentSession(context.Context, string, string) (protocol.SessionForkResult, error)
	}
	forker, ok := inst.(currentForker)
	if !ok {
		t.Fatalf("instance does not implement current fork adapter: %T", inst)
	}
	result, err := forker.ForkCurrentSession(context.Background(), "source-1", `C:\workspace`)
	if err != nil {
		t.Fatalf("ForkCurrentSession(): %v", err)
	}
	if result.SessionID != "child-1" || fc.lastMethod != protocol.MethodSessionFork {
		t.Fatalf("result=%#v method=%q", result, fc.lastMethod)
	}
	params, ok := fc.lastParams.(protocol.SessionForkParams)
	if !ok || params.SessionID != "source-1" || params.CWD != `C:\workspace` || len(params.Meta) != 0 {
		t.Fatalf("standard fork params=%#v", fc.lastParams)
	}
}

func TestInstanceHistoricalForkUsesStandardMethodWithWmExtension(t *testing.T) {
	fc := &fakeConn{
		agentCapabilities: protocol.AgentCapabilities{
			SessionCapabilities: &protocol.SessionCapabilities{Fork: &protocol.SessionForkCapability{}},
		},
		standardForkSessionID: "child-2",
		standardForkMeta: protocol.BuildWMSessionForkResultMeta(nil, protocol.WMSessionForkResultExtension{
			Title: "Forked child",
			ForkPoints: map[int64]protocol.SessionForkPoint{
				3: {Provider: "codex", Ref: "child-turn-3"},
			},
		}),
	}
	inst := NewInstance("codex", fc)
	if _, err := inst.Initialize(context.Background(), protocol.InitializeParams{ProtocolVersion: 1}); err != nil {
		t.Fatal(err)
	}
	type historicalForker interface {
		ForkSessionWithCWD(context.Context, string, string, string, []protocol.SessionForkPrompt) (protocol.SessionForkResult, error)
	}
	forker, ok := inst.(historicalForker)
	if !ok {
		t.Fatalf("instance does not implement historical fork adapter: %T", inst)
	}
	prompts := []protocol.SessionForkPrompt{{DoneTurnIndex: 3, ContentBlocks: []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "follow up"}}}}
	result, err := forker.ForkSessionWithCWD(context.Background(), "source-1", `C:\workspace`, "turn-3", prompts)
	if err != nil {
		t.Fatalf("ForkSessionWithCWD(): %v", err)
	}
	if result.SessionID != "child-2" || fc.lastMethod != protocol.MethodSessionFork {
		t.Fatalf("result=%#v method=%q", result, fc.lastMethod)
	}
	if result.Title != "Forked child" || result.ForkPoints[3].Ref != "child-turn-3" {
		t.Fatalf("historical fork result=%#v", result)
	}
	params, ok := fc.lastParams.(protocol.SessionForkParams)
	if !ok {
		t.Fatalf("standard historical params=%#v", fc.lastParams)
	}
	fork, ok := protocol.WMSessionForkExtensionFromMeta(params.Meta)
	if !ok || fork.Ref != "turn-3" || len(fork.Prompts) != 1 || fork.Prompts[0].DoneTurnIndex != 3 {
		t.Fatalf("wm fork extension=%#v meta=%s", fork, params.Meta)
	}
}

func TestInstanceSessionGoalController(t *testing.T) {
	goal := protocol.SessionGoal{
		SessionID: "session-1",
		Objective: "ship",
		Status:    protocol.SessionGoalStatusActive,
	}
	conn := &fakeConn{
		agentMeta: protocol.BuildWMAgentCapabilitiesMeta(nil, protocol.WMAgentExtensionCapabilities{SessionActions: protocol.WMSessionActionCapabilities{Goal: true}}),
		goal:      &goal,
	}
	inst := NewInstance("test", conn)
	if _, err := inst.Initialize(context.Background(), protocol.InitializeParams{ClientCapabilities: protocol.ClientCapabilities{Meta: protocol.BuildWMClientCapabilitiesMeta(nil)}}); err != nil {
		t.Fatal(err)
	}
	controller, ok := inst.(SessionGoalController)
	if !ok {
		t.Fatalf("instance type %T does not implement SessionGoalController", inst)
	}
	got, err := controller.SessionGoalGet(context.Background(), "session-1")
	if err != nil {
		t.Fatalf("SessionGoalGet(): %v", err)
	}
	if got == nil || got.Objective != "ship" {
		t.Fatalf("SessionGoalGet() = %#v", got)
	}
}

func TestInstanceSessionGoalControllerUnsupported(t *testing.T) {
	inst := NewInstance("test", &fakeRawConn{})
	controller, ok := inst.(SessionGoalController)
	if !ok {
		t.Fatalf("instance type %T does not implement SessionGoalController", inst)
	}
	_, err := controller.SessionGoalGet(context.Background(), "session-1")
	if !errors.Is(err, ErrSessionActionUnsupported) {
		t.Fatalf("SessionGoalGet() error = %v", err)
	}
}

func TestInstanceClassifiesWMActionErrorData(t *testing.T) {
	tests := []struct {
		code string
		want error
	}{
		{protocol.WMActionErrorInactive, ErrSessionSteerInactive},
		{protocol.WMActionErrorBusy, ErrSessionBusy},
		{protocol.WMActionErrorUnavailable, ErrSessionSteerUnavailable},
		{protocol.WMActionErrorUnsupported, ErrSessionActionUnsupported},
		{protocol.WMActionErrorInvalid, ErrSessionActionInvalid},
	}
	for _, test := range tests {
		t.Run(test.code, func(t *testing.T) {
			conn := &fakeConn{
				agentMeta: protocol.BuildWMAgentCapabilitiesMeta(nil, protocol.WMAgentExtensionCapabilities{
					SessionActions: protocol.WMSessionActionCapabilities{Steer: true},
				}),
				sendErr: protocol.NewWMActionRPCError(test.code, "classified"),
			}
			inst := NewInstance("test", conn)
			if _, err := inst.Initialize(context.Background(), protocol.InitializeParams{ClientCapabilities: protocol.ClientCapabilities{Meta: protocol.BuildWMClientCapabilitiesMeta(nil)}}); err != nil {
				t.Fatal(err)
			}
			_, err := inst.(SessionSteerer).SteerSession(context.Background(), "session-1", "message-1", nil)
			if !errors.Is(err, test.want) {
				t.Fatalf("SteerSession() error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestCodexAppWMActionRuntimeErrorRemainsGeneric(t *testing.T) {
	runtimeErr := errors.New("runtime failed")
	got := codexappWMActionError(runtimeErr)
	if !errors.Is(got, runtimeErr) {
		t.Fatalf("runtime error=%v, want original error", got)
	}
	if code, ok := protocol.WMActionErrorCode(got); ok {
		t.Fatalf("runtime error code=%q, want no action classification", code)
	}

	invalid := fmt.Errorf("%w: malformed request", ErrSessionActionInvalid)
	code, ok := protocol.WMActionErrorCode(codexappWMActionError(invalid))
	if !ok || code != protocol.WMActionErrorInvalid {
		t.Fatalf("invalid action code=%q ok=%v", code, ok)
	}
}

func setActiveCodexPromptForTest(conn *codexappConn, turnID string) {
	conn.mu.Lock()
	conn.promptDone = make(chan codexappPromptResult, 1)
	conn.activeTurnID = turnID
	conn.lastTurnID = turnID
	conn.mu.Unlock()
}

func TestCodexAppItemLifecycleEmitsToolCallThenUpdates(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	updates := make(chan protocol.SessionUpdateParams, 4)
	conn.OnACPResponse(captureSessionUpdate(t, updates))

	if err := tr.emit(map[string]any{
		"method": "item/started",
		"params": map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":      "cmd-1",
				"type":    "commandExecution",
				"command": "rg needle",
				"status":  "inProgress",
			},
		},
	}); err != nil {
		t.Fatalf("emit item/started: %v", err)
	}

	update := waitForCodexappUpdate(t, updates)
	if update.Update.SessionUpdate != protocol.SessionUpdateToolCall {
		t.Fatalf("sessionUpdate=%q, want tool_call", update.Update.SessionUpdate)
	}
	if update.Update.ToolCallID != "cmd-1" || update.Update.Title != "rg needle" ||
		update.Update.Kind != protocol.ToolKindExecute || update.Update.Status != protocol.ToolCallStatusPending {
		t.Fatalf("tool call=%#v", update.Update)
	}

	update = waitForCodexappUpdate(t, updates)
	if update.Update.SessionUpdate != protocol.SessionUpdateToolCallUpdate {
		t.Fatalf("sessionUpdate=%q, want tool_call_update", update.Update.SessionUpdate)
	}
	if update.Update.ToolCallID != "cmd-1" || update.Update.Title != "rg needle" ||
		update.Update.Kind != protocol.ToolKindExecute || update.Update.Status != protocol.ToolCallStatusInProgress {
		t.Fatalf("tool update=%#v", update.Update)
	}

	if err := tr.emit(map[string]any{
		"method": "item/completed",
		"params": map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":               "cmd-1",
				"type":             "commandExecution",
				"command":          "rg needle",
				"status":           "completed",
				"aggregatedOutput": "server/internal",
			},
		},
	}); err != nil {
		t.Fatalf("emit item/completed: %v", err)
	}

	update = waitForCodexappUpdate(t, updates)
	if update.Update.Status != protocol.ToolCallStatusCompleted || len(update.Update.ToolCallContent) == 0 {
		t.Fatalf("completed tool update=%#v", update.Update)
	}
}

func TestCodexAppItemTitlesAreDisplaySafe(t *testing.T) {
	tests := []struct {
		name string
		item appServerThreadItem
		want string
	}{
		{
			name: "command execution strips powershell wrapper",
			item: appServerThreadItem{
				ID:      "cmd-1",
				Type:    "commandExecution",
				Command: "\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -Command \"Get-Content -Raw D:\\Code\\WheelMaker\\CLAUDE.md\"",
			},
			want: `Get-Content -Raw D:\Code\WheelMaker\CLAUDE.md`,
		},
		{
			name: "command execution strips ansi",
			item: appServerThreadItem{
				ID:      "cmd-2",
				Type:    "commandExecution",
				Command: "\x1b[32;1mrg needle\x1b[0m",
			},
			want: "rg needle",
		},
		{
			name: "file change uses changed path",
			item: appServerThreadItem{
				ID:   "call_file",
				Type: "fileChange",
				Changes: []appServerFileChange{{
					Path: "app/web/src/main.tsx",
				}},
			},
			want: "Edit app/web/src/main.tsx",
		},
		{
			name: "file change summarizes multiple files",
			item: appServerThreadItem{
				ID:   "call_file",
				Type: "fileChange",
				Changes: []appServerFileChange{
					{Path: "app/web/src/main.tsx"},
					{Path: "server/internal/hub/agent/codexapp_agent.go"},
				},
			},
			want: "Edit 2 files",
		},
		{
			name: "dynamic tool extracts command argument",
			item: appServerThreadItem{
				ID:        "call_dynamic",
				Type:      "dynamicToolCall",
				Arguments: json.RawMessage(`{"command":"Get-ChildItem -Force"}`),
			},
			want: "Get-ChildItem -Force",
		},
		{
			name: "dynamic tool hides opaque call id",
			item: appServerThreadItem{
				ID:   "call_p4Y4Q5C2Eiz9LkpcRF4tn286",
				Type: "dynamicToolCall",
			},
			want: "Tool call",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := codexappItemTitle(tt.item); got != tt.want {
				t.Fatalf("codexappItemTitle() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestCodexAppOutputDeltaDoesNotDisplayOpaqueCallID(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	updates := make(chan protocol.SessionUpdateParams, 2)
	conn.OnACPResponse(captureSessionUpdate(t, updates))

	if err := tr.emit(map[string]any{
		"method": "item/fileChange/outputDelta",
		"params": map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"itemId":   "call_p4Y4Q5C2Eiz9LkpcRF4tn286",
			"delta":    "updated",
		},
	}); err != nil {
		t.Fatalf("emit output delta: %v", err)
	}

	start := waitForCodexappUpdate(t, updates)
	if start.Update.SessionUpdate != protocol.SessionUpdateToolCall ||
		start.Update.Title != "Edit files" {
		t.Fatalf("output delta start=%#v, want title Edit files", start.Update)
	}

	update := waitForCodexappUpdate(t, updates)
	if update.Update.SessionUpdate != protocol.SessionUpdateToolCallUpdate ||
		update.Update.Title != "Edit files" {
		t.Fatalf("output delta update=%#v, want title Edit files", update.Update)
	}
}

func TestCodexAppTurnPlanUpdatedEmitsFullACPPlan(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	updates := make(chan protocol.SessionUpdateParams, 1)
	conn.OnACPResponse(captureSessionUpdate(t, updates))

	if err := tr.emit(map[string]any{
		"method": "turn/plan/updated",
		"params": map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"plan": []map[string]any{
				{"step": "Inspect app-server schema", "status": "completed"},
				{"step": "Patch bridge", "status": "inProgress"},
			},
		},
	}); err != nil {
		t.Fatalf("emit plan update: %v", err)
	}

	update := waitForCodexappUpdate(t, updates)
	if update.Update.SessionUpdate != protocol.SessionUpdatePlan {
		t.Fatalf("sessionUpdate=%q, want plan", update.Update.SessionUpdate)
	}
	want := []protocol.PlanEntry{
		{Content: "Inspect app-server schema", Priority: "medium", Status: protocol.ToolCallStatusCompleted},
		{Content: "Patch bridge", Priority: "medium", Status: protocol.ToolCallStatusInProgress},
	}
	if !reflect.DeepEqual(update.Update.Entries, want) {
		t.Fatalf("plan entries=%#v, want %#v", update.Update.Entries, want)
	}
}

func TestCodexAppFileChangePatchUpdatedEmitsDiffToolUpdate(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	updates := make(chan protocol.SessionUpdateParams, 1)
	conn.OnACPResponse(captureSessionUpdate(t, updates))

	if err := tr.emit(map[string]any{
		"method": "item/fileChange/patchUpdated",
		"params": map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"itemId":   "patch-1",
			"changes": []map[string]any{{
				"path": "D:/Code/WheelMaker/server/main.go",
				"kind": map[string]any{"type": "update", "move_path": nil},
				"diff": "@@ -1 +1 @@",
			}},
		},
	}); err != nil {
		t.Fatalf("emit patch update: %v", err)
	}

	start := waitForCodexappUpdate(t, updates)
	if start.Update.SessionUpdate != protocol.SessionUpdateToolCall ||
		start.Update.ToolCallID != "patch-1" ||
		start.Update.Status != protocol.ToolCallStatusPending {
		t.Fatalf("patch start=%#v", start.Update)
	}

	update := waitForCodexappUpdate(t, updates)
	if update.Update.SessionUpdate != protocol.SessionUpdateToolCallUpdate ||
		update.Update.ToolCallID != "patch-1" ||
		update.Update.Kind != protocol.ToolKindWrite ||
		update.Update.Status != protocol.ToolCallStatusInProgress {
		t.Fatalf("patch update=%#v", update.Update)
	}
	if len(update.Update.ToolCallContent) != 1 || update.Update.ToolCallContent[0].Type != "diff" ||
		update.Update.ToolCallContent[0].Path != "D:/Code/WheelMaker/server/main.go" ||
		update.Update.ToolCallContent[0].NewText != "@@ -1 +1 @@" {
		t.Fatalf("patch content=%#v", update.Update.ToolCallContent)
	}
}

func TestCodexAppRuntimeAttachesTurnDiffArtifact(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		if msg["method"] == "turn/start" {
			_ = tr.emit(map[string]any{
				"id": msg["id"],
				"result": map[string]any{
					"turn": map[string]any{"id": "turn-1"},
				},
			})
		}
	}

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")

	var promptRes protocol.PromptOutcome
	errCh := make(chan error, 1)
	go func() {
		errCh <- conn.Send(context.Background(), protocol.MethodSessionPrompt, protocol.SessionPromptParams{
			SessionID: "thread-1",
			Prompt:    []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "edit file"}},
		}, &promptRes)
	}()
	waitForActiveTurn(t, conn, "turn-1")

	staleDiff := "diff --git a/stale.txt b/stale.txt\n--- a/stale.txt\n+++ b/stale.txt\n@@ -1 +1 @@\n-old\n+stale\n"
	currentDiff := "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n"
	if err := tr.emit(map[string]any{
		"method": "turn/diff/updated",
		"params": map[string]any{"threadId": "thread-1", "turnId": "turn-stale", "diff": staleDiff},
	}); err != nil {
		t.Fatalf("emit stale diff: %v", err)
	}
	if err := tr.emit(map[string]any{
		"method": "turn/diff/updated",
		"params": map[string]any{"threadId": "thread-1", "turnId": "turn-1", "diff": currentDiff},
	}); err != nil {
		t.Fatalf("emit current diff: %v", err)
	}
	waitForTurnDiff(t, conn, "turn-1", currentDiff)
	if err := tr.emit(map[string]any{
		"method": "turn/completed",
		"params": map[string]any{"threadId": "thread-1", "turn": map[string]any{"id": "turn-1", "status": "completed"}},
	}); err != nil {
		t.Fatalf("emit completion: %v", err)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("SessionPrompt: %v", err)
	}
	if promptRes.StopReason != protocol.StopReasonEndTurn {
		t.Fatalf("stopReason=%q, want end_turn", promptRes.StopReason)
	}
	if len(promptRes.Artifacts) != 1 {
		t.Fatalf("artifacts len = %d, want 1: %#v", len(promptRes.Artifacts), promptRes.Artifacts)
	}
	artifact := promptRes.Artifacts[0]
	if artifact.Type != "diff" || artifact.Format != "unified-diff" || artifact.Content != currentDiff {
		t.Fatalf("artifact = %#v, want current unified diff", artifact)
	}
}

func TestCodexAppThreadResumeDecodesOfficialFileChangeKind(t *testing.T) {
	raw := []byte(`{
		"thread": {
			"id": "thread-1",
			"turns": [{
				"id": "turn-1",
				"itemsView": "full",
				"status": "completed",
				"items": [{
					"id": "patch-1",
					"type": "fileChange",
					"status": "completed",
					"changes": [{
						"path": "D:/Code/WheelMaker/server/main.go",
						"kind": { "type": "update", "move_path": null },
						"diff": "@@ -1 +1 @@"
					}]
				}]
			}]
		}
	}`)
	var resp appServerThreadStartResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		t.Fatalf("unmarshal official fileChange kind: %v", err)
	}
	if got := len(resp.Thread.Turns[0].Items[0].Changes); got != 1 {
		t.Fatalf("fileChange changes len=%d, want 1", got)
	}
}

func TestCodexAppConfigStateIncludesPersonalityInRequests(t *testing.T) {
	state := newCodexappConfigState()
	options := state.options()
	var found bool
	for _, option := range options {
		if option.ID != "personality" {
			continue
		}
		found = true
		if option.CurrentValue != "none" {
			t.Fatalf("personality currentValue=%q, want none", option.CurrentValue)
		}
		if len(option.Options) != 3 {
			t.Fatalf("personality options len=%d, want 3", len(option.Options))
		}
	}
	if !found {
		t.Fatal("personality config option not exposed")
	}

	if err := state.set("personality", "pragmatic"); err != nil {
		t.Fatalf("set personality: %v", err)
	}
	if err := state.set("personality", "chaotic"); err == nil {
		t.Fatal("set invalid personality succeeded")
	}

	threadStartRaw, err := json.Marshal(state.threadStartParams("/tmp/project"))
	if err != nil {
		t.Fatalf("marshal thread start: %v", err)
	}
	if !strings.Contains(string(threadStartRaw), `"personality":"pragmatic"`) {
		t.Fatalf("thread/start params=%s, want personality", threadStartRaw)
	}

	threadResumeRaw, err := json.Marshal(state.threadResumeParams("thread-1", "/tmp/project"))
	if err != nil {
		t.Fatalf("marshal thread resume: %v", err)
	}
	if !strings.Contains(string(threadResumeRaw), `"personality":"pragmatic"`) {
		t.Fatalf("thread/resume params=%s, want personality", threadResumeRaw)
	}

	turnStartRaw, err := json.Marshal(state.turnStartParams("thread-1", "/tmp/project", []appServerUserInput{{Type: "text", Text: "hello"}}))
	if err != nil {
		t.Fatalf("marshal turn start: %v", err)
	}
	if !strings.Contains(string(turnStartRaw), `"personality":"pragmatic"`) {
		t.Fatalf("turn/start params=%s, want personality", turnStartRaw)
	}
}

func TestCodexAppConfigStateExposesFastModeAsSessionOption(t *testing.T) {
	state := newCodexappConfigState()
	options := state.options()
	if got := currentConfigValue(options, "fast_mode"); got != "off" {
		t.Fatalf("default fast mode=%q, want off", got)
	}

	var values []protocol.ConfigOptionValue
	for _, option := range options {
		if option.ID == "fast_mode" {
			if option.Category != "speed" {
				t.Fatalf("fast mode category=%q, want speed", option.Category)
			}
			values = option.Options
			break
		}
	}
	want := []protocol.ConfigOptionValue{
		{Value: "off", Name: "Off"},
		{Value: "on", Name: "On"},
	}
	if !reflect.DeepEqual(values, want) {
		t.Fatalf("fast mode options=%#v, want %#v", values, want)
	}
	if err := state.set("fast_mode", "on"); err != nil {
		t.Fatalf("set fast mode on: %v", err)
	}
	if got := currentConfigValue(state.options(), "fast_mode"); got != "on" {
		t.Fatalf("fast mode=%q, want on", got)
	}
	if err := state.set("fast_mode", "turbo"); err == nil {
		t.Fatal("set invalid fast mode succeeded")
	}
}

func TestCodexAppFastModeMapsCatalogTierIntoTurnStart(t *testing.T) {
	var response appServerModelListResponse
	if err := json.Unmarshal([]byte(`{
		"data": [{
			"id": "gpt-fast",
			"displayName": "GPT Fast",
			"serviceTiers": [{
				"id": "priority",
				"name": "Fast",
				"description": "1.5x speed, increased usage"
			}],
			"defaultServiceTier": null
		}]
	}`), &response); err != nil {
		t.Fatalf("unmarshal model list: %v", err)
	}
	state := newCodexappConfigState()
	state.setModels(response.Models)
	if err := state.set("fast_mode", "on"); err != nil {
		t.Fatalf("set fast mode on: %v", err)
	}

	onParams := mustJSONMap(t, state.turnStartParams("thread-1", "/tmp/project", []appServerUserInput{{Type: "text", Text: "hello"}}))
	if got := onParams["serviceTier"]; got != "priority" {
		t.Fatalf("fast serviceTier=%#v, want priority", got)
	}

	if err := state.set("fast_mode", "off"); err != nil {
		t.Fatalf("set fast mode off: %v", err)
	}
	offParams := mustJSONMap(t, state.turnStartParams("thread-1", "/tmp/project", []appServerUserInput{{Type: "text", Text: "hello"}}))
	if value, ok := offParams["serviceTier"]; !ok || value != nil {
		t.Fatalf("standard serviceTier present=%v value=%#v, want explicit null", ok, value)
	}
}

func TestCodexAppFastModeRemainsOnWhenCurrentModelHasNoFastTier(t *testing.T) {
	state := newCodexappConfigState()
	if err := state.set("fast_mode", "on"); err != nil {
		t.Fatalf("set fast mode on: %v", err)
	}
	state.setModels([]appServerModel{{ID: "gpt-standard"}})
	if got := currentConfigValue(state.options(), "fast_mode"); got != "on" {
		t.Fatalf("fast mode after model refresh=%q, want on", got)
	}

	params := mustJSONMap(t, state.turnStartParams("thread-1", "/tmp/project", []appServerUserInput{{Type: "text", Text: "hello"}}))
	if value, ok := params["serviceTier"]; !ok || value != nil {
		t.Fatalf("unsupported serviceTier present=%v value=%#v, want explicit null", ok, value)
	}
}

func mustJSONMap(t *testing.T, value any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal JSON object: %v", err)
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		t.Fatalf("unmarshal JSON object: %v", err)
	}
	return object
}

func TestCodexAppTokenUsageNotificationEmitsUsageUpdate(t *testing.T) {
	conn := newCodexappConnWithRuntimeAndProject(nil, t.TempDir(), "proj")
	conn.BindSessionID("thread-1")
	updates := make(chan protocol.SessionUpdateParams, 1)
	conn.OnACPResponse(captureSessionUpdate(t, updates))

	conn.handleAppServerNotification("thread/tokenUsage/updated", mustRaw(map[string]any{
		"threadId": "thread-1",
		"turnId":   "turn-1",
		"tokenUsage": map[string]any{
			"total": map[string]any{
				"totalTokens":           40894907,
				"inputTokens":           40892907,
				"cachedInputTokens":     12000,
				"outputTokens":          2000,
				"reasoningOutputTokens": 300,
			},
			"last": map[string]any{
				"totalTokens":           93000,
				"inputTokens":           90700,
				"cachedInputTokens":     200,
				"outputTokens":          2300,
				"reasoningOutputTokens": 50,
			},
			"modelContextWindow": 192000,
		},
	}))

	update := waitForCodexappUpdate(t, updates)
	if update.SessionID != "thread-1" {
		t.Fatalf("sessionID=%q, want thread-1", update.SessionID)
	}
	if update.Update.SessionUpdate != protocol.SessionUpdateUsageUpdate {
		t.Fatalf("sessionUpdate=%q, want usage_update", update.Update.SessionUpdate)
	}
	// Usage must reflect the current context-window occupancy. Codex reports it
	// as tokenUsage.last.totalTokens; tokenUsage.total is cumulative session
	// accounting and can greatly exceed modelContextWindow.
	if update.Update.Used == nil || *update.Update.Used != 93000 {
		t.Fatalf("used=%v, want 93000 (tokenUsage.last.totalTokens)", update.Update.Used)
	}
	if update.Update.Size == nil || *update.Update.Size != 192000 {
		t.Fatalf("size=%v, want 192000", update.Update.Size)
	}
	if update.Update.UpdatedAt != "" {
		t.Fatalf("usage updatedAt=%q, want omitted from ACP", update.Update.UpdatedAt)
	}
}

func TestCodexAppCompletedReasoningItemEmitsThoughtChunk(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	updates := make(chan protocol.SessionUpdateParams, 1)
	conn.OnACPResponse(captureSessionUpdate(t, updates))

	if err := tr.emit(map[string]any{
		"method": "item/completed",
		"params": map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":      "reasoning-1",
				"type":    "reasoning",
				"summary": []string{"checking files"},
			},
		},
	}); err != nil {
		t.Fatalf("emit reasoning item: %v", err)
	}

	update := waitForCodexappUpdate(t, updates)
	if update.Update.SessionUpdate != protocol.SessionUpdateAgentThoughtChunk {
		t.Fatalf("sessionUpdate=%q, want agent_thought_chunk", update.Update.SessionUpdate)
	}
	var content protocol.ContentBlock
	if err := json.Unmarshal(update.Update.Content, &content); err != nil {
		t.Fatalf("unmarshal content: %v", err)
	}
	if content.Text != "checking files" {
		t.Fatalf("thought text=%q, want checking files", content.Text)
	}
}

func waitForCodexappUpdate(t *testing.T, updates <-chan protocol.SessionUpdateParams) protocol.SessionUpdateParams {
	t.Helper()
	select {
	case update := <-updates:
		return update
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for codexapp update")
		return protocol.SessionUpdateParams{}
	}
}

func TestCodexAppCancelClearsActivePromptState(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })

	var mu sync.Mutex
	nextTurn := 0
	tr.onSend = func(msg map[string]any) {
		switch msg["method"] {
		case "turn/start":
			mu.Lock()
			nextTurn++
			turnID := "turn-1"
			if nextTurn == 2 {
				turnID = "turn-2"
			}
			mu.Unlock()
			_ = tr.emit(map[string]any{
				"id": msg["id"],
				"result": map[string]any{
					"turn": map[string]any{"id": turnID},
				},
			})
		case "turn/interrupt":
			_ = tr.emit(map[string]any{"id": msg["id"], "result": map[string]any{}})
			_ = tr.emit(map[string]any{
				"method": "turn/completed",
				"params": map[string]any{"threadId": "thread-1", "turn": map[string]any{"id": "turn-1", "status": "interrupted"}},
			})
		}
	}

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")

	var firstRes protocol.SessionPromptResult
	firstErr := make(chan error, 1)
	go func() {
		firstErr <- conn.Send(context.Background(), protocol.MethodSessionPrompt, protocol.SessionPromptParams{
			SessionID: "thread-1",
			Prompt:    []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "first"}},
		}, &firstRes)
	}()

	waitForActiveTurn(t, conn, "turn-1")
	if err := conn.Notify(protocol.MethodSessionCancel, protocol.SessionCancelParams{SessionID: "thread-1"}); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if err := <-firstErr; err != nil {
		t.Fatalf("first prompt: %v", err)
	}
	if firstRes.StopReason != protocol.StopReasonCancelled {
		t.Fatalf("first stopReason=%q, want cancelled", firstRes.StopReason)
	}

	var secondRes protocol.SessionPromptResult
	secondErr := make(chan error, 1)
	go func() {
		secondErr <- conn.Send(context.Background(), protocol.MethodSessionPrompt, protocol.SessionPromptParams{
			SessionID: "thread-1",
			Prompt:    []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "second"}},
		}, &secondRes)
	}()

	waitForActiveTurn(t, conn, "turn-2")
	if err := tr.emit(map[string]any{
		"method": "turn/completed",
		"params": map[string]any{"threadId": "thread-1", "turn": map[string]any{"id": "turn-2", "status": "completed"}},
	}); err != nil {
		t.Fatalf("emit second completion: %v", err)
	}
	if err := <-secondErr; err != nil {
		t.Fatalf("second prompt should start after cancel: %v", err)
	}
	if secondRes.StopReason != protocol.StopReasonEndTurn {
		t.Fatalf("second stopReason=%q, want end_turn", secondRes.StopReason)
	}
}

func TestCodexAppCancelInterruptsAfterPromptContextCancelledFirst(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	interrupts := make(chan map[string]any, 1)
	tr.onSend = func(msg map[string]any) {
		switch msg["method"] {
		case "turn/start":
			_ = tr.emit(map[string]any{
				"id": msg["id"],
				"result": map[string]any{
					"turn": map[string]any{"id": "turn-1"},
				},
			})
		case "turn/interrupt":
			interrupts <- msg
			_ = tr.emit(map[string]any{"id": msg["id"], "result": map[string]any{}})
		}
	}

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() {
		var promptRes protocol.SessionPromptResult
		errCh <- conn.Send(ctx, protocol.MethodSessionPrompt, protocol.SessionPromptParams{
			SessionID: "thread-1",
			Prompt:    []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "first"}},
		}, &promptRes)
	}()
	waitForActiveTurn(t, conn, "turn-1")

	cancel()
	if err := <-errCh; err == nil {
		t.Fatal("prompt should return context cancellation")
	}
	if err := conn.Notify(protocol.MethodSessionCancel, protocol.SessionCancelParams{SessionID: "thread-1"}); err != nil {
		t.Fatalf("cancel notify: %v", err)
	}
	select {
	case msg := <-interrupts:
		params := msg["params"].(map[string]any)
		if params["turnId"] != "turn-1" {
			t.Fatalf("interrupt params=%#v", params)
		}
	case <-time.After(time.Second):
		t.Fatal("turn/interrupt was not sent")
	}
}

func TestCodexAppRuntimeCloseCompletesActivePrompt(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	tr.onSend = func(msg map[string]any) {
		if msg["method"] == "turn/start" {
			_ = tr.emit(map[string]any{
				"id": msg["id"],
				"result": map[string]any{
					"turn": map[string]any{"id": "turn-1"},
				},
			})
		}
	}

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")
	errCh := make(chan error, 1)
	go func() {
		var promptRes protocol.SessionPromptResult
		errCh <- conn.Send(context.Background(), protocol.MethodSessionPrompt, protocol.SessionPromptParams{
			SessionID: "thread-1",
			Prompt:    []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "ping"}},
		}, &promptRes)
	}()
	waitForActiveTurn(t, conn, "turn-1")

	if err := rt.close(); err != nil {
		t.Fatalf("close runtime: %v", err)
	}
	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("prompt should fail when runtime closes")
		}
	case <-time.After(time.Second):
		t.Fatal("prompt did not unblock after runtime close")
	}
}

func TestCodexAppModelRefreshResetsMissingSelectedModel(t *testing.T) {
	state := newCodexappConfigState()
	state.setModels([]appServerModel{{ID: "gpt-5"}})
	if err := state.set(protocol.ConfigOptionIDModel, "gpt-5"); err != nil {
		t.Fatalf("set model: %v", err)
	}
	state.setModels([]appServerModel{{ID: "gpt-5-mini", DefaultReasoningEffort: "low", SupportedReasoningEfforts: []string{"low"}}})
	if got := currentConfigValue(state.options(), protocol.ConfigOptionIDModel); got != "gpt-5-mini" {
		t.Fatalf("model=%q, want gpt-5-mini", got)
	}
	if got := currentConfigValue(state.options(), protocol.ConfigOptionIDReasoningEffort); got != "low" {
		t.Fatalf("reasoning=%q, want low", got)
	}
}

func TestCodexAppReasoningOptionsCapitalizeDisplayNames(t *testing.T) {
	state := newCodexappConfigState()
	state.setModels([]appServerModel{{
		ID:                        "gpt-5.5",
		SupportedReasoningEfforts: []string{"low", "medium", "high", "xhigh"},
	}})

	var got []protocol.ConfigOptionValue
	for _, option := range state.options() {
		if option.ID == protocol.ConfigOptionIDReasoningEffort {
			got = option.Options
			break
		}
	}
	want := []protocol.ConfigOptionValue{
		{Value: "low", Name: "Low"},
		{Value: "medium", Name: "Medium"},
		{Value: "high", Name: "High"},
		{Value: "xhigh", Name: "Xhigh"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("reasoning options=%#v, want %#v", got, want)
	}
}

func TestCodexAppModelListDecodesAppServerDataShape(t *testing.T) {
	var resp appServerModelListResponse
	if err := json.Unmarshal([]byte(`{
		"data": [{
			"id": "gpt-5.5",
			"displayName": "GPT-5.5",
			"supportedReasoningEfforts": [
				{"reasoningEffort": "low", "description": "Fast"},
				{"reasoningEffort": "high", "description": "Deep"}
			],
			"defaultReasoningEffort": "high",
			"isDefault": true
		}]
	}`), &resp); err != nil {
		t.Fatalf("unmarshal model list: %v", err)
	}
	if len(resp.Models) != 1 {
		t.Fatalf("models=%#v, want one model", resp.Models)
	}
	model := resp.Models[0]
	if model.ID != "gpt-5.5" || model.Name != "GPT-5.5" {
		t.Fatalf("model=%#v, want id and display name", model)
	}
	if !reflect.DeepEqual(model.SupportedReasoningEfforts, []string{"low", "high"}) {
		t.Fatalf("efforts=%#v", model.SupportedReasoningEfforts)
	}
	if model.DefaultReasoningEffort != "high" {
		t.Fatalf("default reasoning=%q", model.DefaultReasoningEffort)
	}
}

func TestCodexAppModelListIgnoresLegacyModelsShape(t *testing.T) {
	var resp appServerModelListResponse
	if err := json.Unmarshal([]byte(`{
		"models": [{
			"id": "legacy-models-field",
			"name": "Legacy"
		}]
	}`), &resp); err != nil {
		t.Fatalf("unmarshal legacy model list: %v", err)
	}
	if len(resp.Models) != 0 {
		t.Fatalf("legacy models field decoded as %#v, want ignored", resp.Models)
	}
}

func TestCodexAppThreadListDecodesOfficialDataShape(t *testing.T) {
	var resp appServerThreadListResponse
	if err := json.Unmarshal([]byte(`{
		"data": [{
			"id": "thread-1",
			"sessionId": "session-1",
			"name": null,
			"preview": "Preview title",
			"cwd": "D:\\Code\\WheelMaker",
			"createdAt": 1778536400,
			"updatedAt": 1778536492,
			"cliVersion": "0.1.0",
			"ephemeral": false,
			"modelProvider": "openai",
			"source": "user",
			"status": {"type": "idle"},
			"turns": []
		}],
		"nextCursor": "cursor-2"
	}`), &resp); err != nil {
		t.Fatalf("unmarshal thread list: %v", err)
	}
	if len(resp.Data) != 1 {
		t.Fatalf("data=%#v, want one thread", resp.Data)
	}
	thread := resp.Data[0]
	if thread.ID != "thread-1" || thread.displayTitle() != "Preview title" {
		t.Fatalf("thread=%#v, want id and preview title", thread)
	}
	if got := string(thread.UpdatedAt); got != "2026-05-11T21:54:52Z" {
		t.Fatalf("updatedAt=%q, want RFC3339 timestamp", got)
	}
	if resp.NextCursor != "cursor-2" {
		t.Fatalf("nextCursor=%q", resp.NextCursor)
	}
}

func TestCodexAppTurnNotificationsDecodeOfficialNestedTurnShape(t *testing.T) {
	var started appServerTurnEventParams
	if err := json.Unmarshal([]byte(`{
		"threadId": "thread-1",
		"turn": {"id": "turn-1", "items": [], "status": "inProgress"}
	}`), &started); err != nil {
		t.Fatalf("unmarshal turn/started: %v", err)
	}
	if started.ThreadID != "thread-1" || started.turnID() != "turn-1" {
		t.Fatalf("started=%#v", started)
	}

	var completed appServerTurnCompletedParams
	if err := json.Unmarshal([]byte(`{
		"threadId": "thread-1",
		"turn": {"id": "turn-1", "items": [], "status": "interrupted"}
	}`), &completed); err != nil {
		t.Fatalf("unmarshal turn/completed: %v", err)
	}
	if completed.turnID() != "turn-1" || completed.status() != "interrupted" {
		t.Fatalf("completed=%#v", completed)
	}
}

func TestCodexAppSessionLoadReplaysThreadTurnsBeforeReturning(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		method, _ := msg["method"].(string)
		id := msg["id"]
		switch method {
		case "model/list":
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{"data": []map[string]any{{"id": "gpt-5", "displayName": "GPT-5"}}}})
		case "thread/resume":
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{
				"thread": map[string]any{
					"id": "thread-1",
					"turns": []map[string]any{{
						"id":        "turn-1",
						"itemsView": "full",
						"status":    "completed",
						"items": []map[string]any{
							{
								"id":   "user-1",
								"type": "userMessage",
								"content": []map[string]any{{
									"type":          "text",
									"text":          "hello",
									"text_elements": []any{},
								}},
							},
							{"id": "agent-1", "type": "agentMessage", "text": "world", "phase": "final_answer"},
						},
					}},
				},
			}})
		default:
			t.Errorf("unexpected app-server method %q", method)
		}
	}

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	updates := make(chan protocol.SessionUpdateParams, 2)
	conn.OnACPResponse(captureSessionUpdate(t, updates))

	var loadRes protocol.SessionLoadResult
	if err := conn.Send(context.Background(), protocol.MethodSessionLoad, protocol.SessionLoadParams{
		SessionID: "thread-1",
		CWD:       t.TempDir(),
	}, &loadRes); err != nil {
		t.Fatalf("SessionLoad: %v", err)
	}

	first := waitForCodexappUpdate(t, updates)
	if first.SessionID != "thread-1" || first.Update.SessionUpdate != protocol.SessionUpdateUserMessageChunk {
		t.Fatalf("first replay update=%#v", first)
	}
	var userContent protocol.ContentBlock
	if err := json.Unmarshal(first.Update.Content, &userContent); err != nil {
		t.Fatalf("unmarshal user content: %v", err)
	}
	if userContent.Text != "hello" {
		t.Fatalf("user replay text=%q", userContent.Text)
	}

	second := waitForCodexappUpdate(t, updates)
	if second.SessionID != "thread-1" || second.Update.SessionUpdate != protocol.SessionUpdateAgentMessageChunk {
		t.Fatalf("second replay update=%#v", second)
	}
	var agentContent protocol.ContentBlock
	if err := json.Unmarshal(second.Update.Content, &agentContent); err != nil {
		t.Fatalf("unmarshal agent content: %v", err)
	}
	if agentContent.Text != "world" {
		t.Fatalf("agent replay text=%q", agentContent.Text)
	}
	if second.Update.MessageID != "agent-1" || !protocol.SessionUpdateMetaMessageComplete(second.Update.Meta) {
		t.Fatalf("agent replay lifecycle=%#v meta=%s", second.Update, second.Update.Meta)
	}
	if got := protocol.SessionUpdateMetaMessagePhase(second.Update.Meta); got != protocol.SessionMessagePhaseFinalAnswer {
		t.Fatalf("agent replay phase=%q, meta=%s", got, second.Update.Meta)
	}
}

func TestCodexAppSessionLoadReadsThreadWhenResumeTurnsAreNotFull(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		method, _ := msg["method"].(string)
		id := msg["id"]
		switch method {
		case "model/list":
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{"data": []map[string]any{{"id": "gpt-5", "displayName": "GPT-5"}}}})
		case "thread/resume":
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{
				"thread": map[string]any{
					"id": "thread-1",
					"turns": []map[string]any{{
						"id":        "turn-summary",
						"itemsView": "summary",
						"status":    "completed",
						"items":     []map[string]any{},
					}},
				},
			}})
		case "thread/read":
			params := msg["params"].(map[string]any)
			if params["threadId"] != "thread-1" || params["includeTurns"] != true {
				t.Errorf("thread/read params=%#v", params)
			}
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{
				"thread": map[string]any{
					"id": "thread-1",
					"turns": []map[string]any{{
						"id":        "turn-full",
						"itemsView": "full",
						"status":    "completed",
						"items": []map[string]any{{
							"id":   "agent-1",
							"type": "agentMessage",
							"text": "loaded from read",
						}},
					}},
				},
			}})
		default:
			t.Errorf("unexpected app-server method %q", method)
		}
	}

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	updates := make(chan protocol.SessionUpdateParams, 1)
	conn.OnACPResponse(captureSessionUpdate(t, updates))

	var loadRes protocol.SessionLoadResult
	if err := conn.Send(context.Background(), protocol.MethodSessionLoad, protocol.SessionLoadParams{
		SessionID: "thread-1",
		CWD:       t.TempDir(),
	}, &loadRes); err != nil {
		t.Fatalf("SessionLoad: %v", err)
	}

	update := waitForCodexappUpdate(t, updates)
	if update.Update.SessionUpdate != protocol.SessionUpdateAgentMessageChunk {
		t.Fatalf("replay update=%#v, want agent message from thread/read", update)
	}
	var content protocol.ContentBlock
	if err := json.Unmarshal(update.Update.Content, &content); err != nil {
		t.Fatalf("unmarshal replay content: %v", err)
	}
	if content.Text != "loaded from read" {
		t.Fatalf("replay text=%q, want thread/read content", content.Text)
	}
}

func TestCodexAppPromptResultIncludesForkPoint(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		method, _ := msg["method"].(string)
		id := msg["id"]
		switch method {
		case "turn/start":
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{
				"turn": map[string]any{"id": "turn-fork-point"},
			}})
			_ = tr.emit(map[string]any{
				"method": "turn/completed",
				"params": map[string]any{
					"threadId": "thread-1",
					"turn": map[string]any{
						"id":     "turn-fork-point",
						"status": "completed",
					},
				},
			})
		default:
			t.Errorf("unexpected app-server method %q", method)
		}
	}

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.bindSessionIDs("thread-1", "thread-1")
	var promptRes protocol.PromptOutcome
	if err := conn.Send(context.Background(), protocol.MethodSessionPrompt, protocol.SessionPromptParams{
		SessionID: "thread-1",
		Prompt:    []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "fork me"}},
	}, &promptRes); err != nil {
		t.Fatalf("SessionPrompt: %v", err)
	}
	if promptRes.ForkPoint == nil {
		t.Fatal("prompt result forkPoint is nil")
	}
	if promptRes.ForkPoint.Provider != string(protocol.ACPProviderCodex) || promptRes.ForkPoint.Ref != "turn-fork-point" {
		t.Fatalf("forkPoint = %#v", promptRes.ForkPoint)
	}
}

func TestCodexAppResolveForkPointsReadsAndExactlyMatchesPrompts(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		method, _ := msg["method"].(string)
		id := msg["id"]
		switch method {
		case "thread/read":
			params := msg["params"].(map[string]any)
			if params["threadId"] != "thread-source" || params["includeTurns"] != true {
				t.Errorf("thread/read params=%#v", params)
			}
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{
				"thread": map[string]any{
					"id": "thread-source",
					"turns": []map[string]any{
						codexappTestPromptTurn("turn-1", "first"),
						codexappTestPromptTurn("turn-2", "second"),
					},
				},
			}})
		default:
			t.Errorf("unexpected app-server method %q", method)
		}
	}

	conn := newCodexappConnWithRuntimeAndProject(rt, t.TempDir(), "proj")
	points, err := conn.ResolveForkPoints(context.Background(), "thread-source", []protocol.SessionForkPrompt{
		{DoneTurnIndex: 3, ContentBlocks: []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "first"}}},
		{DoneTurnIndex: 7, ContentBlocks: []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "second"}}},
	})
	if err != nil {
		t.Fatalf("ResolveForkPoints: %v", err)
	}
	if len(points) != 2 || points[3].Ref != "turn-1" || points[7].Ref != "turn-2" {
		t.Fatalf("points = %#v", points)
	}
}

func TestCodexAppResolveForkPointsDoesNotGuessOnMismatch(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		id := msg["id"]
		_ = tr.emit(map[string]any{"id": id, "result": map[string]any{
			"thread": map[string]any{
				"id":    "thread-source",
				"turns": []map[string]any{codexappTestPromptTurn("turn-1", "native text")},
			},
		}})
	}

	conn := newCodexappConnWithRuntimeAndProject(rt, t.TempDir(), "proj")
	points, err := conn.ResolveForkPoints(context.Background(), "thread-source", []protocol.SessionForkPrompt{{
		DoneTurnIndex: 3,
		ContentBlocks: []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "different text"}},
	}})
	if err != nil {
		t.Fatalf("ResolveForkPoints: %v", err)
	}
	if len(points) != 0 {
		t.Fatalf("points = %#v, want no guessed mapping", points)
	}
}

func TestCodexAppForkSessionUsesLastTurnIDAndRemapsTargetTurns(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		method, _ := msg["method"].(string)
		id := msg["id"]
		switch method {
		case "thread/fork":
			params := msg["params"].(map[string]any)
			if params["threadId"] != "thread-source" || params["lastTurnId"] != "source-turn-2" {
				t.Errorf("thread/fork params=%#v", params)
			}
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{
				"thread": map[string]any{
					"id":      "thread-target",
					"preview": "Forked thread",
					"turns": []map[string]any{
						codexappTestPromptTurn("target-turn-1", "first"),
						codexappTestPromptTurn("target-turn-2", "second"),
					},
				},
			}})
		default:
			t.Errorf("unexpected app-server method %q", method)
		}
	}

	conn := newCodexappConnWithRuntimeAndProject(rt, t.TempDir(), "proj")
	result, err := conn.ForkSession(
		context.Background(),
		"thread-source",
		"source-turn-2",
		[]protocol.SessionForkPrompt{
			{DoneTurnIndex: 3, ContentBlocks: []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "first"}}},
			{DoneTurnIndex: 7, ContentBlocks: []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "second"}}},
		},
	)
	if err != nil {
		t.Fatalf("ForkSession: %v", err)
	}
	if result.SessionID != "thread-target" || result.Title != "Forked thread" {
		t.Fatalf("result = %#v", result)
	}
	if len(result.ForkPoints) != 2 || result.ForkPoints[3].Ref != "target-turn-1" || result.ForkPoints[7].Ref != "target-turn-2" {
		t.Fatalf("fork points = %#v", result.ForkPoints)
	}
}

func TestCodexAppStandardForkCarriesWmHistoricalExtension(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		method, _ := msg["method"].(string)
		id := msg["id"]
		switch method {
		case "thread/fork":
			params := msg["params"].(map[string]any)
			if params["threadId"] != "thread-source" || params["lastTurnId"] != "source-turn-2" {
				t.Errorf("thread/fork params=%#v", params)
			}
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{
				"thread": map[string]any{
					"id":      "thread-target",
					"preview": "Forked thread",
					"turns": []map[string]any{
						codexappTestPromptTurn("target-turn-1", "first"),
					},
				},
			}})
		default:
			t.Errorf("unexpected app-server method %q", method)
		}
	}

	conn := newCodexappConnWithRuntimeAndProject(rt, t.TempDir(), "proj")
	conn.bindSessionIDs("thread-source", "thread-source")
	var out protocol.SessionForkResponse
	meta := protocol.BuildWMSessionForkMeta(nil, protocol.WMSessionForkExtension{
		Ref: "source-turn-2",
		Prompts: []protocol.SessionForkPrompt{{
			DoneTurnIndex: 3,
			ContentBlocks: []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "first"}},
		}},
	})
	err := conn.Send(context.Background(), protocol.MethodSessionFork, protocol.SessionForkParams{
		SessionID: "thread-source",
		CWD:       t.TempDir(),
		Meta:      meta,
	}, &out)
	if err != nil {
		t.Fatalf("standard session/fork: %v", err)
	}
	if out.SessionID != "thread-target" {
		t.Fatalf("session/fork result=%#v", out)
	}
	forkResult, ok := protocol.WMSessionForkResultExtensionFromMeta(out.Meta)
	if !ok || forkResult.Title != "Forked thread" || forkResult.ForkPoints[3].Ref != "target-turn-1" {
		t.Fatalf("session/fork historical metadata=%s decoded=%#v ok=%v", out.Meta, forkResult, ok)
	}
}

func TestCodexAppCurrentForkUsesUnifiedSessionForkFacade(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		method, _ := msg["method"].(string)
		id := msg["id"]
		if method != "thread/fork" {
			t.Errorf("unexpected app-server method %q", method)
			return
		}
		params := msg["params"].(map[string]any)
		if params["threadId"] != "thread-source" || params["lastTurnId"] != "source-turn-2" {
			t.Errorf("thread/fork params=%#v", params)
		}
		_ = tr.emit(map[string]any{"id": id, "result": map[string]any{
			"thread": map[string]any{"id": "thread-target", "preview": "Current fork"},
		}})
	}

	conn := newCodexappConnWithRuntimeAndProject(rt, t.TempDir(), "proj")
	conn.bindSessionIDs("thread-source", "thread-source")
	conn.mu.Lock()
	conn.lastTurnID = "source-turn-2"
	conn.mu.Unlock()
	var out protocol.SessionForkResponse
	if err := conn.Send(context.Background(), protocol.MethodSessionFork, protocol.SessionForkParams{
		SessionID: "thread-source",
		CWD:       t.TempDir(),
	}, &out); err != nil {
		t.Fatalf("standard current session/fork: %v", err)
	}
	if out.SessionID != "thread-target" {
		t.Fatalf("session/fork result=%#v", out)
	}
}

func codexappTestPromptTurn(turnID string, text string) map[string]any {
	return map[string]any{
		"id":        turnID,
		"itemsView": "full",
		"status":    "completed",
		"items": []map[string]any{{
			"id":   "user-" + turnID,
			"type": "userMessage",
			"content": []map[string]any{{
				"type":          "text",
				"text":          text,
				"text_elements": []any{},
			}},
		}},
	}
}

func TestCodexAppArchiveSessionCallsThreadArchive(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		method, _ := msg["method"].(string)
		id := msg["id"]
		switch method {
		case "thread/archive":
			params := msg["params"].(map[string]any)
			if params["threadId"] != "thread-archive" {
				t.Errorf("thread/archive params=%#v", params)
			}
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{}})
		default:
			t.Errorf("unexpected app-server method %q", method)
		}
	}

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	if err := conn.ArchiveSession(context.Background(), "thread-archive"); err != nil {
		t.Fatalf("ArchiveSession: %v", err)
	}
}

func TestCodexAppUnarchiveSessionCallsThreadUnarchive(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		method, _ := msg["method"].(string)
		id := msg["id"]
		switch method {
		case "thread/unarchive":
			params := msg["params"].(map[string]any)
			if params["threadId"] != "thread-unarchive" {
				t.Errorf("thread/unarchive params=%#v", params)
			}
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{}})
		default:
			t.Errorf("unexpected app-server method %q", method)
		}
	}

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	if err := conn.UnarchiveSession(context.Background(), "thread-unarchive"); err != nil {
		t.Fatalf("UnarchiveSession: %v", err)
	}
}

func TestCodexAppSessionLoadRecreatesUnmaterializedThreadInternally(t *testing.T) {
	oldMapPath := codexappSessionMapPathFunc
	mapPath := filepath.Join(t.TempDir(), "codexapp-session-map.json")
	codexappSessionMapPathFunc = func() (string, error) { return mapPath, nil }
	t.Cleanup(func() { codexappSessionMapPathFunc = oldMapPath })

	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		method, _ := msg["method"].(string)
		id := msg["id"]
		switch method {
		case "model/list":
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{"data": []map[string]any{{"id": "gpt-5", "displayName": "GPT-5"}}}})
		case "thread/resume":
			params := msg["params"].(map[string]any)
			if params["threadId"] != "old-acp-session" {
				t.Errorf("thread/resume params=%#v", params)
			}
			_ = tr.emit(map[string]any{"id": id, "error": map[string]any{"code": -32600, "message": "no rollout found for thread id old-acp-session"}})
		case "thread/start":
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{"thread": map[string]any{"id": "new-runtime-thread"}}})
		case "turn/start":
			params := msg["params"].(map[string]any)
			if params["threadId"] != "new-runtime-thread" {
				t.Errorf("turn/start threadId=%#v, want remapped runtime thread", params["threadId"])
			}
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{"turn": map[string]any{"id": "turn-1"}}})
			_ = tr.emit(map[string]any{
				"method": "item/agentMessage/delta",
				"params": map[string]any{"threadId": "new-runtime-thread", "turnId": "turn-1", "delta": "pong"},
			})
			_ = tr.emit(map[string]any{
				"method": "turn/completed",
				"params": map[string]any{"threadId": "new-runtime-thread", "turn": map[string]any{"id": "turn-1", "status": "completed"}},
			})
		default:
			t.Errorf("unexpected app-server method %q", method)
		}
	}

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	updates := make(chan protocol.SessionUpdateParams, 1)
	conn.OnACPResponse(captureSessionUpdate(t, updates))

	var loadRes protocol.SessionLoadResult
	if err := conn.Send(context.Background(), protocol.MethodSessionLoad, protocol.SessionLoadParams{
		SessionID: "old-acp-session",
		CWD:       t.TempDir(),
	}, &loadRes); err != nil {
		t.Fatalf("SessionLoad: %v", err)
	}

	var promptRes protocol.SessionPromptResult
	if err := conn.Send(context.Background(), protocol.MethodSessionPrompt, protocol.SessionPromptParams{
		SessionID: "old-acp-session",
		Prompt:    []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "ping"}},
	}, &promptRes); err != nil {
		t.Fatalf("SessionPrompt: %v", err)
	}
	if promptRes.StopReason != protocol.StopReasonEndTurn {
		t.Fatalf("stopReason=%q", promptRes.StopReason)
	}
	update := waitForCodexappUpdate(t, updates)
	if update.SessionID != "old-acp-session" {
		t.Fatalf("update sessionId=%q, want ACP session id", update.SessionID)
	}
}

func TestCodexAppApprovalPresetOptionsMatchOfficialModes(t *testing.T) {
	state := newCodexappConfigState()
	options := state.options()
	if got := currentConfigValue(options, protocol.ConfigOptionIDApprovalPreset); got != "auto" {
		t.Fatalf("default approval preset=%q, want auto", got)
	}

	var values []protocol.ConfigOptionValue
	for _, opt := range options {
		if opt.ID == protocol.ConfigOptionIDApprovalPreset {
			values = opt.Options
			break
		}
	}
	want := []protocol.ConfigOptionValue{
		{Value: "auto", Name: "Auto"},
		{Value: "read_only", Name: "Read-only"},
		{Value: "full", Name: "Full Access"},
	}
	if !reflect.DeepEqual(values, want) {
		t.Fatalf("approval preset options=%#v, want %#v", values, want)
	}
}

func TestCodexAppApprovalProfilesMatchOfficialModes(t *testing.T) {
	tests := []struct {
		name          string
		preset        string
		approval      string
		threadSandbox string
		turnSandbox   string
		network       bool
	}{
		{
			name:          "auto",
			preset:        "auto",
			approval:      "on-request",
			threadSandbox: "workspace-write",
			turnSandbox:   "workspaceWrite",
		},
		{
			name:          "legacy ask",
			preset:        "ask",
			approval:      "on-request",
			threadSandbox: "workspace-write",
			turnSandbox:   "workspaceWrite",
		},
		{
			name:          "read only",
			preset:        "read_only",
			approval:      "on-request",
			threadSandbox: "read-only",
			turnSandbox:   "readOnly",
		},
		{
			name:          "full access",
			preset:        "full",
			approval:      "never",
			threadSandbox: "danger-full-access",
			turnSandbox:   "dangerFullAccess",
			network:       true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			profile, ok := codexappApprovalProfile(tt.preset)
			if !ok {
				t.Fatalf("codexappApprovalProfile(%q) rejected", tt.preset)
			}
			if profile.approvalPolicy != tt.approval || profile.threadSandbox != tt.threadSandbox ||
				profile.turnSandboxType != tt.turnSandbox || profile.networkAccess != tt.network {
				t.Fatalf("profile=%#v, want approval=%q threadSandbox=%q turnSandbox=%q network=%v",
					profile, tt.approval, tt.threadSandbox, tt.turnSandbox, tt.network)
			}
		})
	}
}

func TestCodexAppLegacyAskPresetNormalizesToAuto(t *testing.T) {
	state := newCodexappConfigState()
	if err := state.set(protocol.ConfigOptionIDApprovalPreset, "ask"); err != nil {
		t.Fatalf("set ask preset: %v", err)
	}
	if got := currentConfigValue(state.options(), protocol.ConfigOptionIDApprovalPreset); got != "auto" {
		t.Fatalf("legacy ask preset stored as %q, want auto", got)
	}
}

func TestCodexAppPromptMapsResourceLinks(t *testing.T) {
	input, err := codexappPromptToInput([]protocol.ContentBlock{
		{Type: protocol.ContentBlockTypeText, Text: "what is this file for"},
		{
			Type:     protocol.ContentBlockTypeResourceLink,
			URI:      "file:///D:/Code/WheelMaker/docs/references/acp-protocol-full.zh-CN.md",
			Name:     "acp-protocol-full.zh-CN.md",
			MimeType: "text/markdown",
		},
		{
			Type:        protocol.ContentBlockTypeResourceLink,
			URI:         "https://example.com/spec",
			Name:        "remote spec",
			Title:       "Remote Spec",
			Description: "External reference",
		},
		{
			Type:     protocol.ContentBlockTypeResourceLink,
			URI:      "file:///D:/tmp/pixel.png",
			Name:     "pixel.png",
			MimeType: "image/png",
		},
	})
	if err != nil {
		t.Fatalf("codexappPromptToInput: %v", err)
	}
	if len(input) != 2 {
		t.Fatalf("input len=%d, want 2: %#v", len(input), input)
	}
	if input[0].Type != "text" {
		t.Fatalf("file resource link input=%#v, want text wrapper", input[0])
	}
	if input[0].Path != "" || input[0].Name != "" {
		t.Fatalf("file resource link input=%#v, want no mention fields", input[0])
	}
	for _, want := range []string{
		"# Files mentioned by the user:",
		"## acp-protocol-full.zh-CN.md: D:/Code/WheelMaker/docs/references/acp-protocol-full.zh-CN.md",
		"## pixel.png: D:/tmp/pixel.png",
		"## My request for Codex:",
		"what is this file for",
		"https://example.com/spec",
		"Remote Spec",
	} {
		if !strings.Contains(input[0].Text, want) {
			t.Fatalf("file resource link text=%q, missing %q", input[0].Text, want)
		}
	}
	if input[0].TextElements == nil || len(input[0].TextElements) != 0 {
		t.Fatalf("file resource link text_elements=%#v, want empty array", input[0].TextElements)
	}
	if input[1].Type != "localImage" || filepath.ToSlash(input[1].Path) != "D:/tmp/pixel.png" {
		t.Fatalf("image resource link input=%#v, want localImage", input[1])
	}
}

func TestCodexAppPromptMapsImageResourceLinkToPromptPathAndLocalImage(t *testing.T) {
	input, err := codexappPromptToInput([]protocol.ContentBlock{
		{
			Type:     protocol.ContentBlockTypeResourceLink,
			URI:      "file:///D:/tmp/pixel.png",
			Name:     "pixel.png",
			MimeType: "image/png",
		},
	})
	if err != nil {
		t.Fatalf("codexappPromptToInput: %v", err)
	}
	if len(input) != 2 {
		t.Fatalf("input len=%d, want prompt text + localImage: %#v", len(input), input)
	}
	if input[0].Type != "text" || !strings.Contains(input[0].Text, "## pixel.png: D:/tmp/pixel.png") {
		t.Fatalf("image resource link prompt=%#v, want path mention", input[0])
	}
	if input[1].Type != "localImage" || filepath.ToSlash(input[1].Path) != "D:/tmp/pixel.png" {
		t.Fatalf("image resource link input=%#v, want localImage", input[1])
	}
}

func TestCodexAppSessionPromptSendsBase64ImageAsLocalImage(t *testing.T) {
	oldRoot := codexappArtifactRootPathFunc
	artifactRoot := t.TempDir()
	codexappArtifactRootPathFunc = func() (string, error) { return artifactRoot, nil }
	t.Cleanup(func() { codexappArtifactRootPathFunc = oldRoot })

	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		method, _ := msg["method"].(string)
		id := msg["id"]
		switch method {
		case "turn/start":
			params := msg["params"].(map[string]any)
			input := params["input"].([]any)
			if len(input) != 2 {
				t.Fatalf("turn/start input=%#v, want text + localImage", input)
			}
			textInput := input[0].(map[string]any)
			if textInput["type"] != "text" || textInput["text"] != "describe" {
				t.Fatalf("text input=%#v", textInput)
			}
			imageInput := input[1].(map[string]any)
			imagePath, _ := imageInput["path"].(string)
			if imageInput["type"] != "localImage" || imagePath == "" {
				t.Fatalf("image input=%#v, want localImage path", imageInput)
			}
			if !strings.Contains(filepath.ToSlash(imagePath), "/db/session/Proj_Name-") ||
				!strings.Contains(filepath.ToSlash(imagePath), "/thread-1/attachments/sha256-") ||
				!strings.HasSuffix(imagePath, ".png") {
				t.Fatalf("image path=%q, want project/session image artifact path", imagePath)
			}
			if _, err := os.Stat(imagePath); err != nil {
				t.Fatalf("image artifact not written: %v", err)
			}
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{"turn": map[string]any{"id": "turn-1"}}})
			_ = tr.emit(map[string]any{
				"method": "turn/completed",
				"params": map[string]any{"threadId": "thread-1", "turn": map[string]any{"id": "turn-1", "status": "completed"}},
			})
		default:
			t.Errorf("unexpected app-server method %q", method)
		}
	}

	conn := newCodexappConnWithRuntimeAndProject(rt, t.TempDir(), "Proj:Name")
	conn.BindSessionID("thread-1")

	var promptRes protocol.SessionPromptResult
	if err := conn.Send(context.Background(), protocol.MethodSessionPrompt, protocol.SessionPromptParams{
		SessionID: "thread-1",
		Prompt: []protocol.ContentBlock{
			{Type: protocol.ContentBlockTypeText, Text: "describe"},
			{
				Type:     protocol.ContentBlockTypeImage,
				MimeType: "image/png",
				Data:     "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
			},
		},
	}, &promptRes); err != nil {
		t.Fatalf("SessionPrompt: %v", err)
	}
	if promptRes.StopReason != protocol.StopReasonEndTurn {
		t.Fatalf("stopReason=%q, want end_turn", promptRes.StopReason)
	}
}

func TestCodexAppPromptMapsImageURIs(t *testing.T) {
	input, err := codexappPromptToInputWithArtifacts("proj", "sess-1", []protocol.ContentBlock{
		{Type: protocol.ContentBlockTypeImage, URI: "https://example.com/a.png"},
		{Type: protocol.ContentBlockTypeImage, URI: "file:///D:/tmp/a.png"},
	})
	if err != nil {
		t.Fatalf("codexappPromptToInputWithArtifacts: %v", err)
	}
	if len(input) != 2 {
		t.Fatalf("input len=%d, want 2: %#v", len(input), input)
	}
	if input[0].Type != "image" || input[0].URL != "https://example.com/a.png" {
		t.Fatalf("remote image input=%#v, want image url", input[0])
	}
	if input[1].Type != "localImage" || filepath.ToSlash(input[1].Path) != "D:/tmp/a.png" {
		t.Fatalf("file image input=%#v, want localImage absolute path", input[1])
	}
}

func TestCodexAppSessionPromptRejectsInvalidImageBeforeTurnStart(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		if method, _ := msg["method"].(string); method == "turn/start" {
			t.Fatalf("turn/start sent for invalid image: %#v", msg)
		}
	}

	conn := newCodexappConnWithRuntimeAndProject(rt, t.TempDir(), "proj")
	conn.BindSessionID("thread-1")

	var promptRes protocol.SessionPromptResult
	err := conn.Send(context.Background(), protocol.MethodSessionPrompt, protocol.SessionPromptParams{
		SessionID: "thread-1",
		Prompt: []protocol.ContentBlock{
			{Type: protocol.ContentBlockTypeText, Text: "describe"},
			{Type: protocol.ContentBlockTypeImage, MimeType: "image/png", Data: "not-base64"},
		},
	}, &promptRes)
	if err == nil || !strings.Contains(err.Error(), "valid base64") {
		t.Fatalf("SessionPrompt err=%v, want invalid base64 before turn/start", err)
	}
}

func TestCodexAppSessionPromptRejectsOversizedBase64Image(t *testing.T) {
	oldMax := codexappMaxImageBytes
	codexappMaxImageBytes = 4
	t.Cleanup(func() { codexappMaxImageBytes = oldMax })

	_, err := codexappPromptToInputWithArtifacts("proj", "sess-1", []protocol.ContentBlock{
		{Type: protocol.ContentBlockTypeImage, MimeType: "image/png", Data: "MTIzNDU="},
	})
	if err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("codexappPromptToInputWithArtifacts err=%v, want size rejection", err)
	}
}

func TestCodexAppCleanupSessionArtifactsRemovesAttachmentDirectory(t *testing.T) {
	oldRoot := codexappArtifactRootPathFunc
	artifactRoot := t.TempDir()
	codexappArtifactRootPathFunc = func() (string, error) { return artifactRoot, nil }
	t.Cleanup(func() { codexappArtifactRootPathFunc = oldRoot })

	path, err := codexappWriteImageArtifact("Proj:Name", "thread-1", protocol.ContentBlock{
		Type:     protocol.ContentBlockTypeImage,
		MimeType: "image/png",
		Data:     "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
	})
	if err != nil {
		t.Fatalf("codexappWriteImageArtifact: %v", err)
	}
	attachmentDir := filepath.Dir(path)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("image artifact not written: %v", err)
	}

	if err := CleanupSessionArtifacts("Proj:Name", string(protocol.ACPProviderCodex), "thread-1"); err != nil {
		t.Fatalf("CleanupSessionArtifacts: %v", err)
	}
	if _, err := os.Stat(attachmentDir); !os.IsNotExist(err) {
		t.Fatalf("attachment dir stat err=%v, want removed", err)
	}
}

func TestCleanupSessionArtifactsRemovesAttachmentsForAnyAgent(t *testing.T) {
	oldRoot := codexappArtifactRootPathFunc
	artifactRoot := t.TempDir()
	codexappArtifactRootPathFunc = func() (string, error) { return artifactRoot, nil }
	t.Cleanup(func() { codexappArtifactRootPathFunc = oldRoot })

	dir, err := codexappImageArtifactDir("Proj:Name", "thread-claude")
	if err != nil {
		t.Fatalf("codexappImageArtifactDir: %v", err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("MkdirAll attachments: %v", err)
	}
	path := filepath.Join(dir, "attachment.txt")
	if err := os.WriteFile(path, []byte("owned by wheelmaker"), 0o600); err != nil {
		t.Fatalf("WriteFile attachment: %v", err)
	}

	if err := CleanupSessionArtifacts("Proj:Name", string(protocol.ACPProviderClaude), "thread-claude"); err != nil {
		t.Fatalf("CleanupSessionArtifacts: %v", err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("attachment dir stat err=%v, want removed for claude", err)
	}
}

func TestCodexAppInstanceBasicChatAndConfigOptions(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	tr.onSend = func(msg map[string]any) {
		method, _ := msg["method"].(string)
		id := msg["id"]
		switch method {
		case "initialize":
			params := msg["params"].(map[string]any)
			clientInfo := params["clientInfo"].(map[string]any)
			if version, _ := clientInfo["version"].(string); version == "" {
				t.Errorf("initialize clientInfo missing version: %#v", clientInfo)
			}
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{}})
		case "initialized":
			if params, ok := msg["params"].(map[string]any); !ok || len(params) != 0 {
				t.Errorf("initialized params=%#v, want empty object", msg["params"])
			}
		case "model/list":
			if params, ok := msg["params"].(map[string]any); !ok || len(params) != 0 {
				t.Errorf("model/list params=%#v, want empty object", msg["params"])
			}
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{
				"data": []map[string]any{{
					"id":          "gpt-5",
					"displayName": "GPT-5",
					"supportedReasoningEfforts": []map[string]any{
						{"reasoningEffort": "low", "description": "Fast"},
						{"reasoningEffort": "medium", "description": "Balanced"},
						{"reasoningEffort": "high", "description": "Deep"},
					},
					"defaultReasoningEffort": "medium",
				}},
			}})
		case "thread/start":
			params := msg["params"].(map[string]any)
			if params["approvalPolicy"] != "on-request" || params["sandbox"] != "workspace-write" {
				t.Errorf("thread/start params=%#v", params)
			}
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{
				"thread": map[string]any{"id": "thread-1", "preview": "Thread 1", "updatedAt": float64(1778536492)},
			}})
		case "turn/start":
			params := msg["params"].(map[string]any)
			if params["threadId"] != "thread-1" || params["model"] != "gpt-5" || params["effort"] != "high" {
				t.Errorf("turn/start params=%#v", params)
			}
			input := params["input"].([]any)
			textInput := input[0].(map[string]any)
			if textInput["type"] != "text" || textInput["text"] != "ping" {
				t.Errorf("turn/start input=%#v", input)
			}
			if elements, ok := textInput["text_elements"].([]any); !ok || len(elements) != 0 {
				t.Errorf("turn/start text_elements=%#v, want empty array", textInput["text_elements"])
			}
			if _, ok := params["sandbox"]; ok {
				t.Errorf("turn/start must use sandboxPolicy, not sandbox: %#v", params)
			}
			sandboxPolicy := params["sandboxPolicy"].(map[string]any)
			if sandboxPolicy["type"] != "workspaceWrite" ||
				sandboxPolicy["networkAccess"] != false ||
				sandboxPolicy["excludeTmpdirEnvVar"] != false ||
				sandboxPolicy["excludeSlashTmp"] != false {
				t.Errorf("turn/start sandboxPolicy=%#v", sandboxPolicy)
			}
			_ = tr.emit(map[string]any{"id": id, "result": map[string]any{
				"turn": map[string]any{"id": "turn-1"},
			}})
			_ = tr.emit(map[string]any{
				"method": "item/agentMessage/delta",
				"params": map[string]any{"threadId": "thread-1", "turnId": "turn-1", "delta": "pong"},
			})
			_ = tr.emit(map[string]any{
				"method": "turn/completed",
				"params": map[string]any{"threadId": "thread-1", "turn": map[string]any{"id": "turn-1", "items": []any{}, "status": "completed"}},
			})
		default:
			t.Errorf("unexpected app-server method %q", method)
		}
	}

	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	inst := NewInstance("codex", conn)
	updates := make(chan protocol.SessionUpdateParams, 4)
	inst.SetCallbacks(&fakeCodexappCallbacks{updates: updates})

	initRes, err := inst.Initialize(context.Background(), protocol.InitializeParams{})
	if err != nil {
		t.Fatalf("Initialize: %v", err)
	}
	if initRes.AgentInfo == nil || initRes.AgentInfo.Name != "codex" {
		t.Fatalf("agent info=%#v", initRes.AgentInfo)
	}
	if initRes.AgentCapabilities.PromptCapabilities == nil || !initRes.AgentCapabilities.PromptCapabilities.Image {
		t.Fatalf("prompt capabilities=%#v", initRes.AgentCapabilities.PromptCapabilities)
	}

	newRes, err := inst.SessionNew(context.Background(), protocol.SessionNewParams{CWD: t.TempDir()})
	if err != nil {
		t.Fatalf("SessionNew: %v", err)
	}
	if newRes.SessionID != "thread-1" {
		t.Fatalf("sessionId=%q", newRes.SessionID)
	}
	if currentConfigValue(newRes.ConfigOptions, protocol.ConfigOptionIDApprovalPreset) != "auto" {
		t.Fatalf("config options missing auto approval preset: %#v", newRes.ConfigOptions)
	}
	opts, err := inst.SessionSetConfigOption(context.Background(), protocol.SessionSetConfigOptionParams{
		SessionID: "thread-1",
		ConfigID:  protocol.ConfigOptionIDReasoningEffort,
		Value:     "high",
	})
	if err != nil {
		t.Fatalf("SessionSetConfigOption: %v", err)
	}
	if currentConfigValue(opts, protocol.ConfigOptionIDReasoningEffort) != "high" {
		t.Fatalf("reasoning option not updated: %#v", opts)
	}

	promptRes, err := inst.SessionPrompt(context.Background(), protocol.SessionPromptParams{
		SessionID: "thread-1",
		Prompt:    []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "ping"}},
	})
	if err != nil {
		t.Fatalf("SessionPrompt: %v", err)
	}
	if promptRes.StopReason != protocol.StopReasonEndTurn {
		t.Fatalf("stopReason=%q", promptRes.StopReason)
	}
	deadline := time.After(time.Second)
	for {
		select {
		case update := <-updates:
			if update.SessionID == "thread-1" && update.Update.SessionUpdate == protocol.SessionUpdateAgentMessageChunk {
				return
			}
		case <-deadline:
			t.Fatal("missing agent message update")
		}
	}
}

func TestCodexAppRejectsUnsupportedInputs(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	conn := newCodexappConnWithRuntime(rt, t.TempDir())

	var newRes protocol.SessionNewResult
	if err := conn.Send(context.Background(), protocol.MethodSessionNew, protocol.SessionNewParams{
		CWD:        t.TempDir(),
		MCPServers: []protocol.MCPServer{{Name: "fs", Command: "mcp"}},
	}, &newRes); err == nil {
		t.Fatal("SessionNew accepted non-empty MCP servers")
	}

	var promptRes protocol.SessionPromptResult
	if err := conn.Send(context.Background(), protocol.MethodSessionPrompt, protocol.SessionPromptParams{
		SessionID: "thread-1",
		Prompt:    []protocol.ContentBlock{{Type: protocol.ContentBlockTypeAudio, Data: "abc"}},
	}, &promptRes); err == nil {
		t.Fatal("SessionPrompt accepted audio input")
	}
}

func TestOwnedConn_SendMatchesResponse(t *testing.T) {
	tr := newFakeOwnedTransport()
	tr.onSend = func(v any) {
		req, ok := v.(protocol.ACPRPCRequest)
		if !ok {
			return
		}
		_ = tr.emit(protocol.ACPRPCResponse{
			JSONRPC: protocol.ACPRPCVersion,
			ID:      req.ID,
			Result:  json.RawMessage(`{"ok":true}`),
		})
	}

	conn := NewOwnedConn(tr)
	t.Cleanup(func() { _ = conn.Close() })

	var out struct {
		OK bool `json:"ok"`
	}
	if err := conn.Send(context.Background(), "test/method", map[string]any{"x": 1}, &out); err != nil {
		t.Fatalf("send: %v", err)
	}
	if !out.OK {
		t.Fatalf("result decode failed: %+v", out)
	}
}

func TestOwnedConnAcceptsForwardCompatibleInitializeResults(t *testing.T) {
	tests := []struct {
		name            string
		result          json.RawMessage
		wantAgentName   string
		wantAuthMethods int
	}{
		{
			name:          "kimi resume capability",
			result:        json.RawMessage(`{"protocolVersion":1,"agentCapabilities":{"loadSession":true,"promptCapabilities":{"image":true,"audio":false,"embeddedContext":true},"mcpCapabilities":{"http":true,"sse":true},"sessionCapabilities":{"list":{},"resume":{}}},"agentInfo":{"name":"Kimi Code CLI","version":"0.31.1"}}`),
			wantAgentName: "Kimi Code CLI",
		},
		{
			name:          "claude auth and session capabilities",
			result:        json.RawMessage(`{"protocolVersion":1,"agentCapabilities":{"_meta":{"claudeCode":{"promptQueueing":true}},"promptCapabilities":{"image":true,"embeddedContext":true},"mcpCapabilities":{"http":true,"sse":true},"auth":{"logout":{}},"providers":{},"loadSession":true,"sessionCapabilities":{"additionalDirectories":{},"close":{},"delete":{},"fork":{},"list":{},"resume":{}}},"agentInfo":{"name":"@agentclientprotocol/claude-agent-acp","title":"Claude Agent","version":"0.64.0"},"authMethods":[],"_meta":{"steering":{"supported":true}}}`),
			wantAgentName: "@agentclientprotocol/claude-agent-acp",
		},
		{
			name:            "codebuddy delegate tools capability",
			result:          json.RawMessage(`{"protocolVersion":1,"agentCapabilities":{"promptCapabilities":{"image":true,"embeddedContext":true},"mcpCapabilities":{"http":true,"sse":true},"loadSession":true,"delegateToolsSupport":true},"authMethods":[{"id":"iOA","name":"Login with iOA","description":null},{"id":"external","name":"Login with Google/Github","description":null},{"id":"internal","name":"Login with WeChat","description":null},{"id":"selfhosted","name":"Login with Enterprise Domain","description":null}]}`),
			wantAuthMethods: 4,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tr := newFakeOwnedTransport()
			tr.onSend = func(v any) {
				req, ok := v.(protocol.ACPRPCRequest)
				if !ok {
					return
				}
				_ = tr.emit(protocol.ACPRPCResponse{
					JSONRPC: protocol.ACPRPCVersion,
					ID:      req.ID,
					Result:  tt.result,
				})
			}

			conn := NewOwnedConn(tr)
			t.Cleanup(func() { _ = conn.Close() })
			var out protocol.InitializeResult
			if err := conn.Send(context.Background(), protocol.MethodInitialize, protocol.InitializeParams{}, &out); err != nil {
				t.Fatalf("send: %v", err)
			}
			if out.ProtocolVersion.String() != "1" || !out.AgentCapabilities.LoadSession {
				t.Fatalf("initialize result=%#v", out)
			}
			if tt.wantAgentName != "" && (out.AgentInfo == nil || out.AgentInfo.Name != tt.wantAgentName) {
				t.Fatalf("agentInfo=%#v, want name %q", out.AgentInfo, tt.wantAgentName)
			}
			if len(out.AuthMethods) != tt.wantAuthMethods {
				t.Fatalf("authMethods=%d, want %d", len(out.AuthMethods), tt.wantAuthMethods)
			}
		})
	}
}

func TestOwnedConnRejectsUnknownWMResultField(t *testing.T) {
	tr := newFakeOwnedTransport()
	tr.onSend = func(v any) {
		req, ok := v.(protocol.ACPRPCRequest)
		if !ok {
			return
		}
		_ = tr.emit(protocol.ACPRPCResponse{
			JSONRPC: protocol.ACPRPCVersion,
			ID:      req.ID,
			Result:  json.RawMessage(`{"goal":null,"legacy":true}`),
		})
	}

	conn := NewOwnedConn(tr)
	t.Cleanup(func() { _ = conn.Close() })
	var out protocol.WMSessionGoalResult
	err := conn.Send(context.Background(), protocol.MethodWMSessionGoalGet, protocol.WMSessionGoalParams{}, &out)
	if err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("send error=%v, want private extension unknown field rejection", err)
	}
}

func TestOwnedConn_IncomingRequestDispatchesAndReplies(t *testing.T) {
	tr := newFakeOwnedTransport()
	conn := NewOwnedConn(tr)
	t.Cleanup(func() { _ = conn.Close() })

	conn.OnACPRequest(func(_ context.Context, requestID int64, method string, _ json.RawMessage) (any, error) {
		if requestID != 42 {
			t.Fatalf("requestID=%d, want 42", requestID)
		}
		if method != "session/request_permission" {
			t.Fatalf("method=%q", method)
		}
		return map[string]any{"ok": true}, nil
	})

	if err := tr.emit(protocol.ACPRPCRequest{
		JSONRPC: protocol.ACPRPCVersion,
		ID:      42,
		Method:  "session/request_permission",
		Params:  map[string]any{"sessionId": "s1"},
	}); err != nil {
		t.Fatalf("emit request: %v", err)
	}

	select {
	case sent := <-tr.sent:
		raw, err := json.Marshal(sent)
		if err != nil {
			t.Fatalf("marshal sent response: %v", err)
		}
		var resp struct {
			ID     int64                 `json:"id"`
			Result map[string]any        `json:"result"`
			Error  *protocol.ACPRPCError `json:"error"`
		}
		if err := json.Unmarshal(raw, &resp); err != nil {
			t.Fatalf("unmarshal sent response: %v", err)
		}
		if resp.ID != 42 {
			t.Fatalf("response id=%d, want 42", resp.ID)
		}
		if resp.Error != nil {
			t.Fatalf("unexpected response error: %v", resp.Error)
		}
		if v, ok := resp.Result["ok"].(bool); !ok || !v {
			t.Fatalf("response result=%v", resp.Result)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for response")
	}
}

func TestOwnedConn_NotificationDispatchesResponseCallback(t *testing.T) {
	tr := newFakeOwnedTransport()
	conn := NewOwnedConn(tr)
	t.Cleanup(func() { _ = conn.Close() })

	notified := make(chan struct{}, 1)
	conn.OnACPResponse(func(_ context.Context, method string, _ json.RawMessage) {
		if method == protocol.MethodSessionUpdate {
			notified <- struct{}{}
		}
	})

	if err := tr.emit(protocol.ACPRPCNotification{
		JSONRPC: protocol.ACPRPCVersion,
		Method:  protocol.MethodSessionUpdate,
		Params:  map[string]any{"sessionId": "s1"},
	}); err != nil {
		t.Fatalf("emit notification: %v", err)
	}

	select {
	case <-notified:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for notification dispatch")
	}
}

func TestSharedConnPool_RoutesBySessionID(t *testing.T) {
	raw := &fakeRawConn{}
	shared := NewSharedConnPool(func() (Conn, error) {
		return raw, nil
	})

	r1, err := shared.Open()
	if err != nil {
		t.Fatalf("open route1: %v", err)
	}
	r2, err := shared.Open()
	if err != nil {
		t.Fatalf("open route2: %v", err)
	}
	t.Cleanup(func() {
		_ = r1.Close()
		_ = r2.Close()
		_ = shared.Close()
	})

	count1 := 0
	count2 := 0
	r1.OnACPResponse(func(_ context.Context, _ string, _ json.RawMessage) {
		count1++
	})
	r2.OnACPResponse(func(_ context.Context, _ string, _ json.RawMessage) {
		count2++
	})

	b1, ok := r1.(sessionBinder)
	if !ok {
		t.Fatal("route1 does not support session binder")
	}
	b2, ok := r2.(sessionBinder)
	if !ok {
		t.Fatal("route2 does not support session binder")
	}
	b1.BindSessionID("sid-1")
	b2.BindSessionID("sid-2")

	params, _ := json.Marshal(map[string]any{"sessionId": "sid-2"})
	raw.emitResponse(protocol.MethodSessionUpdate, params)
	if count1 != 0 || count2 != 1 {
		t.Fatalf("counts after sid-2 emit: c1=%d c2=%d", count1, count2)
	}

	unknown, _ := json.Marshal(map[string]any{"sessionId": "unknown"})
	raw.emitResponse(protocol.MethodSessionUpdate, unknown)
	if count1 != 1 || count2 != 1 {
		t.Fatalf("counts after unknown emit: c1=%d c2=%d", count1, count2)
	}
}

func TestSharedConnPoolRoutesUpdatesDuringSessionLoad(t *testing.T) {
	raw := &fakeRawConn{}
	shared := NewSharedConnPool(func() (Conn, error) { return raw, nil })
	sourceConn, err := shared.Open()
	if err != nil {
		t.Fatal(err)
	}
	targetConn, err := shared.Open()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = sourceConn.Close()
		_ = targetConn.Close()
		_ = shared.Close()
	})
	sourceUpdates := 0
	sourceConn.OnACPResponse(func(context.Context, string, json.RawMessage) { sourceUpdates++ })
	sourceConn.(sessionBinder).BindSessionID("source")
	raw.send = func(method string, params any, _ any) error {
		if method == protocol.MethodSessionLoad {
			load := params.(protocol.SessionLoadParams)
			payload, _ := json.Marshal(map[string]any{
				"sessionId": load.SessionID,
				"update": map[string]any{
					"sessionUpdate": "agent_message_chunk",
					"content":       map[string]any{"type": "text", "text": "loading"},
				},
			})
			raw.emitResponse(protocol.MethodSessionUpdate, payload)
		}
		return nil
	}

	target := NewInstance("claude", targetConn)
	targetCallbacks := &fakeCallbacks{}
	target.SetCallbacks(targetCallbacks)
	if _, err := target.SessionLoad(context.Background(), protocol.SessionLoadParams{SessionID: "target", CWD: `C:\workspace`}); err != nil {
		t.Fatal(err)
	}
	if sourceUpdates != 0 || targetCallbacks.updateCount != 1 {
		t.Fatalf("updates during load source=%d target=%d, want target route", sourceUpdates, targetCallbacks.updateCount)
	}
}

func TestSharedConnPoolRoutesUpdatesDuringSessionNew(t *testing.T) {
	raw := &fakeRawConn{}
	shared := NewSharedConnPool(func() (Conn, error) { return raw, nil })
	sourceConn, err := shared.Open()
	if err != nil {
		t.Fatal(err)
	}
	targetConn, err := shared.Open()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = sourceConn.Close()
		_ = targetConn.Close()
		_ = shared.Close()
	})
	sourceUpdates := 0
	sourceConn.OnACPResponse(func(context.Context, string, json.RawMessage) { sourceUpdates++ })
	sourceConn.(sessionBinder).BindSessionID("source")
	raw.send = func(method string, _ any, result any) error {
		if method == protocol.MethodSessionNew {
			result.(*protocol.SessionNewResult).SessionID = "new-target"
			payload, _ := json.Marshal(map[string]any{
				"sessionId": "new-target",
				"update": map[string]any{
					"sessionUpdate": "agent_message_chunk",
					"content":       map[string]any{"type": "text", "text": "creating"},
				},
			})
			raw.emitResponse(protocol.MethodSessionUpdate, payload)
		}
		return nil
	}

	target := NewInstance("claude", targetConn)
	targetCallbacks := &fakeCallbacks{}
	target.SetCallbacks(targetCallbacks)
	if _, err := target.SessionNew(context.Background(), protocol.SessionNewParams{CWD: `C:\workspace`}); err != nil {
		t.Fatal(err)
	}
	if sourceUpdates != 0 || targetCallbacks.updateCount != 1 {
		t.Fatalf("updates during new source=%d target=%d, want target route", sourceUpdates, targetCallbacks.updateCount)
	}
}

func TestClaudeACPInstanceCreatorSharesCompatibleProjectRuntime(t *testing.T) {
	provider := &fakeLaunchProvider{
		name: "claude",
		exe:  "claude-agent-acp",
		args: []string{"--test"},
		env:  []string{"PROFILE=one"},
	}
	starts := 0
	creator := claudeACPInstanceCreatorWithStarter(provider, func(_ string, _ string, _ string, _ []string, _ []string) (Conn, error) {
		starts++
		return &fakeRawConn{}, nil
	}, nil)
	ctx := WithProjectName(context.Background(), "project-one")
	first, err := creator(ctx, `C:\workspace`)
	if err != nil {
		t.Fatal(err)
	}
	second, err := creator(ctx, `C:\workspace`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = first.Close()
		_ = second.Close()
	})

	firstRaw := first.(*instance).conn.(*sharedConn).raw
	secondRaw := second.(*instance).conn.(*sharedConn).raw
	if starts != 1 || firstRaw != secondRaw {
		t.Fatalf("starts=%d firstRaw=%p secondRaw=%p, want one shared runtime", starts, firstRaw, secondRaw)
	}
}

func TestClaudeACPInstanceCreatorSeparatesIsolationKeys(t *testing.T) {
	provider := &fakeLaunchProvider{name: "cc-kimi", exe: "claude-agent-acp", env: []string{"PROFILE=kimi"}}
	starts := 0
	creator := claudeACPInstanceCreatorWithStarter(provider, func(_ string, _ string, _ string, _ []string, _ []string) (Conn, error) {
		starts++
		return &fakeRawConn{}, nil
	}, nil)
	instances := []Instance{}
	open := func(ctx context.Context, cwd string) {
		inst, err := creator(ctx, cwd)
		if err != nil {
			t.Fatal(err)
		}
		instances = append(instances, inst)
	}
	open(WithProjectName(context.Background(), "project-one"), `C:\workspace`)
	open(WithProjectName(context.Background(), "project-two"), `C:\workspace`)
	open(WithProjectName(context.Background(), "project-one"), `C:\other`)
	open(context.Background(), `C:\workspace`)
	open(context.Background(), `C:\workspace`)
	t.Cleanup(func() {
		for _, inst := range instances {
			_ = inst.Close()
		}
	})
	if starts != 5 {
		t.Fatalf("runtime starts=%d, want 5 isolated runtimes", starts)
	}
}

func TestClaudeACPLaunchFingerprintIncludesEnvironment(t *testing.T) {
	base := claudeACPLaunchFingerprint("claude-agent-acp", []string{"--test"}, []string{"A=1", "B=2"})
	reordered := claudeACPLaunchFingerprint("claude-agent-acp", []string{"--test"}, []string{"B=2", "A=1"})
	different := claudeACPLaunchFingerprint("claude-agent-acp", []string{"--test"}, []string{"A=1", "B=3"})
	if base != reordered {
		t.Fatalf("environment order changed fingerprint: %q != %q", base, reordered)
	}
	if base == different {
		t.Fatal("environment value did not change launch fingerprint")
	}
}

func TestClaudeACPPooledRuntimeLoadsProcessLocalForkTarget(t *testing.T) {
	provider := &fakeLaunchProvider{name: "claude", exe: "claude-agent-acp"}
	starts := 0
	creator := claudeACPInstanceCreatorWithStarter(provider, func(_ string, _ string, _ string, _ []string, _ []string) (Conn, error) {
		starts++
		raw := &fakeRawConn{}
		sessions := map[string]bool{}
		raw.send = func(method string, params any, result any) error {
			switch method {
			case protocol.MethodInitialize:
				out := result.(*protocol.InitializeResult)
				out.ProtocolVersion = "1"
				out.AgentCapabilities = protocol.AgentCapabilities{
					LoadSession:         true,
					SessionCapabilities: &protocol.SessionCapabilities{Fork: &protocol.SessionForkCapability{}},
				}
			case protocol.MethodSessionNew:
				sessions["source"] = true
				result.(*protocol.SessionNewResult).SessionID = "source"
			case protocol.MethodSessionFork:
				sourceID := params.(protocol.SessionForkParams).SessionID
				if !sessions[sourceID] {
					return errors.New("source is not in this process")
				}
				sessions["child"] = true
				result.(*protocol.SessionForkResponse).SessionID = "child"
			case protocol.MethodSessionLoad:
				if !sessions[params.(protocol.SessionLoadParams).SessionID] {
					return errors.New("session is not in this process")
				}
			}
			return nil
		}
		return raw, nil
	}, nil)
	ctx := WithProjectName(context.Background(), "project-one")

	source, err := creator(ctx, `C:\workspace`)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	if _, err := source.Initialize(ctx, protocol.InitializeParams{ProtocolVersion: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := source.SessionNew(ctx, protocol.SessionNewParams{CWD: `C:\workspace`}); err != nil {
		t.Fatal(err)
	}
	forked, err := source.(SessionCurrentForker).ForkCurrentSession(ctx, "source", `C:\workspace`)
	if err != nil {
		t.Fatal(err)
	}

	target, err := creator(ctx, `C:\workspace`)
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	if _, err := target.Initialize(ctx, protocol.InitializeParams{ProtocolVersion: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := target.SessionLoad(ctx, protocol.SessionLoadParams{SessionID: forked.SessionID, CWD: `C:\workspace`}); err != nil {
		t.Fatalf("load process-local fork target: %v", err)
	}
	if starts != 1 {
		t.Fatalf("runtime starts=%d, want source and target in one process", starts)
	}
}

func TestRoutes_LoadPendingPromotesToActive(t *testing.T) {
	r := newRouteState()
	tok := r.beginLoad("acp-1", "inst-A", 3)
	if ok := r.commitLoad(tok); !ok {
		t.Fatal("commitLoad returned false")
	}
	got := r.lookupActive("acp-1")
	if got == nil {
		t.Fatal("active route missing")
	}
	if got.instanceKey != "inst-A" || got.epoch != 3 {
		t.Fatalf("active route = %+v", *got)
	}
}

func TestRoutes_LoadFailureRollsBack(t *testing.T) {
	r := newRouteState()
	tok := r.beginLoad("acp-1", "inst-A", 3)
	r.rollbackLoad(tok)
	if got := r.lookupActive("acp-1"); got != nil {
		t.Fatalf("unexpected active route: %+v", *got)
	}
}

func TestRoutes_EpochGuardRejectsStaleCommit(t *testing.T) {
	r := newRouteState()
	fresh := r.beginLoad("acp-1", "inst-new", 4)
	if ok := r.commitLoad(fresh); !ok {
		t.Fatal("fresh commit failed")
	}
	stale := r.beginLoad("acp-1", "inst-old", 2)
	if ok := r.commitLoad(stale); ok {
		t.Fatal("expected stale commit rejection")
	}
	got := r.lookupActive("acp-1")
	if got == nil || got.instanceKey != "inst-new" || got.epoch != 4 {
		t.Fatalf("active route changed by stale commit: %+v", got)
	}
	if got := r.lookupActiveForEpoch("acp-1", 2); got != nil {
		t.Fatalf("stale epoch lookup should fail: %+v", got)
	}
}

func TestRoutes_OrphanReplayAndTTL(t *testing.T) {
	r := newRouteState()
	r.orphanTTL = 1 * time.Second
	t0 := time.Unix(100, 0)

	r.bufferOrphan("acp-1", newUpdate("acp-1", "u1"), t0)
	r.bufferOrphan("acp-1", newUpdate("acp-1", "u2"), t0.Add(500*time.Millisecond))
	r.pruneOrphans(t0.Add(1500 * time.Millisecond))
	r.clock = func() time.Time { return t0.Add(1500 * time.Millisecond) }

	got := r.replayOrphans("acp-1")
	if len(got) != 1 {
		t.Fatalf("replay len=%d, want 1", len(got))
	}
	if got[0].Update.SessionUpdate != "u2" {
		t.Fatalf("replayed update=%q, want u2", got[0].Update.SessionUpdate)
	}
	if gotAgain := r.replayOrphans("acp-1"); len(gotAgain) != 0 {
		t.Fatalf("replay after drain len=%d, want 0", len(gotAgain))
	}
}

func TestInstance_NewAndLoadWithoutACPReady(t *testing.T) {
	fc := &fakeConn{}
	inst := NewInstance("codex", fc)

	newRes, err := inst.SessionNew(context.Background(), protocol.SessionNewParams{CWD: "."})
	if err != nil {
		t.Fatalf("session new: %v", err)
	}
	if newRes.SessionID == "" {
		t.Fatal("expected session id from session/new")
	}

	loadRes, err := inst.SessionLoad(context.Background(), protocol.SessionLoadParams{SessionID: "loaded-1", CWD: "."})
	if err != nil {
		t.Fatalf("session load: %v", err)
	}
	_ = loadRes

	impl := inst.(*instance)
	if !impl.acpSessionReady || impl.acpSessionID != "loaded-1" {
		t.Fatalf("acp session state not updated: ready=%v sid=%q", impl.acpSessionReady, impl.acpSessionID)
	}
}

func TestInstance_HandleInboundDispatch(t *testing.T) {
	fc := &fakeConn{}
	cb := &fakeCallbacks{}
	inst := NewInstance("codex", fc)
	inst.SetCallbacks(cb)
	if fc.resp == nil || fc.req == nil {
		t.Fatal("expected ACP request/response handler registration")
	}

	updateRaw := json.RawMessage(`{"sessionId":"acp-1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"},"messageId":"m1"}}`)
	fc.resp(context.Background(), protocol.MethodSessionUpdate, updateRaw)
	if cb.updateCount != 1 {
		t.Fatalf("updateCount=%d, want 1", cb.updateCount)
	}

	permRaw, _ := json.Marshal(protocol.PermissionRequestParams{
		SessionID: "acp-1",
		ToolCall:  protocol.ToolCallRef{ToolCallID: "tc-1"},
		Options:   []protocol.PermissionOption{{OptionID: "allow", Name: "Allow", Kind: "once"}},
	})
	resp, err := fc.req(context.Background(), 42, protocol.MethodRequestPermission, permRaw)
	if err != nil {
		t.Fatalf("permission dispatch: %v", err)
	}
	permResp, ok := resp.(protocol.PermissionResponse)
	if !ok {
		t.Fatalf("response type=%T, want protocol.PermissionResponse", resp)
	}
	if permResp.Outcome.Outcome != "allow_once" {
		t.Fatalf("permission outcome=%q", permResp.Outcome.Outcome)
	}
	if cb.permissionCount != 1 {
		t.Fatalf("permissionCount=%d, want 1", cb.permissionCount)
	}
	if cb.lastRequestID != 42 {
		t.Fatalf("lastRequestID=%d, want 42", cb.lastRequestID)
	}

	_ = inst
}

func TestInstanceBuffersEarlySessionEventsUntilCallbacks(t *testing.T) {
	fc := &fakeConn{}
	inst := NewInstance("codex", fc)
	fc.resp(context.Background(), protocol.MethodSessionUpdate, json.RawMessage(`{"sessionId":"acp-1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"},"messageId":"m1"}}`))

	cb := &fakeCallbacks{}
	inst.SetCallbacks(cb)
	if cb.updateCount != 1 || cb.lastMessageID != "m1" {
		t.Fatalf("updates=%d messageId=%q, want one buffered m1 event", cb.updateCount, cb.lastMessageID)
	}
}

func TestInstanceRejectsInvalidACPUpdateBeforeCallbacks(t *testing.T) {
	fc := &fakeConn{}
	inst := NewInstance("codex", fc)
	cb := &fakeCallbacks{}
	inst.SetCallbacks(cb)
	fc.resp(context.Background(), protocol.MethodSessionUpdate, json.RawMessage(`{"sessionId":"acp-1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"future","text":"hello"}}}`))
	if cb.updateCount != 0 {
		t.Fatalf("updates=%d, want invalid wire dropped", cb.updateCount)
	}
}

func TestDecodeACPParamsAcceptsUnknownStandardFields(t *testing.T) {
	var params protocol.FSReadTextFileParams
	err := decodeACPParams(protocol.MethodFSRead, json.RawMessage(`{"sessionId":"s1","path":"missing","legacy":true}`), &params)
	if err != nil {
		t.Fatalf("decode callback params: %v", err)
	}
	if params.SessionID != "s1" || params.Path != "missing" {
		t.Fatalf("params=%#v", params)
	}
}

func TestCodexAppRemarshalAcceptsUnknownACPRequestField(t *testing.T) {
	var params protocol.InitializeParams
	err := remarshal(map[string]any{
		"protocolVersion":    1,
		"clientCapabilities": map[string]any{},
		"legacy":             true,
	}, &params)
	if err != nil {
		t.Fatalf("remarshal initialize params: %v", err)
	}
	if params.ProtocolVersion != 1 {
		t.Fatalf("protocolVersion=%d, want 1", params.ProtocolVersion)
	}

	var privateParams protocol.WMSessionGoalParams
	if err := remarshalWM(map[string]any{"sessionId": "s1", "legacy": true}, &privateParams); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("private remarshal error=%v, want unknown field rejection", err)
	}
}

func TestInstancePreservesButDoesNotAuthorizeUnnegotiatedMessageLifecycle(t *testing.T) {
	fc := &fakeConn{}
	inst := NewInstance("third-party", fc)
	if _, err := inst.Initialize(context.Background(), protocol.InitializeParams{
		ProtocolVersion: 1,
		ClientCapabilities: protocol.ClientCapabilities{
			Meta: protocol.BuildWMClientCapabilitiesMeta(nil),
		},
	}); err != nil {
		t.Fatal(err)
	}
	cb := &fakeCallbacks{}
	inst.SetCallbacks(cb)
	meta := json.RawMessage(`{"wm":{"messagePhase":"commentary","messageComplete":true,"steered":true},"vendor":{"trace":"keep"}}`)
	fc.resp(context.Background(), protocol.MethodSessionUpdate, json.RawMessage(`{"sessionId":"acp-1","update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"change"},"messageId":"m1","_meta":`+string(meta)+`}}`))

	if cb.updateCount != 1 {
		t.Fatalf("updates=%d, want 1", cb.updateCount)
	}
	if cb.lastEvent.MessageLifecycle {
		t.Fatal("unnegotiated message lifecycle was authorized")
	}
	message, ok := cb.lastEvent.Update.(protocol.AgentMessageEvent)
	if !ok {
		t.Fatalf("update type=%T", cb.lastEvent.Update)
	}
	if !protocol.EqualSessionUpdateMeta(message.Meta, meta) {
		t.Fatalf("meta=%s, want %s", message.Meta, meta)
	}
	legacy, err := cb.lastEvent.LegacySessionUpdate()
	if err != nil {
		t.Fatal(err)
	}
	if legacy.Update.MessageLifecycle == nil || *legacy.Update.MessageLifecycle {
		t.Fatalf("legacy lifecycle authorization=%v, want false", legacy.Update.MessageLifecycle)
	}
}

func TestInstanceSteerUsesNegotiatedWMRequest(t *testing.T) {
	fc := &fakeConn{agentMeta: protocol.BuildWMAgentCapabilitiesMeta(nil, protocol.WMAgentExtensionCapabilities{
		SessionActions: protocol.WMSessionActionCapabilities{Steer: true},
	})}
	inst := NewInstance("third-party", fc)
	if _, err := inst.Initialize(context.Background(), protocol.InitializeParams{
		ProtocolVersion: 1,
		ClientCapabilities: protocol.ClientCapabilities{
			Meta: protocol.BuildWMClientCapabilitiesMeta(nil),
		},
	}); err != nil {
		t.Fatal(err)
	}
	steerer := inst.(SessionSteerer)
	result, err := steerer.SteerSession(context.Background(), "s1", "m1", []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: "change"}})
	if err != nil {
		t.Fatal(err)
	}
	if fc.lastMethod != protocol.MethodWMSessionSteer || result.ProviderTurnID != "turn-1" {
		t.Fatalf("method=%q result=%#v", fc.lastMethod, result)
	}
	params, ok := fc.lastParams.(protocol.WMSessionSteerParams)
	if !ok || params.SessionID != "s1" || params.MessageID != "m1" || len(params.Prompt) != 1 {
		t.Fatalf("params=%#v", fc.lastParams)
	}
}

func TestInstanceRejectsUnnegotiatedWMActionAndGoalNotification(t *testing.T) {
	fc := &fakeConn{agentMeta: protocol.BuildWMAgentCapabilitiesMeta(nil, protocol.WMAgentExtensionCapabilities{
		GoalLifecycle:  true,
		SessionActions: protocol.WMSessionActionCapabilities{Steer: true},
	})}
	inst := NewInstance("third-party", fc)
	if _, err := inst.Initialize(context.Background(), protocol.InitializeParams{ProtocolVersion: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := inst.(SessionSteerer).SteerSession(context.Background(), "s1", "m1", nil); !errors.Is(err, ErrSessionActionUnsupported) {
		t.Fatalf("steer err=%v", err)
	}
	cb := &fakeCallbacks{}
	inst.SetCallbacks(cb)
	fc.resp(context.Background(), protocol.MethodWMSessionGoal, json.RawMessage(`{"sessionId":"s1","event":"cleared"}`))
	if cb.updateCount != 0 {
		t.Fatalf("unnegotiated Goal notification dispatched %d events", cb.updateCount)
	}
}

func TestInstanceLogsInvalidNegotiatedGoalNotification(t *testing.T) {
	var buf bytes.Buffer
	if err := logger.Setup(logger.LoggerConfig{Level: logger.LevelWarn}); err != nil {
		t.Fatalf("setup logger: %v", err)
	}
	defer logger.Close()
	logger.SetOutput(&buf)
	defer logger.SetOutput(os.Stderr)

	fc := &fakeConn{agentMeta: protocol.BuildWMAgentCapabilitiesMeta(nil, protocol.WMAgentExtensionCapabilities{
		GoalLifecycle: true,
	})}
	inst := NewInstance("third-party", fc)
	if _, err := inst.Initialize(context.Background(), protocol.InitializeParams{
		ProtocolVersion: 1,
		ClientCapabilities: protocol.ClientCapabilities{
			Meta: protocol.BuildWMClientCapabilitiesMeta(nil),
		},
	}); err != nil {
		t.Fatal(err)
	}
	cb := &fakeCallbacks{}
	inst.SetCallbacks(cb)
	fc.resp(context.Background(), protocol.MethodWMSessionGoal, json.RawMessage(`{"sessionId":"s1","event":"updated"}`))

	if cb.updateCount != 0 {
		t.Fatalf("invalid Goal dispatched %d events", cb.updateCount)
	}
	if got := buf.String(); !strings.Contains(got, "invalid Goal notification") || !strings.Contains(got, "s1") {
		t.Fatalf("diagnostic log=%q", got)
	}
}

func TestInstanceDispatchesOnlyValidNegotiatedGoalNotifications(t *testing.T) {
	fc := &fakeConn{agentMeta: protocol.BuildWMAgentCapabilitiesMeta(nil, protocol.WMAgentExtensionCapabilities{GoalLifecycle: true})}
	inst := NewInstance("third-party", fc)
	if _, err := inst.Initialize(context.Background(), protocol.InitializeParams{
		ProtocolVersion:    1,
		ClientCapabilities: protocol.ClientCapabilities{Meta: protocol.BuildWMClientCapabilitiesMeta(nil)},
	}); err != nil {
		t.Fatal(err)
	}
	fc.resp(context.Background(), "_wm/future", json.RawMessage(`{"value":1}`))
	fc.resp(context.Background(), protocol.MethodWMSessionGoal, json.RawMessage(`{"sessionId":"s1","event":"updated"}`))
	fc.resp(context.Background(), protocol.MethodWMSessionGoal, json.RawMessage(`{"sessionId":"s1","event":"cleared","_meta":{"vendor":{"trace":1}}}`))

	cb := &fakeCallbacks{}
	inst.SetCallbacks(cb)
	if cb.updateCount != 1 {
		t.Fatalf("Goal events=%d, want one valid buffered event", cb.updateCount)
	}
}

func newUpdate(acpSessionID, name string) protocol.SessionUpdateParams {
	return protocol.SessionUpdateParams{
		SessionID: acpSessionID,
		Update: protocol.SessionUpdate{
			SessionUpdate: name,
		},
	}
}

type fakeConn struct {
	req                   ACPRequestHandler
	resp                  ACPResponseHandler
	agentMeta             json.RawMessage
	agentCapabilities     protocol.AgentCapabilities
	initializeMeta        json.RawMessage
	nativeSteerOutcome    string
	standardForkSessionID string
	standardForkMeta      json.RawMessage
	lastMethod            string
	lastParams            any
	goal                  *protocol.SessionGoal
	sendErr               error
}

func (f *fakeConn) Send(_ context.Context, method string, params any, result any) error {
	f.lastMethod = method
	f.lastParams = params
	if method != protocol.MethodInitialize && f.sendErr != nil {
		return f.sendErr
	}
	switch method {
	case protocol.MethodInitialize:
		if out, ok := result.(*protocol.InitializeResult); ok {
			out.ProtocolVersion = json.Number("1")
			out.AgentCapabilities = f.agentCapabilities
			out.AgentCapabilities.Meta = protocol.CloneSessionUpdateMeta(f.agentMeta)
			out.Meta = protocol.CloneSessionUpdateMeta(f.initializeMeta)
		}
	case protocol.MethodWMSessionSteer:
		if out, ok := result.(*protocol.WMSessionSteerResult); ok {
			out.TurnID = "turn-1"
		}
	case protocol.MethodSessionSteering:
		if out, ok := result.(*protocol.SessionSteeringResponse); ok {
			out.Outcome = f.nativeSteerOutcome
		}
	case protocol.MethodSessionFork:
		if out, ok := result.(*protocol.SessionForkResponse); ok {
			out.SessionID = f.standardForkSessionID
			out.Meta = protocol.CloneSessionUpdateMeta(f.standardForkMeta)
		}
	case protocol.MethodWMSessionGoalGet:
		if out, ok := result.(*protocol.WMSessionGoalResult); ok {
			out.Goal = f.goal
		}
	case protocol.MethodSessionNew:
		if out, ok := result.(*protocol.SessionNewResult); ok {
			out.SessionID = "new-1"
		}
	case protocol.MethodSessionLoad:
		if out, ok := result.(*protocol.SessionLoadResult); ok {
			out.ConfigOptions = []protocol.ConfigOption{{ID: "mode", CurrentValue: "code"}}
		}
	case protocol.MethodSessionPrompt:
		if out, ok := result.(*protocol.PromptOutcome); ok {
			out.StopReason = "end_turn"
		}
	}
	return nil
}

func (f *fakeConn) Notify(_ string, _ any) error { return nil }

func (f *fakeConn) OnACPRequest(h ACPRequestHandler) { f.req = h }

func (f *fakeConn) OnACPResponse(h ACPResponseHandler) { f.resp = h }

func (f *fakeConn) Close() error { return nil }

type fakeCallbacks struct {
	updateCount     int
	permissionCount int
	lastRequestID   int64
	lastMessageID   string
	lastEvent       protocol.AgentEvent
}

func (f *fakeCallbacks) AgentEvent(event protocol.AgentEvent) {
	params, err := event.LegacySessionUpdate()
	if err != nil {
		return
	}
	f.updateCount++
	f.lastMessageID = params.Update.MessageID
	f.lastEvent = event
}

func (f *fakeCallbacks) SessionRequestPermission(_ context.Context, requestID int64, _ protocol.PermissionRequestParams) (protocol.PermissionResult, error) {
	f.permissionCount++
	f.lastRequestID = requestID
	return protocol.PermissionResult{Outcome: "allow_once", OptionID: "allow"}, nil
}

type fakeCodexappCallbacks struct {
	updates chan protocol.SessionUpdateParams
}

func (f *fakeCodexappCallbacks) AgentEvent(event protocol.AgentEvent) {
	params, err := event.LegacySessionUpdate()
	if err == nil {
		f.updates <- params
	}
}

func (f *fakeCodexappCallbacks) SessionRequestPermission(context.Context, int64, protocol.PermissionRequestParams) (protocol.PermissionResult, error) {
	return protocol.PermissionResult{Outcome: "cancelled"}, nil
}

func captureSessionUpdate(t *testing.T, ch chan<- protocol.SessionUpdateParams) ACPResponseHandler {
	t.Helper()
	return func(_ context.Context, method string, params json.RawMessage) {
		var event protocol.AgentEvent
		switch method {
		case protocol.MethodSessionUpdate:
			wire, err := protocol.DecodeSessionUpdateParams(params)
			if err != nil {
				t.Fatalf("strict decode update: %v; raw=%s", err, params)
			}
			event, err = protocol.ProjectSessionUpdate(wire, time.Now())
			if err != nil {
				t.Fatalf("project update: %v", err)
			}
		case protocol.MethodWMSessionGoal:
			notification, err := protocol.DecodeWMGoalNotification(params)
			if err != nil {
				t.Fatalf("strict decode Goal notification: %v; raw=%s", err, params)
			}
			event = protocol.AgentEvent{SessionID: notification.SessionID, Update: protocol.AgentGoalEvent{
				Event: notification.Event, Goal: notification.Goal, TurnID: notification.TurnID, Meta: notification.Meta,
			}}
		default:
			t.Fatalf("method=%q, want session/update or _wm/session/goal", method)
		}
		update, err := event.LegacySessionUpdate()
		if err != nil {
			t.Fatalf("normalize update: %v", err)
		}
		ch <- update
	}
}

func currentConfigValue(opts []protocol.ConfigOption, id string) string {
	for _, opt := range opts {
		if opt.ID == id {
			return opt.CurrentValue
		}
	}
	return ""
}

func waitForActiveTurn(t *testing.T, conn *codexappConn, want string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		conn.mu.Lock()
		got := conn.activeTurnID
		conn.mu.Unlock()
		if got == want {
			return
		}
		time.Sleep(time.Millisecond)
	}
	conn.mu.Lock()
	got := conn.activeTurnID
	conn.mu.Unlock()
	t.Fatalf("activeTurnID=%q, want %q", got, want)
}

func waitForTurnDiff(t *testing.T, conn *codexappConn, turnID string, want string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		conn.mu.Lock()
		got := ""
		if conn.pendingTurnDiffs != nil {
			got = conn.pendingTurnDiffs[turnID]
		}
		conn.mu.Unlock()
		if got == want {
			return
		}
		time.Sleep(time.Millisecond)
	}
	conn.mu.Lock()
	got := ""
	if conn.pendingTurnDiffs != nil {
		got = conn.pendingTurnDiffs[turnID]
	}
	conn.mu.Unlock()
	t.Fatalf("pendingTurnDiff[%q]=%q, want %q", turnID, got, want)
}

type fakeRawConn struct {
	req  ACPRequestHandler
	resp ACPResponseHandler
	send func(method string, params any, result any) error
}

type fakeLaunchProvider struct {
	name string
	exe  string
	args []string
	env  []string
}

func (p *fakeLaunchProvider) Name() string { return p.name }
func (p *fakeLaunchProvider) Launch() (string, []string, []string, error) {
	return p.exe, append([]string(nil), p.args...), append([]string(nil), p.env...), nil
}

func (f *fakeRawConn) Send(_ context.Context, method string, params any, result any) error {
	if f.send != nil {
		return f.send(method, params, result)
	}
	return nil
}
func (f *fakeRawConn) Notify(_ string, _ any) error       { return nil }
func (f *fakeRawConn) OnACPRequest(h ACPRequestHandler)   { f.req = h }
func (f *fakeRawConn) OnACPResponse(h ACPResponseHandler) { f.resp = h }
func (f *fakeRawConn) Close() error                       { return nil }

func (f *fakeRawConn) emitResponse(method string, params []byte) {
	if f.resp == nil {
		return
	}
	f.resp(context.Background(), method, params)
}

type fakeOwnedTransport struct {
	mu sync.RWMutex

	h      func(json.RawMessage)
	onSend func(v any)

	sent chan any
	done chan struct{}
}

func newFakeOwnedTransport() *fakeOwnedTransport {
	return &fakeOwnedTransport{
		sent: make(chan any, 16),
		done: make(chan struct{}),
	}
}

func (f *fakeOwnedTransport) SendMessage(v any) error {
	f.sent <- v
	f.mu.RLock()
	hook := f.onSend
	f.mu.RUnlock()
	if hook != nil {
		hook(v)
	}
	return nil
}

func (f *fakeOwnedTransport) OnMessage(h func(json.RawMessage)) {
	f.mu.Lock()
	f.h = h
	f.mu.Unlock()
}

func (f *fakeOwnedTransport) Done() <-chan struct{} { return f.done }

func (f *fakeOwnedTransport) Close() error {
	select {
	case <-f.done:
	default:
		close(f.done)
	}
	return nil
}

func (f *fakeOwnedTransport) emit(v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	f.mu.RLock()
	h := f.h
	f.mu.RUnlock()
	if h != nil {
		h(raw)
	}
	return nil
}

type fakeCodexappTransport struct {
	mu sync.RWMutex

	h      func(json.RawMessage)
	onSend func(map[string]any)

	sent chan map[string]any
	done chan struct{}
}

func newFakeCodexappTransport() *fakeCodexappTransport {
	return &fakeCodexappTransport{
		sent: make(chan map[string]any, 32),
		done: make(chan struct{}),
	}
}

func (f *fakeCodexappTransport) SendMessage(v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	var msg map[string]any
	if err := json.Unmarshal(raw, &msg); err != nil {
		return err
	}
	f.sent <- msg
	f.mu.RLock()
	hook := f.onSend
	f.mu.RUnlock()
	if hook != nil {
		hook(msg)
	}
	return nil
}

func (f *fakeCodexappTransport) OnMessage(h func(json.RawMessage)) {
	f.mu.Lock()
	f.h = h
	f.mu.Unlock()
}

func (f *fakeCodexappTransport) Done() <-chan struct{} { return f.done }

func (f *fakeCodexappTransport) Alive() bool {
	select {
	case <-f.done:
		return false
	default:
		return true
	}
}

func (f *fakeCodexappTransport) Close() error {
	select {
	case <-f.done:
	default:
		close(f.done)
	}
	return nil
}

func (f *fakeCodexappTransport) emit(v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	f.mu.RLock()
	h := f.h
	f.mu.RUnlock()
	if h != nil {
		h(raw)
	}
	return nil
}

func (f *fakeCodexappTransport) nextSent(t *testing.T) map[string]any {
	t.Helper()
	select {
	case msg := <-f.sent:
		return msg
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for sent app-server message")
		return nil
	}
}

func TestListSkillsForPreset_ProjectDirUsesRelativeDirectoryName(t *testing.T) {
	root := t.TempDir()
	skillDir := filepath.Join(root, ".agents", "skills", "frontend-design")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	skillFile := filepath.Join(skillDir, "SKILL.md")
	content := "---\nname: fancy-ui\ndescription: \"Build polished interfaces quickly\"\n---\ncontent"
	if err := os.WriteFile(skillFile, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	skills, err := listSkillsForPreset(context.Background(), ACPProviderPreset{
		SkillProjectDirs: []string{".agents/skills"},
	}, root)
	if err != nil {
		t.Fatalf("listSkillsForPreset: %v", err)
	}
	if len(skills) != 1 {
		t.Fatalf("skills len = %d, want 1", len(skills))
	}
	if skills[0].Name != "frontend-design" {
		t.Fatalf("skill name = %q, want %q", skills[0].Name, "frontend-design")
	}
	if !strings.HasSuffix(skills[0].Path, filepath.Join("frontend-design", "SKILL.md")) {
		t.Fatalf("skill path = %q", skills[0].Path)
	}
	encoded, err := json.Marshal(skills[0])
	if err != nil {
		t.Fatalf("Marshal skill: %v", err)
	}
	var skillFields map[string]string
	if err := json.Unmarshal(encoded, &skillFields); err != nil {
		t.Fatalf("Unmarshal skill: %v", err)
	}
	if skillFields["description"] != "Build polished interfaces quickly" {
		t.Fatalf("skill description = %q, want parsed frontmatter description", skillFields["description"])
	}
}

func TestListSkillsForPreset_FoldsMultilineDescriptionForMenuDisplay(t *testing.T) {
	root := t.TempDir()
	skillDir := filepath.Join(root, ".agents", "skills", "caveman")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(skillDir, "SKILL.md"),
		[]byte("---\nname: caveman\ndescription: >\n  Use fewer words.\n  Keep technical accuracy.\n---\n"),
		0o644,
	); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	skills, err := listSkillsForPreset(context.Background(), ACPProviderPreset{
		SkillProjectDirs: []string{".agents/skills"},
	}, root)
	if err != nil {
		t.Fatalf("listSkillsForPreset: %v", err)
	}
	encoded, err := json.Marshal(skills[0])
	if err != nil {
		t.Fatalf("Marshal skill: %v", err)
	}
	var skillFields map[string]string
	if err := json.Unmarshal(encoded, &skillFields); err != nil {
		t.Fatalf("Unmarshal skill: %v", err)
	}
	if got := skillFields["description"]; got != "Use fewer words. Keep technical accuracy." {
		t.Fatalf("skill description = %q", got)
	}
}

func TestListSkillsForPreset_NestedSkillNameUsesLeafDirectoryName(t *testing.T) {
	root := t.TempDir()
	skillDir := filepath.Join(root, ".agents", "skills", "A", "B")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	skillFile := filepath.Join(skillDir, "SKILL.md")
	if err := os.WriteFile(skillFile, []byte("---\nname: ignored\n---\ncontent"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	skills, err := listSkillsForPreset(context.Background(), ACPProviderPreset{
		SkillProjectDirs: []string{".agents/skills"},
	}, root)
	if err != nil {
		t.Fatalf("listSkillsForPreset: %v", err)
	}
	if len(skills) != 1 {
		t.Fatalf("skills len = %d, want 1", len(skills))
	}
	if skills[0].Name != "B" {
		t.Fatalf("skill name = %q, want %q", skills[0].Name, "B")
	}
}

func TestListSkillsForPreset_LinkedUserRoot(t *testing.T) {
	targetRoot := filepath.Join(t.TempDir(), "skills-target")
	skillDir := filepath.Join(targetRoot, "linked-skill")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	skillFile := filepath.Join(skillDir, "SKILL.md")
	if err := os.WriteFile(skillFile, []byte("---\nname: linked-skill\n---\ncontent"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	linkRoot := filepath.Join(t.TempDir(), "skills")
	createAgentSkillDirLink(t, targetRoot, linkRoot)

	skills, err := listSkillsForPreset(context.Background(), ACPProviderPreset{
		SkillUserDirs: []string{linkRoot},
	}, "")
	if err != nil {
		t.Fatalf("listSkillsForPreset: %v", err)
	}
	if len(skills) != 1 {
		t.Fatalf("skills len = %d, want 1", len(skills))
	}
	if skills[0].Name != "linked-skill" {
		t.Fatalf("skill name = %q, want %q", skills[0].Name, "linked-skill")
	}
	wantPath := filepath.Join(linkRoot, "linked-skill", "SKILL.md")
	if skills[0].Path != wantPath {
		t.Fatalf("skill path = %q, want logical path %q", skills[0].Path, wantPath)
	}
}

func TestListSkillsForProvidersDeduplicatesPhysicalRootsAndAggregatesSources(t *testing.T) {
	projectRoot := t.TempDir()
	targetRoot := filepath.Join(t.TempDir(), "shared-skills")
	skillDir := filepath.Join(targetRoot, "shared-skill")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll skill: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("---\nname: shared-skill\n---\n"), 0o600); err != nil {
		t.Fatalf("WriteFile skill: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(projectRoot, ".agents"), 0o755); err != nil {
		t.Fatalf("MkdirAll agents parent: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(projectRoot, ".codebuddy"), 0o755); err != nil {
		t.Fatalf("MkdirAll codebuddy parent: %v", err)
	}
	createAgentSkillDirLink(t, targetRoot, filepath.Join(projectRoot, ".agents", "skills"))
	createAgentSkillDirLink(t, targetRoot, filepath.Join(projectRoot, ".codebuddy", "skills"))

	discovered, err := ListSkillsForProviders(
		context.Background(),
		[]string{"codex", "codebuddy"},
		projectRoot,
		SkillScanScopeProject,
	)
	if err != nil {
		t.Fatalf("ListSkillsForProviders: %v", err)
	}
	if len(discovered) != 1 {
		t.Fatalf("discovered skills = %#v, want one physical scan result", discovered)
	}
	if !containsFold(discovered[0].Provider, "codex") || !containsFold(discovered[0].Provider, "codebuddy") {
		t.Fatalf("providers = %v, want codex and codebuddy", discovered[0].Provider)
	}
	if !containsFold(discovered[0].Locations, "agents") || !containsFold(discovered[0].Locations, "codebuddy") {
		t.Fatalf("locations = %v, want agents and codebuddy", discovered[0].Locations)
	}
}

func createAgentSkillDirLink(t *testing.T, target, link string) {
	t.Helper()
	if os.PathSeparator == '\\' {
		output, err := exec.Command("cmd", "/c", "mklink", "/J", link, target).CombinedOutput()
		if err != nil {
			t.Skipf("unable to create junction: %v (%s)", err, strings.TrimSpace(string(output)))
		}
		return
	}
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("unable to create directory symlink: %v", err)
	}
}

func TestInstanceListSkills_UnknownProvider(t *testing.T) {
	inst := NewInstance("unknown-agent", nil)
	_, err := inst.ListSkills(context.Background(), t.TempDir())
	if err == nil {
		t.Fatal("ListSkills should fail for unknown provider")
	}
}
func TestCodexPreset_IncludesAgentsUserSkillsDir(t *testing.T) {
	found := false
	for _, dir := range CodexProviderPreset.SkillUserDirs {
		if strings.EqualFold(strings.TrimSpace(dir), "~/.agents/skills") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("codex preset user dirs missing ~/.agents/skills: %v", CodexProviderPreset.SkillUserDirs)
	}
}

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

func TestKimiProviderPreset(t *testing.T) {
	preset := KimiACPProviderPreset
	if preset.Name != "kimi" || preset.BinaryName != "kimi" {
		t.Fatalf("preset=%+v", preset)
	}
	if len(preset.Args) != 1 || preset.Args[0] != "acp" {
		t.Fatalf("args=%v, want [acp]", preset.Args)
	}
	if preset.InstallHint != "@moonshot-ai/kimi-code" {
		t.Fatalf("install hint=%q, want @moonshot-ai/kimi-code", preset.InstallHint)
	}
	if preset.MissingPathErrTemplate != "kimi: binary not found in PATH: %v" {
		t.Fatalf("missing-path template=%q, want npm-style PATH message", preset.MissingPathErrTemplate)
	}
	if !strings.Contains(preset.MissingPathErrTemplate, "%v") {
		t.Fatalf("missing-path template must consume the underlying error: %q", preset.MissingPathErrTemplate)
	}
	if !reflect.DeepEqual(preset.SkillProjectDirs, []string{".agents/skills"}) {
		t.Fatalf("project skill dirs = %v, want [.agents/skills]", preset.SkillProjectDirs)
	}
	if !reflect.DeepEqual(preset.SkillUserDirs, []string{"~/.agents/skills"}) {
		t.Fatalf("user skill dirs = %v, want [~/.agents/skills]", preset.SkillUserDirs)
	}

	provider := NewKimiProvider()
	if provider.Name() != "kimi" {
		t.Fatalf("provider name=%q, want kimi", provider.Name())
	}
}

func TestKimiProviderUsesOAuthEnvironment(t *testing.T) {
	if env := NewKimiProvider().preset.Env; len(env) != 0 {
		t.Fatalf("env=%v, want none (OAuth sign-in)", env)
	}
	if len(KimiACPProviderPreset.Env) != 0 {
		t.Fatalf("shared preset mutated: env=%v", KimiACPProviderPreset.Env)
	}
}

func TestProviderPresetByNameKimi(t *testing.T) {
	preset, ok := providerPresetByName("kimi")
	if !ok || preset.Name != "kimi" {
		t.Fatalf("providerPresetByName(kimi)=(%#v,%v), want kimi,true", preset, ok)
	}
}

func TestQoderProviderPreset(t *testing.T) {
	preset := QoderACPProviderPreset
	if preset.Name != "qoder" || preset.BinaryName != "qoderclicn" {
		t.Fatalf("preset=%+v", preset)
	}
	if len(preset.Args) != 1 || preset.Args[0] != "--acp" {
		t.Fatalf("args=%v, want [--acp]", preset.Args)
	}
	if preset.InstallHint != "@qodercn-ai/qoderclicn" {
		t.Fatalf("install hint=%q, want @qodercn-ai/qoderclicn", preset.InstallHint)
	}
	if preset.MissingPathErrTemplate != "qoder: binary not found in PATH: %v" {
		t.Fatalf("missing-path template=%q, want npm-style PATH message", preset.MissingPathErrTemplate)
	}
	if !strings.Contains(preset.MissingPathErrTemplate, "%v") {
		t.Fatalf("missing-path template must consume the underlying error: %q", preset.MissingPathErrTemplate)
	}
	if !reflect.DeepEqual(preset.SkillProjectDirs, []string{".qoder/skills"}) {
		t.Fatalf("project skill dirs = %v, want [.qoder/skills]", preset.SkillProjectDirs)
	}
	if !reflect.DeepEqual(preset.SkillUserDirs, []string{"~/.qoder/skills"}) {
		t.Fatalf("user skill dirs = %v, want [~/.qoder/skills]", preset.SkillUserDirs)
	}

	provider := NewQoderProvider()
	if provider.Name() != "qoder" {
		t.Fatalf("provider name=%q, want qoder", provider.Name())
	}
}

func TestProviderPresetByNameQoder(t *testing.T) {
	preset, ok := providerPresetByName("qoder")
	if !ok || preset.Name != "qoder" {
		t.Fatalf("providerPresetByName(qoder)=(%#v,%v), want qoder,true", preset, ok)
	}
}

func TestClaudeCompatibleProviderPresetsShareClaudeUserSkills(t *testing.T) {
	for _, name := range []string{"cc-deepseek", "cc-glm", "cc-kimi", "cc-qwen", "cc-flicker"} {
		t.Run(name, func(t *testing.T) {
			preset, ok := providerPresetByName(name)
			if !ok || preset.Name != name {
				t.Fatalf("providerPresetByName(%q)=(%#v,%v), want matching preset", name, preset, ok)
			}
			if !reflect.DeepEqual(preset.SkillProjectDirs, []string{".claude/skills"}) {
				t.Fatalf("project skill dirs = %v, want [.claude/skills]", preset.SkillProjectDirs)
			}
			if !reflect.DeepEqual(preset.SkillUserDirs, []string{"~/.claude/skills"}) {
				t.Fatalf("user skill dirs = %v, want [~/.claude/skills]", preset.SkillUserDirs)
			}
		})
	}
}

func TestListProviderSkills_ClaudeCompatibleIncludesClaudeUserSkills(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	skillDir := filepath.Join(homeDir, ".claude", "skills", "shared-global")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll skill: %v", err)
	}
	skillPath := filepath.Join(skillDir, "SKILL.md")
	if err := os.WriteFile(skillPath, []byte("---\nname: shared-global\n---\n"), 0o600); err != nil {
		t.Fatalf("WriteFile skill: %v", err)
	}

	for _, name := range []string{"cc-deepseek", "cc-glm", "cc-kimi", "cc-qwen", "cc-flicker"} {
		t.Run(name, func(t *testing.T) {
			skills, err := ListProviderSkills(context.Background(), name, t.TempDir())
			if err != nil {
				t.Fatalf("ListProviderSkills(%q) error = %v", name, err)
			}
			found := false
			for _, skill := range skills {
				if skill.Name == "shared-global" && skill.Path == skillPath {
					found = true
					break
				}
			}
			if !found {
				t.Fatalf("ListProviderSkills(%q) = %#v, want shared global skill at %s", name, skills, skillPath)
			}
		})
	}
}

func TestClaudePreset_UsesClaudeUserSkillsDirOnly(t *testing.T) {
	hasClaudeDir := false
	for _, dir := range ClaudeACPProviderPreset.SkillUserDirs {
		normalized := strings.TrimSpace(dir)
		if strings.EqualFold(normalized, "~/.claude/skills") {
			hasClaudeDir = true
		}
		if strings.EqualFold(normalized, "~/.agents/skills") {
			t.Fatalf("claude preset should not scan ~/.agents/skills: %v", ClaudeACPProviderPreset.SkillUserDirs)
		}
	}
	if !hasClaudeDir {
		t.Fatalf("claude preset user dirs missing ~/.claude/skills: %v", ClaudeACPProviderPreset.SkillUserDirs)
	}
}

func TestCanonicalAndNativeSkillPresets(t *testing.T) {
	tests := []struct {
		name        string
		preset      ACPProviderPreset
		projectDirs []string
		userDirs    []string
	}{
		{name: "codex", preset: CodexProviderPreset, projectDirs: []string{".agents/skills"}, userDirs: []string{"~/.agents/skills"}},
		{name: "copilot", preset: CopilotACPProviderPreset, projectDirs: []string{".agents/skills"}, userDirs: []string{"~/.agents/skills"}},
		{name: "kimi", preset: KimiACPProviderPreset, projectDirs: []string{".agents/skills"}, userDirs: []string{"~/.agents/skills"}},
		{name: "codebuddy", preset: CodeBuddyACPProviderPreset, projectDirs: []string{".codebuddy/skills"}, userDirs: []string{"~/.codebuddy/skills"}},
		{name: "mimo", preset: MimoACPProviderPreset, projectDirs: []string{".mimocode/skills"}, userDirs: []string{"~/.mimocode/skills"}},
		{name: "qoder", preset: QoderACPProviderPreset, projectDirs: []string{".qoder/skills"}, userDirs: []string{"~/.qoder/skills"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if !reflect.DeepEqual(test.preset.SkillProjectDirs, test.projectDirs) {
				t.Fatalf("project skill dirs = %v, want %v", test.preset.SkillProjectDirs, test.projectDirs)
			}
			if !reflect.DeepEqual(test.preset.SkillUserDirs, test.userDirs) {
				t.Fatalf("user skill dirs = %v, want %v", test.preset.SkillUserDirs, test.userDirs)
			}
		})
	}
}

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
			if !test.want {
				return
			}
			if preferred := factory.PreferredName(); preferred == string(protocol.ACPProviderCXDeepSeek) {
				t.Fatalf("PreferredName() selected cx-deepseek: %q", preferred)
			}
		})
	}
}

func TestConfiguredACPFactoryRegistersQoderWhenAvailable(t *testing.T) {
	factory := newACPFactoryWithOptions(ACPFactoryOptions{}, func(provider ACPProvider) bool {
		return provider.Name() == string(protocol.ACPProviderQoder)
	})
	if factory.Creator(protocol.ACPProviderQoder) == nil {
		t.Fatalf("qoder not registered; names=%v", factory.Names())
	}
	if got := factory.Names(); len(got) != 1 || got[0] != string(protocol.ACPProviderQoder) {
		t.Fatalf("factory.Names() = %v, want [qoder]", got)
	}
}

func TestCodexAppProviderCreatorsUseIndependentPools(t *testing.T) {
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
}

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

func TestACPFactoryReplaceFromUpdatesSharedRegistryInPlace(t *testing.T) {
	original := NewACPFactory()
	original.Register(protocol.ACPProviderClaude, func(context.Context, string) (Instance, error) {
		return nil, nil
	})
	replacement := NewACPFactory()
	replacement.Register(protocol.ACPProviderCodex, func(context.Context, string) (Instance, error) {
		return nil, nil
	})

	original.ReplaceFrom(replacement)

	if got := original.Names(); !reflect.DeepEqual(got, []string{"codex"}) {
		t.Fatalf("Names() = %v, want [codex]", got)
	}
	if original.Creator(protocol.ACPProviderClaude) != nil {
		t.Fatal("Claude creator survived replacement")
	}
	if original.Creator(protocol.ACPProviderCodex) == nil {
		t.Fatal("Codex creator missing after replacement")
	}
}

func TestConfiguredACPFactoryClaudeCompatibleRegistrationMatrix(t *testing.T) {
	stateDir := filepath.Join(t.TempDir(), "state")
	tests := []struct {
		name        string
		deepseekKey string
		kimiKey     string
		qwenKey     string
		zaiKey      string
		flickerKey  string
		available   bool
		wantNames   []string
	}{
		{name: "adapter missing", deepseekKey: "deepseek-key", kimiKey: "kimi-key", qwenKey: "qwen-key", zaiKey: "zai-key", wantNames: []string{}},
		{name: "keys missing", available: true, wantNames: []string{}},
		{name: "deepseek only", deepseekKey: "deepseek-key", available: true, wantNames: []string{"cc-deepseek"}},
		{name: "kimi only", kimiKey: "kimi-key", available: true, wantNames: []string{"cc-kimi"}},
		{name: "qwen only", qwenKey: "qwen-key", available: true, wantNames: []string{"cc-qwen"}},
		{name: "zai only", zaiKey: "zai-key", available: true, wantNames: []string{"cc-glm"}},
		{name: "flicker only", flickerKey: "flicker-key", available: true, wantNames: []string{"cc-flicker"}},
		{name: "all", deepseekKey: "deepseek-key", kimiKey: "kimi-key", qwenKey: "qwen-key", zaiKey: "zai-key", flickerKey: "flicker-key", available: true, wantNames: []string{"cc-deepseek", "cc-flicker", "cc-glm", "cc-kimi", "cc-qwen"}},
		{name: "trimmed input", kimiKey: "  kimi-key  ", available: true, wantNames: []string{"cc-kimi"}},
		{name: "whitespace only", deepseekKey: "\n", kimiKey: "   ", qwenKey: "\r", zaiKey: "\t", available: true, wantNames: []string{}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			factory := newACPFactoryWithOptions(ACPFactoryOptions{
				StateDir:       stateDir,
				DeepSeekAPIKey: tt.deepseekKey,
				KimiAPIKey:     tt.kimiKey,
				QwenAPIKey:     tt.qwenKey,
				ZAIAPIKey:      tt.zaiKey,
				FlickerAPIKey:  tt.flickerKey,
			}, func(provider ACPProvider) bool {
				return tt.available && (provider.Name() == "cc-deepseek" || provider.Name() == "cc-glm" || provider.Name() == "cc-kimi" || provider.Name() == "cc-qwen" || provider.Name() == "cc-flicker")
			})
			if got := factory.Names(); !reflect.DeepEqual(got, tt.wantNames) {
				t.Fatalf("factory.Names() = %v, want %v", got, tt.wantNames)
			}
			if preferred := factory.PreferredName(); preferred == "cc-deepseek" || preferred == "cc-glm" || preferred == "cc-kimi" || preferred == "cc-qwen" || preferred == "cc-flicker" {
				t.Fatalf("PreferredName() selected Claude-compatible provider: %q", preferred)
			}
		})
	}
}

func TestApplyFlickerModelsFallsBackToStrongestAvailableClaudeModel(t *testing.T) {
	profile := claudeCompatibleFlickerProfile(t.TempDir())
	applyFlickerModels(&profile, []claudeModelEntry{
		{ID: "CLAUDE_4_6", Name: "MF Claude Sonnet 4.6"},
	})
	if profile.defaultModel != "CLAUDE_4_6" {
		t.Fatalf("default model = %q, want strongest available Claude id", profile.defaultModel)
	}
	if got := profile.settingsEnv["ANTHROPIC_DEFAULT_OPUS_MODEL_NAME"]; got != "MF Claude Sonnet 4.6" {
		t.Fatalf("opus tier label = %q, want available model label %q", got, "MF Claude Sonnet 4.6")
	}
	if got := profile.settingsEnv["ANTHROPIC_DEFAULT_SONNET_MODEL_NAME"]; got != "MF Claude Sonnet 4.6" {
		t.Fatalf("sonnet tier label = %q, want catalog name %q", got, "MF Claude Sonnet 4.6")
	}
}

func TestClaudeCompatibleFlickerProfileEnablesACPConfigurableEffort(t *testing.T) {
	profile := claudeCompatibleFlickerProfile(t.TempDir())

	if got := profile.settingsEnv["CLAUDE_CODE_ALWAYS_ENABLE_EFFORT"]; got != "1" {
		t.Fatalf("CLAUDE_CODE_ALWAYS_ENABLE_EFFORT = %q, want 1", got)
	}
}

func TestApplyFlickerModelsUsesCurrentV2IDsForTierDefaults(t *testing.T) {
	profile := claudeCompatibleFlickerProfile(t.TempDir())
	applyFlickerModels(&profile, []claudeModelEntry{
		{ID: "claude-haiku-4.5", Name: "Claude Haiku 4.5"},
		{ID: "claude-opus-5", Name: "Claude Opus 5"},
		{ID: "claude-4.8-opus", Name: "Claude Opus 4.8"},
		{ID: "claude-4.6-sonnet", Name: "Claude Sonnet 4.6"},
	})

	if profile.defaultModel != "claude-opus-5" {
		t.Fatalf("default model = %q, want current V2 opus id", profile.defaultModel)
	}
	wantEnv := map[string]string{
		"ANTHROPIC_DEFAULT_FABLE_MODEL":  "claude-opus-5",
		"ANTHROPIC_DEFAULT_OPUS_MODEL":   "claude-opus-5",
		"ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-4.6-sonnet",
		"ANTHROPIC_DEFAULT_HAIKU_MODEL":  "claude-haiku-4.5",
		"CLAUDE_CODE_SUBAGENT_MODEL":     "claude-4.6-sonnet",
	}
	for name, want := range wantEnv {
		if got := profile.settingsEnv[name]; got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
}

func TestApplyFlickerModelsSortsV2CatalogByVendorAndAscendingStrength(t *testing.T) {
	inputIDs := []string{
		"gpt-5.6-luna",
		"gpt-5.5",
		"claude-haiku-4.5",
		"deepseek-v4-flash",
		"kimi-k2.6",
		"kimi-k2.5",
		"minimax-m3",
		"gpt-5.6-terra",
		"auto",
		"claude-4.8-opus",
		"claude-opus-5",
		"claude-4.5-sonnet",
		"kat-coder-v2.5",
		"claude-4.6-sonnet",
		"deepseek-v4-pro",
		"minimax-m2.7",
		"glm-5.2",
		"glm-5.1",
		"gpt-5.6-sol",
		"gpt-5.4",
		"claude-4.7-opus",
		"kimi-k3",
		"qwen-3.7-max",
		"kat-coder",
	}
	models := make([]claudeModelEntry, 0, len(inputIDs))
	for _, id := range inputIDs {
		models = append(models, claudeModelEntry{ID: id, Name: id})
	}
	profile := claudeCompatibleFlickerProfile(t.TempDir())
	applyFlickerModels(&profile, models)

	got := make([]string, 0, len(profile.staticModels))
	for _, model := range profile.staticModels {
		got = append(got, model.ID)
	}
	want := []string{
		"claude-haiku-4.5",
		"claude-4.5-sonnet",
		"claude-4.6-sonnet",
		"claude-4.7-opus",
		"claude-4.8-opus",
		"claude-opus-5",
		"gpt-5.4",
		"gpt-5.5",
		"gpt-5.6-luna",
		"gpt-5.6-terra",
		"gpt-5.6-sol",
		"kimi-k2.5",
		"kimi-k2.6",
		"kimi-k3",
		"glm-5.1",
		"glm-5.2",
		"deepseek-v4-flash",
		"deepseek-v4-pro",
		"kat-coder",
		"kat-coder-v2.5",
		"minimax-m2.7",
		"minimax-m3",
		"qwen-3.7-max",
		"auto",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("sorted model ids = %#v, want %#v", got, want)
	}
}

func TestFlickerModelStoreRefreshFromEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[
			{"id":"CLAUDE_OPUS_4_8","display_name":"MF Claude Opus 4.8","capabilities":{"effortLevels":["low","medium","high","max"],"defaultThinkingLevel":"medium"}},
			{"id":"CLAUDE-MYFLICKER-GPT_5_4","display_name":"MF GPT-5.4","capabilities":{"effortLevels":["low","medium","high","xhigh"],"defaultThinkingLevel":"medium"}}
		]}`))
	}))
	defer server.Close()

	store := &FlickerModelStore{endpoint: server.URL}
	store.Refresh()
	got := store.Models()
	want := []claudeModelEntry{
		{ID: "CLAUDE_OPUS_4_8", Name: "MF Claude Opus 4.8", EffortLevels: []string{"low", "medium", "high", "max"}, DefaultEffort: "medium"},
		{ID: "CLAUDE-MYFLICKER-GPT_5_4", Name: "MF GPT-5.4", EffortLevels: []string{"low", "medium", "high", "xhigh"}, DefaultEffort: "medium"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Models() = %#v, want %#v", got, want)
	}
}

func TestNormalizeFlickerConfigOptionsUsesSelectedModelEfforts(t *testing.T) {
	models := []claudeModelEntry{
		{
			ID:            "gpt-5.6-sol",
			Name:          "GPT 5.6 Sol",
			EffortLevels:  []string{"low", "medium", "high", "xhigh", "max"},
			DefaultEffort: "medium",
		},
		{
			ID:           "kimi-k3",
			Name:         "Kimi K3",
			EffortLevels: []string{"low", "high", "max"},
		},
		{ID: "minimax-m3", Name: "Minimax M3"},
	}
	profile := claudeCompatibleFlickerProfile(t.TempDir())
	applyFlickerModels(&profile, models)

	t.Run("synthesizes missing effort and selects model default", func(t *testing.T) {
		options := normalizeFlickerConfigOptions([]protocol.ConfigOption{{
			ID:           protocol.ConfigOptionIDModel,
			Category:     protocol.ConfigOptionCategoryModel,
			CurrentValue: "gpt-5.6-sol",
		}}, models, profile)
		effort := flickerConfigOption(options, "effort")
		if effort == nil {
			t.Fatal("effort option is missing")
		}
		if effort.CurrentValue != "medium" {
			t.Fatalf("current effort = %q, want medium", effort.CurrentValue)
		}
		if got := configOptionValues(*effort); !reflect.DeepEqual(got, []string{"low", "medium", "high", "xhigh", "max"}) {
			t.Fatalf("effort values = %v", got)
		}
	})

	t.Run("removes default and falls back to first supported level", func(t *testing.T) {
		options := normalizeFlickerConfigOptions([]protocol.ConfigOption{
			{
				ID:           protocol.ConfigOptionIDModel,
				Category:     protocol.ConfigOptionCategoryModel,
				CurrentValue: "kimi-k3",
			},
			{
				ID:           "effort",
				Category:     protocol.ConfigOptionCategoryThoughtLv,
				CurrentValue: "medium",
				Options: []protocol.ConfigOptionValue{
					{Value: "default", Name: "Default"},
					{Value: "low", Name: "Low"},
					{Value: "medium", Name: "Medium"},
					{Value: "high", Name: "High"},
					{Value: "xhigh", Name: "Xhigh"},
					{Value: "max", Name: "Max"},
				},
			},
		}, models, profile)
		effort := flickerConfigOption(options, "effort")
		if effort == nil || effort.CurrentValue != "low" {
			t.Fatalf("effort = %#v, want low", effort)
		}
		if got := configOptionValues(*effort); !reflect.DeepEqual(got, []string{"low", "high", "max"}) {
			t.Fatalf("effort values = %v", got)
		}
	})

	t.Run("hides effort for model without variants", func(t *testing.T) {
		options := normalizeFlickerConfigOptions([]protocol.ConfigOption{
			{ID: protocol.ConfigOptionIDModel, CurrentValue: "minimax-m3"},
			{ID: "effort", CurrentValue: "high"},
		}, models, profile)
		if effort := flickerConfigOption(options, "effort"); effort != nil {
			t.Fatalf("unexpected effort option = %#v", effort)
		}
	})
}

func TestFlickerEffortInstanceNormalizesSessionConfigOptions(t *testing.T) {
	models := []claudeModelEntry{{
		ID:            "gpt-5.6-sol",
		Name:          "GPT 5.6 Sol",
		EffortLevels:  []string{"low", "medium", "high", "xhigh", "max"},
		DefaultEffort: "medium",
	}}
	store := &FlickerModelStore{models: models}
	profile := claudeCompatibleFlickerProfile(t.TempDir())
	applyFlickerModels(&profile, models)
	baseConn := &testFlickerBaseConn{
		sendFn: func(_ context.Context, method string, _ any, result any) error {
			if method != protocol.MethodSessionNew {
				t.Fatalf("method = %q, want session/new", method)
			}
			return assignResult(result, protocol.SessionNewResult{
				SessionID: "session-1",
				ConfigOptions: []protocol.ConfigOption{{
					ID:           protocol.ConfigOptionIDModel,
					Category:     protocol.ConfigOptionCategoryModel,
					CurrentValue: "gpt-5.6-sol",
				}},
			})
		},
	}
	instance := newFlickerEffortInstance(NewInstance("cc-flicker", baseConn), store, &profile)
	result, err := instance.SessionNew(context.Background(), protocol.SessionNewParams{})
	if err != nil {
		t.Fatal(err)
	}
	effort := flickerConfigOption(result.ConfigOptions, "effort")
	if effort == nil || effort.CurrentValue != "medium" {
		t.Fatalf("normalized effort = %#v", effort)
	}
}

func TestFlickerEffortInstanceUsesCatalogModelDisplayNames(t *testing.T) {
	models := []claudeModelEntry{
		{ID: "claude-opus-5", Name: "Claude Opus 5"},
		{ID: "gpt-5.6-sol", Name: "GPT-5.6 Sol"},
	}
	store := &FlickerModelStore{models: models}
	profile := claudeCompatibleFlickerProfile(t.TempDir())
	applyFlickerModels(&profile, models)
	baseConn := &testFlickerBaseConn{
		sendFn: func(_ context.Context, method string, _ any, result any) error {
			if method != protocol.MethodSessionNew {
				t.Fatalf("method = %q, want session/new", method)
			}
			return assignResult(result, protocol.SessionNewResult{
				SessionID: "session-1",
				ConfigOptions: []protocol.ConfigOption{{
					ID:           protocol.ConfigOptionIDModel,
					Category:     protocol.ConfigOptionCategoryModel,
					CurrentValue: "claude-opus-5",
					Options: []protocol.ConfigOptionValue{
						{Value: "default", Name: "Default (recommended)"},
						{Value: "claude-opus-5", Name: "claude-opus-5"},
						{Value: "gpt-5.6-sol", Name: "gpt-5.6-sol"},
						{Value: "unlisted-model", Name: "unlisted-model"},
					},
				}},
			})
		},
	}
	instance := newFlickerEffortInstance(NewInstance("cc-flicker", baseConn), store, &profile)
	result, err := instance.SessionNew(context.Background(), protocol.SessionNewParams{})
	if err != nil {
		t.Fatal(err)
	}
	modelOption := flickerConfigOption(result.ConfigOptions, protocol.ConfigOptionIDModel)
	if modelOption == nil {
		t.Fatal("model option is missing")
	}
	got := make(map[string]string, len(modelOption.Options))
	for _, option := range modelOption.Options {
		got[option.Value] = option.Name
	}
	want := map[string]string{
		"default":        "Default (recommended)",
		"claude-opus-5":  "Claude Opus 5",
		"gpt-5.6-sol":    "GPT-5.6 Sol",
		"unlisted-model": "unlisted-model",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("model option names = %#v, want %#v", got, want)
	}
}

func TestFlickerEffortInstanceRetainsSupportedEffortAcrossModelSwitch(t *testing.T) {
	models := []claudeModelEntry{
		{ID: "gpt-5.6-sol", EffortLevels: []string{"low", "medium", "high", "xhigh", "max"}, DefaultEffort: "medium"},
		{ID: "claude-4.8-opus", EffortLevels: []string{"low", "medium", "high", "max"}, DefaultEffort: "medium"},
	}
	store := &FlickerModelStore{models: models}
	profile := claudeCompatibleFlickerProfile(t.TempDir())
	applyFlickerModels(&profile, models)
	baseConn := &testFlickerBaseConn{
		sendFn: func(_ context.Context, method string, _ any, result any) error {
			switch method {
			case protocol.MethodSessionNew:
				return assignResult(result, protocol.SessionNewResult{
					SessionID: "session-1",
					ConfigOptions: []protocol.ConfigOption{
						{ID: protocol.ConfigOptionIDModel, CurrentValue: "gpt-5.6-sol"},
						{ID: "effort", CurrentValue: "high"},
					},
				})
			case protocol.MethodSetConfigOption:
				return assignResult(result, protocol.SetSessionConfigOptionResponse{ConfigOptions: protocol.WireSessionConfigOptions([]protocol.ConfigOption{{
					ID: protocol.ConfigOptionIDModel, Name: "Model", Type: "select", CurrentValue: "claude-4.8-opus",
				}})})
			default:
				t.Fatalf("unexpected method %q", method)
				return nil
			}
		},
	}
	instance := newFlickerEffortInstance(NewInstance("cc-flicker", baseConn), store, &profile)
	if _, err := instance.SessionNew(context.Background(), protocol.SessionNewParams{}); err != nil {
		t.Fatal(err)
	}
	options, err := instance.SessionSetConfigOption(context.Background(), protocol.SessionSetConfigOptionParams{
		SessionID: "session-1",
		ConfigID:  protocol.ConfigOptionIDModel,
		Value:     "claude-4.8-opus",
	})
	if err != nil {
		t.Fatal(err)
	}
	effort := flickerConfigOption(options, "effort")
	if effort == nil || effort.CurrentValue != "high" {
		t.Fatalf("effort after model switch = %#v, want retained high", effort)
	}
}

func flickerConfigOption(options []protocol.ConfigOption, id string) *protocol.ConfigOption {
	for index := range options {
		if strings.EqualFold(options[index].ID, id) {
			return &options[index]
		}
	}
	return nil
}

func configOptionValues(option protocol.ConfigOption) []string {
	values := make([]string, 0, len(option.Options))
	for _, item := range option.Options {
		values = append(values, item.Value)
	}
	return values
}

func TestFlickerModelStoreRefreshKeepsPreviousOnFailure(t *testing.T) {
	// No server listening at this endpoint: Refresh must not wipe a prior catalog
	// and must never invent a builtin fallback.
	store := &FlickerModelStore{
		endpoint: "http://127.0.0.1:0/v1/models",
		models:   []claudeModelEntry{{ID: "CLAUDE_4_6", Name: "MF Claude Sonnet 4.6"}},
	}
	store.Refresh()
	if got := store.Models(); len(got) != 1 || got[0].ID != "CLAUDE_4_6" {
		t.Fatalf("Models() after failed refresh = %#v, want prior catalog preserved", got)
	}
}

func TestFlickerModelStoreEmptyByDefault(t *testing.T) {
	if got := NewFlickerModelStore().Models(); len(got) != 0 {
		t.Fatalf("new store Models() = %#v, want empty (no builtin fallback)", got)
	}
}
