package cxflicker

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

func TestMaterializeWritesValidatedResponsesCatalog(t *testing.T) {
	homeDir := t.TempDir()
	models := []Model{{
		ID:                        "deepseek-v4-flash-0731",
		Name:                      "DeepSeek-V4-Flash 0731",
		APIFormat:                 "openai",
		EffortLevels:              []string{"low", "high"},
		DefaultEffort:             "high",
		InputModalities:           []string{"text", "image"},
		ContextWindow:             1048576,
		MaxContextWindow:          1048576,
		SupportsTools:             true,
		SupportsParallelToolCalls: true,
	}}

	path, err := Materialize(homeDir, models)
	if err != nil {
		t.Fatal(err)
	}
	if path != filepath.Join(homeDir, CatalogFileName) {
		t.Fatalf("catalog path = %q, want under CODEX_HOME", path)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("catalog permissions = %o, want 600", info.Mode().Perm())
	}

	var document catalogDocument
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	if len(document.Models) != 1 || document.Models[0].Slug != "deepseek-v4-flash-0731" {
		t.Fatalf("catalog models = %#v", document.Models)
	}
	model := document.Models[0]
	if !reflect.DeepEqual(model.InputModalities, []string{"text", "image"}) || model.DefaultReasoningLevel != "high" {
		t.Fatalf("catalog capabilities = %#v", model)
	}
	if model.Description == "" || model.ShellType == "" || model.Visibility == "" ||
		model.ReasoningSummaryFormat == "" || model.ModelMessages["instructions_variables"] == nil {
		t.Fatalf("catalog compatibility fields = %#v", model)
	}
	for _, level := range model.SupportedReasoningLevels {
		if level.Description == "" {
			t.Fatalf("reasoning level missing description: %#v", model.SupportedReasoningLevels)
		}
	}
	if !model.SupportedInAPI || !model.SupportsParallelToolCalls || !model.SupportsSearchTool {
		t.Fatalf("catalog tool/API flags = %#v", model)
	}
	if _, err := Materialize(homeDir, models); err != nil {
		t.Fatalf("second materialize: %v", err)
	}
}

func TestMaterializeRejectsModelsThatCannotUseResponses(t *testing.T) {
	for name, models := range map[string][]Model{
		"empty":     nil,
		"anthropic": {{ID: "claude", APIFormat: "anthropic"}},
		"audio":     {{ID: "deepseek", APIFormat: "openai", InputModalities: []string{"text", "audio"}}},
		"file":      {{ID: "deepseek", APIFormat: "openai", InputModalities: []string{"text", "file"}}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := Materialize(t.TempDir(), models); err == nil {
				t.Fatal("Materialize returned nil error for invalid catalog")
			}
		})
	}
}
