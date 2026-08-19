package tools

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

func normalizeNativeSkillSource(raw string) (string, string, *skillsCommandError) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", "", &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "source is required"}
	}
	if strings.ContainsAny(raw, "\r\n\x00") {
		return "", "", &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "skill source contains invalid characters"}
	}
	identity, err := normalizeSkillSourceInput(raw)
	if err != nil {
		return "", "", &skillsCommandError{Code: rp.CodeForbidden, Message: err.Error()}
	}
	return identity.Source, identity.SourceKey, nil
}

func (c *SkillsCommand) nativeStore() *skillSourceStore {
	if c.store == nil {
		c.store = newSkillSourceStore(c.homeDir)
	}
	return c.store
}

func (c *SkillsCommand) withNativeScopeLock(target skillsCommandTarget, fn func() error) error {
	path := c.sourceLockFile(target)
	if strings.TrimSpace(path) == "" {
		return errors.New("skill source lock path is unavailable")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create skill source lock directory: %w", err)
	}
	return fn()
}

func (c *SkillsCommand) readNativeScopeLock(ctx context.Context, target skillsCommandTarget) (skillSourceLock, string, error) {
	installed, err := c.nativeInstalledNames(target)
	if err != nil {
		return skillSourceLock{}, "", err
	}
	migration, err := readOrMigrateSkillSourceLockWithMaterializer(
		c.skillsLockFile(target),
		c.sourceLockFile(target),
		installed,
		func(lock *skillSourceLock) (*skillSourceMigrationMaterialization, error) {
			return c.materializeNativeMigration(ctx, target, lock)
		},
	)
	if err != nil {
		return skillSourceLock{}, "", err
	}
	return migration.Lock, migration.Revision, nil
}

func (c *SkillsCommand) nativeInstalledNames(target skillsCommandTarget) (map[string]struct{}, error) {
	directories, err := c.skillsInstallDirs(target)
	if err != nil {
		return nil, err
	}
	installed := map[string]struct{}{}
	for _, directory := range directories {
		entries, err := os.ReadDir(directory)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("read installed skills directory: %w", err)
		}
		for _, entry := range entries {
			if validateSkillNames([]string{entry.Name()}) != nil {
				continue
			}
			root := filepath.Join(directory, entry.Name())
			rootInfo, rootErr := os.Stat(root)
			if rootErr != nil || !rootInfo.IsDir() {
				continue
			}
			info, err := os.Stat(filepath.Join(root, "SKILL.md"))
			if err == nil && !info.IsDir() {
				installed[strings.ToLower(entry.Name())] = struct{}{}
			}
		}
	}
	return installed, nil
}

func (c *SkillsCommand) materializeNativeMigration(ctx context.Context, target skillsCommandTarget, lock *skillSourceLock) (*skillSourceMigrationMaterialization, error) {
	if target.scope != "hub" || lock == nil || len(lock.Sources) == 0 {
		return nil, nil
	}
	sortSkillSourceLock(lock)
	releases := make([]func(), 0, len(lock.Sources))
	released := false
	releaseAll := func() {
		if released {
			return
		}
		released = true
		for index := len(releases) - 1; index >= 0; index-- {
			releases[index]()
		}
	}
	for _, source := range lock.Sources {
		_, sourceKey, err := skillSourceStoreInput(source)
		if err != nil {
			releaseAll()
			return nil, err
		}
		release, err := c.nativeStore().acquireSourceLock(ctx, sourceKey)
		if err != nil {
			releaseAll()
			return nil, err
		}
		releases = append(releases, release)
	}

	changes := make([]nativeDirectoryChange, 0)
	for index := range lock.Sources {
		source := lock.Sources[index]
		address, sourceKey, err := skillSourceStoreInput(source)
		if err != nil {
			releaseAll()
			return nil, err
		}
		checkout, err := c.nativeStore().inspectRepoLocked(ctx, address, sourceKey)
		if err != nil {
			releaseAll()
			return nil, err
		}
		managed := append([]string(nil), source.ManagedSkills...)
		lock.Sources[index] = nativeSnapshotFromCheckout(checkout, c.now(), managed)
		installChanges, err := c.nativeInstallChanges(target, checkout, managed)
		if err != nil {
			releaseAll()
			return nil, err
		}
		changes = append(changes, installChanges...)
	}
	transaction, err := applyNativeDirectoryChanges(changes)
	if err != nil {
		releaseAll()
		return nil, err
	}
	return &skillSourceMigrationMaterialization{
		rollback: transaction.Rollback,
		commit:   transaction.Commit,
		release:  releaseAll,
	}, nil
}

type nativeOperationOutcome struct {
	status       string
	exitCode     *int
	errorSummary string
	message      string
}

func (c *SkillsCommand) startNativeOperation(payload skillsCommandPayload, work func() error) (any, *skillsCommandError) {
	return c.startNativeOperationWithOutcome(payload, func(*skillsOperationSnapshot) nativeOperationOutcome {
		if err := work(); err != nil {
			code := -1
			return nativeOperationOutcome{
				status:       "failed",
				exitCode:     &code,
				errorSummary: sanitizeSkillSourceError(err.Error(), payload.Source),
			}
		}
		return nativeOperationOutcome{status: "succeeded", message: "Skills operation completed."}
	})
}

