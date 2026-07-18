//go:build windows

package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

type windowsLocalDevRun func(context.Context, string, []string, string, []string) error

type windowsLocalDevExecutor struct {
	confirm func(localDevOperation, string) bool
	run     windowsLocalDevRun
}

func newWindowsLocalDevController() (*localDevController, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("resolve user home: %w", err)
	}
	executor := &windowsLocalDevExecutor{
		confirm: confirmWindowsLocalDevOperation,
		run: func(ctx context.Context, file string, args []string, dir string, env []string) error {
			command := exec.CommandContext(ctx, file, args...)
			command.Dir = dir
			command.Env = env
			if output, err := command.CombinedOutput(); err != nil {
				return formatWindowsLocalDevCommandError(err, output)
			}
			return nil
		},
	}
	return newLocalDevController(
		newFileLocalDevConfigStore(filepath.Join(home, ".wheelmaker", "dev", "dev-config.json")),
		executor,
		filepath.Join(home, ".wheelmaker", "dev"),
	), nil
}

func formatWindowsLocalDevCommandError(commandErr error, output []byte) error {
	detail := strings.TrimSpace(strings.ToValidUTF8(string(output), ""))
	if detail == "" {
		return fmt.Errorf("run local dev command: %w", commandErr)
	}
	return fmt.Errorf("run local dev command: %w: %s", commandErr, detail)
}

func (e *windowsLocalDevExecutor) Run(ctx context.Context, root string, operation localDevOperation) error {
	if e.confirm == nil || !e.confirm(operation, root) {
		return errors.New("local dev operation was cancelled")
	}
	command := operation
	if operation == localDevExit {
		command = localDevStop
	}
	return e.run(
		ctx,
		"node.exe",
		[]string{filepath.Join(root, "scripts", "dev-local.mjs"), string(command)},
		root,
		append(os.Environ(), "WHEELMAKER_DEV_NO_DESKTOP=1"),
	)
}

func (e *windowsLocalDevExecutor) OpenDirectory(path string) error {
	return exec.Command("explorer.exe", path).Start()
}

func confirmWindowsLocalDevOperation(operation localDevOperation, root string) bool {
	title, _ := windows.UTF16PtrFromString("WheelMaker Local Dev")
	message, _ := windows.UTF16PtrFromString(fmt.Sprintf(
		"Run Local Dev %s from:\n%s",
		operation,
		root,
	))
	result, _, _ := procMessageBoxW.Call(
		0,
		uintptr(unsafe.Pointer(message)),
		uintptr(unsafe.Pointer(title)),
		mbYesNo|mbIconWarning|mbDefButton2,
	)
	return result == idYes
}

func confirmWindowsLocalDevSource(root string) bool {
	title, _ := windows.UTF16PtrFromString("WheelMaker Local Dev")
	message, _ := windows.UTF16PtrFromString(fmt.Sprintf("Use this source directory for native Local Dev commands?\n\n%s", root))
	result, _, _ := procMessageBoxW.Call(0, uintptr(unsafe.Pointer(message)), uintptr(unsafe.Pointer(title)), mbYesNo|mbIconWarning|mbDefButton2)
	return result == idYes
}
