package tools

import (
	"archive/zip"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const maxDebugWebArchiveBytes = int64(512 << 20)

func extractDebugWebZip(archivePath, destination string) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer reader.Close()
	if len(reader.File) == 0 || len(reader.File) > 10000 {
		return errors.New("invalid debug web zip")
	}
	if err := os.MkdirAll(destination, 0o755); err != nil {
		return err
	}
	for _, entry := range reader.File {
		name := path.Clean(entry.Name)
		if name == "." || strings.HasPrefix(name, "../") || strings.HasPrefix(name, "/") || strings.Contains(entry.Name, "\\") || entry.FileInfo().Mode()&os.ModeSymlink != 0 {
			return errors.New("unsafe debug web zip entry")
		}
		target := filepath.Join(destination, filepath.FromSlash(name))
		if target != destination && !strings.HasPrefix(target, destination+string(filepath.Separator)) {
			return errors.New("unsafe debug web zip entry")
		}
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if !entry.FileInfo().Mode().IsRegular() {
			return errors.New("unsafe debug web zip entry")
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		input, err := entry.Open()
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err != nil {
			input.Close()
			return err
		}
		_, copyErr := io.Copy(output, io.LimitReader(input, maxDebugWebArchiveBytes+1))
		closeErr := output.Close()
		input.Close()
		if copyErr != nil || closeErr != nil {
			return errors.New("extract debug web zip")
		}
	}
	return nil
}

func replaceDebugWeb(current, temporary string) error {
	backup := current + ".previous"
	_ = os.RemoveAll(backup)
	if err := os.Rename(current, backup); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(temporary, current); err != nil {
		_ = os.Rename(backup, current)
		return err
	}
	return os.RemoveAll(backup)
}
