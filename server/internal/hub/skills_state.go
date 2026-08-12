package hub

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/swm8023/wheelmaker/internal/hub/agent"
	"github.com/swm8023/wheelmaker/internal/hub/tools"
)

type skillSyncStatus string

const (
	skillSyncAligned         skillSyncStatus = "aligned"
	skillSyncContentMismatch skillSyncStatus = "contentMismatch"
	skillSyncUnknown         skillSyncStatus = "unknown"
)

type skillLocation struct {
	Path         string `json:"path"`
	ResolvedPath string `json:"resolvedPath,omitempty"`
	Fingerprint  string `json:"fingerprint"`
}

type skillSyncDiagnostic struct {
	Status skillSyncStatus `json:"status"`
}

type skillInventoryItem struct {
	Name        string                   `json:"name"`
	Description string                   `json:"description,omitempty"`
	Managed     bool                     `json:"managed"`
	Agents      []string                 `json:"agents"`
	Locations   map[string]skillLocation `json:"locations"`
	Sync        skillSyncDiagnostic      `json:"sync"`
}

type skillsStateSnapshot struct {
	HubInventory            map[string]skillInventoryItem              `json:"hubInventory"`
	ProjectLocalInventories map[string]map[string]skillInventoryItem   `json:"projectLocalInventories"`
	EffectiveSkills         map[string]map[string][]skillInventoryItem `json:"effectiveSkills"`
	HubSources              tools.SkillsSourceScopeSnapshot            `json:"hubSources"`
	ProjectSources          map[string]tools.SkillsSourceScopeSnapshot `json:"projectSources"`
	Operation               *tools.SkillsOperationSnapshot             `json:"operation,omitempty"`
}

type projectSkillsTarget struct {
	ProjectID string
	Path      string
	Agents    []string
}

type projectSkillsState struct {
	Inventory        map[string]skillInventoryItem
	EffectiveByAgent map[string]map[string]skillInventoryItem
}

func scanProjectSkillsState(ctx context.Context, target projectSkillsTarget) (projectSkillsState, error) {
	inventory, err := scanSkillsInventory(ctx, target.Agents, target.Path, agent.SkillScanScopeProject)
	if err != nil {
		return projectSkillsState{}, err
	}
	effective := make(map[string]map[string]skillInventoryItem, len(target.Agents))
	for _, provider := range target.Agents {
		provider = strings.TrimSpace(provider)
		if provider == "" {
			continue
		}
		items := map[string]skillInventoryItem{}
		for name, item := range inventory {
			if containsFold(item.Agents, provider) {
				items[name] = cloneSkillInventoryItem(item)
			}
		}
		effective[provider] = items
	}
	return projectSkillsState{Inventory: inventory, EffectiveByAgent: effective}, nil
}

func scanProjectSkillsInventory(ctx context.Context, target projectSkillsTarget) (map[string]skillInventoryItem, error) {
	state, err := scanProjectSkillsState(ctx, target)
	return state.Inventory, err
}

func scanHubSkillsInventory(ctx context.Context, agents []string) (map[string]skillInventoryItem, error) {
	return scanSkillsInventory(ctx, agents, "", agent.SkillScanScopeUser)
}

func scanSkillsInventory(
	ctx context.Context,
	providers []string,
	cwd string,
	scope agent.SkillScanScope,
) (map[string]skillInventoryItem, error) {
	inventory := map[string]skillInventoryItem{}
	managed := readManagedSkillNames(cwd)
	descriptors, err := agent.ListSkillsForProviders(ctx, providers, cwd, scope)
	if err != nil {
		return nil, err
	}
	for _, discovered := range descriptors {
		name := strings.TrimSpace(discovered.Skill.Name)
		if name == "" {
			continue
		}
		key := strings.ToLower(name)
		item := inventory[key]
		if item.Name == "" {
			item.Name = name
		}
		if item.Description == "" {
			item.Description = strings.TrimSpace(discovered.Skill.Description)
		}
		item.Managed = item.Managed || managed[key]
		item.Agents = appendUniqueFold(item.Agents, discovered.Provider...)
		if item.Locations == nil {
			item.Locations = map[string]skillLocation{}
		}
		for _, locationName := range discovered.Locations {
			locationName = strings.TrimSpace(locationName)
			if locationName == "" {
				continue
			}
			item.Locations[locationName] = inspectSkillLocation(discovered.Skill.Path)
		}
		inventory[key] = item
	}
	for key, item := range inventory {
		sort.Slice(item.Agents, func(i, j int) bool {
			return strings.ToLower(item.Agents[i]) < strings.ToLower(item.Agents[j])
		})
		item.Sync.Status = deriveSkillSyncStatus(item.Locations)
		inventory[key] = item
	}
	return inventory, nil
}