func (c *SkillsCommand) startNativeOperationWithOutcome(payload skillsCommandPayload, work func(*skillsOperationSnapshot) nativeOperationOutcome) (any, *skillsCommandError) {
	operation, cmdErr := c.acceptOperation(payload)
	if cmdErr != nil {
		return nil, cmdErr
	}
	accepted := cloneSkillsOperation(operation)
	go func() {
		outcome := work(operation)
		c.finishOperation(operation, outcome.status, outcome.exitCode, outcome.errorSummary, outcome.message)
	}()
	return skillsCommandResponse{
		OK: true, Accepted: true, HubID: payload.HubID, UpdatedAt: operation.StartedAt,
		Source: payload.Source, Scope: payload.Scope, ProjectName: payload.ProjectName,
		Operation: accepted,
	}, nil
}

func (c *SkillsCommand) startNativeScopeOperation(payload skillsCommandPayload, installAll bool) (any, *skillsCommandError) {
	target, cmdErr := c.resolveTarget(payload)
	if cmdErr != nil {
		return nil, cmdErr
	}
	if installAll {
		payload.Action = "installAllScope"
	} else {
		payload.Action = "updateScope"
	}
	return c.startNativeOperationWithOutcome(payload, func(operation *skillsOperationSnapshot) nativeOperationOutcome {
		return c.nativeScopeOperation(context.Background(), target, operation, installAll)
	})
}

func (c *SkillsCommand) nativeScopeOperation(ctx context.Context, target skillsCommandTarget, operation *skillsOperationSnapshot, installAll bool) nativeOperationOutcome {
	lock, _, err := c.readNativeScopeLock(ctx, target)
	if err != nil {
		code := -1
		return nativeOperationOutcome{
			status:       "failed",
			exitCode:     &code,
			errorSummary: sanitizeSkillSourceError(err.Error(), ""),
		}
	}
	action := "update"
	if installAll {
		action = "installAll"
	}
	failures := 0
	for _, source := range lock.Sources {
		var sourceErr error
		if installAll {
			sourceErr = c.nativeInstall(ctx, target, source.Source, nil, true)
		} else {
			sourceErr = c.nativeUpdateRepo(ctx, target, source.Source)
		}
		result := skillsOperationItemResult{Skill: source.SourceKey, Action: action, Status: "succeeded"}
		if sourceErr != nil {
			failures++
			result.Status = "failed"
			result.ErrorSummary = sanitizeSkillSourceError(sourceErr.Error(), source.Source)
		}
		c.appendSkillsOperationResult(operation, result)
	}
	if failures == 0 {
		return nativeOperationOutcome{status: "succeeded", message: "Skills operation completed."}
	}
	code := -1
	status := "partial"
	if failures == len(lock.Sources) {
		status = "failed"
	}
	return nativeOperationOutcome{
		status:       status,
		exitCode:     &code,
		errorSummary: fmt.Sprintf("%d of %d skill source operation(s) failed", failures, len(lock.Sources)),
		message:      "Skills operation completed with source failures.",
	}
}

func (c *SkillsCommand) inspectNativeRepo(ctx context.Context, payload skillsCommandPayload) (any, *skillsCommandError) {
	source, sourceKey, cmdErr := normalizeNativeSkillSource(payload.Source)
	if cmdErr != nil {
		return nil, cmdErr
	}
	checkout, err := c.nativeStore().inspectRepo(ctx, skillSourceSnapshot{Source: source, SourceKey: sourceKey})
	if err != nil {
		return skillsCommandResponse{OK: false, HubID: payload.HubID, Source: source, ErrorSummary: sanitizeSkillSourceError(err.Error(), source)}, nil
	}
	return skillsCommandResponse{
		OK: true, HubID: payload.HubID, UpdatedAt: c.now().Format(time.RFC3339), Source: source,
		Repo: nativeRepoSnapshot(checkout),
	}, nil
}

func (c *SkillsCommand) startNativeAddRepo(payload skillsCommandPayload) (any, *skillsCommandError) {
	target, cmdErr := c.resolveTarget(payload)
	if cmdErr != nil {
		return nil, cmdErr
	}
	source, sourceKey, cmdErr := normalizeNativeSkillSource(payload.Source)
	if cmdErr != nil {
		return nil, cmdErr
	}
	payload.Source = source
	return c.startNativeOperation(payload, func() error {
		return c.nativeAddRepo(context.Background(), target, source, sourceKey)
	})
}

func (c *SkillsCommand) startNativeRefreshRepo(payload skillsCommandPayload) (any, *skillsCommandError) {
	_, cmdErr := c.resolveTarget(payload)
	if cmdErr != nil {
		return nil, cmdErr
	}
	source, sourceKey, cmdErr := normalizeNativeSkillSource(payload.Source)
	if cmdErr != nil {
		return nil, cmdErr
	}
	payload.Source = source
	return c.startNativeOperation(payload, func() error {
		_, err := c.nativeStore().refreshRepo(context.Background(), skillSourceSnapshot{Source: source, SourceKey: sourceKey})
		return err
	})
}

func (c *SkillsCommand) startNativeUpdateRepo(payload skillsCommandPayload) (any, *skillsCommandError) {
	target, cmdErr := c.resolveTarget(payload)
	if cmdErr != nil {
		return nil, cmdErr
	}
	source, _, cmdErr := normalizeNativeSkillSource(payload.Source)
	if cmdErr != nil {
		return nil, cmdErr
	}
	payload.Source = source
	return c.startNativeOperation(payload, func() error {
		return c.nativeUpdateRepo(context.Background(), target, source)
	})
}

