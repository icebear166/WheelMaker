package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/swm8023/wheelmaker/internal/shared"
)

var startManagedRuntimeRestartCommand = func(cmd *exec.Cmd) error {
	return cmd.Start()
}

var releaseManagedRuntimeRestartProcess = func(process *os.Process) error {
	return process.Release()
}

func startManagedRuntimeRestart(stateDir string) error {
	cmd := exec.Command(
		"node",
		filepath.Join(stateDir, "deploy.mjs"),
		"runtime",
		"restart",
	)
	cmd.Dir = stateDir
	shared.ConfigureBackgroundCommand(cmd)
	restoreIO, err := configureWorkerCommandIO(cmd)
	if err != nil {
		return fmt.Errorf("configure runtime restart: %w", err)
	}
	if err := startManagedRuntimeRestartCommand(cmd); err != nil {
		restoreIO()
		return fmt.Errorf("start runtime restart: %w", err)
	}
	restoreIO()
	if err := releaseManagedRuntimeRestartProcess(cmd.Process); err != nil {
		return fmt.Errorf("release runtime restart process: %w", err)
	}
	return nil
}
