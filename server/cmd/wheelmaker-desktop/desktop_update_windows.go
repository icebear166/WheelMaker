//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
)

func newDesktopUpdaterCommand(path string, parentPID int) *exec.Cmd {
	command := fmt.Sprintf(`call "%s" %d`, path, parentPID)
	return exec.Command("cmd.exe", "/d", "/s", "/c", command)
}

func newWindowsDesktopUpdateController() *desktopUpdateController {
	return newDesktopUpdateController(desktopUpdateDependencies{
		userHome:   os.UserHomeDir,
		executable: os.Executable,
		hashFile:   sha256File,
		readFile:   os.ReadFile,
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
