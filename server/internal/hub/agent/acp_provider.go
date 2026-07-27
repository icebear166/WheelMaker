package agent

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/swm8023/wheelmaker/internal/flickerbridge"
	"github.com/swm8023/wheelmaker/internal/shared"
)

// ACPProvider resolves launch details for one ACP agent type.
type ACPProvider interface {
	Name() string
	Launch() (exe string, args []string, env []string, err error)
}

// ACPProviderPreset declares launch behavior for one provider kind.
type ACPProviderPreset struct {
	Name                   string
	BinaryName             string
	Args                   []string
	Env                    []string
	MissingPathErrTemplate string
	InstallHint            string
	SkillProjectDirs       []string
	SkillProjectParentDirs []string
	SkillUserDirs          []string
	SkillExtraDirsEnv      string
	SkillPluginDirGlobs    []string
}

var (
	CodexProviderPreset = ACPProviderPreset{
		Name:             "codex",
		BinaryName:       "codex",
		InstallHint:      "@openai/codex",
		SkillProjectDirs: []string{".agents/skills"},
		SkillUserDirs:    []string{"~/.codex/skills", "~/.agents/skills", "~/.copilot/skills"},
		SkillPluginDirGlobs: []string{
			"~/.copilot/installed-plugins/*/*/skills",
		},
	}
	ClaudeACPProviderPreset = ACPProviderPreset{
		Name:                   "claude",
		BinaryName:             "claude-agent-acp",
		InstallHint:            "@agentclientprotocol/claude-agent-acp",
		SkillProjectDirs:       []string{".claude/skills"},
		SkillProjectParentDirs: []string{".claude/skills"},
		SkillUserDirs:          []string{"~/.claude/skills"},
	}
	CopilotACPProviderPreset = ACPProviderPreset{
		Name:                   "copilot",
		BinaryName:             "copilot",
		Args:                   []string{"--acp", "--stdio"},
		InstallHint:            "@github/copilot",
		MissingPathErrTemplate: "copilot: binary not found in PATH: %v",
		SkillProjectDirs:       []string{".github/skills", ".agents/skills", ".claude/skills"},
		SkillProjectParentDirs: []string{".github/skills"},
		SkillUserDirs:          []string{"~/.copilot/skills", "~/.agents/skills", "~/.claude/skills"},
		SkillExtraDirsEnv:      "COPILOT_SKILLS_DIRS",
		SkillPluginDirGlobs:    []string{"~/.copilot/installed-plugins/*/*/skills"},
	}
	OpenCodeACPProviderPreset = ACPProviderPreset{
		Name:                   "opencode",
		BinaryName:             "opencode",
		Args:                   []string{"acp"},
		InstallHint:            "opencode-ai",
		MissingPathErrTemplate: "opencode: binary not found in PATH: %v",
		SkillProjectDirs:       []string{".agents/skills"},
		SkillUserDirs:          []string{"~/.agents/skills"},
	}
	MimoACPProviderPreset = ACPProviderPreset{
		Name:                   "mimo",
		BinaryName:             "mimo",
		Args:                   []string{"acp"},
		MissingPathErrTemplate: "mimo: binary not found in PATH: %v",
		SkillProjectDirs:       []string{".agents/skills"},
		SkillUserDirs:          []string{"~/.agents/skills"},
	}
	CodeBuddyACPProviderPreset = ACPProviderPreset{
		Name:                   "codebuddy",
		BinaryName:             "codebuddy",
		Args:                   []string{"--acp"},
		InstallHint:            "@tencent-ai/codebuddy-code",
		MissingPathErrTemplate: "codebuddy: binary not found in PATH: %v",
		SkillProjectDirs:       []string{".agents/skills"},
		SkillUserDirs:          []string{"~/.agents/skills"},
	}
	FlickerACPProviderPreset = ACPProviderPreset{
		Name:                   "flicker",
		BinaryName:             "myflicker",
		Args:                   []string{"acp"},
		InstallHint:            "@myflicker/cli",
		MissingPathErrTemplate: "flicker: myflicker binary not found in PATH: %v",
		SkillProjectDirs:       []string{".agents/skills"},
		SkillUserDirs:          []string{"~/.agents/skills"},
	}
	KimiACPProviderPreset = ACPProviderPreset{
		Name:                   "kimi",
		BinaryName:             "kimi",
		Args:                   []string{"acp"},
		MissingPathErrTemplate: "kimi: binary not found (install Kimi Code CLI: https://code.kimi.com/kimi-code): %v",
		SkillProjectDirs:       []string{".agents/skills", ".kimi-code/skills"},
		SkillUserDirs:          []string{"~/.agents/skills", "~/.kimi-code/skills"},
	}
	ClaudeCompatibleDeepSeekProviderPreset = ACPProviderPreset{
		Name:                   "cc-deepseek",
		BinaryName:             "claude-agent-acp",
		Args:                   []string{"--hide-claude-auth"},
		InstallHint:            "@agentclientprotocol/claude-agent-acp",
		SkillProjectDirs:       []string{".claude/skills"},
		SkillProjectParentDirs: []string{".claude/skills"},
		SkillUserDirs:          []string{"~/.claude/skills"},
	}
	ClaudeCompatibleGLMProviderPreset = ACPProviderPreset{
		Name:                   "cc-glm",
		BinaryName:             "claude-agent-acp",
		Args:                   []string{"--hide-claude-auth"},
		InstallHint:            "@agentclientprotocol/claude-agent-acp",
		SkillProjectDirs:       []string{".claude/skills"},
		SkillProjectParentDirs: []string{".claude/skills"},
		SkillUserDirs:          []string{"~/.claude/skills"},
	}
	ClaudeCompatibleKimiProviderPreset = ACPProviderPreset{
		Name:                   "cc-kimi",
		BinaryName:             "claude-agent-acp",
		Args:                   []string{"--hide-claude-auth"},
		InstallHint:            "@agentclientprotocol/claude-agent-acp",
		SkillProjectDirs:       []string{".claude/skills"},
		SkillProjectParentDirs: []string{".claude/skills"},
		SkillUserDirs:          []string{"~/.claude/skills"},
	}
	ClaudeCompatibleQwenProviderPreset = ACPProviderPreset{
		Name:                   "cc-qwen",
		BinaryName:             "claude-agent-acp",
		Args:                   []string{"--hide-claude-auth"},
		InstallHint:            "@agentclientprotocol/claude-agent-acp",
		SkillProjectDirs:       []string{".claude/skills"},
		SkillProjectParentDirs: []string{".claude/skills"},
		SkillUserDirs:          []string{"~/.claude/skills"},
	}
	ClaudeCompatibleFlickerProviderPreset = ACPProviderPreset{
		Name:                   "cc-flicker",
		BinaryName:             "claude-agent-acp",
		Args:                   []string{"--hide-claude-auth"},
		InstallHint:            "@agentclientprotocol/claude-agent-acp",
		SkillProjectDirs:       []string{".claude/skills"},
		SkillProjectParentDirs: []string{".claude/skills"},
		SkillUserDirs:          []string{"~/.claude/skills"},
	}
)

