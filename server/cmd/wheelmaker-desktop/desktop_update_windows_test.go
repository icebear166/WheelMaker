//go:build windows

package main

import (
	"path/filepath"
	"strconv"
	"testing"
)

func TestWindowsDesktopUpdaterCommandUsesOnlyFixedArguments(t *testing.T) {
	updater := filepath.Join(t.TempDir(), "update.exe")
	cmd := newDesktopUpdaterCommand(updater, 42)
	wantArgs := []string{updater, "--parent-pid", strconv.Itoa(42)}
	if len(cmd.Args) != len(wantArgs) {
		t.Fatalf("args=%v", cmd.Args)
	}
	for index := range wantArgs {
		if cmd.Args[index] != wantArgs[index] {
			t.Fatalf("args=%v want=%v", cmd.Args, wantArgs)
		}
	}
	if cmd.SysProcAttr == nil || !cmd.SysProcAttr.HideWindow {
		t.Fatal("Desktop updater command must stay hidden")
	}
}
