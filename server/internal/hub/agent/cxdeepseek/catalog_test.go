package cxdeepseek

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
)

func TestEmbeddedCatalogContainsOfficialFlashAndPro(t *testing.T) {
	doc, err := validateCatalog(embeddedCatalog)
	if err != nil {
		t.Fatalf("validateCatalog() error = %v", err)
	}
	wantModels := []string{ModelID, "deepseek-v4-pro"}
	if got := catalogModelSlugs(doc); !reflect.DeepEqual(got, wantModels) {
		t.Fatalf("model slugs = %v, want %v", got, wantModels)
	}
	if ModelID != "deepseek-v4-flash" {
		t.Fatalf("default model = %q, want deepseek-v4-flash", ModelID)
	}
	for _, model := range doc.Models {
		if !reflect.DeepEqual(model.InputModalities, []string{"text"}) ||
			model.ApplyPatchToolType != "freeform" ||
			model.WebSearchToolType != "text" ||
			!model.SupportsParallelToolCalls ||
			model.ContextWindow != 1048576 ||
			model.MaxContextWindow != 1048576 ||
			model.DefaultReasoningLevel != "high" ||
			model.MinimalClientVersion != MinimumCodexVersion ||
			!model.SupportedInAPI ||
			!model.SupportsSearchTool {
			t.Fatalf("model capability mismatch: %#v", model)
		}
		wantEfforts := []string{"low", "high", "max"}
		if got := reasoningEfforts(model); !reflect.DeepEqual(got, wantEfforts) {
			t.Fatalf("reasoning efforts for %q = %v, want %v", model.Slug, got, wantEfforts)
		}
		if len(bytes.TrimSpace(model.ModelMessages)) == 0 || bytes.Equal(bytes.TrimSpace(model.ModelMessages), []byte("{}")) {
			t.Fatalf("official model_messages are missing for %q", model.Slug)
		}
		if len(model.BaseInstructions) < 1000 {
			t.Fatalf("official base_instructions for %q are missing or abbreviated: %d bytes", model.Slug, len(model.BaseInstructions))
		}
	}
}

func TestValidateCatalogRejectsUnsupportedDocuments(t *testing.T) {
	tests := []struct {
		name   string
		raw    []byte
		mutate func(map[string]any)
	}{
		{name: "malformed JSON", raw: []byte(`{"models":`)},
		{name: "zero models", mutate: func(doc map[string]any) { doc["models"] = []any{} }},
		{name: "missing Pro", mutate: removeCatalogModel("deepseek-v4-pro")},
		{name: "missing Flash", mutate: removeCatalogModel(ModelID)},
		{name: "unknown slug", mutate: func(doc map[string]any) { catalogModelMap(t, doc, ModelID)["slug"] = "deepseek-v4-unknown" }},
		{name: "duplicate slug", mutate: func(doc map[string]any) { catalogModelMap(t, doc, "deepseek-v4-pro")["slug"] = ModelID }},
		{name: "image input", mutate: func(doc map[string]any) {
			catalogModelMap(t, doc, ModelID)["input_modalities"] = []any{"text", "image"}
		}},
		{name: "missing apply patch", mutate: func(doc map[string]any) { catalogModelMap(t, doc, ModelID)["apply_patch_tool_type"] = "" }},
		{name: "missing web search", mutate: func(doc map[string]any) { catalogModelMap(t, doc, ModelID)["web_search_tool_type"] = "" }},
		{name: "search disabled", mutate: func(doc map[string]any) { catalogModelMap(t, doc, ModelID)["supports_search_tool"] = false }},
		{name: "parallel tools disabled", mutate: func(doc map[string]any) { catalogModelMap(t, doc, ModelID)["supports_parallel_tool_calls"] = false }},
		{name: "wrong context window", mutate: func(doc map[string]any) { catalogModelMap(t, doc, ModelID)["context_window"] = 128000 }},
		{name: "wrong max context window", mutate: func(doc map[string]any) { catalogModelMap(t, doc, ModelID)["max_context_window"] = 128000 }},
		{name: "unsupported in API", mutate: func(doc map[string]any) { catalogModelMap(t, doc, ModelID)["supported_in_api"] = false }},
		{name: "wrong effort set", mutate: func(doc map[string]any) {
			catalogModelMap(t, doc, ModelID)["supported_reasoning_levels"] = []any{map[string]any{"effort": "high"}}
		}},
		{name: "wrong default effort", mutate: func(doc map[string]any) { catalogModelMap(t, doc, ModelID)["default_reasoning_level"] = "low" }},
		{name: "wrong minimum version", mutate: func(doc map[string]any) {
			catalogModelMap(t, doc, "deepseek-v4-pro")["minimal_client_version"] = "0.143.0"
		}},
		{name: "empty model messages", mutate: func(doc map[string]any) { catalogModelMap(t, doc, ModelID)["model_messages"] = map[string]any{} }},
		{name: "empty base instructions", mutate: func(doc map[string]any) { catalogModelMap(t, doc, ModelID)["base_instructions"] = "" }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			raw := test.raw
			if raw == nil {
				raw = catalogVariant(t, test.mutate)
			}
			if _, err := validateCatalog(raw); err == nil {
				t.Fatal("validateCatalog() error = nil, want rejection")
			}
		})
	}
}

