package tools

import (
	"context"
	"errors"
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
	Source          string                             `json:"source"`
	SourceKey       string                             `json:"sourceKey"`
	Branch          string                             `json:"branch,omitempty"`
	Commit          string                             `json:"commit,omitempty"`
	RemoteCommit    string                             `json:"remoteCommit,omitempty"`
	UpdateAvailable bool                               `json:"updateAvailable"`
	ResolvedCommit  string                             `json:"resolvedCommit,omitempty"`
	RefreshedAt     string                             `json:"refreshedAt,omitempty"`
	Status          string                             `json:"status"`
	Error           string                             `json:"error,omitempty"`
	InstalledCount  int                                `json:"installedCount"`
	UpdateCount     int                                `json:"updateCount"`
	Skills          []SkillsSourceCatalogSkillSnapshot `json:"skills"`
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
	ProjectRoot string
	// GlobalLockPath is retained for source compatibility; native skills lock
	// files are intentionally ignored by the 2.0 scanner.
	GlobalLockPath string
	HomeDir        string
	// ReconciliationPath is retained for source compatibility; source removal
	// reconciliation is now represented directly by the canonical lock.
	ReconciliationPath string
	Installed          []SkillsInstalledSkillSnapshot
	StaleErrors        map[string]string
}

type skillSourceInstalledSnapshot = SkillsInstalledSkillSnapshot
type skillsSourceCatalogSkillSnapshot = SkillsSourceCatalogSkillSnapshot

func ScanSkillsSourceScope(ctx context.Context, input SkillsSourceScopeInput) (SkillsSourceScopeSnapshot, error) {
	if err := ctx.Err(); err != nil {
		return SkillsSourceScopeSnapshot{}, err
	}
	projectRoot := strings.TrimSpace(input.ProjectRoot)
	sourceLockPath := skillSourceLockPath(projectRoot, input.HomeDir)
	if sourceLockPath == "" {
		return SkillsSourceScopeSnapshot{}, fmt.Errorf("skill source lock path is unavailable")
	}
	command := newSkillsCommandWithRunner(nil, skillsCommandConfig{HomeDir: input.HomeDir})
	target := skillsCommandTarget{scope: "hub"}
	if projectRoot != "" {
		target = skillsCommandTarget{scope: "project", dir: projectRoot}
	}
	var migration skillSourceMigrationResult
	installedNames := map[string]struct{}{}
	for _, item := range input.Installed {
		if name := strings.TrimSpace(item.Name); name != "" {
			installedNames[strings.ToLower(name)] = struct{}{}
		}
	}
	err := withSkillSourceLockFile(sourceLockPath, func() error {
		var err error
		migration, err = readOrMigrateSkillSourceLockWithMaterializer(
			legacySkillSourceLockPath(projectRoot, input.HomeDir),
			sourceLockPath,
			installedNames,
			func(lock *skillSourceLock) (*skillSourceMigrationMaterialization, error) {
				return command.materializeNativeMigration(ctx, target, lock)
			},
		)
		return err
	})
	if err != nil {
		return SkillsSourceScopeSnapshot{}, err
	}
	lock := migration.Lock
	populateSkillSourceWorkingTree(ctx, input.HomeDir, &lock)
	snapshot := composeSkillSourceCatalog(lock, nil, input.Installed, input.StaleErrors)
	if len(snapshot.NeedsResolutionSkills) == 0 && len(migration.NeedsResolutionSkills) > 0 {
		snapshot.NeedsResolutionSkills = append([]string(nil), migration.NeedsResolutionSkills...)
	}
	return snapshot, nil
}

func populateSkillSourceWorkingTree(ctx context.Context, homeDir string, lock *skillSourceLock) {
	if lock == nil {
		return
	}
	store := newSkillSourceStore(homeDir)
	for index := range lock.Sources {
		source := &lock.Sources[index]
		_, err := os.Stat(store.repositoryPath(source.SourceKey))
		if errors.Is(err, os.ErrNotExist) {
			source.Status = "needs_clone"
			if identity, identityErr := normalizePersistedSkillSource(source.Source); identityErr == nil && identity.Kind == skillSourceKindWellKnown {
				source.Status = "needs_fetch"
			}
			continue
		} else if err != nil {
			source.Status = "error"
			source.Error = err.Error()
			continue
		}
		checkout, err := store.readRepo(ctx, *source)
		if err != nil {
			source.Status = "stale"
			source.Error = err.Error()
			continue
		}
		source.Status = "ready"
		source.Error = ""
		source.SkillList = append([]skillSourceSkillSnapshot(nil), checkout.Skills...)
		source.Branch = checkout.Branch
		source.RemoteCommit = checkout.RemoteCommit
		source.UpdateAvailable = checkout.RemoteCommit != "" && source.Commit != "" && checkout.RemoteCommit != source.Commit
	}
}