func (c *SkillsCommand) startNativeInstall(payload skillsCommandPayload, installAll bool) (any, *skillsCommandError) {
	target, cmdErr := c.resolveTarget(payload)
	if cmdErr != nil {
		return nil, cmdErr
	}
	source, _, cmdErr := normalizeNativeSkillSource(payload.Source)
	if cmdErr != nil {
		return nil, cmdErr
	}
	if !installAll && len(payload.Skills) == 0 {
		return nil, &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "skills are required"}
	}
	if !installAll {
		if err := validateSkillNames(payload.Skills); err != nil {
			return nil, err
		}
	}
	payload.Source = source
	if installAll {
		payload.Action = "installAll"
	}
	return c.startNativeOperation(payload, func() error {
		return c.nativeInstall(context.Background(), target, source, payload.Skills, installAll)
	})
}

func (c *SkillsCommand) startNativeUninstall(payload skillsCommandPayload) (any, *skillsCommandError) {
	target, cmdErr := c.resolveTarget(payload)
	if cmdErr != nil {
		return nil, cmdErr
	}
	if len(payload.Skills) == 0 {
		return nil, &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "skills are required"}
	}
	if err := validateSkillNames(payload.Skills); err != nil {
		return nil, err
	}
	if payload.Source != "" {
		source, _, sourceErr := normalizeNativeSkillSource(payload.Source)
		if sourceErr != nil {
			return nil, sourceErr
		}
		payload.Source = source
	}
	return c.startNativeOperation(payload, func() error {
		return c.nativeUninstall(context.Background(), target, payload.Source, payload.Skills)
	})
}

func (c *SkillsCommand) startNativeRemoveRepo(payload skillsCommandPayload) (any, *skillsCommandError) {
	target, cmdErr := c.resolveTarget(payload)
	if cmdErr != nil {
		return nil, cmdErr
	}
	source, _, cmdErr := normalizeNativeSkillSource(payload.Source)
	if cmdErr != nil {
		return nil, cmdErr
	}
	payload.Source = source
	return c.startNativeOperation(payload, func() error {
		return c.nativeRemoveRepo(context.Background(), target, source)
	})
}

func (c *SkillsCommand) nativeAddRepo(ctx context.Context, target skillsCommandTarget, source, sourceKey string) error {
	return c.withNativeScopeLock(target, func() error {
		lock, revision, err := c.readNativeScopeLock(ctx, target)
		if err != nil {
			return err
		}
		index := nativeSourceIndex(lock, sourceKey)
		if index >= 0 {
			return nil
		}
		return c.nativeStore().withUpdatedRepo(ctx, skillSourceSnapshot{Source: source, SourceKey: sourceKey}, func(checkout skillSourceCheckout) error {
			if nativeSourceIndex(lock, checkout.SourceKey) >= 0 {
				return nil
			}
			lock.Sources = append(lock.Sources, nativeSnapshotFromCheckout(checkout, c.now(), nil))
			sortSkillSourceLock(&lock)
			_, err := writeSkillSourceLockFile(c.sourceLockFile(target), revision, lock)
			return err
		})
	})
}

func (c *SkillsCommand) nativeUpdateRepo(ctx context.Context, target skillsCommandTarget, source string) error {
	return c.withNativeScopeLock(target, func() error {
		lock, revision, err := c.readNativeScopeLock(ctx, target)
		if err != nil {
			return err
		}
		sourceKey, normalizeErr := nativeSourceKeyFromLock(lock, source)
		if normalizeErr != nil {
			return normalizeErr
		}
		index := nativeSourceIndex(lock, sourceKey)
		if index < 0 {
			return errors.New("skill source is not installed in this scope")
		}
		sourceSnapshot := lock.Sources[index]
		return c.nativeStore().withUpdatedRepo(ctx, sourceSnapshot, func(checkout skillSourceCheckout) error {
			managed := append([]string(nil), sourceSnapshot.ManagedSkills...)
			changes, remaining, err := c.nativeChangesForManaged(
				target,
				checkout,
				managed,
				nativeManagedOwnersExcluding(lock, sourceKey),
			)
			if err != nil {
				return err
			}
			transaction, err := applyNativeDirectoryChanges(changes)
			if err != nil {
				return err
			}
			lock.Sources[index] = nativeSnapshotFromCheckout(checkout, c.now(), remaining)
			if _, err = writeSkillSourceLockFile(c.sourceLockFile(target), revision, lock); err != nil {
				return rollbackNativeTransaction(transaction, err)
			}
			transaction.Commit()
			return nil
		})
	})
}