// acpProvider is the unified implementation for all ACP providers.
type acpProvider struct {
	preset         ACPProviderPreset
	claudeSettings *claudeCompatibleProfile

	resolveBinary       func(name, configuredPath, installHint string) (string, error)
	lookPath            func(file string) (string, error)
	ensureFlickerLoader func() (string, error)
}

// NewACPProvider creates a provider from preset.
func NewACPProvider(preset ACPProviderPreset) *acpProvider {
	return &acpProvider{
		preset:              preset,
		resolveBinary:       ResolveACPBinary,
		lookPath:            exec.LookPath,
		ensureFlickerLoader: ensureFlickerACPLoader,
	}
}

func NewCodexProvider() *codexAppProvider {
	return NewCodexAppProvider()
}

func NewClaudeProvider() *acpProvider {
	return NewACPProvider(ClaudeACPProviderPreset)
}

func NewCopilotProvider() *acpProvider {
	return NewACPProvider(CopilotACPProviderPreset)
}

func NewOpenCodeProvider() *acpProvider {
	return NewACPProvider(OpenCodeACPProviderPreset)
}

func NewMimoProvider() *acpProvider {
	return NewACPProvider(MimoACPProviderPreset)
}

func NewCodeBuddyProvider() *acpProvider {
	return NewACPProvider(CodeBuddyACPProviderPreset)
}

