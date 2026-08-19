package agent

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/swm8023/wheelmaker/internal/hub/agent/cxflicker"
	"github.com/swm8023/wheelmaker/internal/hubconfig"
	"github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	cxFlickerAPIKeyEnv = "MYFLICKER_WANQING_PROXY_KEY"
	cxFlickerBaseURL   = "http://127.0.0.1:17999/"
)

func NewCXFlickerProvider(stateDir, apiKey string, store *FlickerModelStore) *codexAppProvider {
	return NewCXFlickerProviderWithMCP(stateDir, apiKey, store, nil)
}

func NewCXFlickerProviderWithMCP(stateDir, apiKey string, store *FlickerModelStore, servers []hubconfig.MCPServerConfig) *codexAppProvider {
	homeDir, homeErr := cxFlickerHomeDir(stateDir)
	provider := newCodexAppProvider(codexAppProviderOptions{
		Provider:       protocol.ACPProviderCXFlicker,
		Title:          "Flicker Codex",
		AllowImages:    true,
		CodexHome:      homeDir,
		SessionMapPath: filepath.Join(homeDir, "wheelmaker-sessions.json"),
		Environment: []string{
			"CODEX_HOME=" + homeDir,
			cxFlickerAPIKeyEnv + "=" + strings.TrimSpace(apiKey),
		},
		MCPServers: cloneMCPServerConfigs(servers),
	})
	provider.configurationErr = homeErr
	provider.minimumVersion = cxflicker.MinimumCodexVersion
	provider.versionOutput = codexVersionOutput
	provider.materializeCatalog = func(home string) (string, error) {
		if store == nil {
			return "", errors.New("cx-flicker model catalog is unavailable")
		}
		models := store.CXFlickerModels()
		if !hasCXFlickerModel(models, cxflicker.ModelID) {
			return "", fmt.Errorf("cx-flicker model catalog does not contain %q", cxflicker.ModelID)
		}
		return cxflicker.Materialize(home, models)
	}
	provider.configArgs = cxFlickerConfigArgs
	return provider
}

func hasCXFlickerModel(models []cxflicker.Model, modelID string) bool {
	for _, model := range models {
		if strings.EqualFold(strings.TrimSpace(model.ID), strings.TrimSpace(modelID)) {
			return true
		}
	}
	return false
}

func cxFlickerHomeDir(stateDir string) (string, error) {
	stateDir = strings.TrimSpace(stateDir)
	if stateDir == "" {
		return "", errors.New("cx-flicker state directory is required")
	}
	homeDir, err := filepath.Abs(filepath.Join(stateDir, ".data", string(protocol.ACPProviderCXFlicker)))
	if err != nil {
		return "", fmt.Errorf("resolve cx-flicker CODEX_HOME: %w", err)
	}
	return homeDir, nil
}

func cxFlickerConfigArgs(catalogPath string) []string {
	return []string{
		"-c", tomlStringOverride("model", cxflicker.ModelID),
		"-c", tomlStringOverride("model_provider", "flicker"),
		"-c", tomlStringOverride("model_reasoning_effort", "high"),
		"-c", tomlStringOverride("model_catalog_json", catalogPath),
		"-c", tomlStringOverride("model_providers.flicker.name", "flicker"),
		"-c", tomlStringOverride("model_providers.flicker.base_url", cxFlickerBaseURL),
		"-c", tomlStringOverride("model_providers.flicker.wire_api", "responses"),
		"-c", tomlStringOverride("model_providers.flicker.env_key", cxFlickerAPIKeyEnv),
		"-c", "model_providers.flicker.requires_openai_auth=false",
		"-c", "model_providers.flicker.supports_websockets=false",
	}
}
