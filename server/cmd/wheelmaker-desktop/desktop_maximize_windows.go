//go:build windows

package main

type desktopWindowOps interface {
	showWindow(hwnd uintptr, command uintptr)
	isMaximized(hwnd uintptr) bool
}

type win32DesktopWindowOps struct{}

func (win32DesktopWindowOps) showWindow(hwnd uintptr, command uintptr) {
	showWindow(hwnd, command)
}

func (win32DesktopWindowOps) isMaximized(hwnd uintptr) bool {
	return isWindowMaximized(hwnd)
}

type desktopMaximizeController struct {
	hwnd uintptr
	ops  desktopWindowOps
}

func newDesktopMaximizeController(hwnd uintptr, ops desktopWindowOps) *desktopMaximizeController {
	return &desktopMaximizeController{hwnd: hwnd, ops: ops}
}

func (c *desktopMaximizeController) toggle() {
	if c.ops.isMaximized(c.hwnd) {
		c.ops.showWindow(c.hwnd, swRestore)
		return
	}
	c.ops.showWindow(c.hwnd, swMaximize)
}