func catalogVariant(t *testing.T, mutate func(map[string]any)) []byte {
	t.Helper()
	var doc map[string]any
	if err := json.Unmarshal(embeddedCatalog, &doc); err != nil {
		t.Fatalf("decode embedded catalog fixture: %v", err)
	}
	mutate(doc)
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("encode catalog variant: %v", err)
	}
	return raw
}

func catalogModelMap(t *testing.T, doc map[string]any, slug string) map[string]any {
	t.Helper()
	models, ok := doc["models"].([]any)
	if !ok {
		t.Fatalf("catalog models = %#v", doc["models"])
	}
	for _, raw := range models {
		model, modelOK := raw.(map[string]any)
		if modelOK && model["slug"] == slug {
			return model
		}
	}
	t.Fatalf("catalog model %q not found in %#v", slug, models)
	return nil
}

func removeCatalogModel(slug string) func(map[string]any) {
	return func(doc map[string]any) {
		models, _ := doc["models"].([]any)
		kept := make([]any, 0, len(models))
		for _, raw := range models {
			model, _ := raw.(map[string]any)
			if model["slug"] != slug {
				kept = append(kept, raw)
			}
		}
		doc["models"] = kept
	}
}

func catalogModelSlugs(doc catalogDocument) []string {
	slugs := make([]string, 0, len(doc.Models))
	for _, model := range doc.Models {
		slugs = append(slugs, model.Slug)
	}
	return slugs
}

func TestMaterializePreservesLastValidCatalogWhenRenameFails(t *testing.T) {
	home := t.TempDir()
	path := filepath.Join(home, CatalogFileName)
	old := append(append([]byte(nil), embeddedCatalog...), '\n')
	if err := os.WriteFile(path, old, 0o600); err != nil {
		t.Fatal(err)
	}
	m := newMaterializer(embeddedCatalog)
	m.rename = func(string, string) error { return errors.New("rename failed") }
	if _, err := m.materialize(home); err == nil {
		t.Fatal("materialize() error = nil, want rename failure")
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, old) {
		t.Fatalf("last valid catalog changed: %q", got)
	}
	assertNoTemporaryCatalogs(t, home)
}

func TestMaterializeLeavesNoFinalCatalogWhenFirstRenameFails(t *testing.T) {
	home := t.TempDir()
	m := newMaterializer(embeddedCatalog)
	m.rename = func(string, string) error { return errors.New("rename failed") }
	if _, err := m.materialize(home); err == nil {
		t.Fatal("materialize() error = nil, want rename failure")
	}
	if _, err := os.Stat(filepath.Join(home, CatalogFileName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("final catalog stat error = %v, want not exist", err)
	}
	assertNoTemporaryCatalogs(t, home)
}

func TestMaterializeSerializesConcurrentReplacement(t *testing.T) {
	home := t.TempDir()
	m := newMaterializer(embeddedCatalog)
	rename := m.rename
	var replacements atomic.Int32
	m.rename = func(oldPath, newPath string) error {
		replacements.Add(1)
		return rename(oldPath, newPath)
	}

	const callers = 16
	type result struct {
		path string
		err  error
	}
	results := make(chan result, callers)
	var group sync.WaitGroup
	for range callers {
		group.Add(1)
		go func() {
			defer group.Done()
			path, err := m.materialize(home)
			results <- result{path: path, err: err}
		}()
	}
	group.Wait()
	close(results)

	wantPath, err := filepath.Abs(filepath.Join(home, CatalogFileName))
	if err != nil {
		t.Fatal(err)
	}
	for result := range results {
		if result.err != nil || result.path != wantPath {
			t.Fatalf("materialize result = (%q, %v), want (%q, nil)", result.path, result.err, wantPath)
		}
	}
	if got := replacements.Load(); got != 1 {
		t.Fatalf("catalog replacements = %d, want 1", got)
	}
	raw, err := os.ReadFile(wantPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(raw, embeddedCatalog) {
		t.Fatal("materialized catalog is incomplete")
	}
	assertNoTemporaryCatalogs(t, home)
}

func TestMaterializeRejectsInvalidInputsBeforeWriting(t *testing.T) {
	if _, err := newMaterializer(embeddedCatalog).materialize(" "); err == nil {
		t.Fatal("materialize() error = nil, want missing home rejection")
	}
	home := t.TempDir()
	if _, err := newMaterializer([]byte(`{"models":[]}`)).materialize(home); err == nil {
		t.Fatal("materialize() error = nil, want invalid catalog rejection")
	}
	if _, err := os.Stat(filepath.Join(home, CatalogFileName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("final catalog stat error = %v, want not exist", err)
	}
}

func assertNoTemporaryCatalogs(t *testing.T, home string) {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(home, ".models-*.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("temporary catalogs remain: %v", matches)
	}
}