func (c *SkillsCommand) nativeInstall(ctx context.Context, target skillsCommandTarget, source string, requested []string, installAll bool) error {
	return c.withNativeScopeLock(target, func() error {
		lock, revision, err := c.readNativeScopeLock(ctx, target)
		if err != nil {
			return err
		}
		sourceKey, normalizeErr := nativeSourceKeyFromLock(lock, source)
		if normalizeErr != nil {
			return normalizeErr
		}
		index := nativeSourceIndex(lock, sourceKey)
		if index < 0 {
			return errors.New("skill source is not added to this scope; add it first")
		}
		sourceSnapshot := lock.Sources[index]
		return c.nativeStore().withUpdatedRepo(ctx, sourceSnapshot, func(checkout skillSourceCheckout) error {
			if err := ensureNativeSkillSourceCheckoutReady(ctx, checkout); err != nil {
				return err
			}
			available := nativeSkillNames(checkout.Skills)
			selectedRequested := requested
			if installAll {
				selectedRequested = append([]string(nil), available...)
			}
			selected, err := canonicalNativeSkillNames(selectedRequested, available)
			if err != nil {
				return err
			}
			managed := append([]string(nil), sourceSnapshot.ManagedSkills...)
			needsSync := sourceSnapshot.Commit != "" && sourceSnapshot.Commit != checkout.Commit
			changes := []nativeDirectoryChange{}
			remaining := make([]string, 0, len(managed)+len(selected))
			if needsSync {
				syncChanges, syncRemaining, syncErr := c.nativeChangesForManaged(
					target,
					checkout,
					managed,
					nativeManagedOwnersExcluding(lock, sourceKey),
				)
				if syncErr != nil {
					return syncErr
				}
				changes = append(changes, syncChanges...)
				remaining = append(remaining, syncRemaining...)
			} else {
				remaining = append(remaining, managed...)
			}
			for _, name := range selected {
				if nativeContainsFold(remaining, name) {
					continue
				}
				remaining = append(remaining, name)
			}
			if needsSync {
				// The sync plan already stages all currently managed entries. Selected
				// entries are added below only when they were not previously managed.
				selected = filterNativeNamesNotIn(selected, managed)
			}
			installChanges, err := c.nativeInstallChanges(target, checkout, selected)
			if err != nil {
				return err
			}
			changes = append(changes, installChanges...)
			removeOwnershipFromOtherSources(&lock, sourceKey, selected)
			transaction, err := applyNativeDirectoryChanges(changes)
			if err != nil {
				return err
			}
			lock.Sources[index] = nativeSnapshotFromCheckout(checkout, c.now(), remaining)
			if _, err = writeSkillSourceLockFile(c.sourceLockFile(target), revision, lock); err != nil {
				return rollbackNativeTransaction(transaction, err)
			}
			transaction.Commit()
			return nil
		})
	})
}

func (c *SkillsCommand) nativeUninstall(ctx context.Context, target skillsCommandTarget, source string, names []string) error {
	return c.withNativeScopeLock(target, func() error {
		installed, err := c.nativeInstalledNames(target)
		if err != nil {
			return err
		}
		lock, revision, err := c.readNativeScopeLock(ctx, target)
		if err != nil {
			return err
		}
		wanted := map[string]struct{}{}
		for _, name := range names {
			wanted[strings.ToLower(name)] = struct{}{}
		}
		sourceKey := ""
		if strings.TrimSpace(source) != "" {
			sourceKey, err = nativeSourceKeyFromLock(lock, source)
			if err != nil {
				return err
			}
		}
		managedRemoved := map[string]struct{}{}
		lockChanged := false
		for index := range lock.Sources {
			if sourceKey != "" && !skillSourceKeysEqual(lock.Sources[index].SourceKey, sourceKey) {
				continue
			}
			kept := lock.Sources[index].ManagedSkills[:0]
			for _, managed := range lock.Sources[index].ManagedSkills {
				if _, ok := wanted[strings.ToLower(managed)]; ok {
					managedRemoved[strings.ToLower(managed)] = struct{}{}
					lockChanged = true
					continue
				}
				kept = append(kept, managed)
			}
			lock.Sources[index].ManagedSkills = kept
		}
		if sourceKey != "" && len(managedRemoved) == 0 {
			return errors.New("skill is not managed in this scope")
		}
		owners := nativeManagedOwners(lock)
		removeSet := map[string]struct{}{}
		for name := range managedRemoved {
			if _, stillOwned := owners[name]; !stillOwned {
				removeSet[name] = struct{}{}
			}
		}
		if sourceKey == "" {
			for name := range wanted {
				if _, managed := owners[name]; managed {
					continue
				}
				if _, exists := installed[name]; exists {
					removeSet[name] = struct{}{}
				}
			}
		}
		if len(removeSet) == 0 && !lockChanged {
			return errors.New("skill is not installed or managed in this scope")
		}
		removeNames := make([]string, 0, len(removeSet))
		for name := range removeSet {
			removeNames = append(removeNames, name)
		}
		sort.Strings(removeNames)
		removeChanges, removeErr := nativeRemoveChanges(c, target, removeNames)
		if removeErr != nil {
			return removeErr
		}
		transaction, err := applyNativeDirectoryChanges(removeChanges)
		if err != nil {
			return err
		}
		if lockChanged {
			if _, err = writeSkillSourceLockFile(c.sourceLockFile(target), revision, lock); err != nil {
				return rollbackNativeTransaction(transaction, err)
			}
		}
		transaction.Commit()
		return err
	})
}

func (c *SkillsCommand) nativeRemoveRepo(ctx context.Context, target skillsCommandTarget, source string) error {
	return c.withNativeScopeLock(target, func() error {
		lock, revision, err := c.readNativeScopeLock(ctx, target)
		if err != nil {
			return err
		}
		sourceKey, err := nativeSourceKeyFromLock(lock, source)
		if err != nil {
			return err
		}
		index := nativeSourceIndex(lock, sourceKey)
		if index < 0 {
			return errors.New("skill source is not installed in this scope")
		}
		removed := append([]string(nil), lock.Sources[index].ManagedSkills...)
		next := append([]skillSourceSnapshot(nil), lock.Sources[:index]...)
		next = append(next, lock.Sources[index+1:]...)
		lock.Sources = next
		owners := nativeManagedOwners(lock)
		filtered := removed[:0]
		for _, name := range removed {
			if _, stillOwned := owners[strings.ToLower(name)]; !stillOwned {
				filtered = append(filtered, name)
			}
		}
		removeChanges, removeErr := nativeRemoveChanges(c, target, filtered)
		if removeErr != nil {
			return removeErr
		}
		transaction, err := applyNativeDirectoryChanges(removeChanges)
		if err != nil {
			return err
		}
		if _, err = writeSkillSourceLockFile(c.sourceLockFile(target), revision, lock); err != nil {
			return rollbackNativeTransaction(transaction, err)
		}
		transaction.Commit()
		return err
	})
}

