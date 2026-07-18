package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeDesktopUpdateTestFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestDesktopUpdateInfoUsesOnlyStandardInstall(t *testing.T) {
	home := t.TempDir()
	exe := filepath.Join(home, ".wheelmaker", "desktop", "WheelMakerDesktop.exe")
	updater := filepath.Join(home, ".wheelmaker", "desktop", "update.exe")
	writeDesktopUpdateTestFile(t, exe, "desktop")
	writeDesktopUpdateTestFile(t, updater, "updater")

	controller := newDesktopUpdateController(desktopUpdateDependencies{
		userHome:   func() (string, error) { return home, nil },
		executable: func() (string, error) { return exe, nil },
		hashFile:   sha256File,
		stat:       os.Stat,
	})
	info, err := controller.Info()
	if err != nil {
		t.Fatal(err)
	}
	wantSHA := sha256.Sum256([]byte("desktop"))
	if info.SHA256 != hex.EncodeToString(wantSHA[:]) || !info.UpdaterReady {
		t.Fatalf("info=%+v", info)
	}
}

func TestDesktopUpdateStartsOnlyTheFixedUpdater(t *testing.T) {
	home := t.TempDir()
	exe := filepath.Join(home, ".wheelmaker", "desktop", "WheelMakerDesktop.exe")
	updater := filepath.Join(home, ".wheelmaker", "desktop", "update.exe")
	writeDesktopUpdateTestFile(t, exe, "desktop")
	writeDesktopUpdateTestFile(t, updater, "updater")
	var startedPath string
	var startedPID int
	controller := newDesktopUpdateController(desktopUpdateDependencies{
		userHome:   func() (string, error) { return home, nil },
		executable: func() (string, error) { return exe, nil },
		hashFile:   sha256File,
		stat:       os.Stat,
		startUpdater: func(path string, pid int) error {
			startedPath, startedPID = path, pid
			return nil
		},
	})
	if err := controller.Start(42); err != nil {
		t.Fatal(err)
	}
	if filepath.Clean(startedPath) != filepath.Clean(updater) || startedPID != 42 {
		t.Fatalf("started path=%q pid=%d", startedPath, startedPID)
	}
}

func TestDesktopUpdateRejectsPortableExecutable(t *testing.T) {
	home := t.TempDir()
	portable := filepath.Join(home, "WheelMakerDesktop.exe")
	controller := newDesktopUpdateController(desktopUpdateDependencies{
		userHome:   func() (string, error) { return home, nil },
		executable: func() (string, error) { return portable, nil },
		hashFile:   sha256File,
		stat:       os.Stat,
	})
	if _, err := controller.Info(); err == nil || !strings.Contains(err.Error(), "standard install") {
		t.Fatalf("Info error=%v", err)
	}
}

func TestDesktopUpdateStartPropagatesLauncherFailure(t *testing.T) {
	home := t.TempDir()
	exe := filepath.Join(home, ".wheelmaker", "desktop", "WheelMakerDesktop.exe")
	updater := filepath.Join(home, ".wheelmaker", "desktop", "update.exe")
	writeDesktopUpdateTestFile(t, exe, "desktop")
	writeDesktopUpdateTestFile(t, updater, "updater")
	wantErr := errors.New("start failed")
	controller := newDesktopUpdateController(desktopUpdateDependencies{
		userHome:   func() (string, error) { return home, nil },
		executable: func() (string, error) { return exe, nil },
		hashFile:   sha256File,
		stat:       os.Stat,
		startUpdater: func(string, int) error {
			return wantErr
		},
	})
	if err := controller.Start(42); !errors.Is(err, wantErr) {
		t.Fatalf("Start error=%v", err)
	}
}
