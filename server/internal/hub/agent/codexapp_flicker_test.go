package agent

import (
	"slices"
	"strings"
	"testing"

	"github.com/swm8023/wheelmaker/internal/protocol"
)

func TestCXFlickerProviderLaunchUsesV2ResponsesBridge(t *testing.T) {
	stateDir := t.TempDir()
	store := &FlickerModelStore{models: []claudeModelEntry{{
		ID:                        "deepseek-v4-flash-0731",
		Name:                      "DeepSeek-V4-Flash 0731",
		APIFormat:                 "openai",
		EffortLevels:              []string{"low", "high"},
		DefaultEffort:             "high",
		InputModalities:           []string{"text"},
		ContextWindow:             1048576,
		MaxContextWindow:          1048576,
		SupportsTools:             true,
		SupportsParallelToolCalls: true,
	}}}
	provider := NewCXFlickerProvider(stateDir, "bridge-key", store)
	provider.lookPath = func(string) (string, error) { return `C:\bin\codex.exe`, nil }
	provider.versionOutput = func(string) ([]byte, error) { return []byte("codex-cli 0.147.0\n"), nil }

	exe, args, env, err := provider.Launch()
	if err != nil {
		t.Fatal(err)
	}
	if exe != `C:\bin\codex.exe` || provider.Name() != string(protocol.ACPProviderCXFlicker) {
		t.Fatalf("provider launch = (%q, %q), name=%q", exe, args, provider.Name())
	}
	for _, expected := range []string{
		`model="deepseek-v4-flash-0731"`,
		`model_provider="flicker"`,
		`model_reasoning_effort="high"`,
		`model_providers.flicker.base_url="http://127.0.0.1:17999/"`,
		`model_providers.flicker.wire_api="responses"`,
		`model_providers.flicker.env_key="MYFLICKER_WANQING_PROXY_KEY"`,
		`model_providers.flicker.requires_openai_auth=false`,
		`model_providers.flicker.supports_websockets=false`,
	} {
		if !slices.Contains(args, "-c") || !slices.Contains(args, expected) {
			t.Fatalf("args = %v, missing %q", args, expected)
		}
	}
	if !anyArgHasPrefix(args, `model_catalog_json="`) {
		t.Fatalf("args = %v, missing model catalog path", args)
	}
	if !slices.Contains(env, "MYFLICKER_WANQING_PROXY_KEY=bridge-key") {
		t.Fatalf("env = %v, missing bridge key", env)
	}
	if profile := provider.connectionProfile(); profile.AllowImages {
		t.Fatal("cx-flicker unexpectedly allows images for the text-only DeepSeek catalog")
	}
}

func anyArgHasPrefix(args []string, prefix string) bool {
	for _, arg := range args {
		if strings.HasPrefix(arg, prefix) {
			return true
		}
	}
	return false
}

func TestConfiguredACPFactoryRegistersCXFlickerWithBridgeKey(t *testing.T) {
	factory := newACPFactoryWithOptions(ACPFactoryOptions{
		StateDir:      t.TempDir(),
		FlickerAPIKey: "bridge-key",
		FlickerModelStore: &FlickerModelStore{models: []claudeModelEntry{{
			ID: "deepseek-v4-flash-0731", APIFormat: "openai", EffortLevels: []string{"high"}, DefaultEffort: "high",
		}}},
	}, func(ACPProvider) bool { return true })
	if factory.Creator(protocol.ACPProviderCXFlicker) == nil {
		t.Fatalf("factory providers = %v, want %q", factory.Names(), protocol.ACPProviderCXFlicker)
	}
}

func TestCXFlickerPresetUsesSharedAgentSkills(t *testing.T) {
	preset, ok := providerPresetByName(string(protocol.ACPProviderCXFlicker))
	if !ok {
		t.Fatal("providerPresetByName(cx-flicker) returned ok=false")
	}
	if preset.Name != string(protocol.ACPProviderCXFlicker) || preset.BinaryName != "codex" {
		t.Fatalf("preset = %#v", preset)
	}
	if !slices.Equal(preset.SkillProjectDirs, []string{".agents/skills"}) ||
		!slices.Equal(preset.SkillUserDirs, []string{"~/.agents/skills"}) {
		t.Fatalf("preset skills = project %v user %v", preset.SkillProjectDirs, preset.SkillUserDirs)
	}
}