func NewFlickerProvider() *acpProvider {
	return NewACPProvider(FlickerACPProviderPreset)
}

func NewKimiProvider() *acpProvider {
	return NewACPProvider(KimiACPProviderPreset)
}

func NewCCDeepSeekProvider(stateDir, apiKey string) *acpProvider {
	profile := claudeCompatibleDeepSeekProfile(stateDir)
	preset := ClaudeCompatibleDeepSeekProviderPreset
	preset.Env = claudeCompatibleLaunchEnvironment(profile, apiKey)
	provider := NewACPProvider(preset)
	provider.claudeSettings = &profile
	return provider
}

func NewCCGLMProvider(stateDir, apiKey string) *acpProvider {
	profile := claudeCompatibleGLMProfile(stateDir)
	preset := ClaudeCompatibleGLMProviderPreset
	preset.Env = claudeCompatibleLaunchEnvironment(profile, apiKey)
	provider := NewACPProvider(preset)
	provider.claudeSettings = &profile
	return provider
}

func NewCCKimiProvider(stateDir, apiKey string) *acpProvider {
	profile := claudeCompatibleKimiProfile(stateDir)
	preset := ClaudeCompatibleKimiProviderPreset
	preset.Env = claudeCompatibleLaunchEnvironment(profile, apiKey)
	provider := NewACPProvider(preset)
	provider.claudeSettings = &profile
	return provider
}

func NewCCQwenProvider(stateDir, apiKey string) *acpProvider {
	profile := claudeCompatibleQwenProfile(stateDir)
	preset := ClaudeCompatibleQwenProviderPreset
	preset.Env = claudeCompatibleLaunchEnvironment(profile, apiKey)
	provider := NewACPProvider(preset)
	provider.claudeSettings = &profile
	return provider
}

func NewCCFlickerProvider(stateDir, apiKey string) *acpProvider {
	profile := claudeCompatibleFlickerProfile(stateDir)
	preset := ClaudeCompatibleFlickerProviderPreset
	preset.Env = claudeCompatibleLaunchEnvironment(profile, apiKey)
	provider := NewACPProvider(preset)
	provider.claudeSettings = &profile
	return provider
}

func (p *acpProvider) Name() string { return p.preset.Name }

func (p *acpProvider) Launch() (string, []string, []string, error) {
	defaultArgs := cloneArgs(p.preset.Args)
	defaultEnv := cloneArgs(p.preset.Env)

	exePath, err := p.resolveBinary(p.preset.BinaryName, "", p.preset.InstallHint)
	if err != nil {
		if p.preset.MissingPathErrTemplate != "" {
			return "", nil, nil, fmt.Errorf(p.preset.MissingPathErrTemplate, err)
		}
		return "", nil, nil, fmt.Errorf("%s: resolve binary: %w", p.preset.Name, err)
	}
	if p.preset.Name == FlickerACPProviderPreset.Name {
		return p.launchFlicker(exePath)
	}
	if p.claudeSettings != nil {
		if err := ensureClaudeCompatibleSkills(p.claudeSettings.configDir); err != nil {
			return "", nil, nil, fmt.Errorf("%s: prepare Claude skills: %w", p.preset.Name, err)
		}
		if err := ensureClaudeCompatibleSettings(*p.claudeSettings); err != nil {
			return "", nil, nil, fmt.Errorf("%s: prepare Claude settings: %w", p.preset.Name, err)
		}
	}
	return exePath, defaultArgs, defaultEnv, nil
}

// gatewayModelDiscoveryEnv toggles Claude Code CLI's gateway model discovery,
// which pulls the endpoint's /v1/models catalog (with full per-model
// capabilities, including effort) instead of the static availableModels list.
const gatewayModelDiscoveryEnv = "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY"

