//go:build windows

package main

import (
	"os"
	"os/exec"
	"strconv"

	"github.com/swm8023/wheelmaker/internal/shared"
)

func newDesktopUpdaterCommand(path string, parentPID int) *exec.Cmd {
	cmd := exec.Command(path, "--parent-pid", strconv.Itoa(parentPID))
	shared.ConfigureBackgroundCommand(cmd)
	return cmd
}

func newWindowsDesktopUpdateController() *desktopUpdateController {
	return newDesktopUpdateController(desktopUpdateDependencies{
		userHome:   os.UserHomeDir,
		executable: os.Executable,
		hashFile:   sha256File,
		stat:       os.Stat,
		startUpdater: func(path string, parentPID int) error {
			cmd := newDesktopUpdaterCommand(path, parentPID)
			if err := cmd.Start(); err != nil {
				return err
			}
			_ = cmd.Process.Release()
			return nil
		},
	})
}
