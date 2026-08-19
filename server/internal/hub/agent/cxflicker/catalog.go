package cxflicker

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	ModelID               = "deepseek-v4-flash-0731"
	MinimumCodexVersion  = "0.144.0"
	CatalogFileName      = "models.json"
	defaultContextWindow = 1048576
)

// Model is the validated subset of the live Flicker catalog that can be
// represented by Codex's Responses provider catalog.
type Model struct {
	ID                        string
	Name                      string
	APIFormat                 string
	Aliases                   []string
	EffortLevels              []string
	DefaultEffort             string
	InputModalities           []string
	ContextWindow             int
	MaxContextWindow          int
	SupportsTools             bool
	SupportsParallelToolCalls bool
}

type reasoningLevel struct {
	Effort string `json:"effort"`
}

type catalogModel struct {
	Slug                      string           `json:"slug"`
	DisplayName               string           `json:"display_name"`
	Aliases                   []string         `json:"aliases,omitempty"`
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
	ModelMessages             map[string]any   `json:"model_messages"`
	BaseInstructions          string           `json:"base_instructions"`
}

type catalogDocument struct {
	Models []catalogModel `json:"models"`
}

const defaultBaseInstructions = `You are Codex, an agent that works with the user in a shared workspace. Complete the user's goal carefully and communicate the result clearly. Inspect relevant files before editing, preserve unrelated changes, and verify the work with appropriate tests. Use tools when they are available and ask for clarification when a required decision is genuinely ambiguous.`

func normalizeModel(model Model) (catalogModel, error) {
	model.ID = strings.TrimSpace(model.ID)
	model.Name = strings.TrimSpace(model.Name)
	model.APIFormat = strings.ToLower(strings.TrimSpace(model.APIFormat))
	if model.ID == "" {
		return catalogModel{}, errors.New("cx-flicker catalog model ID is required")
	}
	if model.APIFormat != "openai" && model.APIFormat != "responses" {
		return catalogModel{}, fmt.Errorf("cx-flicker model %q does not use an OpenAI-compatible API", model.ID)
	}
	if model.Name == "" {
		model.Name = model.ID
	}
	modalities := cleanStrings(model.InputModalities)
	if len(modalities) == 0 {
		modalities = []string{"text"}
	}
	for _, modality := range modalities {
		if !strings.EqualFold(modality, "text") {
			return catalogModel{}, fmt.Errorf("cx-flicker model %q has unsupported input modality %q", model.ID, modality)
		}
	}
	efforts := cleanStrings(model.EffortLevels)
	if len(efforts) == 0 {
		efforts = []string{"high"}
	}
	defaultEffort := strings.TrimSpace(model.DefaultEffort)
	if defaultEffort == "" || !contains(efforts, defaultEffort) {
		defaultEffort = efforts[0]
	}
	contextWindow := model.ContextWindow
	if contextWindow <= 0 {
		contextWindow = defaultContextWindow
	}
	maxContextWindow := model.MaxContextWindow
	if maxContextWindow <= 0 {
		maxContextWindow = contextWindow
	}
	aliases := cleanStrings(model.Aliases)
	return catalogModel{
		Slug:                      model.ID,
		DisplayName:               model.Name,
		Aliases:                   aliases,
		ApplyPatchToolType:        "freeform",
		WebSearchToolType:         "text",
		InputModalities:           modalities,
		SupportsParallelToolCalls: model.SupportsParallelToolCalls || model.SupportsTools,
		ContextWindow:             contextWindow,
		MaxContextWindow:          maxContextWindow,
		DefaultReasoningLevel:     defaultEffort,
		SupportedReasoningLevels:  reasoningLevels(efforts),
		MinimalClientVersion:      MinimumCodexVersion,
		SupportedInAPI:            true,
		SupportsSearchTool:        true,
		ModelMessages:             map[string]any{"instructions_template": defaultBaseInstructions},
		BaseInstructions:          defaultBaseInstructions,
	}, nil
}

func validateModels(models []Model) (catalogDocument, error) {
	if len(models) == 0 {
		return catalogDocument{}, errors.New("cx-flicker catalog is empty")
	}
	document := catalogDocument{Models: make([]catalogModel, 0, len(models))}
	seen := map[string]struct{}{}
	for _, model := range models {
		normalized, err := normalizeModel(model)
		if err != nil {
			return catalogDocument{}, err
		}
		key := strings.ToLower(normalized.Slug)
		if _, exists := seen[key]; exists {
			return catalogDocument{}, fmt.Errorf("cx-flicker catalog contains duplicate model %q", normalized.Slug)
		}
		seen[key] = struct{}{}
		document.Models = append(document.Models, normalized)
	}
	return document, nil
}

func cleanStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, value)
	}
	return result
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if strings.EqualFold(value, expected) {
			return true
		}
	}
	return false
}

func reasoningLevels(efforts []string) []reasoningLevel {
	levels := make([]reasoningLevel, 0, len(efforts))
	for _, effort := range efforts {
		levels = append(levels, reasoningLevel{Effort: effort})
	}
	return levels
}

var catalogLocks sync.Map

// Materialize writes the current live model snapshot into one isolated
// CODEX_HOME. The file is replaced atomically and is reused byte-for-byte when
// the snapshot has not changed.
func Materialize(homeDir string, models []Model) (string, error) {
	document, err := validateModels(models)
	if err != nil {
		return "", err
	}
	raw, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return "", fmt.Errorf("encode cx-flicker catalog: %w", err)
	}
	raw = append(raw, '\n')
	homeDir = strings.TrimSpace(homeDir)
	if homeDir == "" {
		return "", errors.New("cx-flicker CODEX_HOME is required")
	}
	absHome, err := filepath.Abs(homeDir)
	if err != nil {
		return "", fmt.Errorf("resolve cx-flicker CODEX_HOME: %w", err)
	}
	target := filepath.Join(absHome, CatalogFileName)
	lockValue, _ := catalogLocks.LoadOrStore(filepath.Clean(target), &sync.Mutex{})
	lock := lockValue.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()
	if existing, readErr := os.ReadFile(target); readErr == nil && bytes.Equal(existing, raw) {
		return target, nil
	}
	if err := os.MkdirAll(absHome, 0o700); err != nil {
		return "", fmt.Errorf("create cx-flicker CODEX_HOME: %w", err)
	}
	temporary, err := os.CreateTemp(absHome, ".models-*.json")
	if err != nil {
		return "", fmt.Errorf("create temporary cx-flicker catalog: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return "", fmt.Errorf("protect temporary cx-flicker catalog: %w", err)
	}
	if _, err := temporary.Write(raw); err != nil {
		_ = temporary.Close()
		return "", fmt.Errorf("write temporary cx-flicker catalog: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return "", fmt.Errorf("sync temporary cx-flicker catalog: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return "", fmt.Errorf("close temporary cx-flicker catalog: %w", err)
	}
	if err := os.Rename(temporaryPath, target); err != nil {
		return "", fmt.Errorf("replace cx-flicker catalog: %w", err)
	}
	if err := os.Chmod(target, 0o600); err != nil {
		return "", fmt.Errorf("protect cx-flicker catalog: %w", err)
	}
	return target, nil
}
