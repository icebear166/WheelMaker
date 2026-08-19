package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	wellKnownSourceMetadataFile    = ".wheelmaker-source.json"
	wellKnownSourceMetadataVersion = 1
)

type wellKnownSourceMetadata struct {
	Version   int                        `json:"version"`
	Source    string                     `json:"source"`
	SourceKey string                     `json:"sourceKey"`
	Revision  string                     `json:"revision"`
	Skills    []skillSourceSkillSnapshot `json:"skills"`
}

func (s *skillSourceStore) wellKnownProvider() *wellKnownSkillSourceProvider {
	if s.wellKnown == nil {
		s.wellKnown = newWellKnownSkillSourceProvider(nil)
	}
	return s.wellKnown
}

func skillSourceWellKnownIdentityForSnapshot(source skillSourceSnapshot) (skillSourceIdentity, bool, error) {
	address := strings.TrimSpace(source.Source)
	if address == "" {
		return skillSourceIdentity{}, false, nil
	}
	identity, err := normalizeSkillSourceInput(address)
	if err != nil {
		return skillSourceIdentity{}, false, nil
	}
	if identity.Kind != skillSourceKindWellKnown {
		return skillSourceIdentity{}, false, nil
	}
	declaredKey := strings.TrimSpace(source.SourceKey)
	if declaredKey == "" {
		return identity, true, nil
	}
	if identity.SourceKey == "" {
		return skillSourceIdentity{}, true, errors.New("well-known skill source key requires a canonical index")
	}
	if identity.SourceKey != declaredKey {
		return skillSourceIdentity{}, true, errors.New("skill source key does not match its canonical source")
	}
	return identity, true, nil
}

func (s *skillSourceStore) ensureLatestWellKnown(ctx context.Context, identity skillSourceIdentity) (skillSourceCheckout, error) {
	var checkout skillSourceCheckout
	err := s.withUpdatedWellKnown(ctx, identity, func(current skillSourceCheckout) error {
		checkout = current
		return nil
	})
	return checkout, err
}

func (s *skillSourceStore) withUpdatedWellKnown(ctx context.Context, identity skillSourceIdentity, fn func(skillSourceCheckout) error) error {
	if identity.Kind != skillSourceKindWellKnown {
		return errors.New("skill source is not a well-known source")
	}
	if identity.SourceKey == "" {
		prepared, cleanup, err := s.prepareWellKnownSnapshot(ctx, identity.Source)
		if err != nil {
			return err
		}
		defer cleanup()
		_, err = s.withSourceLock(ctx, prepared.SourceKey, func() (skillSourceCheckout, error) {
			published, err := s.publishWellKnownSnapshot(prepared)
			if err != nil {
				return skillSourceCheckout{}, err
			}
			if fn != nil {
				if err := fn(published); err != nil {
					return skillSourceCheckout{}, err
				}
			}
			return published, nil
		})
		return err
	}

	_, err := s.withSourceLock(ctx, identity.SourceKey, func() (skillSourceCheckout, error) {
		prepared, cleanup, err := s.prepareWellKnownSnapshot(ctx, identity.Source)
		if err != nil {
			return skillSourceCheckout{}, err
		}
		defer cleanup()
		published, err := s.publishWellKnownSnapshot(prepared)
		if err != nil {
			return skillSourceCheckout{}, err
		}
		if fn != nil {
			if err := fn(published); err != nil {
				return skillSourceCheckout{}, err
			}
		}
		return published, nil
	})
	return err
}

