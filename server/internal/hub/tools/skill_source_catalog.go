package tools

import (
	"bytes"
	"context"
	"encoding/json"
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
	Source         string                             `json:"source"`
	SourceKey      string                             `json:"sourceKey"`
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
	ProjectRoot        string
	GlobalLockPath     string
	HomeDir            string
	ReconciliationPath string
	Installed          []SkillsInstalledSkillSnapshot
	StaleErrors        map[string]string
}

type skillSourceReconciliation struct {
	Version int                         `json:"version"`
	Sources []skillSourceReconciledItem `json:"sources"`
}

type skillSourceReconciledItem struct {
	Source    string `json:"source"`
	SourceKey string `json:"sourceKey"`
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
	reconciliation, err := readSkillSourceReconciliation(input.ReconciliationPath)
	if err != nil {
		return SkillsSourceScopeSnapshot{}, err
	}
	var migration skillSourceMigrationResult
	_, sourceLockStatErr := os.Stat(sourceLockPath)
	if errors.Is(sourceLockStatErr, os.ErrNotExist) && len(reconciliation.Sources) > 0 {
		migration = skillSourceMigrationResult{Lock: newSkillSourceLock(), Revision: skillSourceMissingRevision}
	} else {
		migration, err = readOrMigrateSkillSourceLock(nativeLockPath, sourceLockPath)
		if err != nil {
			return SkillsSourceScopeSnapshot{}, err
		}
	}
	native := readNativeSkillSourceEntries(nativeLockPath)
	snapshot := composeSkillSourceCatalog(migration.Lock, native, input.Installed, input.StaleErrors)
	if len(snapshot.NeedsResolutionSkills) == 0 && len(migration.NeedsResolutionSkills) > 0 {
		snapshot.NeedsResolutionSkills = append([]string(nil), migration.NeedsResolutionSkills...)
	}
	pending := appendPendingSkillSourceRemovals(&snapshot, reconciliation, migration.Lock, native, input.Installed)
	if strings.TrimSpace(input.ReconciliationPath) != "" {
		next := skillSourceReconciliation{Version: 2, Sources: make([]skillSourceReconciledItem, 0, len(migration.Lock.Sources)+len(pending))}
		for _, source := range migration.Lock.Sources {
			next.Sources = append(next.Sources, skillSourceReconciledItem{Source: source.Source, SourceKey: source.SourceKey})
		}
		next.Sources = append(next.Sources, pending...)
		_, existingErr := os.Stat(input.ReconciliationPath)
		if len(next.Sources) > 0 || existingErr == nil {
			if err := writeSkillSourceReconciliation(input.ReconciliationPath, next); err != nil {
				return SkillsSourceScopeSnapshot{}, err
			}
		}
	}
	return snapshot, nil
}

func appendPendingSkillSourceRemovals(
	snapshot *SkillsSourceScopeSnapshot,
	previous skillSourceReconciliation,
	lock skillSourceLock,
	native []nativeSkillSourceEntry,
	installed []SkillsInstalledSkillSnapshot,
) []skillSourceReconciledItem {
	current := map[string]struct{}{}
	for _, source := range lock.Sources {
		current[strings.ToLower(source.SourceKey)] = struct{}{}
	}
	installedByName := map[string]SkillsInstalledSkillSnapshot{}
	for _, item := range installed {
		installedByName[strings.ToLower(item.Name)] = item
	}
	namesBySource := map[string][]string{}
	for _, entry := range native {
		address := entry.SourceURL
		if address == "" {
			address = entry.Source
		}
		_, sourceKey, err := normalizeSkillGitSource(address)
		if err == nil {
			namesBySource[strings.ToLower(sourceKey)] = append(namesBySource[strings.ToLower(sourceKey)], entry.Name)
		}
	}
	var active []skillSourceReconciledItem
	pendingNames := map[string]struct{}{}
	for _, previousSource := range previous.Sources {
		key := strings.ToLower(previousSource.SourceKey)
		if _, exists := current[key]; exists {
			continue
		}
		var rows []SkillsSourceCatalogSkillSnapshot
		for _, name := range namesBySource[key] {
			local, exists := installedByName[strings.ToLower(name)]
			if !exists {
				continue
			}
			localHash, localErr := hashInstalledSkillCopies(local.Locations)
			row := SkillsSourceCatalogSkillSnapshot{
				Name: local.Name, LocalContentSHA256: localHash, Status: "pending_removal",
				Installed: true, Managed: local.Managed, CanUninstall: true,
			}
			if localErr != nil {
				row.Error = localErr.Error()
			}
			rows = append(rows, row)
			pendingNames[strings.ToLower(local.Name)] = struct{}{}
		}
		if len(rows) == 0 {
			continue
		}
		sort.Slice(rows, func(i, j int) bool { return strings.ToLower(rows[i].Name) < strings.ToLower(rows[j].Name) })
		snapshot.Sources = append(snapshot.Sources, SkillsSourceCatalogSnapshot{
			Source: previousSource.Source, SourceKey: previousSource.SourceKey,
			Status: "pending_removal", InstalledCount: len(rows), Skills: rows,
		})
		active = append(active, previousSource)
	}
	if len(pendingNames) > 0 {
		unmanaged := snapshot.UnmanagedSkills[:0]
		for _, row := range snapshot.UnmanagedSkills {
			if _, pending := pendingNames[strings.ToLower(row.Name)]; !pending {
				unmanaged = append(unmanaged, row)
			}
		}
		snapshot.UnmanagedSkills = unmanaged
	}
	sort.Slice(snapshot.Sources, func(i, j int) bool {
		return strings.ToLower(snapshot.Sources[i].SourceKey) < strings.ToLower(snapshot.Sources[j].SourceKey)
	})
	applySkillSourceConflicts(snapshot)
	return active
}

