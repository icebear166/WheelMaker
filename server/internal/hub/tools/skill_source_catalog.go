package tools

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type SkillsSourceScopeSnapshot struct {
	Sources               []SkillsSourceCatalogSnapshot      `json:"sources"`
	UnmanagedSkills       []SkillsSourceCatalogSkillSnapshot `json:"unmanagedSkills"`
	NeedsResolutionSkills []string                           `json:"needsResolutionSkills,omitempty"`
}

type SkillsSourceCatalogSnapshot struct {
	Source         string                             `json:"source"`
	SourceKey      string                             `json:"sourceKey"`
	Ref            string                             `json:"ref"`
	ResolvedCommit string                             `json:"resolvedCommit,omitempty"`
	RefreshedAt    string                             `json:"refreshedAt,omitempty"`
	Status         string                             `json:"status"`
	Error          string                             `json:"error,omitempty"`
	InstalledCount int                                `json:"installedCount"`
	UpdateCount    int                                `json:"updateCount"`
	Skills         []SkillsSourceCatalogSkillSnapshot `json:"skills"`
}

type SkillsSourceCatalogSkillSnapshot struct {
	Name                string `json:"name"`
	SkillPath           string `json:"skillPath,omitempty"`
	RemoteContentSHA256 string `json:"remoteContentSha256,omitempty"`
	LocalContentSHA256  string `json:"localContentSha256,omitempty"`
	Status              string `json:"status"`
	Installed           bool   `json:"installed"`
	Managed             bool   `json:"managed"`
	Conflict            bool   `json:"conflict"`
	Error               string `json:"error,omitempty"`
	CanInstall          bool   `json:"canInstall"`
	CanUpdate           bool   `json:"canUpdate"`
	CanUninstall        bool   `json:"canUninstall"`
}

type SkillsInstalledSkillSnapshot struct {
	Name      string
	Managed   bool
	Locations []string
}

type SkillsSourceScopeInput struct {
	ProjectRoot    string
	GlobalLockPath string
	HomeDir        string
	Installed      []SkillsInstalledSkillSnapshot
}

type skillSourceInstalledSnapshot = SkillsInstalledSkillSnapshot
type skillsSourceCatalogSkillSnapshot = SkillsSourceCatalogSkillSnapshot

func ScanSkillsSourceScope(ctx context.Context, input SkillsSourceScopeInput) (SkillsSourceScopeSnapshot, error) {
	if err := ctx.Err(); err != nil {
		return SkillsSourceScopeSnapshot{}, err
	}
	projectRoot := strings.TrimSpace(input.ProjectRoot)
	nativeLockPath := strings.TrimSpace(input.GlobalLockPath)
	if projectRoot != "" {
		nativeLockPath = filepath.Join(projectRoot, "skills-lock.json")
	} else if nativeLockPath == "" {
		nativeLockPath = defaultGlobalSkillsLockPath(input.HomeDir)
	}
	sourceLockPath := skillSourceLockPath(projectRoot, nativeLockPath, input.HomeDir)
	if sourceLockPath == "" {
		return SkillsSourceScopeSnapshot{}, fmt.Errorf("skill source lock path is unavailable")
	}
	migration, err := readOrMigrateSkillSourceLock(nativeLockPath, sourceLockPath)
	if err != nil {
		return SkillsSourceScopeSnapshot{}, err
	}
	native := readNativeSkillSourceEntries(nativeLockPath)
	snapshot := composeSkillSourceCatalog(migration.Lock, native, input.Installed, nil)
	if len(snapshot.NeedsResolutionSkills) == 0 && len(migration.NeedsResolutionSkills) > 0 {
		snapshot.NeedsResolutionSkills = append([]string(nil), migration.NeedsResolutionSkills...)
	}
	return snapshot, nil
}

func defaultGlobalSkillsLockPath(homeDir string) string {
	if stateHome := strings.TrimSpace(os.Getenv("XDG_STATE_HOME")); stateHome != "" {
		return filepath.Join(stateHome, "skills", ".skill-lock.json")
	}
	if homeDir = strings.TrimSpace(homeDir); homeDir != "" {
		return filepath.Join(homeDir, ".agents", ".skill-lock.json")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".agents", ".skill-lock.json")
}