func (s *skillSourceStore) prepareWellKnownSnapshot(ctx context.Context, source string) (skillSourceCheckout, func(), error) {
	if err := os.MkdirAll(s.root, 0o755); err != nil {
		return skillSourceCheckout{}, nil, fmt.Errorf("create skill source store: %w", err)
	}
	stagingParent, err := os.MkdirTemp(s.root, ".well-known-stage-*")
	if err != nil {
		return skillSourceCheckout{}, nil, fmt.Errorf("create well-known source staging: %w", err)
	}
	cleanup := func() { _ = os.RemoveAll(stagingParent) }
	checkout, err := s.wellKnownProvider().materialize(ctx, source, filepath.Join(stagingParent, "snapshot"))
	if err != nil {
		cleanup()
		return skillSourceCheckout{}, nil, err
	}
	metadata := wellKnownSourceMetadata{
		Version: wellKnownSourceMetadataVersion, Source: checkout.Source, SourceKey: checkout.SourceKey,
		Revision: checkout.Commit, Skills: append([]skillSourceSkillSnapshot(nil), checkout.Skills...),
	}
	if err := writeWellKnownSourceMetadata(checkout.Path, metadata); err != nil {
		cleanup()
		return skillSourceCheckout{}, nil, err
	}
	return checkout, cleanup, nil
}

func (s *skillSourceStore) publishWellKnownSnapshot(prepared skillSourceCheckout) (skillSourceCheckout, error) {
	stablePath := s.repositoryPath(prepared.SourceKey)
	if filepath.Clean(prepared.Path) == filepath.Clean(stablePath) {
		return prepared, nil
	}
	backupParent, err := os.MkdirTemp(s.root, ".well-known-backup-*")
	if err != nil {
		return skillSourceCheckout{}, fmt.Errorf("create well-known source backup: %w", err)
	}
	defer os.RemoveAll(backupParent)
	backupPath := filepath.Join(backupParent, "snapshot")
	hadPrevious := false
	if _, err := os.Lstat(stablePath); err == nil {
		if err := s.renameWellKnownPath(stablePath, backupPath); err != nil {
			return skillSourceCheckout{}, fmt.Errorf("backup well-known source snapshot: %w", err)
		}
		hadPrevious = true
	} else if !errors.Is(err, os.ErrNotExist) {
		return skillSourceCheckout{}, fmt.Errorf("inspect well-known source snapshot: %w", err)
	}
	if err := s.renameWellKnownPath(prepared.Path, stablePath); err != nil {
		if hadPrevious {
			if restoreErr := s.renameWellKnownPath(backupPath, stablePath); restoreErr != nil {
				return skillSourceCheckout{}, errors.Join(
					fmt.Errorf("publish well-known source snapshot: %w", err),
					fmt.Errorf("restore previous well-known source snapshot: %w", restoreErr),
				)
			}
		}
		return skillSourceCheckout{}, fmt.Errorf("publish well-known source snapshot: %w", err)
	}
	prepared.Path = stablePath
	return prepared, nil
}

func (s *skillSourceStore) renameWellKnownPath(oldPath, newPath string) error {
	if s.renamePath != nil {
		return s.renamePath(oldPath, newPath)
	}
	return os.Rename(oldPath, newPath)
}

func (s *skillSourceStore) readWellKnown(ctx context.Context, identity skillSourceIdentity) (skillSourceCheckout, error) {
	if identity.Kind != skillSourceKindWellKnown || identity.SourceKey == "" {
		return skillSourceCheckout{}, errors.New("well-known skill source must identify a canonical index")
	}
	return s.withSourceLock(ctx, identity.SourceKey, func() (skillSourceCheckout, error) {
		path := s.repositoryPath(identity.SourceKey)
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			return skillSourceCheckout{}, errors.New("well-known skill source snapshot is missing")
		} else if err != nil {
			return skillSourceCheckout{}, fmt.Errorf("inspect well-known skill source snapshot: %w", err)
		}
		metadata, err := readWellKnownSourceMetadata(path)
		if err != nil {
			return skillSourceCheckout{}, err
		}
		if metadata.Source != identity.Source || metadata.SourceKey != identity.SourceKey {
			return skillSourceCheckout{}, errors.New("well-known skill source metadata identity does not match")
		}
		return skillSourceCheckout{
			Source: metadata.Source, SourceKey: metadata.SourceKey, Path: path,
			Commit: metadata.Revision, RemoteCommit: metadata.Revision,
			Skills: append([]skillSourceSkillSnapshot(nil), metadata.Skills...),
		}, nil
	})
}