func readSkillSourceReconciliation(path string) (skillSourceReconciliation, error) {
	if strings.TrimSpace(path) == "" {
		return skillSourceReconciliation{Version: 2, Sources: []skillSourceReconciledItem{}}, nil
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return skillSourceReconciliation{Version: 2, Sources: []skillSourceReconciledItem{}}, nil
	}
	if err != nil {
		return skillSourceReconciliation{}, err
	}
	var envelope struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return skillSourceReconciliation{}, fmt.Errorf("decode skill source reconciliation: %w", err)
	}
	if envelope.Version == 1 {
		var legacy struct {
			Version int `json:"version"`
			Sources []struct {
				Source    string `json:"source"`
				SourceKey string `json:"sourceKey"`
				Ref       string `json:"ref"`
			} `json:"sources"`
		}
		if err := json.Unmarshal(raw, &legacy); err != nil {
			return skillSourceReconciliation{}, fmt.Errorf("decode skill source reconciliation: %w", err)
		}
		state := skillSourceReconciliation{Version: 2, Sources: make([]skillSourceReconciledItem, 0, len(legacy.Sources))}
		for _, source := range legacy.Sources {
			state.Sources = append(state.Sources, skillSourceReconciledItem{Source: source.Source, SourceKey: source.SourceKey})
		}
		return state, nil
	}
	if envelope.Version != 2 {
		return skillSourceReconciliation{}, fmt.Errorf("unsupported skill source reconciliation version %d", envelope.Version)
	}
	var state skillSourceReconciliation
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		return skillSourceReconciliation{}, fmt.Errorf("decode skill source reconciliation: %w", err)
	}
	return state, nil
}

func writeSkillSourceReconciliation(path string, state skillSourceReconciliation) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	sort.Slice(state.Sources, func(i, j int) bool {
		return strings.ToLower(state.Sources[i].SourceKey) < strings.ToLower(state.Sources[j].SourceKey)
	})
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	if current, readErr := os.ReadFile(path); readErr == nil && bytes.Equal(current, raw) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".skill-source-reconciliation-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	closed := false
	defer func() {
		if !closed {
			_ = temporary.Close()
		}
		_ = os.Remove(temporaryPath)
	}()
	if err := temporary.Chmod(0o600); err != nil {
		return err
	}
	if _, err := temporary.Write(raw); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		closed = true
		return err
	}
	closed = true
	return os.Rename(temporaryPath, path)
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
			Source: source.Source, SourceKey: source.SourceKey,
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
				case errors.Is(localErr, errInstalledSkillCopiesDiffer) && view.Status == "ready":
					row.Status = "copies_differ"
					row.CanUpdate = true
				case localErr != nil && !errors.Is(localErr, errInstalledSkillCopiesDiffer):
					row.Status = "error"
					row.Error = localErr.Error()
				case view.Status != "ready":
					row.Status = view.Status
				case localHash == remote.ContentSHA256:
					row.Status = "up_to_date"
				default:
					row.Status = "update_available"
					row.CanUpdate = true
				}
			}
			view.Skills = append(view.Skills, row)
		}
		if view.Status == "needs_refresh" {
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
					Name: local.Name, LocalContentSHA256: localHash, Status: "needs_refresh",
					Installed: true, Managed: local.Managed, CanUninstall: true,
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
			return "", fmt.Errorf("resolve installed skill root %q: %w", absolute, err)
		}
		if linkTarget, linkErr := os.Readlink(absolute); linkErr == nil {
			if !filepath.IsAbs(linkTarget) {
				linkTarget = filepath.Join(filepath.Dir(absolute), linkTarget)
			}
			resolved, err = filepath.EvalSymlinks(linkTarget)
			if err != nil {
				return "", fmt.Errorf("resolve installed skill root %q: %w", absolute, err)
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