func composeSkillSourceCatalog(
	lock skillSourceLock,
	native []nativeSkillSourceEntry,
	installed []skillSourceInstalledSnapshot,
	staleErrors map[string]string,
) SkillsSourceScopeSnapshot {
	sortSkillSourceLock(&lock)
	installedByName := make(map[string]skillSourceInstalledSnapshot, len(installed))
	for _, item := range installed {
		key := strings.ToLower(strings.TrimSpace(item.Name))
		if key != "" {
			installedByName[key] = item
		}
	}
	configured := make(map[string]struct{}, len(lock.Sources))
	for _, source := range lock.Sources {
		configured[strings.ToLower(source.SourceKey)] = struct{}{}
	}
	ownerByName := map[string]string{}
	for _, entry := range native {
		address := entry.SourceURL
		if address == "" {
			address = entry.Source
		}
		_, sourceKey, err := normalizeSkillGitSource(address)
		if err != nil {
			continue
		}
		if _, exists := configured[strings.ToLower(sourceKey)]; exists {
			ownerByName[strings.ToLower(entry.Name)] = strings.ToLower(sourceKey)
		}
	}

	result := SkillsSourceScopeSnapshot{
		Sources:         make([]SkillsSourceCatalogSnapshot, 0, len(lock.Sources)),
		UnmanagedSkills: []SkillsSourceCatalogSkillSnapshot{},
	}
	for _, source := range lock.Sources {
		view := SkillsSourceCatalogSnapshot{
			Source: source.Source, SourceKey: source.SourceKey, Ref: source.Ref,
			ResolvedCommit: source.ResolvedCommit, RefreshedAt: source.RefreshedAt,
			Status: "ready", Skills: []SkillsSourceCatalogSkillSnapshot{},
		}
		if source.ResolvedCommit == "" || source.RefreshedAt == "" {
			view.Status = "needs_refresh"
		}
		if message := strings.TrimSpace(staleErrors[strings.ToLower(source.SourceKey)]); message != "" {
			view.Status = "stale"
			view.Error = message
		}
		remoteNames := map[string]struct{}{}
		for _, remote := range source.SkillList {
			key := strings.ToLower(remote.Name)
			remoteNames[key] = struct{}{}
			row := SkillsSourceCatalogSkillSnapshot{
				Name: remote.Name, SkillPath: remote.SkillPath, RemoteContentSHA256: remote.ContentSHA256,
				Status: "uninstalled", CanInstall: view.Status == "ready",
			}
			local, localExists := installedByName[key]
			if localExists && ownerByName[key] == strings.ToLower(source.SourceKey) {
				row.Installed = true
				row.Managed = local.Managed
				row.CanInstall = false
				row.CanUninstall = true
				localHash, localErr := hashInstalledSkillCopies(local.Locations)
				row.LocalContentSHA256 = localHash
				switch {
				case localErr != nil:
					row.Status = "error"
					row.Error = localErr.Error()
				case view.Status != "ready":
					row.Status = "error"
					row.Error = "Source snapshot is not current."
				case localHash == remote.ContentSHA256:
					row.Status = "up_to_date"
				default:
					row.Status = "update_available"
					row.CanUpdate = true
				}
			}
			view.Skills = append(view.Skills, row)
		}
		if view.Status == "ready" {
			for nameKey, ownerKey := range ownerByName {
				if ownerKey != strings.ToLower(source.SourceKey) {
					continue
				}
				if _, exists := remoteNames[nameKey]; exists {
					continue
				}
				local, exists := installedByName[nameKey]
				if !exists {
					continue
				}
				localHash, localErr := hashInstalledSkillCopies(local.Locations)
				row := SkillsSourceCatalogSkillSnapshot{
					Name: local.Name, LocalContentSHA256: localHash, Status: "removed_upstream",
					Installed: true, Managed: local.Managed, CanUninstall: true,
				}
				if localErr != nil {
					row.Error = localErr.Error()
				}
				view.Skills = append(view.Skills, row)
			}
		}
		sort.Slice(view.Skills, func(i, j int) bool {
			return strings.ToLower(view.Skills[i].Name) < strings.ToLower(view.Skills[j].Name)
		})
		result.Sources = append(result.Sources, view)
	}

	for key, local := range installedByName {
		if _, managedBySource := ownerByName[key]; managedBySource {
			continue
		}
		localHash, localErr := hashInstalledSkillCopies(local.Locations)
		row := SkillsSourceCatalogSkillSnapshot{
			Name: local.Name, LocalContentSHA256: localHash, Status: "unmanaged",
			Installed: true, Managed: local.Managed,
		}
		if localErr != nil {
			row.Status = "error"
			row.Error = localErr.Error()
		}
		result.UnmanagedSkills = append(result.UnmanagedSkills, row)
	}
	sort.Slice(result.UnmanagedSkills, func(i, j int) bool {
		return strings.ToLower(result.UnmanagedSkills[i].Name) < strings.ToLower(result.UnmanagedSkills[j].Name)
	})
	applySkillSourceConflicts(&result)
	for sourceIndex := range result.Sources {
		source := &result.Sources[sourceIndex]
		for _, row := range source.Skills {
			if row.Installed {
				source.InstalledCount++
			}
			if row.CanUpdate {
				source.UpdateCount++
			}
		}
	}
	groups, _ := classifyNativeSkillSourceEntries(native)
	for _, group := range groups {
		if len(group.Sources) != 1 || len(group.Refs) != 1 {
			if _, configuredSource := configured[strings.ToLower(group.SourceKey)]; !configuredSource {
				result.NeedsResolutionSkills = append(result.NeedsResolutionSkills, group.Skills...)
			}
		}
	}
	sort.Strings(result.NeedsResolutionSkills)
	return result
}