type claudeCompatibleProfile struct {
	configDir       string
	endpoint        string
	authName        string
	defaultModel    string
	availableModels []string
	// gatewayDiscovery selects CLI gateway model discovery instead of the
	// availableModels allowlist. Discovery lets non-Claude models inherit their
	// upstream effort/reasoning capabilities (the allowlist path strips them),
	// at the cost of surfacing the bridge's full dynamic catalog in the picker.
	gatewayDiscovery bool
	// staticModels, when set, is written to settings["models"] as an object
	// array (id + name) so gateway-discovered non-Claude ids survive the CLI's
	// "claude" prefix filter and appear in the model picker. Distinct from
	// availableModels (an allowlist that strips effort capability); used
	// together with gatewayDiscovery.
	staticModels []claudeModelEntry
	settingsEnv  map[string]string
}

// claudeModelEntry is one entry of the settings["models"] object array.
type claudeModelEntry struct {
	ID   string
	Name string
}

var claudeCompatibleConfigMu sync.Mutex

func claudeCompatibleLaunchEnvironment(profile claudeCompatibleProfile, apiKey string) []string {
	otherAuthName := "ANTHROPIC_API_KEY"
	if profile.authName == otherAuthName {
		otherAuthName = "ANTHROPIC_AUTH_TOKEN"
	}
	return []string{
		"CLAUDE_CONFIG_DIR=" + profile.configDir,
		"ANTHROPIC_BASE_URL=" + profile.endpoint,
		otherAuthName + "=",
		"CLAUDE_CODE_USE_BEDROCK=",
		"CLAUDE_CODE_USE_VERTEX=",
		"CLAUDE_CODE_USE_FOUNDRY=",
		profile.authName + "=" + apiKey,
	}
}

