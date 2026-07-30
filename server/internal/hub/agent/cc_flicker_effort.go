package agent

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/swm8023/wheelmaker/internal/protocol"
)

const ccFlickerEffortLoaderSource = `
import { Buffer } from "node:buffer";

function isClaudeACPAgent(url) {
  const normalized = decodeURIComponent(url).replace(/\\/g, "/");
  return normalized.endsWith("/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js");
}

function sourceToString(source) {
  if (typeof source === "string") {
    return source;
  }
  if (source instanceof Uint8Array) {
    return Buffer.from(source).toString("utf8");
  }
  return "";
}

function replaceOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle);
  if (index < 0) {
    throw new Error("WheelMaker cc-flicker effort patch failed: " + label + " not found");
  }
  if (source.indexOf(needle, index + needle.length) >= 0) {
    throw new Error("WheelMaker cc-flicker effort patch failed: " + label + " matched more than once");
  }
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
}

function patchClaudeACPAgent(source) {
  const levels = '["low", "medium", "high", "xhigh", "max"]';
  source = replaceOnce(
    source,
    "result.push({ ...sdkMatch, value: effective });",
    "result.push({ ...sdkMatch, value: effective, supportsEffort: true, supportedEffortLevels: " + levels + " });",
    "matched allowlist model"
  );
  return replaceOnce(
    source,
    'result.push({ value: effective, displayName: trimmed, description: "" });',
    'result.push({ value: effective, displayName: trimmed, description: "", supportsEffort: true, supportedEffortLevels: ' + levels + " });",
    "custom allowlist model"
  );
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!isClaudeACPAgent(url)) {
    return result;
  }
  const source = sourceToString(result.source);
  if (!source) {
    return result;
  }
  return { ...result, source: patchClaudeACPAgent(source) };
}
`

func ensureCCFlickerEffortLoader() (string, error) {
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
		return "", fmt.Errorf("create loader directory: %w", err)
	}
	path := filepath.Join(dir, "cc_flicker_effort_loader.mjs")
	if err := os.WriteFile(path, []byte(ccFlickerEffortLoaderSource), 0o644); err != nil {
		return "", fmt.Errorf("write loader: %w", err)
	}
	return path, nil
}

// flickerEffortInstance keeps Claude Code's session configuration aligned with
// the model-specific effort variants published by the V2 Flicker bridge.
type flickerEffortInstance struct {
	Instance
	store   *FlickerModelStore
	profile *claudeCompatibleProfile

	mu      sync.Mutex
	efforts map[string]string
}

func newFlickerEffortInstance(
	base Instance,
	store *FlickerModelStore,
	profile *claudeCompatibleProfile,
) Instance {
	if base == nil {
		return nil
	}
	return &flickerEffortInstance{
		Instance: base,
		store:    store,
		profile:  profile,
		efforts:  make(map[string]string),
	}
}

func (i *flickerEffortInstance) SessionNew(
	ctx context.Context,
	params protocol.SessionNewParams,
) (protocol.SessionNewResult, error) {
	result, err := i.Instance.SessionNew(ctx, params)
	if err != nil {
		return result, err
	}
	result.ConfigOptions = i.normalize(result.SessionID, result.ConfigOptions, "")
	return result, nil
}

func (i *flickerEffortInstance) SessionLoad(
	ctx context.Context,
	params protocol.SessionLoadParams,
) (protocol.SessionLoadResult, error) {
	result, err := i.Instance.SessionLoad(ctx, params)
	if err != nil {
		return result, err
	}
	result.ConfigOptions = i.normalize(params.SessionID, result.ConfigOptions, "")
	return result, nil
}

func (i *flickerEffortInstance) SessionSetConfigOption(
	ctx context.Context,
	params protocol.SessionSetConfigOptionParams,
) ([]protocol.ConfigOption, error) {
	options, err := i.Instance.SessionSetConfigOption(ctx, params)
	if err != nil {
		return nil, err
	}
	preferred := ""
	if isFlickerEffortOption(protocol.ConfigOption{ID: params.ConfigID}) {
		preferred = params.Value
	}
	return i.normalize(params.SessionID, options, preferred), nil
}

func (i *flickerEffortInstance) normalize(
	sessionID string,
	options []protocol.ConfigOption,
	preferred string,
) []protocol.ConfigOption {
	if i == nil || i.profile == nil {
		return cloneConfigOptions(options)
	}
	sessionID = strings.TrimSpace(sessionID)
	i.mu.Lock()
	if preferred == "" {
		preferred = i.efforts[sessionID]
	}
	i.mu.Unlock()
	if preferred != "" {
		options = cloneConfigOptions(options)
		found := false
		for index := range options {
			if isFlickerEffortOption(options[index]) {
				options[index].CurrentValue = preferred
				found = true
				break
			}
		}
		if !found {
			options = append(options, protocol.ConfigOption{
				ID:           "effort",
				CurrentValue: preferred,
			})
		}
	}
	models := i.profile.staticModels
	if i.store != nil {
		models = i.store.Models()
	}
	normalized := normalizeFlickerConfigOptions(options, models, *i.profile)
	resolved := ""
	for _, option := range normalized {
		if isFlickerEffortOption(option) {
			resolved = option.CurrentValue
			break
		}
	}
	i.mu.Lock()
	if resolved == "" {
		delete(i.efforts, sessionID)
	} else {
		i.efforts[sessionID] = resolved
	}
	i.mu.Unlock()
	return normalized
}

