//go:build windows

package main

import (
	"testing"
)

func TestWaitForParentTreatsAnAlreadyExitedPIDAsComplete(t *testing.T) {
	if err := waitForParent(^uint32(0)); err != nil {
		t.Fatalf("waitForParent() error=%v", err)
	}
}

func TestDesktopDeployCommandIsHiddenOnWindows(t *testing.T) {
	paths := resolveUpdaterPaths(t.TempDir())
	cmd := newDesktopDeployCommand("node.exe", paths)
	if cmd.SysProcAttr == nil || !cmd.SysProcAttr.HideWindow {
		t.Fatal("deploy command must not open a console window")
	}
}