func claudeCompatibleKimiProfile(stateDir string) claudeCompatibleProfile {
	return claudeCompatibleProfile{
		configDir:       filepath.Join(stateDir, ".data", ClaudeCompatibleKimiProviderPreset.Name),
		endpoint:        "https://api.kimi.com/coding/",
		authName:        "ANTHROPIC_API_KEY",
		defaultModel:    "k3[1m]",
		availableModels: []string{"k3[1m]"},
		settingsEnv: map[string]string{
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
	}
}

func claudeCompatibleDeepSeekProfile(stateDir string) claudeCompatibleProfile {
	return claudeCompatibleProfile{
		configDir:       filepath.Join(stateDir, ".data", ClaudeCompatibleDeepSeekProviderPreset.Name),
		endpoint:        "https://api.deepseek.com/anthropic",
		authName:        "ANTHROPIC_AUTH_TOKEN",
		defaultModel:    "deepseek-v4-pro[1m]",
		availableModels: []string{"deepseek-v4-pro[1m]", "deepseek-v4-flash"},
		settingsEnv: map[string]string{
			"ANTHROPIC_DEFAULT_OPUS_MODEL":             "deepseek-v4-pro[1m]",
			"ANTHROPIC_DEFAULT_SONNET_MODEL":           "deepseek-v4-pro[1m]",
			"ANTHROPIC_DEFAULT_HAIKU_MODEL":            "deepseek-v4-flash",
			"CLAUDE_CODE_SUBAGENT_MODEL":               "deepseek-v4-flash",
			"CLAUDE_CODE_EFFORT_LEVEL":                 "max",
			"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
		},
	}
}

func claudeCompatibleGLMProfile(stateDir string) claudeCompatibleProfile {
	return claudeCompatibleProfile{
		configDir:       filepath.Join(stateDir, ".data", ClaudeCompatibleGLMProviderPreset.Name),
		endpoint:        "https://api.z.ai/api/anthropic",
		authName:        "ANTHROPIC_AUTH_TOKEN",
		defaultModel:    "glm-5.2[1m]",
		availableModels: []string{"glm-5.2[1m]", "glm-5-turbo", "glm-5v-turbo", "glm-5.1", "glm-4.7", "glm-4.5-air"},
		settingsEnv: map[string]string{
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
	}
}

func claudeCompatibleQwenProfile(stateDir string) claudeCompatibleProfile {
	return claudeCompatibleProfile{
		configDir:       filepath.Join(stateDir, ".data", ClaudeCompatibleQwenProviderPreset.Name),
		endpoint:        "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
		authName:        "ANTHROPIC_AUTH_TOKEN",
		defaultModel:    "qwen3.8-max-preview",
		availableModels: []string{"qwen3.8-max-preview", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-flash", "glm-5.2", "deepseek-v4-pro"},
		settingsEnv: map[string]string{
			"ANTHROPIC_DEFAULT_FABLE_MODEL":       "qwen3.8-max-preview",
			"ANTHROPIC_DEFAULT_FABLE_MODEL_NAME":  "Qwen3.8 Max Preview",
			"ANTHROPIC_DEFAULT_OPUS_MODEL":        "qwen3.8-max-preview",
			"ANTHROPIC_DEFAULT_OPUS_MODEL_NAME":   "Qwen3.8 Max Preview",
			"ANTHROPIC_DEFAULT_SONNET_MODEL":      "qwen3.8-max-preview",
			"ANTHROPIC_DEFAULT_SONNET_MODEL_NAME": "Qwen3.8 Max Preview",
			"ANTHROPIC_DEFAULT_HAIKU_MODEL":       "deepseek-v4-pro",
			"ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME":  "DeepSeek V4 Pro",
			"CLAUDE_CODE_SUBAGENT_MODEL":          "qwen3.8-max-preview",
			"CLAUDE_CODE_MAX_CONTEXT_TOKENS":      "983616",
		},
	}
}

// flickerExposedModels returns the flicker bridge's discovery-visible model
// catalog (id + display name). It prefers the running bridge's live /v1/models
// (which reflects the current upstream catalog) and falls back to the built-in
// exposed list when the endpoint is unreachable. The result is written into the
// Claude settings["models"] array so gateway-discovered non-Claude ids survive
// the CLI's "claude" prefix filter.
func flickerExposedModels() []claudeModelEntry {
	if models := fetchFlickerModelsFromBridge(flickerACPModelsEndpoint); len(models) > 0 {
		return models
	}
	builtin := flickerbridge.BuiltinExposedModels()
	models := make([]claudeModelEntry, 0, len(builtin))
	for _, model := range builtin {
		models = append(models, claudeModelEntry{ID: model.ID, Name: model.Name})
	}
	return models
}

// flickerACPModelsEndpoint is the managed bridge's OpenAI-compatible model list.
const flickerACPModelsEndpoint = "http://127.0.0.1:17999/v1/models"

func fetchFlickerModelsFromBridge(endpoint string) []claudeModelEntry {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil
	}
	var payload struct {
		Data []struct {
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil
	}
	models := make([]claudeModelEntry, 0, len(payload.Data))
	for _, model := range payload.Data {
		if model.ID == "" {
			continue
		}
		name := model.DisplayName
		if name == "" {
			name = model.ID
		}
		models = append(models, claudeModelEntry{ID: model.ID, Name: name})
	}
	return models
}

func claudeCompatibleFlickerProfile(stateDir string) claudeCompatibleProfile {
	return claudeCompatibleProfile{
		configDir:        filepath.Join(stateDir, ".data", ClaudeCompatibleFlickerProviderPreset.Name),
		endpoint:         "http://127.0.0.1:17999",
		authName:         "ANTHROPIC_AUTH_TOKEN",
		defaultModel:     "CLAUDE_OPUS_4_8",
		gatewayDiscovery: true,
		staticModels:     flickerExposedModels(),
		settingsEnv: map[string]string{
			"ANTHROPIC_DEFAULT_FABLE_MODEL":  "CLAUDE_OPUS_4_8",
			"ANTHROPIC_DEFAULT_OPUS_MODEL":   "CLAUDE_OPUS_4_8",
			"ANTHROPIC_DEFAULT_SONNET_MODEL": "CLAUDE_4_6",
			"ANTHROPIC_DEFAULT_HAIKU_MODEL":  "CLAUDE_4_6",
			"CLAUDE_CODE_SUBAGENT_MODEL":     "CLAUDE_4_6",
		},
	}
}

func ensureClaudeCompatibleSettings(profile claudeCompatibleProfile) error {
	claudeCompatibleConfigMu.Lock()
	defer claudeCompatibleConfigMu.Unlock()

	settingsPath := filepath.Join(profile.configDir, "settings.json")
	existing, err := os.ReadFile(settingsPath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read %s: %w", settingsPath, err)
	}
	settings := make(map[string]any)
	if len(existing) > 0 {
		if err := json.Unmarshal(existing, &settings); err != nil {
			return fmt.Errorf("decode %s: %w", settingsPath, err)
		}
		if settings == nil {
			return fmt.Errorf("decode %s: expected JSON object", settingsPath)
		}
	}

	env := make(map[string]any)
	if rawEnv, exists := settings["env"]; exists {
		var ok bool
		env, ok = rawEnv.(map[string]any)
		if !ok {
			return fmt.Errorf("decode %s: env must be a JSON object", settingsPath)
		}
	}
	removeClaudeCompatibleManagedEnv(env)
	for name, value := range profile.settingsEnv {
		env[name] = value
	}
	settings["model"] = profile.defaultModel
	if profile.gatewayDiscovery {
		// Gateway model discovery is mutually exclusive with the allowlist:
		// enforceAvailableModels re-filters discovered models and strips their
		// effort capability. Drop any stale allowlist keys from a prior launch
		// and let the CLI pull the bridge's dynamic catalog instead.
		delete(settings, "availableModels")
		delete(settings, "enforceAvailableModels")
		env[gatewayModelDiscoveryEnv] = "1"
		// A static models object array (id + name) makes gateway-discovered
		// non-Claude ids survive the CLI's "claude" prefix filter so they show
		// up in the picker. Unlike availableModels this does not strip effort.
		if len(profile.staticModels) > 0 {
			models := make([]any, 0, len(profile.staticModels))
			for _, model := range profile.staticModels {
				models = append(models, map[string]any{"id": model.ID, "name": model.Name})
			}
			settings["models"] = models
		} else {
			delete(settings, "models")
		}
	} else {
		settings["availableModels"] = append([]string(nil), profile.availableModels...)
		settings["enforceAvailableModels"] = true
	}
	settings["env"] = env

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return fmt.Errorf("encode %s: %w", settingsPath, err)
	}
	data = append(data, '\n')
	if bytes.Equal(existing, data) {
		return shared.SecureConfigFile(settingsPath)
	}
	if err := shared.WriteConfigFile(settingsPath, data); err != nil {
		return fmt.Errorf("write %s: %w", settingsPath, err)
	}
	return nil
}

func ensureClaudeCompatibleSkills(configDir string) error {
	claudeCompatibleConfigMu.Lock()
	defer claudeCompatibleConfigMu.Unlock()

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("resolve user home: %w", err)
	}
	nativeSkillsDir := filepath.Join(homeDir, ".claude", "skills")
	if err := os.MkdirAll(nativeSkillsDir, 0o755); err != nil {
		return fmt.Errorf("prepare native Claude skills directory %s: %w", nativeSkillsDir, err)
	}
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return fmt.Errorf("prepare Claude config directory %s: %w", configDir, err)
	}

	sharedSkillsDir := filepath.Join(configDir, "skills")
	info, err := os.Lstat(sharedSkillsDir)
	if os.IsNotExist(err) {
		return createDirectoryLink(nativeSkillsDir, sharedSkillsDir)
	}
	if err != nil {
		return fmt.Errorf("inspect Claude-compatible skills path %s: %w", sharedSkillsDir, err)
	}
	if linkTarget, linkErr := os.Readlink(sharedSkillsDir); linkErr == nil {
		if !filepath.IsAbs(linkTarget) {
			linkTarget = filepath.Join(filepath.Dir(sharedSkillsDir), linkTarget)
		}
		resolved, err := filepath.EvalSymlinks(linkTarget)
		if err != nil {
			return fmt.Errorf("resolve Claude-compatible skills link target %s: %w", linkTarget, err)
		}
		nativeResolved, err := filepath.EvalSymlinks(nativeSkillsDir)
		if err != nil {
			return fmt.Errorf("resolve native Claude skills directory %s: %w", nativeSkillsDir, err)
		}
		if samePath(resolved, nativeResolved) {
			return nil
		}
		return fmt.Errorf("Claude-compatible skills path %s links to %s, want %s", sharedSkillsDir, resolved, nativeResolved)
	}
	if !info.IsDir() {
		return fmt.Errorf("Claude-compatible skills path %s exists and is not a directory link", sharedSkillsDir)
	}

	entries, err := os.ReadDir(sharedSkillsDir)
	if err != nil {
		return fmt.Errorf("read Claude-compatible skills directory %s: %w", sharedSkillsDir, err)
	}
	if len(entries) != 0 {
		return fmt.Errorf("Claude-compatible skills directory %s is not empty; preserve its contents and link it manually", sharedSkillsDir)
	}
	if err := os.Remove(sharedSkillsDir); err != nil {
		return fmt.Errorf("remove empty Claude-compatible skills directory %s: %w", sharedSkillsDir, err)
	}
	if err := createDirectoryLink(nativeSkillsDir, sharedSkillsDir); err != nil {
		_ = os.MkdirAll(sharedSkillsDir, 0o755)
		return err
	}
	return nil
}

