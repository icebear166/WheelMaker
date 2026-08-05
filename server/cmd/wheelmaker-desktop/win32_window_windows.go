//go:build windows

package main

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	gwlStyle      = -16
	gwlHwndParent = -8
	gwlWndProc    = -4

	wsCaption     = 0x00c00000
	wsSysMenu     = 0x00080000
	wsThickFrame  = 0x00040000
	wsMinimizeBox = 0x00020000
	wsMaximizeBox = 0x00010000

	swpNoSize        = 0x0001
	swpNoMove        = 0x0002
	swpNoZOrder      = 0x0004
	swpNoActivate    = 0x0010
	swpNoOwnerZOrder = 0x0200
	swpFrameChanged  = 0x0020
	swpShowWindow    = 0x0040

	swMinimize = 6
	swMaximize = 3
	swRestore  = 9

	wmClose         = 0x0010
	wmGetMinMaxInfo = 0x0024
	wmNCLButtonDown = 0x00a1
	wmNCDestroy     = 0x0082
	htCaption       = 2

	dwmwaUseImmersiveDarkMode        = 20
	dwmwaBorderColor                 = 34
	dwmwaCaptionColor                = 35
	dwmColorNone              uint32 = 0xfffffffe
)

const monitorDefaultToNearest = 2

var (
	user32                            = windows.NewLazySystemDLL("user32.dll")
	dwmapi                            = windows.NewLazySystemDLL("dwmapi.dll")
	procGetWindowLongPtrW             = user32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtrW             = user32.NewProc("SetWindowLongPtrW")
	procSetWindowPos                  = user32.NewProc("SetWindowPos")
	procGetWindowRect                 = user32.NewProc("GetWindowRect")
	procMonitorFromWindow             = user32.NewProc("MonitorFromWindow")
	procGetMonitorInfoW               = user32.NewProc("GetMonitorInfoW")
	procCallWindowProcW               = user32.NewProc("CallWindowProcW")
	procDefWindowProcW                = user32.NewProc("DefWindowProcW")
	procReleaseCapture                = user32.NewProc("ReleaseCapture")
	procSendMessageW                  = user32.NewProc("SendMessageW")
	procPostMessageW                  = user32.NewProc("PostMessageW")
	procShowWindow                    = user32.NewProc("ShowWindow")
	procMessageBoxW                   = user32.NewProc("MessageBoxW")
	procIsZoomed                      = user32.NewProc("IsZoomed")
	procIsWindow                      = user32.NewProc("IsWindow")
	procDwmSetWindowAttribute         = dwmapi.NewProc("DwmSetWindowAttribute")
	desktopWindowWorkAreaProcCallback = windows.NewCallback(desktopWindowWorkAreaProc)
)

const (
	mbYesNo       = 0x00000004
	mbIconWarning = 0x00000030
	mbDefButton2  = 0x00000100
	idYes         = 6
)

type desktopWindowRect struct {
	left   int32
	top    int32
	right  int32
	bottom int32
}

type win32MonitorInfo struct {
	cbSize    uint32
	rcMonitor desktopWindowRect
	rcWork    desktopWindowRect
	dwFlags   uint32
}

type win32DesktopWindowSubclassOps struct{}

func (win32DesktopWindowSubclassOps) monitorInfo(hwnd uintptr) (desktopMonitorInfo, bool) {
	monitor, _, _ := procMonitorFromWindow.Call(hwnd, monitorDefaultToNearest)
	if monitor == 0 {
		return desktopMonitorInfo{}, false
	}
	info := win32MonitorInfo{cbSize: uint32(unsafe.Sizeof(win32MonitorInfo{}))}
	result, _, _ := procGetMonitorInfoW.Call(monitor, uintptr(unsafe.Pointer(&info)))
	if result == 0 {
		return desktopMonitorInfo{}, false
	}
	return desktopMonitorInfo{monitor: info.rcMonitor, workArea: info.rcWork}, true
}

func (win32DesktopWindowSubclassOps) replaceWindowProc(hwnd, replacement uintptr) (uintptr, bool) {
	original := replaceWindowLongPtr(hwnd, gwlWndProc, replacement)
	return original, original != 0
}

func (win32DesktopWindowSubclassOps) restoreWindowProc(hwnd, original uintptr) {
	if isWindow(hwnd) {
		setWindowLongPtr(hwnd, gwlWndProc, original)
	}
}

func (win32DesktopWindowSubclassOps) callWindowProc(original, hwnd, msg, wparam, lparam uintptr) uintptr {
	result, _, _ := procCallWindowProcW.Call(original, hwnd, msg, wparam, lparam)
	return result
}

func defaultDesktopWindowProc(hwnd, msg, wparam, lparam uintptr) uintptr {
	result, _, _ := procDefWindowProcW.Call(hwnd, msg, wparam, lparam)
	return result
}

func (r desktopWindowRect) width() int32 {
	return r.right - r.left
}

func (r desktopWindowRect) height() int32 {
	return r.bottom - r.top
}

func getWindowLongPtr(hwnd uintptr, index int32) uintptr {
	value, _, _ := procGetWindowLongPtrW.Call(hwnd, uintptr(index))
	return value
}

func setWindowLongPtr(hwnd uintptr, index int32, value uintptr) {
	procSetWindowLongPtrW.Call(hwnd, uintptr(index), value)
}

func replaceWindowLongPtr(hwnd uintptr, index int32, value uintptr) uintptr {
	original, _, _ := procSetWindowLongPtrW.Call(hwnd, uintptr(index), value)
	return original
}

func setWindowPos(hwnd uintptr, flags uintptr) {
	procSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0, flags)
}

func getWindowRect(hwnd uintptr) (desktopWindowRect, bool) {
	var rect desktopWindowRect
	result, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&rect)))
	return rect, result != 0
}

func releaseCapture() {
	procReleaseCapture.Call()
}

func sendWindowMessage(hwnd uintptr, msg uintptr, wparam uintptr, lparam uintptr) {
	procSendMessageW.Call(hwnd, msg, wparam, lparam)
}

func postWindowMessage(hwnd uintptr, msg uintptr, wparam uintptr, lparam uintptr) {
	procPostMessageW.Call(hwnd, msg, wparam, lparam)
}

func showWindow(hwnd uintptr, command uintptr) {
	procShowWindow.Call(hwnd, command)
}

func isWindowMaximized(hwnd uintptr) bool {
	result, _, _ := procIsZoomed.Call(hwnd)
	return result != 0
}

func isWindow(hwnd uintptr) bool {
	result, _, _ := procIsWindow.Call(hwnd)
	return result != 0
}

func setWindowPosRect(hwnd uintptr, x, y, width, height int32, flags uintptr) {
	procSetWindowPos.Call(hwnd, 0, uintptr(uint32(x)), uintptr(uint32(y)), uintptr(width), uintptr(height), flags)
}

func setDwmWindowAttribute(hwnd uintptr, attribute uint32, value unsafe.Pointer, size uint32) error {
	result, _, err := procDwmSetWindowAttribute.Call(hwnd, uintptr(attribute), uintptr(value), uintptr(size))
	if result == 0 {
		return nil
	}
	if err != windows.Errno(0) {
		return err
	}
	return windows.Errno(result)
}
