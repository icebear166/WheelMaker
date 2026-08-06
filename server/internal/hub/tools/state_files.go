package tools

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// createUpdateLease atomically reserves a state path for the command that owns
// the corresponding operation. UpdateCommand only reads this state; the core
// updater is the owner for normal product updates.
func createUpdateLease(path string, lease updateLease) (bool, updateLease, error) {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		raw, readErr := os.ReadFile(path)
		if readErr != nil {
			return false, updateLease{}, readErr
		}
		var existing updateLease
		if jsonErr := json.Unmarshal(raw, &existing); jsonErr != nil || existing.Schema != 1 || existing.JobID == "" {
			return false, updateLease{}, errors.New("invalid existing update lease")
		}
		return false, existing, nil
	}
	if err != nil {
		return false, updateLease{}, err
	}
	raw, err := json.MarshalIndent(lease, "", "  ")
	if err == nil {
		raw = append(raw, '\n')
		_, err = file.Write(raw)
	}
	if syncErr := file.Sync(); err == nil {
		err = syncErr
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(path)
		return false, updateLease{}, err
	}
	return true, lease, nil
}

func replaceUpdateFile(path string, raw []byte, mode os.FileMode) (retErr error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".update-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer func() {
		_ = temporary.Close()
		if retErr != nil {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(mode); err != nil {
		return err
	}
	if _, err := temporary.Write(raw); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err == nil {
		return nil
	}
	backupPath := path + ".previous"
	_ = os.Remove(backupPath)
	if err := os.Rename(path, backupPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		_ = os.Rename(backupPath, path)
		return err
	}
	_ = os.Remove(backupPath)
	return nil
}

func newUpdateJobID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", raw[0:4], raw[4:6], raw[6:8], raw[8:10], raw[10:16]), nil
}