func samePath(left, right string) bool {
	leftAbs, leftErr := filepath.Abs(left)
	rightAbs, rightErr := filepath.Abs(right)
	if leftErr != nil || rightErr != nil {
		return false
	}
	if runtime.GOOS == "windows" {
		return strings.EqualFold(filepath.Clean(leftAbs), filepath.Clean(rightAbs))
	}
	return filepath.Clean(leftAbs) == filepath.Clean(rightAbs)
}

func removeClaudeCompatibleManagedEnv(env map[string]any) {
	for name := range env {
		if strings.HasPrefix(name, "ANTHROPIC_DEFAULT_FABLE_MODEL") ||
			strings.HasPrefix(name, "ANTHROPIC_DEFAULT_OPUS_MODEL") ||
			strings.HasPrefix(name, "ANTHROPIC_DEFAULT_SONNET_MODEL") ||
			strings.HasPrefix(name, "ANTHROPIC_DEFAULT_HAIKU_MODEL") {
			delete(env, name)
		}
	}
	for _, name := range []string{
		"ANTHROPIC_MODEL",
		"CLAUDE_MODEL_CONFIG",
		"CLAUDE_CODE_SUBAGENT_MODEL",
		"CLAUDE_CODE_EFFORT_LEVEL",
		"CLAUDE_CODE_AUTO_COMPACT_WINDOW",
		"CLAUDE_CODE_MAX_CONTEXT_TOKENS",
		gatewayModelDiscoveryEnv,
	} {
		delete(env, name)
	}
}