func rollbackNativeTransaction(transaction *nativeDirectoryTransaction, cause error) error {
	if transaction == nil {
		return cause
	}
	if rollbackErr := transaction.Rollback(); rollbackErr != nil {
		return errors.Join(cause, fmt.Errorf("rollback skill targets: %w", rollbackErr))
	}
	return cause
}

func nativeRepoSnapshot(checkout skillSourceCheckout) *skillsRepoSnapshot {
	return &skillsRepoSnapshot{
		Source: checkout.Source, SourceKey: checkout.SourceKey, Branch: checkout.Branch,
		Commit: checkout.Commit, RemoteCommit: checkout.RemoteCommit,
		UpdateAvailable: checkout.RemoteCommit != "" && checkout.RemoteCommit != checkout.Commit,
		Skills:          append([]skillSourceSkillSnapshot(nil), checkout.Skills...),
	}
}

func nativeSnapshotFromCheckout(checkout skillSourceCheckout, now time.Time, managed []string) skillSourceSnapshot {
	updated := now.UTC().Format(time.RFC3339)
	return skillSourceSnapshot{
		Source: checkout.Source, SourceKey: checkout.SourceKey, Branch: checkout.Branch,
		Commit: checkout.Commit, UpdatedAt: updated, ResolvedCommit: checkout.Commit, RefreshedAt: updated,
		ManagedSkills: append([]string(nil), managed...),
	}
}

func nativeSourceIndex(lock skillSourceLock, sourceKey string) int {
	for index, source := range lock.Sources {
		if skillSourceKeysEqual(source.SourceKey, sourceKey) {
			return index
		}
	}
	return -1
}

func nativeSourceKeyFromLock(lock skillSourceLock, source string) (string, error) {
	if identity, err := normalizeSkillSourceInput(source); err == nil && identity.SourceKey != "" {
		return identity.SourceKey, nil
	}
	for _, candidate := range lock.Sources {
		if candidate.Source == strings.TrimSpace(source) {
			return candidate.SourceKey, nil
		}
	}
	return "", errors.New("skill source is invalid or is not installed in this scope")
}

func ensureNativeSkillSourceCheckoutReady(ctx context.Context, checkout skillSourceCheckout) error {
	if identity, err := normalizePersistedSkillSource(checkout.Source); err == nil && identity.Kind == skillSourceKindWellKnown {
		return nil
	}
	return ensureSkillSourceCheckoutClean(ctx, checkout.Path)
}

func nativeSkillNames(skills []skillSourceSkillSnapshot) []string {
	names := make([]string, 0, len(skills))
	for _, skill := range skills {
		if strings.TrimSpace(skill.Name) != "" {
			names = append(names, skill.Name)
		}
	}
	sort.Slice(names, func(i, j int) bool { return strings.ToLower(names[i]) < strings.ToLower(names[j]) })
	return names
}

func canonicalNativeSkillNames(requested, available []string) ([]string, error) {
	byName := map[string]string{}
	for _, name := range available {
		byName[strings.ToLower(name)] = name
	}
	seen := map[string]struct{}{}
	selected := make([]string, 0, len(requested))
	for _, requestedName := range requested {
		name, ok := byName[strings.ToLower(requestedName)]
		if !ok {
			return nil, fmt.Errorf("skill not found in source: %s", requestedName)
		}
		if _, exists := seen[strings.ToLower(name)]; exists {
			continue
		}
		seen[strings.ToLower(name)] = struct{}{}
		selected = append(selected, name)
	}
	sort.Slice(selected, func(i, j int) bool { return strings.ToLower(selected[i]) < strings.ToLower(selected[j]) })
	return selected, nil
}

func filterNativeNamesNotIn(names, existing []string) []string {
	result := make([]string, 0, len(names))
	for _, name := range names {
		if !nativeContainsFold(existing, name) {
			result = append(result, name)
		}
	}
	return result
}

func nativeContainsFold(values []string, candidate string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), strings.TrimSpace(candidate)) {
			return true
		}
	}
	return false
}

func removeOwnershipFromOtherSources(lock *skillSourceLock, ownerKey string, names []string) {
	wanted := map[string]struct{}{}
	for _, name := range names {
		wanted[strings.ToLower(name)] = struct{}{}
	}
	for index := range lock.Sources {
		if skillSourceKeysEqual(lock.Sources[index].SourceKey, ownerKey) {
			continue
		}
		kept := lock.Sources[index].ManagedSkills[:0]
		for _, name := range lock.Sources[index].ManagedSkills {
			if _, remove := wanted[strings.ToLower(name)]; !remove {
				kept = append(kept, name)
			}
		}
		lock.Sources[index].ManagedSkills = kept
	}
}

func nativeManagedOwners(lock skillSourceLock) map[string]string {
	owners := map[string]string{}
	for _, source := range lock.Sources {
		for _, name := range source.ManagedSkills {
			owners[strings.ToLower(name)] = source.SourceKey
		}
	}
	return owners
}

func nativeManagedOwnersExcluding(lock skillSourceLock, sourceKey string) map[string]string {
	owners := map[string]string{}
	for _, source := range lock.Sources {
		if skillSourceKeysEqual(source.SourceKey, sourceKey) {
			continue
		}
		for _, name := range source.ManagedSkills {
			owners[strings.ToLower(name)] = source.SourceKey
		}
	}
	return owners
}