func composeSkillSourceCatalog(
	lock skillSourceLock,
	_ []nativeSkillSourceEntry,
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
	ownerByName := map[string]string{}
	for _, source := range lock.Sources {
		for _, name := range source.ManagedSkills {
			if key := strings.ToLower(strings.TrimSpace(name)); key != "" {
				ownerByName[key] = skillSourceKeyMapKey(source.SourceKey)
			}
		}
	}

	result := SkillsSourceScopeSnapshot{
		Sources:         make([]SkillsSourceCatalogSnapshot, 0, len(lock.Sources)),
		UnmanagedSkills: []SkillsSourceCatalogSkillSnapshot{},
	}
	for _, source := range lock.Sources {
		view := SkillsSourceCatalogSnapshot{
			Source: source.Source, SourceKey: source.SourceKey,
			Branch: source.Branch, Commit: source.Commit,
			ResolvedCommit: source.ResolvedCommit, RefreshedAt: source.RefreshedAt,
			Status: source.Status, Error: source.Error, Skills: []SkillsSourceCatalogSkillSnapshot{},
		}
		if view.Status == "" {
			view.Status = "ready"
		}
		if source.Commit == "" || source.UpdatedAt == "" {
			if view.Status == "ready" {
				view.Status = "needs_refresh"
			}
		}
		view.RemoteCommit = source.RemoteCommit
		view.UpdateAvailable = source.UpdateAvailable
		if message := strings.TrimSpace(staleErrors[skillSourceKeyMapKey(source.SourceKey)]); message != "" {
			view.Status = "stale"
			view.Error = message
		}
		remoteNames := map[string]struct{}{}
		for _, remote := range source.SkillList {
			key := strings.ToLower(remote.Name)
			remoteNames[key] = struct{}{}
			row := SkillsSourceCatalogSkillSnapshot{
				Name: remote.Name, SkillPath: remote.SkillPath, RemoteContentSHA256: remote.ContentSHA256,
				Status: "uninstalled", CanInstall: true,
			}
			local, localExists := installedByName[key]
			if localExists && ownerByName[key] == skillSourceKeyMapKey(source.SourceKey) {
				row.Installed = true
				row.Managed = true
				row.CanInstall = false
				row.CanUninstall = true
				localHash, localErr := hashInstalledSkillCopies(local.Locations)
				row.LocalContentSHA256 = localHash
				switch {
				case errors.Is(localErr, errInstalledSkillCopiesDiffer) && view.Status == "ready":
					row.Status = "copies_differ"
				case localErr != nil && !errors.Is(localErr, errInstalledSkillCopiesDiffer):
					row.Status = "error"
					row.Error = localErr.Error()
				case view.Status != "ready":
					row.Status = view.Status
				case remote.ContentSHA256 != "" && localHash == remote.ContentSHA256:
					row.Status = "up_to_date"
				default:
					row.Status = "update_available"
				}
			}
			view.Skills = append(view.Skills, row)
		}
		if view.Status != "ready" {
			for nameKey, ownerKey := range ownerByName {
				if ownerKey != skillSourceKeyMapKey(source.SourceKey) {
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
					Name: local.Name, LocalContentSHA256: localHash, Status: view.Status,
					Installed: true, Managed: true, CanUninstall: true,
				}
				if localErr != nil && !errors.Is(localErr, errInstalledSkillCopiesDiffer) {
					row.Status = "error"
					row.Error = localErr.Error()
				}
				view.Skills = append(view.Skills, row)
			}
		}
		if view.Status == "ready" {
			for nameKey, ownerKey := range ownerByName {
				if ownerKey != skillSourceKeyMapKey(source.SourceKey) {
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
			Installed: true, Managed: local.Managed, CanUninstall: true,
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
	sort.Strings(result.NeedsResolutionSkills)
	return result
}

var errInstalledSkillCopiesDiffer = errors.New("installed skill copies have different content")

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
		resolved, err := filepath.EvalSymlinks(absolute)
		if err != nil {
			if _, statErr := os.Stat(absolute); statErr != nil {
				return "", fmt.Errorf("resolve installed skill root %q: %w", absolute, err)
			}
			resolved = absolute
		}
		if linkTarget, linkErr := os.Readlink(absolute); linkErr == nil {
			if !filepath.IsAbs(linkTarget) {
				linkTarget = filepath.Join(filepath.Dir(absolute), linkTarget)
			}
			resolved, err = filepath.EvalSymlinks(linkTarget)
			if err != nil {
				if _, statErr := os.Stat(absolute); statErr != nil {
					return "", fmt.Errorf("resolve installed skill root %q: %w", absolute, err)
				}
				resolved = absolute
			}
		}
		absolute, err = filepath.Abs(resolved)
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
		return firstHash, errInstalledSkillCopiesDiffer
	}
	return firstHash, nil
}

func applySkillSourceConflicts(scope *SkillsSourceScopeSnapshot) {
	// Skill ownership is resolved by the last successful installation. A
	// duplicate name is therefore an overwrite decision, not a persistent
	// conflict that blocks every source row.
}