func (p *acpProvider) launchFlicker(myflickerPath string) (string, []string, []string, error) {
	nodePath, err := p.lookPath("node")
	if err != nil {
		return "", nil, nil, fmt.Errorf("flicker: node binary not found: %w", err)
	}
	cliPath, err := resolveFlickerCLIEntry(myflickerPath)
	if err != nil {
		return "", nil, nil, err
	}
	loaderPath, err := p.ensureFlickerLoader()
	if err != nil {
		return "", nil, nil, fmt.Errorf("flicker: prepare ACP loader: %w", err)
	}
	loaderURL, err := nodeFileURL(loaderPath)
	if err != nil {
		return "", nil, nil, fmt.Errorf("flicker: resolve ACP loader URL: %w", err)
	}
	return nodePath, []string{
		"--import", nodeRegisterImportArg(loaderURL),
		cliPath,
		"--approval-mode", "yolo",
		"--thinking-level", "xhigh",
		"acp",
	}, nil, nil
}

func cloneArgs(args []string) []string {
	if len(args) == 0 {
		return nil
	}
	return append([]string(nil), args...)
}

func resolveFlickerCLIEntry(binaryPath string) (string, error) {
	ext := strings.ToLower(filepath.Ext(binaryPath))
	if ext == ".mjs" || ext == ".js" {
		if exists(binaryPath) {
			return binaryPath, nil
		}
		return "", fmt.Errorf("flicker: CLI entry not found at %s", binaryPath)
	}
	binDir := filepath.Dir(binaryPath)
	candidates := []string{
		filepath.Join(binDir, "node_modules", "@myflicker", "cli", "cli.mjs"),
		filepath.Join(binDir, "..", "lib", "node_modules", "@myflicker", "cli", "cli.mjs"),
		filepath.Join(binDir, "..", "node_modules", "@myflicker", "cli", "cli.mjs"),
	}
	for _, candidate := range candidates {
		if exists(candidate) {
			abs, err := filepath.Abs(candidate)
			if err != nil {
				return "", fmt.Errorf("flicker: abs CLI path %q: %w", candidate, err)
			}
			return abs, nil
		}
	}
	return "", fmt.Errorf("flicker: could not locate @myflicker/cli/cli.mjs next to %s", binaryPath)
}