func inspectSkillLocation(path string) skillLocation {
	location := skillLocation{Path: filepath.Clean(path)}
	resolved, err := filepath.EvalSymlinks(path)
	if err == nil && !strings.EqualFold(filepath.Clean(resolved), filepath.Clean(path)) {
		location.ResolvedPath = resolved
	}
	raw, err := os.ReadFile(path)
	if err == nil {
		sum := sha256.Sum256(raw)
		location.Fingerprint = hex.EncodeToString(sum[:])
	}
	return location
}

func deriveSkillSyncStatus(locations map[string]skillLocation) skillSyncStatus {
	fingerprints := map[string]struct{}{}
	for _, location := range locations {
		if location.Fingerprint != "" {
			fingerprints[location.Fingerprint] = struct{}{}
		}
	}
	if len(fingerprints) > 1 {
		return skillSyncContentMismatch
	}
	agents, hasAgents := locations["agents"]
	claude, hasClaude := locations["claude"]
	switch {
	case hasAgents && hasClaude && agents.Fingerprint != "" && agents.Fingerprint == claude.Fingerprint:
		return skillSyncAligned
	case hasAgents && hasClaude:
		return skillSyncContentMismatch
	default:
		return skillSyncUnknown
	}
}

func readManagedSkillNames(root string) map[string]bool {
	out := map[string]bool{}
	lockPath := managedSkillsLockPath(root)
	if lockPath == "" {
		return out
	}
	raw, err := os.ReadFile(lockPath)
	if err != nil {
		return out
	}
	var value struct {
		Skills map[string]json.RawMessage `json:"skills"`
	}
	if json.Unmarshal(raw, &value) != nil {
		return out
	}
	for name := range value.Skills {
		if name = strings.TrimSpace(name); name != "" {
			out[strings.ToLower(name)] = true
		}
	}
	return out
}

func managedSkillsLockPath(root string) string {
	if root = strings.TrimSpace(root); root != "" {
		return filepath.Join(root, "skills-lock.json")
	}
	if stateHome := strings.TrimSpace(os.Getenv("XDG_STATE_HOME")); stateHome != "" {
		return filepath.Join(stateHome, "skills", ".skill-lock.json")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".agents", ".skill-lock.json")
}

type skillsStateCoordinatorOptions struct {
	ScanHub            func(context.Context) (map[string]skillInventoryItem, error)
	ScanProject        func(context.Context, projectSkillsTarget) (map[string]skillInventoryItem, error)
	ScanHubSources     func(context.Context, map[string]skillInventoryItem) (tools.SkillsSourceScopeSnapshot, error)
	ScanProjectSources func(context.Context, projectSkillsTarget, map[string]skillInventoryItem) (tools.SkillsSourceScopeSnapshot, error)
	Targets            func() []projectSkillsTarget
}

type skillsStateCoordinator struct {
	mu             sync.Mutex
	options        skillsStateCoordinatorOptions
	hub            map[string]skillInventoryItem
	projects       map[string]map[string]skillInventoryItem
	hubSources     tools.SkillsSourceScopeSnapshot
	projectSources map[string]tools.SkillsSourceScopeSnapshot
	targets        map[string]projectSkillsTarget
	operation      *tools.SkillsOperationSnapshot
}