func (c *SkillsCommand) nativeChangesForManaged(
	target skillsCommandTarget,
	checkout skillSourceCheckout,
	names []string,
	preservedMissingOwners map[string]string,
) ([]nativeDirectoryChange, []string, error) {
	available := nativeSkillNames(checkout.Skills)
	byName := map[string]struct{}{}
	for _, name := range available {
		byName[strings.ToLower(name)] = struct{}{}
	}
	changes := []nativeDirectoryChange{}
	remaining := []string{}
	missing := []string{}
	for _, name := range names {
		if _, exists := byName[strings.ToLower(name)]; !exists {
			if _, stillOwned := preservedMissingOwners[strings.ToLower(name)]; !stillOwned {
				missing = append(missing, name)
			}
			continue
		}
		remaining = append(remaining, name)
	}
	installChanges, err := c.nativeInstallChanges(target, checkout, remaining)
	if err != nil {
		return nil, nil, err
	}
	changes = append(changes, installChanges...)
	removeChanges, err := nativeRemoveChanges(c, target, missing)
	if err != nil {
		return nil, nil, err
	}
	changes = append(changes, removeChanges...)
	sort.Slice(remaining, func(i, j int) bool { return strings.ToLower(remaining[i]) < strings.ToLower(remaining[j]) })
	return changes, remaining, nil
}

func (c *SkillsCommand) nativeInstallChanges(target skillsCommandTarget, checkout skillSourceCheckout, names []string) ([]nativeDirectoryChange, error) {
	changes := make([]nativeDirectoryChange, 0, len(names)*2)
	directories, err := c.skillsInstallDirs(target)
	if err != nil {
		return nil, err
	}
	for _, name := range names {
		root, err := nativeSkillRoot(checkout, name)
		if err != nil {
			return nil, err
		}
		for _, directory := range directories {
			final, err := nativeSkillTargetPath(directory, name)
			if err != nil {
				return nil, err
			}
			changes = append(changes, nativeDirectoryChange{
				Final: final, Source: root, Link: target.scope == "hub",
			})
		}
	}
	return changes, nil
}

func nativeRemoveChanges(c *SkillsCommand, target skillsCommandTarget, names []string) ([]nativeDirectoryChange, error) {
	changes := make([]nativeDirectoryChange, 0, len(names)*2)
	directories, err := c.skillsInstallDirs(target)
	if err != nil {
		return nil, err
	}
	for _, name := range names {
		for _, directory := range directories {
			final, err := nativeSkillTargetPath(directory, name)
			if err != nil {
				return nil, err
			}
			changes = append(changes, nativeDirectoryChange{Final: final, Remove: true})
		}
	}
	return changes, nil
}

func nativeSkillTargetPath(directory, name string) (string, error) {
	if err := validateSkillNames([]string{name}); err != nil {
		return "", err
	}
	root, err := validateNativeManagedRoot(directory)
	if err != nil {
		return "", err
	}
	final, err := filepath.Abs(filepath.Join(root, name))
	if err != nil {
		return "", fmt.Errorf("resolve skill target: %w", err)
	}
	relative, err := filepath.Rel(root, final)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return "", fmt.Errorf("skill path escapes skills directory: %s", name)
	}
	return final, nil
}

func validateNativeManagedRoot(directory string) (string, error) {
	root, err := filepath.Abs(strings.TrimSpace(directory))
	if err != nil {
		return "", fmt.Errorf("resolve skills directory: %w", err)
	}
	root = filepath.Clean(root)
	if root == "." || strings.TrimSpace(root) == "" {
		return "", errors.New("skills directory is required")
	}
	for current := root; ; current = filepath.Dir(current) {
		info, statErr := os.Lstat(current)
		if statErr == nil {
			if info.Mode()&os.ModeSymlink != 0 || isNativeReparsePoint(info) {
				return "", fmt.Errorf("managed skills directory contains a symlink: %s", current)
			}
			resolved, evalErr := filepath.EvalSymlinks(current)
			if evalErr != nil {
				return "", fmt.Errorf("resolve managed skills directory: %w", evalErr)
			}
			resolved, absErr := filepath.Abs(resolved)
			if absErr != nil || !samePath(current, resolved) {
				return "", fmt.Errorf("managed skills directory resolves through a link: %s", current)
			}
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return "", fmt.Errorf("inspect managed skills directory: %w", statErr)
		}
		parent := filepath.Dir(current)
		if samePath(parent, current) {
			break
		}
	}
	return root, nil
}

func isNativeReparsePoint(info os.FileInfo) bool {
	if info == nil || info.Sys() == nil {
		return false
	}
	value := reflect.ValueOf(info.Sys())
	if value.Kind() == reflect.Pointer {
		if value.IsNil() {
			return false
		}
		value = value.Elem()
	}
	if value.Kind() != reflect.Struct {
		return false
	}
	attributes := value.FieldByName("FileAttributes")
	return attributes.IsValid() && attributes.Kind() >= reflect.Uint && attributes.Kind() <= reflect.Uint64 && attributes.Uint()&0x400 != 0
}

