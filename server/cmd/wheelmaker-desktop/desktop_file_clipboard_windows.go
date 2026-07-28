//go:build windows

package main

import "fmt"

type desktopFileClipboardOperations struct {
	openClipboard           func(uintptr) error
	closeClipboard          func()
	emptyClipboard          func() error
	registerClipboardFormat func(string) (uintptr, error)
	setClipboardData        func(uintptr, []byte, string) error
}

func setDesktopFileClipboard(hwnd uintptr, path string) error {
	oleErr := setDesktopFileClipboardWithOLEOperations(path, desktopFileClipboardOLEOperations{
		createDataObject: newDesktopShellFileDataObject,
		setClipboard:     setDesktopOLEClipboard,
	})
	if oleErr == nil {
		return nil
	}
	rawErr := setDesktopFileClipboardWithOperations(hwnd, path, desktopFileClipboardOperations{
		openClipboard: func(owner uintptr) error {
			opened, _, callErr := procDesktopOpenClipboard.Call(owner)
			if opened == 0 {
				return desktopClipboardCallError("open clipboard", callErr)
			}
			return nil
		},
		closeClipboard: func() {
			procDesktopCloseClipboard.Call()
		},
		emptyClipboard: func() error {
			emptied, _, callErr := procDesktopEmptyClipboard.Call()
			if emptied == 0 {
				return desktopClipboardCallError("empty clipboard", callErr)
			}
			return nil
		},
		registerClipboardFormat: registerDesktopClipboardFormat,
		setClipboardData:        setDesktopGlobalClipboardData,
	})
	if rawErr == nil {
		return nil
	}
	return fmt.Errorf("set Shell/OLE file clipboard: %v; raw clipboard fallback: %w", oleErr, rawErr)
}

func setDesktopFileClipboardWithOLEOperations(
	path string,
	operations desktopFileClipboardOLEOperations,
) error {
	target, err := resolveDesktopAbsoluteFilePath(path)
	if err != nil {
		return err
	}
	return publishDesktopFileClipboardWithOLEOperations(target, operations)
}

func publishDesktopFileClipboardWithOLEOperations(
	path string,
	operations desktopFileClipboardOLEOperations,
) error {
	if operations.createDataObject == nil || operations.setClipboard == nil {
		return fmt.Errorf("file clipboard OLE operations are unavailable")
	}
	dataObject, release, err := operations.createDataObject(path)
	if err != nil {
		return err
	}
	if release != nil {
		defer release()
	}
	if dataObject == 0 {
		return fmt.Errorf("Shell data object is unavailable")
	}
	return operations.setClipboard(dataObject)
}

func setDesktopFileClipboardWithOperations(
	hwnd uintptr,
	path string,
	operations desktopFileClipboardOperations,
) error {
	target, err := resolveDesktopAbsoluteFilePath(path)
	if err != nil {
		return err
	}
	dropFiles, err := encodeDesktopDropFiles([]string{target})
	if err != nil {
		return err
	}
	preferredFormat, err := operations.registerClipboardFormat(desktopPreferredDropEffectFormat)
	if err != nil {
		return err
	}
	if err := operations.openClipboard(hwnd); err != nil {
		return err
	}
	defer operations.closeClipboard()
	if err := operations.emptyClipboard(); err != nil {
		return err
	}
	for _, payload := range []struct {
		format uintptr
		data   []byte
		label  string
	}{
		{format: cfHDrop, data: dropFiles, label: "file drop"},
		{format: preferredFormat, data: encodeDesktopPreferredDropEffect(), label: "preferred drop effect"},
	} {
		if err := operations.setClipboardData(payload.format, payload.data, payload.label); err != nil {
			return err
		}
	}
	return nil
}
