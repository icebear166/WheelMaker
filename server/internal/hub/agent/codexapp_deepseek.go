package agent

import (
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/swm8023/wheelmaker/internal/hub/agent/cxdeepseek"
	"github.com/swm8023/wheelmaker/internal/protocol"
)

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

func codexVersionOutput(executable string) ([]byte, error) {
	return exec.Command(executable, "--version").CombinedOutput()
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
	stateDir = strings.TrimSpace(stateDir)
	if stateDir == "" {
		return "", errors.New("cx-deepseek state directory is required")
	}
	homeDir, err := filepath.Abs(filepath.Join(stateDir, ".data", string(protocol.ACPProviderCXDeepSeek)))
	if err != nil {
		return "", fmt.Errorf("resolve cx-deepseek CODEX_HOME: %w", err)
	}
	return homeDir, nil
}

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