func writeWellKnownSourceMetadata(root string, metadata wellKnownSourceMetadata) error {
	if err := validateWellKnownSourceMetadata(root, metadata); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		return fmt.Errorf("encode well-known source metadata: %w", err)
	}
	raw = append(raw, '\n')
	if err := os.WriteFile(filepath.Join(root, wellKnownSourceMetadataFile), raw, 0o600); err != nil {
		return fmt.Errorf("write well-known source metadata: %w", err)
	}
	return nil
}

func readWellKnownSourceMetadata(root string) (wellKnownSourceMetadata, error) {
	raw, err := os.ReadFile(filepath.Join(root, wellKnownSourceMetadataFile))
	if errors.Is(err, os.ErrNotExist) {
		return wellKnownSourceMetadata{}, errors.New("well-known skill source metadata is missing")
	}
	if err != nil {
		return wellKnownSourceMetadata{}, fmt.Errorf("read well-known source metadata: %w", err)
	}
	var metadata wellKnownSourceMetadata
	if err := decodeStrictSkillJSON(raw, &metadata); err != nil {
		return wellKnownSourceMetadata{}, fmt.Errorf("decode well-known source metadata: %w", err)
	}
	if err := validateWellKnownSourceMetadata(root, metadata); err != nil {
		return wellKnownSourceMetadata{}, err
	}
	return metadata, nil
}

func validateWellKnownSourceMetadata(root string, metadata wellKnownSourceMetadata) error {
	if metadata.Version != wellKnownSourceMetadataVersion {
		return fmt.Errorf("unsupported well-known source metadata version %d", metadata.Version)
	}
	identity, err := normalizePersistedSkillSource(metadata.Source)
	if err != nil || identity.Kind != skillSourceKindWellKnown || identity.Source != metadata.Source || identity.SourceKey != metadata.SourceKey {
		return errors.New("well-known source metadata identity is invalid")
	}
	if len(metadata.Revision) != 64 || !skillSourceHexPattern.MatchString(metadata.Revision) {
		return errors.New("well-known source metadata revision is invalid")
	}
	if len(metadata.Skills) == 0 {
		return errors.New("well-known source metadata contains no skills")
	}
	seen := map[string]struct{}{}
	for _, skill := range metadata.Skills {
		if !validWellKnownSkillName(skill.Name) {
			return fmt.Errorf("well-known source metadata has invalid skill name %q", skill.Name)
		}
		key := strings.ToLower(skill.Name)
		if _, exists := seen[key]; exists {
			return fmt.Errorf("well-known source metadata has duplicate skill %q", skill.Name)
		}
		seen[key] = struct{}{}
		wantPath := filepath.ToSlash(filepath.Join("skills", skill.Name, "SKILL.md"))
		if skill.SkillPath != wantPath || len(skill.ContentSHA256) != 64 || !skillSourceHexPattern.MatchString(skill.ContentSHA256) {
			return fmt.Errorf("well-known source metadata for skill %q is invalid", skill.Name)
		}
		skillRoot := filepath.Join(root, "skills", skill.Name)
		if info, err := os.Lstat(filepath.Join(skillRoot, "SKILL.md")); err != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("well-known source skill %q is missing SKILL.md", skill.Name)
		}
		contentHash, err := hashSkillDirectory(skillRoot)
		if err != nil {
			return fmt.Errorf("hash well-known source skill %q: %w", skill.Name, err)
		}
		if contentHash != skill.ContentSHA256 {
			return fmt.Errorf("well-known source skill %q content does not match metadata", skill.Name)
		}
	}
	return nil
}