func newSkillsStateCoordinator(options skillsStateCoordinatorOptions) *skillsStateCoordinator {
	return &skillsStateCoordinator{
		options:        options,
		hub:            map[string]skillInventoryItem{},
		projects:       map[string]map[string]skillInventoryItem{},
		projectSources: map[string]tools.SkillsSourceScopeSnapshot{},
		targets:        map[string]projectSkillsTarget{},
	}
}

func (c *skillsStateCoordinator) SetTargets(targets []projectSkillsTarget) {
	c.mu.Lock()
	defer c.mu.Unlock()
	next := make(map[string]projectSkillsTarget, len(targets))
	for _, target := range targets {
		if target.ProjectID != "" {
			next[target.ProjectID] = cloneProjectSkillsTarget(target)
		}
	}
	c.targets = next
	for projectID := range c.projects {
		if _, ok := next[projectID]; !ok {
			delete(c.projects, projectID)
		}
	}
	for projectID := range c.projectSources {
		if _, ok := next[projectID]; !ok {
			delete(c.projectSources, projectID)
		}
	}
}

func (c *skillsStateCoordinator) SetOperation(operation *tools.SkillsOperationSnapshot) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.operation = cloneSkillsStateOperation(operation)
}

func (c *skillsStateCoordinator) seedProject(projectID string, inventory map[string]skillInventoryItem) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.projects[projectID] = cloneSkillInventory(inventory)
	if _, ok := c.targets[projectID]; !ok {
		c.targets[projectID] = projectSkillsTarget{
			ProjectID: projectID,
			Agents:    inventoryAgents(inventory),
		}
	}
}

func (c *skillsStateCoordinator) RefreshAll(ctx context.Context) (skillsStateSnapshot, error) {
	hub, err := c.options.ScanHub(ctx)
	if err != nil {
		return skillsStateSnapshot{}, err
	}
	hubSources, err := c.scanHubSources(ctx, hub)
	if err != nil {
		return skillsStateSnapshot{}, err
	}
	targets := c.currentTargets()
	projects := make(map[string]map[string]skillInventoryItem, len(targets))
	projectSources := make(map[string]tools.SkillsSourceScopeSnapshot, len(targets))
	for _, target := range targets {
		inventory, scanErr := c.options.ScanProject(ctx, target)
		if scanErr != nil {
			return skillsStateSnapshot{}, scanErr
		}
		projects[target.ProjectID] = inventory
		sources, scanErr := c.scanProjectSources(ctx, target, inventory)
		if scanErr != nil {
			return skillsStateSnapshot{}, scanErr
		}
		projectSources[target.ProjectID] = sources
	}
	c.mu.Lock()
	c.hub = cloneSkillInventory(hub)
	c.projects = cloneProjectSkillInventories(projects)
	c.hubSources = cloneSkillsSourceScopeSnapshot(hubSources)
	c.projectSources = cloneProjectSkillsSourceSnapshots(projectSources)
	snapshot := c.snapshotLocked()
	c.mu.Unlock()
	return snapshot, nil
}

func (c *skillsStateCoordinator) RefreshHub(ctx context.Context) (skillsStateSnapshot, error) {
	hub, err := c.options.ScanHub(ctx)
	if err != nil {
		return skillsStateSnapshot{}, err
	}
	sources, err := c.scanHubSources(ctx, hub)
	if err != nil {
		return skillsStateSnapshot{}, err
	}
	c.mu.Lock()
	c.hub = cloneSkillInventory(hub)
	c.hubSources = cloneSkillsSourceScopeSnapshot(sources)
	snapshot := c.snapshotLocked()
	c.mu.Unlock()
	return snapshot, nil
}

