package main

import (
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"

	"github.com/swm8023/wheelmaker/internal/shared"
)

type updaterPaths struct {
	root    string
	deploy  string
	desktop string
}

func parseParentPID(args []string) (uint32, error) {
	if len(args) != 2 || args[0] != "--parent-pid" || args[1] == "" {
		return 0, errors.New("usage: update.exe --parent-pid PID")
	}
	for _, char := range args[1] {
		if char < '0' || char > '9' {
			return 0, errors.New("parent PID must be a positive decimal integer")
		}
	}
	value, err := strconv.ParseUint(args[1], 10, 32)
	if err != nil || value == 0 {
		return 0, errors.New("parent PID must be a positive decimal integer")
	}
	return uint32(value), nil
}

func resolveUpdaterPaths(home string) updaterPaths {
	root := filepath.Join(home, ".wheelmaker")
	return updaterPaths{
		root:    root,
		deploy:  filepath.Join(root, "deploy.mjs"),
		desktop: filepath.Join(root, "desktop", "WheelMakerDesktop.exe"),
	}
}

func newDesktopDeployCommand(nodePath string, paths updaterPaths) *exec.Cmd {
	cmd := exec.Command(nodePath, paths.deploy, "desktop-update")
	cmd.Dir = paths.root
	shared.ConfigureBackgroundCommand(cmd)
	return cmd
}

type updaterDependencies struct {
	waitForParent func(uint32) error
	runUpdate     func() error
	showError     func(error)
	restart       func() error
}

func runUpdater(parentPID uint32, deps updaterDependencies) error {
	if parentPID == 0 {
		return errors.New("parent PID is required")
	}
	if err := deps.waitForParent(parentPID); err != nil {
		wrapped := fmt.Errorf("wait for Desktop: %w", err)
		deps.showError(wrapped)
		return wrapped
	}

	updateErr := deps.runUpdate()
	if updateErr != nil {
		deps.showError(updateErr)
	}
	restartErr := deps.restart()
	if restartErr != nil {
		deps.showError(restartErr)
	}
	return errors.Join(updateErr, restartErr)
}
