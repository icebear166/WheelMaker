package registry

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/swm8023/wheelmaker/internal/shared"
)

const (
	maxDebugUploadFiles      = 128
	maxDebugUploadTotalBytes = 64 * 1024 * 1024
)

var debugUploadQuotaMu sync.Mutex

type debugUploadFile struct {
	path    string
	size    int64
	modTime int64
}

func writeDebugUpload(directory string, fileName string, data []byte) error {
	debugUploadQuotaMu.Lock()
	defer debugUploadQuotaMu.Unlock()

	if fileName == "" || filepath.Base(fileName) != fileName || strings.ContainsAny(fileName, `/\\`) || !isDebugUploadFileName(fileName) {
		return errors.New("invalid debug upload file name")
	}
	if len(data) > maxDebugUploadLogBytes {
		return errors.New("debug upload exceeds per-file limit")
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	if err := enforceDebugUploadQuota(directory, int64(len(data)), 1); err != nil {
		return err
	}

	temporary, err := os.CreateTemp(directory, ".wheelmaker-upload-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	removeTemporary := true
	defer func() {
		_ = temporary.Close()
		if removeTemporary {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := shared.SecureConfigFile(temporaryPath); err != nil {
		return err
	}

	destination := filepath.Join(directory, fileName)
	if err := os.Rename(temporaryPath, destination); err != nil {
		return err
	}
	removeTemporary = false
	if err := shared.SecureConfigFile(destination); err != nil {
		_ = os.Remove(destination)
		return err
	}
	if err := enforceDebugUploadQuota(directory, 0, 0); err != nil {
		_ = os.Remove(destination)
		return err
	}
	return nil
}

func enforceDebugUploadQuota(directory string, incomingBytes int64, incomingFiles int) error {
	if incomingBytes < 0 || incomingBytes > maxDebugUploadTotalBytes || incomingFiles < 0 || incomingFiles > maxDebugUploadFiles {
		return errors.New("invalid debug upload quota request")
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return err
	}
	files := make([]debugUploadFile, 0, len(entries))
	var totalBytes int64
	for _, entry := range entries {
		if !isDebugUploadFileName(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return fmt.Errorf("unsafe debug upload directory entry %q", entry.Name())
		}
		file := debugUploadFile{
			path:    filepath.Join(directory, entry.Name()),
			size:    info.Size(),
			modTime: info.ModTime().UnixNano(),
		}
		files = append(files, file)
		totalBytes += file.size
	}
	sort.Slice(files, func(left, right int) bool {
		if files[left].modTime == files[right].modTime {
			return files[left].path < files[right].path
		}
		return files[left].modTime < files[right].modTime
	})
	for len(files)+incomingFiles > maxDebugUploadFiles || totalBytes+incomingBytes > maxDebugUploadTotalBytes {
		if len(files) == 0 {
			return errors.New("debug upload quota cannot be satisfied")
		}
		oldest := files[0]
		if err := removeDebugUploadFile(directory, oldest.path); err != nil {
			return err
		}
		files = files[1:]
		totalBytes -= oldest.size
	}
	return nil
}

func isDebugUploadFileName(name string) bool {
	return strings.Contains(name, "-diagnostics-") && strings.HasSuffix(strings.ToLower(name), ".log")
}

func removeDebugUploadFile(directory string, path string) error {
	root, err := filepath.EvalSymlinks(directory)
	if err != nil {
		return err
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return err
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return err
	}
	resolved, err = filepath.Abs(resolved)
	if err != nil {
		return err
	}
	relative, err := filepath.Rel(root, resolved)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return fmt.Errorf("debug upload path escapes log directory: %q", path)
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return fmt.Errorf("refuse to delete non-regular debug upload %q", path)
	}
	return os.Remove(path)
}
