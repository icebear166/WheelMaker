//go:build windows

package main

import (
	"errors"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	wsChild         = 0x40000000
	wsVisible       = 0x10000000
	wsExTransparent = 0x00000020
	wsExNoActivate  = 0x08000000

	swHide = 0

	wmSize             = 0x0005
	wmSetCursor        = 0x0020
	wmMouseActivate    = 0x0021
	wmEraseBkgnd       = 0x0014
	wmWindowPosChanged = 0x0047
	wmDpiChanged       = 0x02e0

	maNoActivate = 3

	idcSizeNWSE = 32642
	idcSizeNESW = 32643
	idcSizeWE   = 32644
	idcSizeNS   = 32645

	desktopResizeOverlayClassName = "WheelMakerDesktopResizeGrip"
)

var (
	kernel32                         = windows.NewLazySystemDLL("kernel32.dll")
	procGetModuleHandleW             = kernel32.NewProc("GetModuleHandleW")
	procRegisterClassExW             = user32.NewProc("RegisterClassExW")
	procCreateWindowExW              = user32.NewProc("CreateWindowExW")
	procDestroyWindow                = user32.NewProc("DestroyWindow")
	procGetClientRect                = user32.NewProc("GetClientRect")
	procLoadCursorW                  = user32.NewProc("LoadCursorW")
	procSetCursor                    = user32.NewProc("SetCursor")
	desktopResizeOverlayProcCallback = windows.NewCallback(desktopResizeOverlayProc)
)

type desktopResizeGripSpec struct {
	hitTest uintptr
	rect    desktopWindowRect
}

type desktopResizeOverlayMessageResult struct {
	result  uintptr
	forward bool
}

func desktopResizeGripSpecs(size, border desktopWindowPoint) []desktopResizeGripSpec {
	if size.x <= 0 || size.y <= 0 {
		return nil
	}
	xBorder := minDesktopResizeDimension(border.x, size.x/2)
	yBorder := minDesktopResizeDimension(border.y, size.y/2)
	if xBorder <= 0 || yBorder <= 0 {
		return nil
	}
	return []desktopResizeGripSpec{
		{hitTest: htTopLeft, rect: desktopWindowRect{left: 0, top: 0, right: xBorder, bottom: yBorder}},
		{hitTest: htTop, rect: desktopWindowRect{left: xBorder, top: 0, right: size.x - xBorder, bottom: yBorder}},
		{hitTest: htTopRight, rect: desktopWindowRect{left: size.x - xBorder, top: 0, right: size.x, bottom: yBorder}},
		{hitTest: htLeft, rect: desktopWindowRect{left: 0, top: yBorder, right: xBorder, bottom: size.y - yBorder}},
		{hitTest: htRight, rect: desktopWindowRect{left: size.x - xBorder, top: yBorder, right: size.x, bottom: size.y - yBorder}},
		{hitTest: htBottomLeft, rect: desktopWindowRect{left: 0, top: size.y - yBorder, right: xBorder, bottom: size.y}},
		{hitTest: htBottom, rect: desktopWindowRect{left: xBorder, top: size.y - yBorder, right: size.x - xBorder, bottom: size.y}},
		{hitTest: htBottomRight, rect: desktopWindowRect{left: size.x - xBorder, top: size.y - yBorder, right: size.x, bottom: size.y}},
	}
}

func minDesktopResizeDimension(left, right int32) int32 {
	if left < right {
		return left
	}
	return right
}

func desktopResizeOverlayMessage(msg, hitTest uintptr) desktopResizeOverlayMessageResult {
	switch msg {
	case wmNCHitTest:
		return desktopResizeOverlayMessageResult{result: hitTest}
	case wmNCLButtonDown:
		if isDesktopResizeHitTest(hitTest) {
			return desktopResizeOverlayMessageResult{forward: true}
		}
	}
	return desktopResizeOverlayMessageResult{}
}

func isDesktopResizeHitTest(hitTest uintptr) bool {
	switch hitTest {
	case htLeft, htRight, htTop, htBottom, htTopLeft, htTopRight, htBottomLeft, htBottomRight:
		return true
	default:
		return false
	}
}

type desktopResizeOverlayWndClassEx struct {
	cbSize     uint32
	style      uint32
	wndProc    uintptr
	clsExtra   int32
	wndExtra   int32
	instance   uintptr
	icon       uintptr
	cursor     uintptr
	background uintptr
	menuName   *uint16
	className  *uint16
	iconSmall  uintptr
}

var (
	desktopResizeOverlayClassOnce sync.Once
	desktopResizeOverlayClassOK   bool
)

func ensureDesktopResizeOverlayClass() bool {
	desktopResizeOverlayClassOnce.Do(func() {
		className := windows.StringToUTF16Ptr(desktopResizeOverlayClassName)
		classInfo := desktopResizeOverlayWndClassEx{
			cbSize:    uint32(unsafe.Sizeof(desktopResizeOverlayWndClassEx{})),
			wndProc:   desktopResizeOverlayProcCallback,
			instance:  desktopModuleHandle(),
			className: className,
		}
		atom, _, _ := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&classInfo)))
		desktopResizeOverlayClassOK = atom != 0
	})
	return desktopResizeOverlayClassOK
}

func desktopModuleHandle() uintptr {
	result, _, _ := procGetModuleHandleW.Call(0)
	return result
}

type desktopResizeOverlayHandle struct {
	hwnd    uintptr
	parent  uintptr
	hitTest uintptr
}

type desktopResizeOverlayController struct {
	parent  uintptr
	handles []desktopResizeOverlayHandle
}

