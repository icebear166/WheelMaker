package shared

import (
	"fmt"
	"os"
	"path/filepath"
)

// WriteConfigFile atomically replaces a config file and applies private permissions.
func WriteConfigFile(path string, data []byte) (retErr error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".config-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary config: %w", err)
	}
	tmpPath := tmp.Name()
	defer func() {
		_ = tmp.Close()
		if retErr != nil {
			_ = os.Remove(tmpPath)
		}
	}()
	if err := tmp.Chmod(0o600); err != nil {
		return fmt.Errorf("set temporary config mode: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		return fmt.Errorf("write temporary config: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		return fmt.Errorf("sync temporary config: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temporary config: %w", err)
	}
	if err := SecureConfigFile(tmpPath); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("replace config: %w", err)
	}
	if err := SecureConfigFile(path); err != nil {
		return err
	}
	return nil
}

// SecureConfigFile restricts a config file to the current OS user and SYSTEM where applicable.
func SecureConfigFile(path string) error {
	if err := secureConfigFile(path); err != nil {
		return fmt.Errorf("secure config %s: %w", path, err)
	}
	return nil
}
