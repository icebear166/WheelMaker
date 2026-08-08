package agent

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// SkillDescriptor describes one discovered skill for an agent provider.
type SkillDescriptor struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	Description string `json:"description,omitempty"`
}

// SkillScanScope limits discovery to project or user roots when a caller does
// not need the other scope. The all scope preserves the provider API's legacy
// project-plus-user behavior.
type SkillScanScope string

const (
	SkillScanScopeAll     SkillScanScope = "all"
	SkillScanScopeProject SkillScanScope = "project"
	SkillScanScopeUser    SkillScanScope = "user"
)

// ProviderSkillDescriptor describes one skill discovered from one physical
// root. Providers and locations are aggregated when they share that root.
type ProviderSkillDescriptor struct {
	Provider  []string
	Locations []string
	Skill     SkillDescriptor
}

// ListProviderSkills returns discovered skills for a provider name in cwd context.
func ListProviderSkills(ctx context.Context, providerName, cwd string) ([]SkillDescriptor, error) {
	discovered, err := ListSkillsForProviders(ctx, []string{providerName}, cwd, SkillScanScopeAll)
	if err != nil {
		return nil, err
	}
	seen := map[string]SkillDescriptor{}
	for _, item := range discovered {
		key := strings.ToLower(strings.TrimSpace(item.Skill.Path))
		if key != "" {
			seen[key] = item.Skill
		}
	}
	out := make([]SkillDescriptor, 0, len(seen))
	for _, skill := range seen {
		out = append(out, skill)
	}
	sort.Slice(out, func(i, j int) bool {
		left := strings.ToLower(strings.TrimSpace(out[i].Name))
		right := strings.ToLower(strings.TrimSpace(out[j].Name))
		if left == right {
			return out[i].Path < out[j].Path
		}
		return left < right
	})
	return out, nil
}

func providerPresetByName(name string) (ACPProviderPreset, bool) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case CodexProviderPreset.Name:
		return CodexProviderPreset, true
	case CXDeepSeekProviderPreset.Name:
		return CXDeepSeekProviderPreset, true
	case ClaudeACPProviderPreset.Name:
		return ClaudeACPProviderPreset, true
	case CopilotACPProviderPreset.Name:
		return CopilotACPProviderPreset, true
	case OpenCodeACPProviderPreset.Name:
		return OpenCodeACPProviderPreset, true
	case MimoACPProviderPreset.Name:
		return MimoACPProviderPreset, true
	case CodeBuddyACPProviderPreset.Name:
		return CodeBuddyACPProviderPreset, true
	case FlickerACPProviderPreset.Name:
		return FlickerACPProviderPreset, true
	case KimiACPProviderPreset.Name:
		return KimiACPProviderPreset, true
	case QoderACPProviderPreset.Name:
		return QoderACPProviderPreset, true
	case ClaudeCompatibleDeepSeekProviderPreset.Name:
		return ClaudeCompatibleDeepSeekProviderPreset, true
	case ClaudeCompatibleGLMProviderPreset.Name:
		return ClaudeCompatibleGLMProviderPreset, true
	case ClaudeCompatibleKimiProviderPreset.Name:
		return ClaudeCompatibleKimiProviderPreset, true
	case ClaudeCompatibleQwenProviderPreset.Name:
		return ClaudeCompatibleQwenProviderPreset, true
	case ClaudeCompatibleFlickerProviderPreset.Name:
		return ClaudeCompatibleFlickerProviderPreset, true
	default:
		return ACPProviderPreset{}, false
	}
}

func listSkillsForPreset(_ context.Context, preset ACPProviderPreset, cwd string) ([]SkillDescriptor, error) {
	roots := skillScanRootsForPresets([]ACPProviderPreset{preset}, cwd, SkillScanScopeAll)
	if len(roots) == 0 {
		return nil, nil
	}

	seenPaths := map[string]SkillDescriptor{}
	for _, root := range roots {
		_ = walkSkillRoot(root.path, func(skill SkillDescriptor) {
			key := strings.ToLower(strings.TrimSpace(skill.Path))
			if key == "" {
				return
			}
			if _, exists := seenPaths[key]; exists {
				return
			}
			seenPaths[key] = skill
		})
	}

	if len(seenPaths) == 0 {
		return nil, nil
	}

	out := make([]SkillDescriptor, 0, len(seenPaths))
	for _, skill := range seenPaths {
		out = append(out, skill)
	}
	sort.Slice(out, func(i, j int) bool {
		left := strings.ToLower(strings.TrimSpace(out[i].Name))
		right := strings.ToLower(strings.TrimSpace(out[j].Name))
		if left == right {
			return out[i].Path < out[j].Path
		}
		return left < right
	})
	return out, nil
}

