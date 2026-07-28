//go:build windows

package main

import (
	"fmt"
	"os"
	"strconv"
	"unsafe"

	"golang.org/x/sys/windows"
)

const desktopUpdaterShowNormal = 1

type desktopShellExecute func(
	operation string,
	target string,
	parameters string,
	showCommand int,
) (uintptr, error)

func launchDesktopUpdater(
	path string,
	parentPID int,
	execute desktopShellExecute,
) error {
	result, err := execute(
		"open",
		path,
		strconv.Itoa(parentPID),
		desktopUpdaterShowNormal,
	)
	if err != nil {
		return err
	}
	if result <= 32 {
		return fmt.Errorf("ShellExecuteW failed with code %d", result)
	}
	return nil
}

func executeDesktopUpdaterShell(
	operation string,
	target string,
	parameters string,
	showCommand int,
) (uintptr, error) {
	operationPointer, err := windows.UTF16PtrFromString(operation)
	if err != nil {
		return 0, err
	}
	targetPointer, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return 0, err
	}
	parametersPointer, err := windows.UTF16PtrFromString(parameters)
	if err != nil {
		return 0, err
	}
	result, _, _ := desktopShellExecuteW.Call(
		0,
		uintptr(unsafe.Pointer(operationPointer)),
		uintptr(unsafe.Pointer(targetPointer)),
		uintptr(unsafe.Pointer(parametersPointer)),
		0,
		uintptr(showCommand),
	)
	return result, nil
}

func newWindowsDesktopUpdateController() *desktopUpdateController {
	return newDesktopUpdateController(desktopUpdateDependencies{
		userHome:   os.UserHomeDir,
		executable: os.Executable,
		hashFile:   sha256File,
		readFile:   os.ReadFile,
		startUpdater: func(path string, parentPID int) error {
			return launchDesktopUpdater(
				path,
				parentPID,
				executeDesktopUpdaterShell,
			)
		},
	})
}