func nativeSkillRoot(checkout skillSourceCheckout, name string) (string, error) {
	for _, skill := range checkout.Skills {
		if strings.EqualFold(skill.Name, name) {
			path := strings.ReplaceAll(skill.SkillPath, "\\", "/")
			if path == "" || strings.HasPrefix(path, "/") || filepath.IsAbs(path) || !strings.HasPrefix(path, "skills/") || !strings.HasSuffix(path, "/SKILL.md") {
				return "", fmt.Errorf("skill path is invalid for %s", name)
			}
			root := filepath.Join(checkout.Path, filepath.FromSlash(filepath.Dir(path)))
			relative, err := filepath.Rel(checkout.Path, root)
			if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
				return "", fmt.Errorf("skill path escapes source root for %s", name)
			}
			info, err := os.Stat(filepath.Join(root, "SKILL.md"))
			if err != nil || info.IsDir() {
				return "", fmt.Errorf("skill directory is unavailable for %s", name)
			}
			return root, nil
		}
	}
	return "", fmt.Errorf("skill not found in source: %s", name)
}

type nativeDirectoryChange struct {
	Final  string
	Source string
	Link   bool
	Remove bool
}

type nativeStagedChange struct {
	nativeDirectoryChange
	Stage     string
	Backup    string
	HadExist  bool
	Committed bool
}

type nativeDirectoryTransaction struct {
	items     []nativeStagedChange
	finalized bool
}

func applyNativeDirectoryChanges(changes []nativeDirectoryChange) (*nativeDirectoryTransaction, error) {
	transaction := &nativeDirectoryTransaction{items: make([]nativeStagedChange, 0, len(changes))}
	seen := map[string]struct{}{}
	cleanup := func() {
		for _, item := range transaction.items {
			if item.Stage != "" {
				_ = os.RemoveAll(item.Stage)
			}
			if item.Backup != "" {
				_ = os.RemoveAll(item.Backup)
			}
		}
	}
	for _, change := range changes {
		final, err := filepath.Abs(change.Final)
		if err != nil {
			cleanup()
			return nil, err
		}
		key := strings.ToLower(filepath.Clean(final))
		if _, exists := seen[key]; exists {
			cleanup()
			return nil, fmt.Errorf("duplicate skill target: %s", final)
		}
		seen[key] = struct{}{}
		change.Final = final
		item := nativeStagedChange{nativeDirectoryChange: change}
		if change.Remove {
			transaction.items = append(transaction.items, item)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(final), 0o755); err != nil {
			cleanup()
			return nil, err
		}
		stage, err := os.MkdirTemp(filepath.Dir(final), ".wheelmaker-skill-stage-")
		if err != nil {
			cleanup()
			return nil, err
		}
		_ = os.RemoveAll(stage)
		item.Stage = stage
		if change.Link {
			err = createSkillDirectoryLink(change.Source, stage)
		} else {
			err = copySkillDirectory(change.Source, stage)
		}
		if err != nil {
			transaction.items = append(transaction.items, item)
			cleanup()
			return nil, err
		}
		transaction.items = append(transaction.items, item)
	}
	for index := range transaction.items {
		item := &transaction.items[index]
		if _, err := os.Lstat(item.Final); err == nil {
			backup, backupErr := os.MkdirTemp(filepath.Dir(item.Final), ".wheelmaker-skill-backup-")
			if backupErr != nil {
				return nil, errors.Join(backupErr, transaction.Rollback())
			}
			_ = os.RemoveAll(backup)
			if err := os.Rename(item.Final, backup); err != nil {
				_ = os.RemoveAll(backup)
				return nil, errors.Join(fmt.Errorf("stage existing skill target: %w", err), transaction.Rollback())
			}
			item.Backup, item.HadExist = backup, true
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, errors.Join(err, transaction.Rollback())
		}
		if !item.Remove {
			if err := os.Rename(item.Stage, item.Final); err != nil {
				return nil, errors.Join(fmt.Errorf("replace skill target: %w", err), transaction.Rollback())
			}
			item.Stage = ""
		}
		item.Committed = true
	}
	return transaction, nil
}

func (transaction *nativeDirectoryTransaction) Rollback() error {
	if transaction == nil || transaction.finalized {
		return nil
	}
	var rollbackErr error
	for index := len(transaction.items) - 1; index >= 0; index-- {
		item := &transaction.items[index]
		if item.Committed {
			if err := os.RemoveAll(item.Final); err != nil && !errors.Is(err, os.ErrNotExist) {
				rollbackErr = errors.Join(rollbackErr, fmt.Errorf("remove staged skill target %s: %w", item.Final, err))
			}
		}
		if item.HadExist && item.Backup != "" {
			if err := os.Rename(item.Backup, item.Final); err != nil {
				rollbackErr = errors.Join(rollbackErr, fmt.Errorf("restore staged skill target %s: %w", item.Final, err))
			}
		}
		if item.Stage != "" {
			if err := os.RemoveAll(item.Stage); err != nil && !errors.Is(err, os.ErrNotExist) {
				rollbackErr = errors.Join(rollbackErr, fmt.Errorf("remove staged skill directory %s: %w", item.Stage, err))
			}
		}
	}
	transaction.finalized = true
	return rollbackErr
}

func (transaction *nativeDirectoryTransaction) Commit() {
	if transaction == nil || transaction.finalized {
		return
	}
	for _, item := range transaction.items {
		if item.Backup != "" {
			_ = os.RemoveAll(item.Backup)
		}
		if item.Stage != "" {
			_ = os.RemoveAll(item.Stage)
		}
	}
	transaction.finalized = true
}

