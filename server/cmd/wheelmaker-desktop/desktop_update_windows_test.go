//go:build windows

package main

import (
	"fmt"
	"path/filepath"
	"testing"
)

func TestWindowsDesktopUpdaterCommandUsesVisibleCMDWithFixedArguments(t *testing.T) {
	updater := filepath.Join(t.TempDir(), "update_exe.bat")
	cmd := newDesktopUpdaterCommand(updater, 42)
	wantArgs := []string{
		"cmd.exe",
		"/d",
		"/s",
		"/c",
		fmt.Sprintf(`call "%s" 42`, updater),
	}
	if len(cmd.Args) != len(wantArgs) {
		t.Fatalf("args=%v", cmd.Args)
	}
	for index := range wantArgs {
		if cmd.Args[index] != wantArgs[index] {
			t.Fatalf("args=%v want=%v", cmd.Args, wantArgs)
		}
	}
	if cmd.SysProcAttr != nil && cmd.SysProcAttr.HideWindow {
		t.Fatal("Desktop updater command must be visible")
	}
}
