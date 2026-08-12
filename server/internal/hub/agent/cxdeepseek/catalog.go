package cxdeepseek

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
)

const (
	ModelID             = "deepseek-v4-flash"
	proModelID          = "deepseek-v4-pro"
	MinimumCodexVersion = "0.144.0"
	CatalogFileName     = "models.json"
)

//go:embed models.json
var embeddedCatalog []byte

type reasoningLevel struct {
	Effort string `json:"effort"`
}

type catalogModel struct {
	Slug                      string           `json:"slug"`
	ApplyPatchToolType        string           `json:"apply_patch_tool_type"`
	WebSearchToolType         string           `json:"web_search_tool_type"`
	InputModalities           []string         `json:"input_modalities"`
	SupportsParallelToolCalls bool             `json:"supports_parallel_tool_calls"`
	ContextWindow             int              `json:"context_window"`
	MaxContextWindow          int              `json:"max_context_window"`
	DefaultReasoningLevel     string           `json:"default_reasoning_level"`
	SupportedReasoningLevels  []reasoningLevel `json:"supported_reasoning_levels"`
	MinimalClientVersion      string           `json:"minimal_client_version"`
	SupportedInAPI            bool             `json:"supported_in_api"`
	SupportsSearchTool        bool             `json:"supports_search_tool"`
	ModelMessages             json.RawMessage  `json:"model_messages"`
	BaseInstructions          string           `json:"base_instructions"`
}

type catalogDocument struct {
	Models []catalogModel `json:"models"`
}

func validateCatalog(raw []byte) (catalogDocument, error) {
	var doc catalogDocument
	if err := json.Unmarshal(raw, &doc); err != nil {
		return doc, fmt.Errorf("decode DeepSeek Codex catalog: %w", err)
	}
	if len(doc.Models) != 2 {
		return doc, fmt.Errorf("DeepSeek Codex catalog must contain exactly two models")
	}
	seen := make(map[string]struct{}, len(doc.Models))
	for _, model := range doc.Models {
		switch model.Slug {
		case ModelID, proModelID:
		default:
			return doc, fmt.Errorf("DeepSeek Codex catalog contains unsupported model %q", model.Slug)
		}
		if _, duplicate := seen[model.Slug]; duplicate {
			return doc, fmt.Errorf("DeepSeek Codex catalog contains duplicate model %q", model.Slug)
		}
		seen[model.Slug] = struct{}{}
		if !reflect.DeepEqual(model.InputModalities, []string{"text"}) {
			return doc, fmt.Errorf("DeepSeek Codex catalog model %q has unsupported input modalities", model.Slug)
		}
		if model.ApplyPatchToolType != "freeform" || model.WebSearchToolType != "text" || !model.SupportsSearchTool || !model.SupportsParallelToolCalls {
			return doc, fmt.Errorf("DeepSeek Codex catalog model %q is missing required tool capabilities", model.Slug)
		}
		if model.ContextWindow != 1048576 || model.MaxContextWindow != 1048576 || !model.SupportedInAPI {
			return doc, fmt.Errorf("DeepSeek Codex catalog model %q has invalid API or context metadata", model.Slug)
		}
		if model.DefaultReasoningLevel != "high" || !reflect.DeepEqual(reasoningEfforts(model), []string{"low", "high", "max"}) {
			return doc, fmt.Errorf("DeepSeek Codex catalog model %q has invalid reasoning metadata", model.Slug)
		}
		if model.MinimalClientVersion != MinimumCodexVersion {
			return doc, fmt.Errorf("DeepSeek Codex catalog model %q requires unexpected Codex version %q", model.Slug, model.MinimalClientVersion)
		}
		modelMessages := bytes.TrimSpace(model.ModelMessages)
		if len(modelMessages) == 0 || bytes.Equal(modelMessages, []byte("{}")) || strings.TrimSpace(model.BaseInstructions) == "" {
			return doc, fmt.Errorf("DeepSeek Codex catalog model %q is missing official instructions", model.Slug)
		}
	}
	return doc, nil
}

func reasoningEfforts(model catalogModel) []string {
	out := make([]string, 0, len(model.SupportedReasoningLevels))
	for _, level := range model.SupportedReasoningLevels {
		out = append(out, level.Effort)
	}
	return out
}

var catalogLocks sync.Map

type materializer struct {
	catalog   []byte
	rename    func(string, string) error
	writeFile func(*os.File, []byte) error
}

func Materialize(homeDir string) (string, error) {
	return newMaterializer(embeddedCatalog).materialize(homeDir)
}

func newMaterializer(catalog []byte) *materializer {
	return &materializer{
		catalog: catalog,
		rename:  os.Rename,
		writeFile: func(file *os.File, raw []byte) error {
			if _, err := file.Write(raw); err != nil {
				return err
			}
			return file.Sync()
		},
	}
}

func (m *materializer) materialize(homeDir string) (string, error) {
	homeDir = strings.TrimSpace(homeDir)
	if homeDir == "" {
		return "", errors.New("cx-deepseek CODEX_HOME is required")
	}
	if _, err := validateCatalog(m.catalog); err != nil {
		return "", err
	}
	absHome, err := filepath.Abs(homeDir)
	if err != nil {
		return "", fmt.Errorf("resolve cx-deepseek CODEX_HOME: %w", err)
	}
	target := filepath.Join(absHome, CatalogFileName)
	lockValue, _ := catalogLocks.LoadOrStore(filepath.Clean(target), &sync.Mutex{})
	lock := lockValue.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()

	if existing, readErr := os.ReadFile(target); readErr == nil && bytes.Equal(existing, m.catalog) {
		return target, nil
	}
	if err := os.MkdirAll(absHome, 0o700); err != nil {
		return "", fmt.Errorf("create cx-deepseek CODEX_HOME: %w", err)
	}
	temporary, err := os.CreateTemp(absHome, ".models-*.json")
	if err != nil {
		return "", fmt.Errorf("create temporary DeepSeek catalog: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return "", fmt.Errorf("protect temporary DeepSeek catalog: %w", err)
	}
	if err := m.writeFile(temporary, m.catalog); err != nil {
		_ = temporary.Close()
		return "", fmt.Errorf("write temporary DeepSeek catalog: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return "", fmt.Errorf("close temporary DeepSeek catalog: %w", err)
	}
	if err := m.rename(temporaryPath, target); err != nil {
		return "", fmt.Errorf("replace DeepSeek catalog: %w", err)
	}
	return target, nil
}