func (c *skillsStateCoordinator) RefreshProject(ctx context.Context, projectID string) (skillsStateSnapshot, error) {
	target, ok := c.target(projectID)
	if !ok {
		return c.Snapshot(), nil
	}
	inventory, err := c.options.ScanProject(ctx, target)
	if err != nil {
		return skillsStateSnapshot{}, err
	}
	sources, err := c.scanProjectSources(ctx, target, inventory)
	if err != nil {
		return skillsStateSnapshot{}, err
	}
	c.mu.Lock()
	c.projects[projectID] = cloneSkillInventory(inventory)
	c.projectSources[projectID] = cloneSkillsSourceScopeSnapshot(sources)
	snapshot := c.snapshotLocked()
	c.mu.Unlock()
	return snapshot, nil
}

func (c *skillsStateCoordinator) Snapshot() skillsStateSnapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.snapshotLocked()
}

func (c *skillsStateCoordinator) currentTargets() []projectSkillsTarget {
	if c.options.Targets != nil {
		c.SetTargets(c.options.Targets())
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]projectSkillsTarget, 0, len(c.targets))
	for _, target := range c.targets {
		out = append(out, cloneProjectSkillsTarget(target))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ProjectID < out[j].ProjectID })
	return out
}

func (c *skillsStateCoordinator) target(projectID string) (projectSkillsTarget, bool) {
	if c.options.Targets != nil {
		c.SetTargets(c.options.Targets())
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	target, ok := c.targets[projectID]
	return cloneProjectSkillsTarget(target), ok
}

func (c *skillsStateCoordinator) snapshotLocked() skillsStateSnapshot {
	hub := cloneSkillInventory(c.hub)
	projects := cloneProjectSkillInventories(c.projects)
	effective := make(map[string]map[string][]skillInventoryItem, len(projects))
	for projectID, local := range projects {
		target := c.targets[projectID]
		agents := append([]string(nil), target.Agents...)
		if len(agents) == 0 {
			agents = appendUniqueFold(inventoryAgents(hub), inventoryAgents(local)...)
		}
		byAgent := make(map[string][]skillInventoryItem, len(agents))
		for _, provider := range agents {
			items := map[string]skillInventoryItem{}
			for name, item := range hub {
				if containsFold(item.Agents, provider) {
					items[name] = cloneSkillInventoryItem(item)
				}
			}
			for name, item := range local {
				if containsFold(item.Agents, provider) {
					items[name] = cloneSkillInventoryItem(item)
				}
			}
			names := make([]string, 0, len(items))
			for name := range items {
				names = append(names, name)
			}
			sort.Strings(names)
			for _, name := range names {
				byAgent[provider] = append(byAgent[provider], items[name])
			}
		}
		effective[projectID] = byAgent
	}
	return skillsStateSnapshot{
		HubInventory:            hub,
		ProjectLocalInventories: projects,
		EffectiveSkills:         effective,
		HubSources:              cloneSkillsSourceScopeSnapshot(c.hubSources),
		ProjectSources:          cloneProjectSkillsSourceSnapshots(c.projectSources),
		Operation:               cloneSkillsStateOperation(c.operation),
	}
}

func (c *skillsStateCoordinator) scanHubSources(ctx context.Context, inventory map[string]skillInventoryItem) (tools.SkillsSourceScopeSnapshot, error) {
	if c.options.ScanHubSources == nil {
		return tools.SkillsSourceScopeSnapshot{}, nil
	}
	return c.options.ScanHubSources(ctx, cloneSkillInventory(inventory))
}

func (c *skillsStateCoordinator) scanProjectSources(ctx context.Context, target projectSkillsTarget, inventory map[string]skillInventoryItem) (tools.SkillsSourceScopeSnapshot, error) {
	if c.options.ScanProjectSources == nil {
		return tools.SkillsSourceScopeSnapshot{}, nil
	}
	return c.options.ScanProjectSources(ctx, cloneProjectSkillsTarget(target), cloneSkillInventory(inventory))
}

func cloneSkillsStateOperation(operation *tools.SkillsOperationSnapshot) *tools.SkillsOperationSnapshot {
	if operation == nil {
		return nil
	}
	clone := *operation
	clone.Skills = append([]string(nil), operation.Skills...)
	if operation.ExitCode != nil {
		exitCode := *operation.ExitCode
		clone.ExitCode = &exitCode
	}
	return &clone
}

func cloneSkillInventory(source map[string]skillInventoryItem) map[string]skillInventoryItem {
	out := make(map[string]skillInventoryItem, len(source))
	for key, item := range source {
		out[key] = cloneSkillInventoryItem(item)
	}
	return out
}

func cloneProjectSkillInventories(source map[string]map[string]skillInventoryItem) map[string]map[string]skillInventoryItem {
	out := make(map[string]map[string]skillInventoryItem, len(source))
	for projectID, inventory := range source {
		out[projectID] = cloneSkillInventory(inventory)
	}
	return out
}

func cloneProjectSkillsSourceSnapshots(source map[string]tools.SkillsSourceScopeSnapshot) map[string]tools.SkillsSourceScopeSnapshot {
	out := make(map[string]tools.SkillsSourceScopeSnapshot, len(source))
	for projectID, snapshot := range source {
		out[projectID] = cloneSkillsSourceScopeSnapshot(snapshot)
	}
	return out
}

func cloneSkillsSourceScopeSnapshot(source tools.SkillsSourceScopeSnapshot) tools.SkillsSourceScopeSnapshot {
	out := tools.SkillsSourceScopeSnapshot{
		Sources:               make([]tools.SkillsSourceCatalogSnapshot, len(source.Sources)),
		UnmanagedSkills:       make([]tools.SkillsSourceCatalogSkillSnapshot, len(source.UnmanagedSkills)),
		NeedsResolutionSkills: append([]string(nil), source.NeedsResolutionSkills...),
	}
	copy(out.UnmanagedSkills, source.UnmanagedSkills)
	for index, snapshot := range source.Sources {
		out.Sources[index] = snapshot
		out.Sources[index].Skills = make([]tools.SkillsSourceCatalogSkillSnapshot, len(snapshot.Skills))
		copy(out.Sources[index].Skills, snapshot.Skills)
	}
	return out
}

func skillInventoryAsInstalledSnapshots(inventory map[string]skillInventoryItem) []tools.SkillsInstalledSkillSnapshot {
	names := make([]string, 0, len(inventory))
	for name := range inventory {
		names = append(names, name)
	}
	sort.Strings(names)
	out := make([]tools.SkillsInstalledSkillSnapshot, 0, len(names))
	for _, name := range names {
		item := inventory[name]
		locationNames := make([]string, 0, len(item.Locations))
		for locationName := range item.Locations {
			locationNames = append(locationNames, locationName)
		}
		sort.Strings(locationNames)
		locations := make([]string, 0, len(locationNames))
		for _, locationName := range locationNames {
			if path := strings.TrimSpace(item.Locations[locationName].Path); path != "" {
				locations = append(locations, path)
			}
		}
		out = append(out, tools.SkillsInstalledSkillSnapshot{
			Name: item.Name, Managed: item.Managed, Locations: locations,
		})
	}
	return out
}

func cloneSkillInventoryItem(item skillInventoryItem) skillInventoryItem {
	item.Agents = append([]string(nil), item.Agents...)
	locations := make(map[string]skillLocation, len(item.Locations))
	for name, location := range item.Locations {
		locations[name] = location
	}
	item.Locations = locations
	return item
}

func cloneProjectSkillsTarget(target projectSkillsTarget) projectSkillsTarget {
	target.Agents = append([]string(nil), target.Agents...)
	return target
}

func inventoryAgents(inventory map[string]skillInventoryItem) []string {
	var out []string
	for _, item := range inventory {
		out = appendUniqueFold(out, item.Agents...)
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i]) < strings.ToLower(out[j])
	})
	return out
}

func appendUniqueFold(values []string, candidates ...string) []string {
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate != "" && !containsFold(values, candidate) {
			values = append(values, candidate)
		}
	}
	return values
}

func containsFold(values []string, candidate string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), strings.TrimSpace(candidate)) {
			return true
		}
	}
	return false
}