var (
	desktopResizeOverlayControllers sync.Map
	desktopResizeOverlayHandles     sync.Map
)

func installDesktopWindowResizeHitTestOverlay(parent uintptr) (func(), error) {
	if !ensureDesktopResizeOverlayClass() {
		return nil, errors.New("could not register desktop resize overlay window class")
	}
	controller := &desktopResizeOverlayController{parent: parent}
	if _, loaded := desktopResizeOverlayControllers.LoadOrStore(parent, controller); loaded {
		return nil, errors.New("desktop resize hit-test overlay is already installed")
	}
	for _, hitTest := range []uintptr{
		htTopLeft,
		htTop,
		htTopRight,
		htLeft,
		htRight,
		htBottomLeft,
		htBottom,
		htBottomRight,
	} {
		handle, ok := createDesktopResizeOverlayHandle(parent, hitTest)
		if !ok {
			destroyDesktopResizeOverlayController(controller)
			desktopResizeOverlayControllers.Delete(parent)
			return nil, errors.New("could not create desktop resize overlay window")
		}
		controller.handles = append(controller.handles, handle)
	}
	syncDesktopWindowResizeHitTestOverlay(parent)
	var cleanupOnce sync.Once
	return func() {
		cleanupOnce.Do(func() {
			desktopResizeOverlayControllers.Delete(parent)
			destroyDesktopResizeOverlayController(controller)
		})
	}, nil
}

func createDesktopResizeOverlayHandle(parent, hitTest uintptr) (desktopResizeOverlayHandle, bool) {
	className := windows.StringToUTF16Ptr(desktopResizeOverlayClassName)
	hwnd, _, _ := procCreateWindowExW.Call(
		wsExTransparent|wsExNoActivate,
		uintptr(unsafe.Pointer(className)),
		0,
		wsChild|wsVisible,
		0,
		0,
		0,
		0,
		parent,
		0,
		desktopModuleHandle(),
		0,
	)
	if hwnd == 0 {
		return desktopResizeOverlayHandle{}, false
	}
	handle := desktopResizeOverlayHandle{
		hwnd:    hwnd,
		parent:  parent,
		hitTest: hitTest,
	}
	desktopResizeOverlayHandles.Store(hwnd, handle)
	return handle, true
}

func destroyDesktopResizeOverlayController(controller *desktopResizeOverlayController) {
	for _, handle := range controller.handles {
		desktopResizeOverlayHandles.Delete(handle.hwnd)
		if isWindow(handle.hwnd) {
			procDestroyWindow.Call(handle.hwnd)
		}
	}
}

func syncDesktopWindowResizeHitTestOverlay(parent uintptr) {
	value, ok := desktopResizeOverlayControllers.Load(parent)
	if !ok {
		return
	}
	controller := value.(*desktopResizeOverlayController)
	size, ok := desktopWindowClientSize(parent)
	if !ok || size.x <= 0 || size.y <= 0 || isWindowMaximized(parent) {
		for _, handle := range controller.handles {
			showWindow(handle.hwnd, swHide)
		}
		return
	}
	specs := desktopResizeGripSpecs(size, getDesktopWindowResizeBorder())
	for index, handle := range controller.handles {
		if index >= len(specs) {
			showWindow(handle.hwnd, swHide)
			continue
		}
		rect := specs[index].rect
		procSetWindowPos.Call(
			handle.hwnd,
			0,
			uintptr(uint32(rect.left)),
			uintptr(uint32(rect.top)),
			uintptr(rect.width()),
			uintptr(rect.height()),
			swpNoActivate|swpNoOwnerZOrder|swpShowWindow,
		)
	}
}

func desktopWindowClientSize(hwnd uintptr) (desktopWindowPoint, bool) {
	var rect desktopWindowRect
	result, _, _ := procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rect)))
	if result == 0 {
		return desktopWindowPoint{}, false
	}
	return desktopWindowPoint{x: rect.width(), y: rect.height()}, true
}

func desktopResizeOverlayProc(hwnd, msg, wparam, lparam uintptr) uintptr {
	value, ok := desktopResizeOverlayHandles.Load(hwnd)
	if !ok {
		return defaultDesktopWindowProc(hwnd, msg, wparam, lparam)
	}
	handle := value.(desktopResizeOverlayHandle)
	switch msg {
	case wmNCHitTest:
		return desktopResizeOverlayMessage(msg, handle.hitTest).result
	case wmSetCursor:
		setDesktopResizeCursor(handle.hitTest)
		return 1
	case wmMouseActivate:
		return maNoActivate
	case wmNCLButtonDown:
		if action := desktopResizeOverlayMessage(msg, handle.hitTest); action.forward {
			releaseCapture()
			sendWindowMessage(handle.parent, wmNCLButtonDown, handle.hitTest, lparam)
			return action.result
		}
	case wmEraseBkgnd:
		return 1
	case wmNCDestroy:
		defer desktopResizeOverlayHandles.Delete(hwnd)
	}
	return defaultDesktopWindowProc(hwnd, msg, wparam, lparam)
}

func setDesktopResizeCursor(hitTest uintptr) {
	cursorID := uintptr(0)
	switch hitTest {
	case htLeft, htRight:
		cursorID = idcSizeWE
	case htTop, htBottom:
		cursorID = idcSizeNS
	case htTopLeft, htBottomRight:
		cursorID = idcSizeNWSE
	case htTopRight, htBottomLeft:
		cursorID = idcSizeNESW
	}
	if cursorID == 0 {
		return
	}
	cursor, _, _ := procLoadCursorW.Call(0, cursorID)
	if cursor != 0 {
		procSetCursor.Call(cursor)
	}
}
