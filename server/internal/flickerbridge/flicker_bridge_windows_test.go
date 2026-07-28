//go:build windows

package flickerbridge

import (
	"context"
	"testing"
)

func TestRunningMyFlickerExecutablePathsCommandHidesConsoleWindow(t *testing.T) {
	command := newRunningMyFlickerExecutablePathsCommand()

	if command.SysProcAttr == nil {
		t.Fatal("SysProcAttr is nil, want hidden window settings")
	}
	if !command.SysProcAttr.HideWindow {
		t.Fatal("HideWindow=false, want true")
	}
}

func TestV2NodeVersionCommandHidesConsoleWindow(t *testing.T) {
	command := newV2NodeVersionCommand("node.exe")

	if command.SysProcAttr == nil || !command.SysProcAttr.HideWindow {
		t.Fatal("V2 Node version command must hide its console window")
	}
}

func TestV2WorkerCommandHidesConsoleWindow(t *testing.T) {
	command := newV2WorkerCommand(context.Background(), "node.exe", "")

	if command.SysProcAttr == nil || !command.SysProcAttr.HideWindow {
		t.Fatal("V2 worker command must hide its console window")
	}
}
