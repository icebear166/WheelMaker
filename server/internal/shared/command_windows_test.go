//go:build windows

package shared

import (
	"os/exec"
	"testing"
)

func TestConfigureBackgroundCommandHidesConsoleWindow(t *testing.T) {
	cmd := exec.Command("powershell", "-NoProfile")

	ConfigureBackgroundCommand(cmd)

	if cmd.SysProcAttr == nil {
		t.Fatal("SysProcAttr is nil, want hidden window settings")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("HideWindow=false, want true")
	}
}
