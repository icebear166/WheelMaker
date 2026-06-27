//go:build windows

package shared

import (
	"os/exec"
	"syscall"
)

// ConfigureBackgroundCommand prevents helper console programs from opening
// visible windows when WheelMaker is running in an interactive user session.
func ConfigureBackgroundCommand(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
}
