//go:build windows

package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsDesktopUpdaterUsesVisibleShellWithFixedArguments(t *testing.T) {
	updater := filepath.Join(t.TempDir(), "update_exe.bat")
	var gotOperation string
	var gotTarget string
	var gotParameters string
	var gotShowCommand int
	err := launchDesktopUpdater(updater, 42, func(
		operation string,
		target string,
		parameters string,
		showCommand int,
	) (uintptr, error) {
		gotOperation = operation
		gotTarget = target
		gotParameters = parameters
		gotShowCommand = showCommand
		return 33, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if gotOperation != "open" ||
		gotTarget != updater ||
		gotParameters != "42" ||
		gotShowCommand != desktopUpdaterShowNormal {
		t.Fatalf(
			"operation=%q target=%q parameters=%q showCommand=%d",
			gotOperation,
			gotTarget,
			gotParameters,
			gotShowCommand,
		)
	}
}

func TestWindowsDesktopUpdaterReturnsShellLaunchFailure(t *testing.T) {
	err := launchDesktopUpdater("update_exe.bat", 42, func(
		string,
		string,
		string,
		int,
	) (uintptr, error) {
		return 31, nil
	})
	if err == nil || !strings.Contains(err.Error(), "code 31") {
		t.Fatalf("error=%v", err)
	}
}

func TestWindowsDesktopUpdaterReturnsShellAdapterFailure(t *testing.T) {
	wantErr := filepath.ErrBadPattern
	err := launchDesktopUpdater("update_exe.bat", 42, func(
		string,
		string,
		string,
		int,
	) (uintptr, error) {
		return 0, wantErr
	})
	if err != wantErr {
		t.Fatalf("error=%v want=%v", err, wantErr)
	}
}
