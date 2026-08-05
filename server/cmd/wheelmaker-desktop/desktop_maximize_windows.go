//go:build windows

package main

import (
	"errors"
	"sync"
	"unsafe"
)

type desktopWindowPoint struct {
	x int32
	y int32
}

type desktopWindowMinMaxInfo struct {
	reserved     desktopWindowPoint
	maxSize      desktopWindowPoint
	maxPosition  desktopWindowPoint
	minTrackSize desktopWindowPoint
	maxTrackSize desktopWindowPoint
}

type desktopMonitorInfo struct {
	monitor  desktopWindowRect
	workArea desktopWindowRect
}

type desktopMonitorOps interface {
	monitorInfo(hwnd uintptr) (desktopMonitorInfo, bool)
}

type desktopWindowSubclassOps interface {
	desktopMonitorOps
	replaceWindowProc(hwnd, replacement uintptr) (uintptr, bool)
	restoreWindowProc(hwnd, original uintptr)
	callWindowProc(original, hwnd, msg, wparam, lparam uintptr) uintptr
}

type desktopWindowSubclass struct {
	originalProc uintptr
	ops          desktopWindowSubclassOps
}

var desktopWindowSubclasses sync.Map

func desktopMaximizeBounds(monitor, workArea desktopWindowRect) (desktopWindowPoint, desktopWindowPoint) {
	position := desktopWindowPoint{
		x: workArea.left - monitor.left,
		y: workArea.top - monitor.top,
	}
	size := desktopWindowPoint{
		x: workArea.width(),
		y: workArea.height(),
	}
	return position, size
}

func constrainDesktopMaximizeToWorkArea(hwnd uintptr, info *desktopWindowMinMaxInfo, ops desktopMonitorOps) bool {
	monitorInfo, ok := ops.monitorInfo(hwnd)
	if !ok {
		return false
	}
	info.maxPosition, info.maxSize = desktopMaximizeBounds(monitorInfo.monitor, monitorInfo.workArea)
	return true
}

func installDesktopWindowWorkAreaConstraintWithOps(hwnd uintptr, ops desktopWindowSubclassOps) (func(), error) {
	if _, exists := desktopWindowSubclasses.Load(hwnd); exists {
		return nil, errors.New("desktop window work-area constraint is already installed")
	}
	originalProc, ok := ops.replaceWindowProc(hwnd, desktopWindowWorkAreaProcCallback)
	if !ok {
		return nil, errors.New("could not replace desktop window procedure")
	}
	desktopWindowSubclasses.Store(hwnd, desktopWindowSubclass{originalProc: originalProc, ops: ops})
	var cleanupOnce sync.Once
	return func() {
		cleanupOnce.Do(func() {
			value, exists := desktopWindowSubclasses.LoadAndDelete(hwnd)
			if !exists {
				return
			}
			subclass := value.(desktopWindowSubclass)
			subclass.ops.restoreWindowProc(hwnd, subclass.originalProc)
		})
	}, nil
}

func desktopWindowWorkAreaProc(hwnd, msg, wparam uintptr, lparam unsafe.Pointer) uintptr {
	var info *desktopWindowMinMaxInfo
	if msg == wmGetMinMaxInfo && lparam != nil {
		info = (*desktopWindowMinMaxInfo)(lparam)
	}
	return desktopWindowWorkAreaProcWithInfo(hwnd, msg, wparam, uintptr(lparam), info)
}

func desktopWindowWorkAreaProcWithInfo(hwnd, msg, wparam, lparam uintptr, info *desktopWindowMinMaxInfo) uintptr {
	value, ok := desktopWindowSubclasses.Load(hwnd)
	if !ok {
		return defaultDesktopWindowProc(hwnd, msg, wparam, lparam)
	}
	subclass := value.(desktopWindowSubclass)
	result := subclass.ops.callWindowProc(subclass.originalProc, hwnd, msg, wparam, lparam)
	if info != nil {
		constrainDesktopMaximizeToWorkArea(hwnd, info, subclass.ops)
	}
	if msg == wmNCDestroy {
		desktopWindowSubclasses.Delete(hwnd)
	}
	return result
}

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
