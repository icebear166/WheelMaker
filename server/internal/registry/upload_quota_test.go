package registry

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestUploadQuotaEvictsOldestRegularFile(t *testing.T) {
	directory := t.TempDir()
	base := time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)
	for index := 0; index < maxDebugUploadFiles; index++ {
		path := filepath.Join(directory, uploadTestFileName(index))
		file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0o600)
		if err != nil {
			t.Fatalf("create quota fixture: %v", err)
		}
		if err := file.Truncate(maxDebugUploadLogBytes); err != nil {
			_ = file.Close()
			t.Fatalf("truncate quota fixture: %v", err)
		}
		_ = file.Close()
		stamp := base.Add(time.Duration(index) * time.Second)
		if err := os.Chtimes(path, stamp, stamp); err != nil {
			t.Fatalf("Chtimes(): %v", err)
		}
	}

	newName := "web-diagnostics-new.log"
	if err := writeDebugUpload(directory, newName, []byte("new upload")); err != nil {
		t.Fatalf("writeDebugUpload(): %v", err)
	}
	if _, err := os.Stat(filepath.Join(directory, uploadTestFileName(0))); !os.IsNotExist(err) {
		t.Fatalf("oldest upload was not evicted: %v", err)
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatalf("ReadDir(): %v", err)
	}
	if len(entries) != maxDebugUploadFiles {
		t.Fatalf("entry count=%d, want %d", len(entries), maxDebugUploadFiles)
	}
	info, err := os.Stat(filepath.Join(directory, newName))
	if err != nil {
		t.Fatalf("stat new upload: %v", err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("new upload mode=%#o, want private", info.Mode().Perm())
	}
}

func TestUploadQuotaRejectsNonRegularDirectoryEntry(t *testing.T) {
	directory := t.TempDir()
	unsafeName := "web-diagnostics-20260713-000000.000-1-1.log"
	if err := os.Mkdir(filepath.Join(directory, unsafeName), 0o700); err != nil {
		t.Fatalf("Mkdir(): %v", err)
	}
	if err := writeDebugUpload(directory, "web-diagnostics-new.log", []byte("content")); err == nil {
		t.Fatal("writeDebugUpload() accepted a non-regular directory entry")
	}
	if _, err := os.Stat(filepath.Join(directory, "web-diagnostics-new.log")); !os.IsNotExist(err) {
		t.Fatalf("upload was written despite unsafe directory: %v", err)
	}
}

func TestUploadQuotaPreservesUnrelatedServiceLogs(t *testing.T) {
	directory := t.TempDir()
	serviceLog := filepath.Join(directory, "hub.log")
	if err := os.WriteFile(serviceLog, []byte("must survive"), 0o600); err != nil {
		t.Fatalf("write service log: %v", err)
	}
	old := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	if err := os.Chtimes(serviceLog, old, old); err != nil {
		t.Fatalf("Chtimes service log: %v", err)
	}
	for index := 0; index < maxDebugUploadFiles; index++ {
		name := uploadTestFileName(index)
		path := filepath.Join(directory, name)
		if err := os.WriteFile(path, []byte("upload"), 0o600); err != nil {
			t.Fatalf("write upload fixture: %v", err)
		}
		stamp := old.Add(time.Duration(index+1) * time.Second)
		if err := os.Chtimes(path, stamp, stamp); err != nil {
			t.Fatalf("Chtimes upload: %v", err)
		}
	}
	if err := writeDebugUpload(directory, "web-diagnostics-new.log", []byte("new")); err != nil {
		t.Fatalf("writeDebugUpload(): %v", err)
	}
	if data, err := os.ReadFile(serviceLog); err != nil || string(data) != "must survive" {
		t.Fatalf("service log changed data=%q err=%v", data, err)
	}
}

func uploadTestFileName(index int) string {
	return "web-diagnostics-" + time.Unix(int64(index), 0).UTC().Format("20060102-150405.000000000") + ".log"
}
