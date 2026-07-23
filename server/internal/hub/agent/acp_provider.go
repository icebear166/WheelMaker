package agent

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

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
	}
	ClaudeCompatibleGLMProviderPreset = ACPProviderPreset{
		Name:                   "cc-glm",
		BinaryName:             "claude-agent-acp",
		Args:                   []string{"--hide-claude-auth"},
		InstallHint:            "@agentclientprotocol/claude-agent-acp",
		SkillProjectDirs:       []string{".claude/skills"},
		SkillProjectParentDirs: []string{".claude/skills"},
	}
	ClaudeCompatibleKimiProviderPreset = ACPProviderPreset{
		Name:                   "cc-kimi",
		BinaryName:             "claude-agent-acp",
		Args:                   []string{"--hide-claude-auth"},
		InstallHint:            "@agentclientprotocol/claude-agent-acp",
		SkillProjectDirs:       []string{".claude/skills"},
		SkillProjectParentDirs: []string{".claude/skills"},
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
		if err := ensureClaudeCompatibleSettings(*p.claudeSettings); err != nil {
			return "", nil, nil, fmt.Errorf("%s: prepare Claude settings: %w", p.preset.Name, err)
		}
	}
	return exePath, defaultArgs, defaultEnv, nil
}

type claudeCompatibleProfile struct {
	configDir       string
	endpoint        string
	authName        string
	defaultModel    string
	availableModels []string
	settingsEnv     map[string]string
}

var claudeCompatibleSettingsMu sync.Mutex

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
		availableModels: []string{"k3[1m]", "k3", "kimi-for-coding", "kimi-for-coding-highspeed"},
		settingsEnv: map[string]string{
			"ANTHROPIC_DEFAULT_FABLE_MODEL":       "k3[1m]",
			"ANTHROPIC_DEFAULT_FABLE_MODEL_NAME":  "Kimi K3 (1M)",
			"ANTHROPIC_DEFAULT_OPUS_MODEL":        "k3",
			"ANTHROPIC_DEFAULT_OPUS_MODEL_NAME":   "Kimi K3 (256K)",
			"ANTHROPIC_DEFAULT_SONNET_MODEL":      "kimi-for-coding",
			"ANTHROPIC_DEFAULT_SONNET_MODEL_NAME": "Kimi for Coding",
			"ANTHROPIC_DEFAULT_HAIKU_MODEL":       "kimi-for-coding-highspeed",
			"ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME":  "Kimi for Coding Highspeed",
			"CLAUDE_CODE_SUBAGENT_MODEL":          "k3[1m]",
		},
	}
}

func claudeCompatibleDeepSeekProfile(stateDir string) claudeCompatibleProfile {
	return claudeCompatibleProfile{
		configDir:       filepath.Join(stateDir, ".data", ClaudeCompatibleDeepSeekProviderPreset.Name),
		endpoint:        "https://api.deepseek.com/anthropic",
		authName:        "ANTHROPIC_AUTH_TOKEN",
		defaultModel:    "deepseek-v4-pro[1m]",
		availableModels: []string{"deepseek-v4-pro[1m]", "deepseek-v4-flash[1m]"},
		settingsEnv: map[string]string{
			"ANTHROPIC_DEFAULT_FABLE_MODEL":            "deepseek-v4-pro[1m]",
			"ANTHROPIC_DEFAULT_FABLE_MODEL_NAME":       "DeepSeek V4 Pro (1M)",
			"ANTHROPIC_DEFAULT_OPUS_MODEL":             "deepseek-v4-pro[1m]",
			"ANTHROPIC_DEFAULT_OPUS_MODEL_NAME":        "DeepSeek V4 Pro (1M)",
			"ANTHROPIC_DEFAULT_SONNET_MODEL":           "deepseek-v4-pro[1m]",
			"ANTHROPIC_DEFAULT_SONNET_MODEL_NAME":      "DeepSeek V4 Pro (1M)",
			"ANTHROPIC_DEFAULT_HAIKU_MODEL":            "deepseek-v4-flash[1m]",
			"ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME":       "DeepSeek V4 Flash (1M)",
			"CLAUDE_CODE_SUBAGENT_MODEL":               "deepseek-v4-flash[1m]",
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
			"CLAUDE_CODE_SUBAGENT_MODEL":               "glm-4.7",
			"CLAUDE_CODE_AUTO_COMPACT_WINDOW":          "1000000",
			"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
			"API_TIMEOUT_MS":                           "3000000",
		},
	}
}

func ensureClaudeCompatibleSettings(profile claudeCompatibleProfile) error {
	claudeCompatibleSettingsMu.Lock()
	defer claudeCompatibleSettingsMu.Unlock()

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
	settings["availableModels"] = append([]string(nil), profile.availableModels...)
	settings["enforceAvailableModels"] = true
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