func hashInstalledSkillCopies(locations []string) (string, error) {
	if len(locations) == 0 {
		return "", fmt.Errorf("installed skill has no visible locations")
	}
	uniquePaths := map[string]struct{}{}
	uniqueHashes := map[string]struct{}{}
	var firstHash string
	for _, location := range locations {
		location = strings.TrimSpace(location)
		if location == "" {
			continue
		}
		root := location
		if strings.EqualFold(filepath.Base(root), "SKILL.md") {
			root = filepath.Dir(root)
		}
		absolute, err := filepath.Abs(root)
		if err != nil {
			return "", err
		}
		key := strings.ToLower(filepath.Clean(absolute))
		if _, exists := uniquePaths[key]; exists {
			continue
		}
		uniquePaths[key] = struct{}{}
		contentHash, err := hashSkillDirectory(absolute)
		if err != nil {
			return "", err
		}
		if firstHash == "" {
			firstHash = contentHash
		}
		uniqueHashes[contentHash] = struct{}{}
	}
	if len(uniquePaths) == 0 {
		return "", fmt.Errorf("installed skill has no visible locations")
	}
	if len(uniqueHashes) != 1 {
		return firstHash, fmt.Errorf("installed skill copies have different content")
	}
	return firstHash, nil
}

func applySkillSourceConflicts(scope *SkillsSourceScopeSnapshot) {
	counts := map[string]int{}
	unmanaged := map[string]struct{}{}
	for _, row := range scope.UnmanagedSkills {
		unmanaged[strings.ToLower(row.Name)] = struct{}{}
	}
	for _, source := range scope.Sources {
		for _, row := range source.Skills {
			counts[strings.ToLower(row.Name)]++
		}
	}
	for sourceIndex := range scope.Sources {
		for rowIndex := range scope.Sources[sourceIndex].Skills {
			row := &scope.Sources[sourceIndex].Skills[rowIndex]
			key := strings.ToLower(row.Name)
			_, unmanagedCollision := unmanaged[key]
			if counts[key] <= 1 && !unmanagedCollision {
				continue
			}
			row.Status = "conflict"
			row.Conflict = true
			row.CanInstall = false
			row.CanUpdate = false
			row.CanUninstall = false
			row.Error = "Skill name conflicts with another source or unmanaged installation."
		}
	}
}