func normalizeFlickerConfigOptions(
	options []protocol.ConfigOption,
	models []claudeModelEntry,
	profile claudeCompatibleProfile,
) []protocol.ConfigOption {
	normalized := cloneConfigOptions(options)
	for optionIndex := range normalized {
		if !strings.EqualFold(normalized[optionIndex].ID, protocol.ConfigOptionIDModel) &&
			!strings.EqualFold(normalized[optionIndex].Category, protocol.ConfigOptionCategoryModel) {
			continue
		}
		for valueIndex := range normalized[optionIndex].Options {
			model, found := findFlickerModel(models, normalized[optionIndex].Options[valueIndex].Value)
			if found && model.Name != "" {
				normalized[optionIndex].Options[valueIndex].Name = model.Name
			}
		}
		break
	}
	modelID, modelOptionIndex := selectedFlickerModel(normalized, profile)
	model, found := findFlickerModel(models, modelID)
	if !found {
		return normalized
	}

	effortIndex := -1
	for index := range normalized {
		if isFlickerEffortOption(normalized[index]) {
			effortIndex = index
			break
		}
	}
	if len(model.EffortLevels) == 0 {
		if effortIndex >= 0 {
			normalized = append(normalized[:effortIndex], normalized[effortIndex+1:]...)
		}
		return normalized
	}

	effort := protocol.ConfigOption{
		ID:       "effort",
		Name:     "Effort",
		Category: protocol.ConfigOptionCategoryThoughtLv,
		Type:     "select",
	}
	if effortIndex >= 0 {
		effort = normalized[effortIndex]
		if strings.TrimSpace(effort.ID) == "" {
			effort.ID = "effort"
		}
		if strings.TrimSpace(effort.Name) == "" {
			effort.Name = "Effort"
		}
		if strings.TrimSpace(effort.Category) == "" {
			effort.Category = protocol.ConfigOptionCategoryThoughtLv
		}
		if strings.TrimSpace(effort.Type) == "" {
			effort.Type = "select"
		}
	}
	existingLabels := make(map[string]protocol.ConfigOptionValue, len(effort.Options))
	for _, option := range effort.Options {
		existingLabels[strings.ToLower(strings.TrimSpace(option.Value))] = option
	}
	effort.Options = make([]protocol.ConfigOptionValue, 0, len(model.EffortLevels))
	allowed := make(map[string]string, len(model.EffortLevels))
	for _, level := range model.EffortLevels {
		level = strings.ToLower(strings.TrimSpace(level))
		if level == "" || level == "default" {
			continue
		}
		allowed[level] = level
		value, ok := existingLabels[level]
		if !ok {
			value = protocol.ConfigOptionValue{
				Value: level,
				Name:  flickerEffortDisplayName(level),
			}
		}
		value.Value = level
		effort.Options = append(effort.Options, value)
	}
	current := strings.ToLower(strings.TrimSpace(effort.CurrentValue))
	if _, ok := allowed[current]; !ok {
		current = strings.ToLower(strings.TrimSpace(model.DefaultEffort))
	}
	if _, ok := allowed[current]; !ok && len(effort.Options) > 0 {
		current = effort.Options[0].Value
	}
	effort.CurrentValue = current

	if effortIndex >= 0 {
		normalized[effortIndex] = effort
		return normalized
	}
	insertAt := len(normalized)
	if modelOptionIndex >= 0 {
		insertAt = modelOptionIndex + 1
	}
	normalized = append(normalized, protocol.ConfigOption{})
	copy(normalized[insertAt+1:], normalized[insertAt:])
	normalized[insertAt] = effort
	return normalized
}

func cloneConfigOptions(options []protocol.ConfigOption) []protocol.ConfigOption {
	cloned := append([]protocol.ConfigOption(nil), options...)
	for index := range cloned {
		cloned[index].Options = append([]protocol.ConfigOptionValue(nil), options[index].Options...)
	}
	return cloned
}

func selectedFlickerModel(options []protocol.ConfigOption, profile claudeCompatibleProfile) (string, int) {
	value := ""
	index := -1
	for optionIndex, option := range options {
		if strings.EqualFold(strings.TrimSpace(option.ID), protocol.ConfigOptionIDModel) ||
			strings.EqualFold(strings.TrimSpace(option.Category), protocol.ConfigOptionCategoryModel) {
			value = strings.TrimSpace(option.CurrentValue)
			index = optionIndex
			break
		}
	}
	switch strings.ToLower(value) {
	case "", "default":
		value = profile.defaultModel
	case "fable":
		value = profile.settingsEnv["ANTHROPIC_DEFAULT_FABLE_MODEL"]
	case "opus":
		value = profile.settingsEnv["ANTHROPIC_DEFAULT_OPUS_MODEL"]
	case "sonnet":
		value = profile.settingsEnv["ANTHROPIC_DEFAULT_SONNET_MODEL"]
	case "haiku":
		value = profile.settingsEnv["ANTHROPIC_DEFAULT_HAIKU_MODEL"]
	}
	return value, index
}

func findFlickerModel(models []claudeModelEntry, modelID string) (claudeModelEntry, bool) {
	for _, model := range models {
		if strings.EqualFold(strings.TrimSpace(model.ID), strings.TrimSpace(modelID)) {
			return model, true
		}
	}
	return claudeModelEntry{}, false
}

func isFlickerEffortOption(option protocol.ConfigOption) bool {
	switch strings.ToLower(strings.TrimSpace(option.ID)) {
	case "effort", protocol.ConfigOptionIDThoughtLevel, protocol.ConfigOptionIDReasoningEffort:
		return true
	}
	return strings.EqualFold(strings.TrimSpace(option.Category), protocol.ConfigOptionCategoryThoughtLv)
}

func flickerEffortDisplayName(level string) string {
	switch level {
	case "xhigh":
		return "Xhigh"
	default:
		if level == "" {
			return ""
		}
		return strings.ToUpper(level[:1]) + level[1:]
	}
}