func ensureFlickerACPLoader() (string, error) {
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			return "", err
		}
		cacheDir = filepath.Join(home, ".wheelmaker", "cache")
	}
	dir := filepath.Join(cacheDir, "wheelmaker")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "flicker_acp_loader.mjs")
	if err := os.WriteFile(path, []byte(flickerACPLoaderSource), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func nodeFileURL(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	slashPath := filepath.ToSlash(abs)
	if runtime.GOOS == "windows" && !strings.HasPrefix(slashPath, "/") {
		slashPath = "/" + slashPath
	}
	return (&url.URL{Scheme: "file", Path: slashPath}).String(), nil
}

func nodeRegisterImportArg(loaderURL string) string {
	script := fmt.Sprintf(
		`import { register } from "node:module"; import { pathToFileURL } from "node:url"; register(%q, pathToFileURL("./"));`,
		loaderURL,
	)
	return "data:text/javascript;base64," + base64.StdEncoding.EncodeToString([]byte(script))
}

// ResolveACPBinary locates an ACP executable in this order:
//  1. configuredPath if non-empty and exists
//  2. PATH
//  3. bin/{GOOS}_{GOARCH}/ next to the running executable
//  4. bin/{GOOS}_{GOARCH}/ relative to current working directory
func ResolveACPBinary(name, configuredPath, installHint string) (string, error) {
	if configuredPath != "" {
		if exists(configuredPath) {
			abs, err := filepath.Abs(configuredPath)
			if err != nil {
				return "", fmt.Errorf("agent: abs path %q: %w", configuredPath, err)
			}
			return abs, nil
		}
	}

	path, err := exec.LookPath(name)
	if err == nil {
		return path, nil
	}

	if exeDir, dirErr := executableDir(); dirErr == nil {
		for _, binName := range binaryNames(name) {
			candidate := filepath.Join(exeDir, "bin", platformDir(), binName)
			if exists(candidate) {
				return candidate, nil
			}
		}
	}

	for _, binName := range binaryNames(name) {
		candidate := filepath.Join("bin", platformDir(), binName)
		if exists(candidate) {
			abs, absErr := filepath.Abs(candidate)
			if absErr == nil {
				return abs, nil
			}
		}
	}

	if installHint != "" {
		return "", fmt.Errorf(
			"agent: %q not found (tried configured path, PATH, and bin/%s/); install with: npm install -g %s",
			name, platformDir(), installHint,
		)
	}
	return "", fmt.Errorf(
		"agent: %q not found (tried configured path, PATH, and bin/%s/); install the %s CLI",
		name, platformDir(), name,
	)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func platformDir() string {
	return runtime.GOOS + "_" + runtime.GOARCH
}

func binaryNames(name string) []string {
	if runtime.GOOS == "windows" {
		return []string{name + ".exe", name + ".cmd"}
	}
	return []string{name}
}

func executableDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Dir(exe), nil
}
