//go:build windows

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWorkerProcessAliveRecognizesCurrentProcess(t *testing.T) {
	exePath, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable() error = %v", err)
	}

	alive, err := workerProcessAlive(os.Getpid(), exePath)
	if err != nil {
		t.Fatalf("workerProcessAlive() error = %v", err)
	}
	if !alive {
		t.Fatal("workerProcessAlive() = false for the current process")
	}

	wrongPath := filepath.Join(filepath.Dir(exePath), "not-wheelmaker.exe")
	alive, err = workerProcessAlive(os.Getpid(), wrongPath)
	if err != nil {
		t.Fatalf("workerProcessAlive() with a different path error = %v", err)
	}
	if alive {
		t.Fatalf("workerProcessAlive() = true for a different executable path %q", wrongPath)
	}
}