func ListSkillsForProviders(
	ctx context.Context,
	providerNames []string,
	cwd string,
	scope SkillScanScope,
) ([]ProviderSkillDescriptor, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	presets := make([]ACPProviderPreset, 0, len(providerNames))
	for _, providerName := range providerNames {
		preset, ok := providerPresetByName(providerName)
		if ok {
			presets = append(presets, preset)
		}
	}
	roots := skillScanRootsForPresets(presets, cwd, scope)
	if len(roots) == 0 {
		return nil, nil
	}
	out := make([]ProviderSkillDescriptor, 0)
	for _, root := range roots {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		if err := walkSkillRoot(root.path, func(skill SkillDescriptor) {
			out = append(out, ProviderSkillDescriptor{
				Provider:  append([]string(nil), root.providers...),
				Locations: append([]string(nil), root.locations...),
				Skill:     skill,
			})
		}); err != nil {
			return nil, err
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		left := strings.ToLower(strings.TrimSpace(out[i].Skill.Name))
		right := strings.ToLower(strings.TrimSpace(out[j].Skill.Name))
		if left == right {
			return strings.ToLower(out[i].Skill.Path) < strings.ToLower(out[j].Skill.Path)
		}
		return left < right
	})
	return out, nil
}

type skillScanRoot struct {
	path      string
	providers []string
	locations []string
}

func skillScanRootsForPresets(presets []ACPProviderPreset, cwd string, scope SkillScanScope) []skillScanRoot {
	roots := make([]skillScanRoot, 0, len(presets)*2)
	byKey := make(map[string]int)
	appendRoot := func(rawPath string, provider string) {
		rawPath = strings.TrimSpace(rawPath)
		if rawPath == "" {
			return
		}
		abs, err := filepath.Abs(rawPath)
		if err != nil {
			return
		}
		abs = filepath.Clean(abs)
		key := skillPhysicalPathKey(abs)
		index, exists := byKey[key]
		if !exists {
			index = len(roots)
			byKey[key] = index
			roots = append(roots, skillScanRoot{
				path: abs,
			})
		}
		root := &roots[index]
		if provider != "" && !containsFold(root.providers, provider) {
			root.providers = append(root.providers, provider)
		}
		if location := skillLocationForRoot(abs); location != "" && !containsFold(root.locations, location) {
			root.locations = append(root.locations, location)
		}
	}

	for _, preset := range presets {
		provider := strings.TrimSpace(preset.Name)
		if scope == SkillScanScopeAll || scope == SkillScanScopeProject {
			if strings.TrimSpace(cwd) != "" {
				for _, dir := range preset.SkillProjectDirs {
					appendRoot(filepath.Join(cwd, filepath.FromSlash(strings.TrimSpace(dir))), provider)
				}
			}
		}
		if scope == SkillScanScopeAll || scope == SkillScanScopeUser {
			for _, dir := range preset.SkillUserDirs {
				appendRoot(expandHomePath(dir), provider)
			}
		}
	}
	return roots
}

func skillLocationForRoot(path string) string {
	normalized := strings.TrimRight(strings.ToLower(filepath.ToSlash(filepath.Clean(path))), "/")
	locations := []struct {
		suffix string
		name   string
	}{
		{suffix: "/.agents/skills", name: "agents"},
		{suffix: "/.claude/skills", name: "claude"},
		{suffix: "/.codebuddy/skills", name: "codebuddy"},
		{suffix: "/.mimocode/skills", name: "mimo"},
		{suffix: "/.qoder/skills", name: "qoder"},
	}
	for _, location := range locations {
		if strings.HasSuffix(normalized, location.suffix) {
			return location.name
		}
	}
	return ""
}

