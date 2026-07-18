//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"unsafe"

	"github.com/swm8023/wheelmaker/internal/shared"
	"golang.org/x/sys/windows"
)

const messageBoxIconError = 0x00000010

var desktopUpdaterMessageBox = windows.NewLazySystemDLL("user32.dll").NewProc("MessageBoxW")

func waitForParent(pid uint32) error {
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, pid)
	if err != nil {
		if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
			return nil
		}
		return fmt.Errorf("open Desktop process %d: %w", pid, err)
	}
	defer windows.CloseHandle(handle)

	status, err := windows.WaitForSingleObject(handle, windows.INFINITE)
	if err != nil {
		return fmt.Errorf("wait for Desktop process %d: %w", pid, err)
	}
	if status != windows.WAIT_OBJECT_0 {
		return fmt.Errorf("unexpected Desktop wait status: %d", status)
	}
	return nil
}

func runDesktopUpdate(paths updaterPaths) error {
	nodePath, err := exec.LookPath("node.exe")
	if err != nil {
		return fmt.Errorf("find Node.js: %w", err)
	}
	output, err := newDesktopDeployCommand(nodePath, paths).CombinedOutput()
	if err == nil {
		return nil
	}
	message := strings.TrimSpace(string(output))
	if message == "" {
		return fmt.Errorf("run Desktop update: %w", err)
	}
	return fmt.Errorf("run Desktop update: %w\n\n%s", err, message)
}

func restartDesktop(path string) error {
	cmd := exec.Command(path)
	shared.ConfigureBackgroundCommand(cmd)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("restart Desktop: %w", err)
	}
	_ = cmd.Process.Release()
	return nil
}

func showDesktopUpdateError(err error) {
	title, titleErr := windows.UTF16PtrFromString("WheelMaker Desktop Update")
	message, messageErr := windows.UTF16PtrFromString(err.Error())
	if titleErr != nil || messageErr != nil {
		return
	}
	desktopUpdaterMessageBox.Call(
		0,
		uintptr(unsafe.Pointer(message)),
		uintptr(unsafe.Pointer(title)),
		messageBoxIconError,
	)
}

func runMain(args []string) error {
	parentPID, err := parseParentPID(args)
	if err != nil {
		showDesktopUpdateError(err)
		return err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		err = fmt.Errorf("resolve user home: %w", err)
		showDesktopUpdateError(err)
		return err
	}
	paths := resolveUpdaterPaths(home)
	return runUpdater(parentPID, updaterDependencies{
		waitForParent: waitForParent,
		runUpdate: func() error {
			return runDesktopUpdate(paths)
		},
		showError: showDesktopUpdateError,
		restart: func() error {
			return restartDesktop(paths.desktop)
		},
	})
}

func main() {
	if err := runMain(os.Args[1:]); err != nil {
		os.Exit(1)
	}
}