func (c *SkillsCommand) nativeScan(ctx context.Context, hubID string) skillsCommandResponse {
	response := skillsCommandResponse{
		OK: true, HubID: hubID, UpdatedAt: c.now().Format(time.RFC3339),
		Projects: []skillsProjectSnapshot{},
	}
	hubTarget := skillsCommandTarget{scope: "hub"}
	hubSkills, hubErr := c.nativeScanScope(ctx, hubTarget)
	response.HubSkills = skillsScopeSnapshot{Scope: "hub", Skills: hubSkills}
	if hubErr != nil {
		response.OK = false
		response.ErrorSummary = hubErr.Error()
	}
	for _, project := range c.projectSnapshot() {
		target := skillsCommandTarget{scope: "project", projectName: project.Name, project: project, dir: project.Path}
		item := skillsProjectSnapshot{ProjectName: project.Name, ProjectID: rp.ProjectID(hubID, project.Name), Path: project.Path}
		item.Skills, hubErr = c.nativeScanScope(ctx, target)
		if hubErr != nil {
			item.Error = hubErr.Error()
		}
		response.Projects = append(response.Projects, item)
	}
	return response
}

func (c *SkillsCommand) nativeScanScope(ctx context.Context, target skillsCommandTarget) ([]skillsSkillSnapshot, error) {
	var result []skillsSkillSnapshot
	err := c.withNativeScopeLock(target, func() error {
		lock, _, err := c.readNativeScopeLock(ctx, target)
		if err != nil {
			return err
		}
		owners := nativeManagedOwners(lock)
		byName := map[string]*skillsSkillSnapshot{}
		directories, err := c.skillsInstallDirs(target)
		if err != nil {
			return err
		}
		for index, directory := range directories {
			entries, readErr := os.ReadDir(directory)
			if errors.Is(readErr, os.ErrNotExist) {
				continue
			}
			if readErr != nil {
				return readErr
			}
			for _, entry := range entries {
				if validateSkillNames([]string{entry.Name()}) != nil {
					continue
				}
				skillFile := filepath.Join(directory, entry.Name(), "SKILL.md")
				if info, statErr := os.Stat(skillFile); statErr != nil || info.IsDir() {
					continue
				}
				key := strings.ToLower(entry.Name())
				item := byName[key]
				if item == nil {
					categoryKey, category := skillCategory("")
					item = &skillsSkillSnapshot{Name: entry.Name(), Path: skillFile, Category: category, CategoryKey: categoryKey}
					byName[key] = item
				}
				if index == 0 || item.Path == "" {
					item.Path = skillFile
				}
				if index == 0 {
					item.Agents = appendUniqueFoldStrings(item.Agents, "codex")
				} else {
					item.Agents = appendUniqueFoldStrings(item.Agents, "claude")
				}
				if _, managed := owners[key]; managed {
					item.Managed = true
				}
			}
		}
		for _, item := range byName {
			sort.Slice(item.Agents, func(i, j int) bool { return strings.ToLower(item.Agents[i]) < strings.ToLower(item.Agents[j]) })
			result = append(result, *item)
		}
		return nil
	})
	sort.Slice(result, func(i, j int) bool { return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name) })
	return result, err
}

func (c *SkillsCommand) nativeDetail(ctx context.Context, payload skillsCommandPayload) (any, *skillsCommandError) {
	target, cmdErr := c.resolveTarget(payload)
	if cmdErr != nil {
		return nil, cmdErr
	}
	name := payload.SkillName
	if name == "" && len(payload.Skills) == 1 {
		name = payload.Skills[0]
	}
	if err := validateSkillNames([]string{name}); err != nil {
		return nil, err
	}
	var detail *skillsSkillDetailSnapshot
	err := c.withNativeScopeLock(target, func() error {
		lock, _, err := c.readNativeScopeLock(ctx, target)
		if err != nil {
			return err
		}
		owners := nativeManagedOwners(lock)
		directories, err := c.skillsInstallDirs(target)
		if err != nil {
			return err
		}
		var root string
		for _, directory := range directories {
			candidate := filepath.Join(directory, name)
			if info, statErr := os.Stat(filepath.Join(candidate, "SKILL.md")); statErr == nil && !info.IsDir() {
				root = candidate
				break
			}
		}
		if root == "" {
			return errors.New("skill not found")
		}
		markdown, cmdErr := readSkillMarkdown(root)
		if cmdErr != nil {
			return cmdErr
		}
		files, cmdErr := listSkillSupportingFiles(root)
		if cmdErr != nil {
			return cmdErr
		}
		categoryKey, category := skillCategory("")
		detail = &skillsSkillDetailSnapshot{
			Name: name, Scope: target.scope, ProjectName: target.projectName,
			Path: filepath.Join(root, "SKILL.md"), Category: category, CategoryKey: categoryKey,
			Managed: false, Agents: []string{"codex", "claude"},
			SkillMarkdown: markdown, SupportingFiles: files,
		}
		if ownerKey, managed := owners[strings.ToLower(name)]; managed {
			detail.Managed = true
			for _, source := range lock.Sources {
				if skillSourceKeysEqual(source.SourceKey, ownerKey) {
					detail.Source, detail.SourceURL, detail.SourceType = source.Source, source.Source, nativeSkillSourceType(source.Source)
					break
				}
			}
		}
		return nil
	})
	if err != nil {
		code := rp.CodeInternal
		if strings.Contains(err.Error(), "not found") {
			code = rp.CodeNotFound
		}
		return nil, &skillsCommandError{Code: code, Message: err.Error()}
	}
	return skillsCommandResponse{OK: true, HubID: payload.HubID, UpdatedAt: c.now().Format(time.RFC3339), Scope: target.scope, ProjectName: target.projectName, Detail: detail}, nil
}

func nativeSkillSourceType(source string) string {
	if identity, err := normalizePersistedSkillSource(source); err == nil && identity.Kind == skillSourceKindWellKnown {
		return "well-known"
	}
	return "git"
}
