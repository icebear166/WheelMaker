//go:build windows

package flickerbridge

import "testing"

func TestRunningMyFlickerExecutablePathsCommandHidesConsoleWindow(t *testing.T) {
	command := newRunningMyFlickerExecutablePathsCommand()

	if command.SysProcAttr == nil {
		t.Fatal("SysProcAttr is nil, want hidden window settings")
	}
	if !command.SysProcAttr.HideWindow {
		t.Fatal("HideWindow=false, want true")
	}
}
