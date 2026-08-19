package hub

import (
	"context"
	"sort"
	"strings"

	"github.com/swm8023/wheelmaker/internal/hub/agent"
)

// discoveredSkillItem is the runtime-facing view of a Skill. It intentionally
// carries no managed/source/lock metadata because discovery and management are
// separate concerns.
type discoveredSkillItem struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

func scanSkillsDiscovery(
	ctx context.Context,
	providers []string,
	cwd string,
	scope agent.SkillScanScope,
) (map[string][]discoveredSkillItem, error) {
	providers = normalizeSkillDiscoveryProviders(providers)
	descriptors, err := agent.ListSkillsForProviders(ctx, providers, cwd, scope)
	if err != nil {
		return nil, err
	}

	byProvider := make(map[string]map[string]discoveredSkillItem, len(providers))
	for _, provider := range providers {
		byProvider[strings.ToLower(provider)] = map[string]discoveredSkillItem{}
	}
	for _, descriptor := range descriptors {
		name := strings.TrimSpace(descriptor.Skill.Name)
		if name == "" {
			continue
		}
		item := discoveredSkillItem{
			Name:        name,
			Description: strings.TrimSpace(descriptor.Skill.Description),
		}
		for _, provider := range descriptor.Provider {
			provider = strings.ToLower(strings.TrimSpace(provider))
			if provider == "" {
				continue
			}
			items := byProvider[provider]
			if items == nil {
				items = map[string]discoveredSkillItem{}
				byProvider[provider] = items
			}
			key := strings.ToLower(name)
			if existing, ok := items[key]; !ok || existing.Description == "" {
				items[key] = item
			}
		}
	}

	out := make(map[string][]discoveredSkillItem, len(byProvider))
	for provider, items := range byProvider {
		list := make([]discoveredSkillItem, 0, len(items))
		for _, item := range items {
			list = append(list, item)
		}
		sort.Slice(list, func(i, j int) bool {
			left := strings.ToLower(list[i].Name)
			right := strings.ToLower(list[j].Name)
			if left == right {
				return list[i].Name < list[j].Name
			}
			return left < right
		})
		out[provider] = list
	}
	return out, nil
}

func normalizeSkillDiscoveryProviders(providers []string) []string {
	out := appendUniqueFold(nil, providers...)
	if len(out) == 0 {
		out = []string{"codex", "claude"}
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i]) < strings.ToLower(out[j])
	})
	return out
}

func discoveryProvidersForTargets(targets []projectSkillsTarget) []string {
	providers := make([]string, 0)
	for _, target := range targets {
		providers = appendUniqueFold(providers, target.Agents...)
	}
	return normalizeSkillDiscoveryProviders(providers)
}

func cloneDiscoveredSkills(source map[string][]discoveredSkillItem) map[string][]discoveredSkillItem {
	out := make(map[string][]discoveredSkillItem, len(source))
	for provider, skills := range source {
		out[provider] = append([]discoveredSkillItem(nil), skills...)
	}
	return out
}

func cloneProjectDiscoveredSkills(source map[string]map[string][]discoveredSkillItem) map[string]map[string][]discoveredSkillItem {
	out := make(map[string]map[string][]discoveredSkillItem, len(source))
	for projectID, skills := range source {
		out[projectID] = cloneDiscoveredSkills(skills)
	}
	return out
}

func effectiveDiscoveredSkills(
	hub map[string][]discoveredSkillItem,
	projects map[string]map[string][]discoveredSkillItem,
	targets map[string]projectSkillsTarget,
) map[string]map[string][]discoveredSkillItem {
	out := make(map[string]map[string][]discoveredSkillItem, len(targets))
	for projectID, target := range targets {
		providers := appendUniqueFold(nil, target.Agents...)
		if len(providers) == 0 {
			providers = appendUniqueFold(providers, mapKeys(hub)...)
			providers = appendUniqueFold(providers, mapKeys(projects[projectID])...)
		}
		byAgent := make(map[string][]discoveredSkillItem, len(providers))
		for _, provider := range providers {
			providerKey := strings.ToLower(strings.TrimSpace(provider))
			if providerKey == "" {
				continue
			}
			items := make(map[string]discoveredSkillItem)
			for _, item := range hub[providerKey] {
				items[strings.ToLower(item.Name)] = item
			}
			for _, item := range projects[projectID][providerKey] {
				items[strings.ToLower(item.Name)] = item
			}
			list := make([]discoveredSkillItem, 0, len(items))
			for _, item := range items {
				list = append(list, item)
			}
			sort.Slice(list, func(i, j int) bool {
				left := strings.ToLower(list[i].Name)
				right := strings.ToLower(list[j].Name)
				if left == right {
					return list[i].Name < list[j].Name
				}
				return left < right
			})
			byAgent[provider] = list
		}
		out[projectID] = byAgent
	}
	return out
}

func mapKeys[T any](source map[string]T) []string {
	keys := make([]string, 0, len(source))
	for key := range source {
		keys = append(keys, key)
	}
	return keys
}
