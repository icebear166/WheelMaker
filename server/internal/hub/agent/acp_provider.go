package agent

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
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
	preset ACPProviderPreset

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

func NewCCGLMProvider(stateDir, apiKey string) *acpProvider {
	preset := ClaudeCompatibleGLMProviderPreset
	preset.Env = claudeCompatibleGLMEnvironment(stateDir, apiKey)
	return NewACPProvider(preset)
}

func NewCCKimiProvider(stateDir, apiKey string) *acpProvider {
	preset := ClaudeCompatibleKimiProviderPreset
	preset.Env = claudeCompatibleKimiEnvironment(stateDir, apiKey)
	return NewACPProvider(preset)
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
	return exePath, defaultArgs, defaultEnv, nil
}

type claudeModelConfig struct {
	AvailableModels []string `json:"availableModels"`
}

func claudeModelConfigJSON(models []string) string {
	data, _ := json.Marshal(claudeModelConfig{AvailableModels: models})
	return string(data)
}

func claudeCompatibleEnvironment(
	stateDir, providerName, endpoint, authName, apiKey, defaultModel, haikuModel string,
	autoCompactWindow, maxContextTokens string, models []string,
	extra ...string,
) []string {
	env := []string{
		"CLAUDE_CONFIG_DIR=" + filepath.Join(stateDir, ".data", providerName),
		"ANTHROPIC_BASE_URL=" + endpoint,
		authName + "=" + apiKey,
		"ANTHROPIC_MODEL=" + defaultModel,
		"ANTHROPIC_DEFAULT_FABLE_MODEL=" + defaultModel,
		"ANTHROPIC_DEFAULT_OPUS_MODEL=" + defaultModel,
		"ANTHROPIC_DEFAULT_SONNET_MODEL=" + defaultModel,
		"ANTHROPIC_DEFAULT_HAIKU_MODEL=" + haikuModel,
		"CLAUDE_CODE_SUBAGENT_MODEL=" + defaultModel,
		"CLAUDE_CODE_AUTO_COMPACT_WINDOW=" + autoCompactWindow,
		"CLAUDE_CODE_MAX_CONTEXT_TOKENS=" + maxContextTokens,
		"CLAUDE_MODEL_CONFIG=" + claudeModelConfigJSON(models),
	}
	return append(env, extra...)
}

func claudeCompatibleKimiEnvironment(stateDir, apiKey string) []string {
	env := claudeCompatibleEnvironment(
		stateDir,
		ClaudeCompatibleKimiProviderPreset.Name,
		"https://api.kimi.com/coding/",
		"ANTHROPIC_API_KEY",
		apiKey,
		"k3[1m]",
		"k3[1m]",
		"1048576",
		"1048576",
		[]string{"k3[1m]", "k3", "kimi-for-coding", "kimi-for-coding-highspeed"},
	)
	return append(env, "CLAUDE_CODE_EFFORT_LEVEL=high")
}

func claudeCompatibleGLMEnvironment(stateDir, apiKey string) []string {
	return claudeCompatibleEnvironment(
		stateDir,
		ClaudeCompatibleGLMProviderPreset.Name,
		"https://api.z.ai/api/anthropic",
		"ANTHROPIC_AUTH_TOKEN",
		apiKey,
		"glm-5.2[1m]",
		"glm-4.5-air",
		"1000000",
		"1000000",
		[]string{"glm-5.2[1m]", "glm-5.2", "glm-4.7", "glm-4.5-air"},
		"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
		"API_TIMEOUT_MS=3000000",
	)
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