func containsFold(values []string, candidate string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), strings.TrimSpace(candidate)) {
			return true
		}
	}
	return false
}

func expandHomePath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	if strings.HasPrefix(path, "~/") || strings.HasPrefix(path, "~\\") {
		home, err := os.UserHomeDir()
		if err != nil || strings.TrimSpace(home) == "" {
			return ""
		}
		rest := strings.TrimPrefix(strings.TrimPrefix(path, "~/"), "~\\")
		return filepath.Join(home, filepath.FromSlash(strings.ReplaceAll(rest, "\\", "/")))
	}
	if path == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		return home
	}
	return path
}

func walkSkillRoot(root string, emit func(skill SkillDescriptor)) error {
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return nil
	}
	return walkSkillDirectory(root, root, make(map[string]struct{}), emit)
}

func walkSkillDirectory(
	root string,
	dir string,
	ancestors map[string]struct{},
	emit func(skill SkillDescriptor),
) error {
	physicalKey := skillPhysicalPathKey(dir)
	if _, exists := ancestors[physicalKey]; exists {
		return nil
	}
	ancestors[physicalKey] = struct{}{}
	defer delete(ancestors, physicalKey)

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	for _, entry := range entries {
		path := filepath.Join(dir, entry.Name())
		info, statErr := os.Stat(path)
		if statErr != nil {
			continue
		}
		if info.IsDir() {
			_ = walkSkillDirectory(root, path, ancestors, emit)
			continue
		}
		if !strings.EqualFold(entry.Name(), "SKILL.md") {
			continue
		}
		name := skillNameFromRelativePath(root, path)
		if name == "" {
			name = strings.TrimSpace(filepath.Base(filepath.Dir(path)))
		}
		abs, absErr := filepath.Abs(path)
		if absErr != nil {
			abs = path
		}
		emit(SkillDescriptor{
			Name:        name,
			Path:        abs,
			Description: readSkillDescription(path),
		})
	}
	return nil
}

func readSkillDescription(path string) string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	lines := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")
	if len(lines) == 0 || strings.TrimSpace(strings.TrimPrefix(lines[0], "\uFEFF")) != "---" {
		return ""
	}
	for index, line := range lines[1:] {
		trimmed := strings.TrimSpace(line)
		if trimmed == "---" {
			return ""
		}
		key, value, found := strings.Cut(trimmed, ":")
		if !found || !strings.EqualFold(strings.TrimSpace(key), "description") {
			continue
		}
		value = strings.TrimSpace(value)
		if value == ">" || value == "|" {
			parts := make([]string, 0, 2)
			for _, continuation := range lines[index+2:] {
				if strings.TrimSpace(continuation) == "---" {
					break
				}
				if continuation != "" && continuation[0] != ' ' && continuation[0] != '\t' {
					break
				}
				if part := strings.TrimSpace(continuation); part != "" {
					parts = append(parts, part)
				}
			}
			return strings.Join(parts, " ")
		}
		if len(value) >= 2 && value[0] == '\'' && value[len(value)-1] == '\'' {
			return strings.ReplaceAll(value[1:len(value)-1], "''", "'")
		}
		if len(value) >= 2 && value[0] == '"' && value[len(value)-1] == '"' {
			if unquoted, unquoteErr := strconv.Unquote(value); unquoteErr == nil {
				return strings.TrimSpace(unquoted)
			}
		}
		return value
	}
	return ""
}

func skillNameFromRelativePath(root, skillFile string) string {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return ""
	}
	fileAbs, err := filepath.Abs(skillFile)
	if err != nil {
		return ""
	}
	relDir, err := filepath.Rel(rootAbs, filepath.Dir(fileAbs))
	if err != nil {
		return ""
	}
	relDir = strings.TrimSpace(filepath.ToSlash(relDir))
	if relDir == "" || relDir == "." || relDir == ".." || strings.HasPrefix(relDir, "../") {
		return ""
	}
	parts := strings.Split(relDir, "/")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" || part == "." {
			continue
		}
		out = append(out, part)
	}
	if len(out) == 0 {
		return ""
	}
	return out[len(out)-1]
}
