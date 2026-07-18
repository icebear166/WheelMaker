package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

type recordingLocalDevExecutor struct {
	operation localDevOperation
	root      string
}

func (e *recordingLocalDevExecutor) Run(_ context.Context, root string, operation localDevOperation) error {
	e.root = root
	e.operation = operation
	return nil
}

func (e *recordingLocalDevExecutor) OpenDirectory(root string) error {
	e.root = root
	e.operation = localDevOpenDirectory
	return nil
}

func TestValidateLocalDevSourceRoot(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"server/go.mod", "app/package.json", "scripts/.keep"} {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	got, err := validateLocalDevSourceRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	if got != root {
		t.Fatalf("validateLocalDevSourceRoot() = %q, want %q", got, root)
	}
}

func TestParseLocalDevOperationRejectsUnknownValue(t *testing.T) {
	if _, err := parseLocalDevOperation("cmd /c whoami"); err == nil {
		t.Fatal("parseLocalDevOperation accepted an arbitrary command")
	}
}

func TestFileLocalDevConfigStoreRoundTripsSourcePath(t *testing.T) {
	store := newFileLocalDevConfigStore(filepath.Join(t.TempDir(), "dev-config.json"))
	if err := store.Save(localDevConfig{SourcePath: `D:\Code\WheelMaker`}); err != nil {
		t.Fatal(err)
	}
	got, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if got.SourcePath != `D:\Code\WheelMaker` {
		t.Fatalf("SourcePath = %q", got.SourcePath)
	}
}

func TestLocalDevControllerRunsOnlyWhitelistedOperationFromSavedSource(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"server/go.mod", "app/package.json", "scripts/.keep"} {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	store := newFileLocalDevConfigStore(filepath.Join(t.TempDir(), "dev-config.json"))
	if err := store.Save(localDevConfig{SourcePath: root}); err != nil {
		t.Fatal(err)
	}
	executor := &recordingLocalDevExecutor{}
	controller := newLocalDevController(store, executor)
	if _, err := controller.Run(context.Background(), "build"); err != nil {
		t.Fatal(err)
	}
	if executor.root != root || executor.operation != localDevBuild {
		t.Fatalf("executor = root %q operation %q", executor.root, executor.operation)
	}
	if _, err := controller.Run(context.Background(), "cmd /c whoami"); err == nil {
		t.Fatal("controller accepted an arbitrary operation")
	}
}

func TestLocalDevControllerValidatesBeforeSavingSource(t *testing.T) {
	store := newFileLocalDevConfigStore(filepath.Join(t.TempDir(), "dev-config.json"))
	controller := newLocalDevController(store, &recordingLocalDevExecutor{})
	if _, err := controller.SaveSource(t.TempDir()); err == nil {
		t.Fatal("SaveSource accepted a non-WheelMaker directory")
	}
}
