//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"sync"
	"sync/atomic"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

// desktopNotification is the trusted-page payload rendered by the self-drawn
// notification window. The WebView2 notification pipeline is intentionally not
// used: it denies permission requests without host handling and never routes
// toast clicks back to the page.
type desktopNotification struct {
	Key       string
	ProjectID string
	SessionID string
	Title     string
	Body      string
	Status    string
}

func parseDesktopNotification(raw string) (desktopNotification, error) {
	var payload struct {
		Type      string `json:"type"`
		ProjectID string `json:"projectId"`
		SessionID string `json:"sessionId"`
		Title     string `json:"title"`
		Body      string `json:"body"`
		Status    string `json:"status"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return desktopNotification{}, err
	}
	if payload.Type != "chat.prompt.completed" {
		return desktopNotification{}, fmt.Errorf("unsupported notification type %q", payload.Type)
	}
	if payload.ProjectID == "" || payload.SessionID == "" {
		return desktopNotification{}, fmt.Errorf("notification target is required")
	}
	title := payload.Title
	if title == "" {
		title = "WheelMaker"
	}
	body := payload.Body
	if body == "" {
		body = "Prompt completed"
	}
	return desktopNotification{
		Key:       payload.ProjectID + ":" + payload.SessionID,
		ProjectID: payload.ProjectID,
		SessionID: payload.SessionID,
		Title:     title,
		Body:      body,
		Status:    payload.Status,
	}, nil
}

func desktopNotificationResult(ok bool, reason string) string {
	if ok {
		return `{"ok":true}`
	}
	return `{"ok":false,"error":` + strconv.Quote(reason) + `}`
}

// desktopNotificationMetrics are the physical-pixel layout values for the
// notification windows, scaled from logical pixels by the main window DPI.
type desktopNotificationMetrics struct {
	width   int32
	height  int32
	gap     int32
	marginX int32
	marginY int32
}

const (
	desktopNotificationLogicalWidth           int32 = 480
	desktopNotificationLogicalHeight          int32 = 112
	desktopNotificationLogicalGap             int32 = 10
	desktopNotificationLogicalMarginX         int32 = 16
	desktopNotificationLogicalMarginY         int32 = 16
	desktopNotificationLogicalPadding         int32 = 16
	desktopNotificationLogicalDotSize         int32 = 10
	desktopNotificationLogicalTextGap         int32 = 10
	desktopNotificationLogicalTitleFontSize   int32 = 15
	desktopNotificationLogicalBodyFontSize    int32 = 13
	desktopNotificationLogicalTitleHeight     int32 = 22
	desktopNotificationLogicalBodyTop         int32 = 26
	desktopNotificationLogicalBodyBottomInset int32 = 10
)

type desktopNotificationWindowState struct {
	notification desktopNotification
	hwnd         uintptr
	rect         desktopWindowRect
}

type desktopNotificationOps interface {
	metricsForWindow() desktopNotificationMetrics
	workArea() (desktopWindowRect, bool)
	createWindow(state *desktopNotificationWindowState, rect desktopWindowRect) (uintptr, error)
	repositionWindow(hwnd uintptr, rect desktopWindowRect)
	repaintWindow(hwnd uintptr)
	resetDismissTimer(hwnd uintptr, milliseconds int)
	destroyWindow(hwnd uintptr)
	focusMainWindow()
	evalScript(script string)
}

const desktopNotificationDismissMilliseconds = 5000

type desktopNotificationCenter struct {
	ops   desktopNotificationOps
	mu    sync.Mutex
	order []string
	byKey map[string]*desktopNotificationWindowState
}

func newDesktopNotificationCenter(mainHwnd uintptr, eval func(script string)) *desktopNotificationCenter {
	return newDesktopNotificationCenterWithOps(newWin32DesktopNotificationOps(mainHwnd, eval))
}

func newDesktopNotificationCenterWithOps(ops desktopNotificationOps) *desktopNotificationCenter {
	center := &desktopNotificationCenter{
		ops:   ops,
		order: []string{},
		byKey: map[string]*desktopNotificationWindowState{},
	}
	desktopActiveNotificationCenter.Store(center)
	return center
}

func (c *desktopNotificationCenter) show(raw string) string {
	notification, err := parseDesktopNotification(raw)
	if err != nil {
		return desktopNotificationResult(false, "invalid_payload")
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	if existing, ok := c.byKey[notification.Key]; ok {
		existing.notification = notification
		c.ops.repaintWindow(existing.hwnd)
		c.ops.resetDismissTimer(existing.hwnd, desktopNotificationDismissMilliseconds)
		return desktopNotificationResult(true, "")
	}

	workArea, ok := c.ops.workArea()
	if !ok {
		return desktopNotificationResult(false, "work_area_unavailable")
	}
	metrics := c.ops.metricsForWindow()
	c.order = append(c.order, notification.Key)
	state := &desktopNotificationWindowState{notification: notification}
	c.byKey[notification.Key] = state
	state.rect = c.rectFor(workArea, metrics, len(c.order)-1)
	hwnd, err := c.ops.createWindow(state, state.rect)
	if err != nil {
		delete(c.byKey, notification.Key)
		c.order = c.order[:len(c.order)-1]
		return desktopNotificationResult(false, "window_failed")
	}
	state.hwnd = hwnd
	c.ops.resetDismissTimer(hwnd, desktopNotificationDismissMilliseconds)
	c.trimOverflowLocked(workArea, metrics)
	c.reflowLocked()
	return desktopNotificationResult(true, "")
}

// rectFor returns the rect of the window at index (0 = oldest, top-most slot).
// The newest window sits at the bottom of the stack.
func (c *desktopNotificationCenter) rectFor(workArea desktopWindowRect, metrics desktopNotificationMetrics, index int) desktopWindowRect {
	count := len(c.order)
	levelsFromBottom := int32(count - index)
	right := workArea.right - metrics.marginX
	bottom := workArea.bottom - metrics.marginY
	top := bottom - levelsFromBottom*metrics.height - (levelsFromBottom-1)*metrics.gap
	return desktopWindowRect{
		left:   right - metrics.width,
		top:    top,
		right:  right,
		bottom: top + metrics.height,
	}
}

func (c *desktopNotificationCenter) trimOverflowLocked(workArea desktopWindowRect, metrics desktopNotificationMetrics) {
	for len(c.order) > 0 {
		topRect := c.rectFor(workArea, metrics, 0)
		if topRect.top >= workArea.top {
			return
		}
		c.dismissLocked(c.order[0])
	}
}

func (c *desktopNotificationCenter) reflowLocked() {
	workArea, ok := c.ops.workArea()
	if !ok {
		return
	}
	metrics := c.ops.metricsForWindow()
	for index, key := range c.order {
		state := c.byKey[key]
		next := c.rectFor(workArea, metrics, index)
		if next != state.rect {
			state.rect = next
			c.ops.repositionWindow(state.hwnd, next)
		}
	}
}

func (c *desktopNotificationCenter) dismissLocked(key string) {
	state, ok := c.byKey[key]
	if !ok {
		return
	}
	delete(c.byKey, key)
	for index, existing := range c.order {
		if existing == key {
			c.order = append(c.order[:index], c.order[index+1:]...)
			break
		}
	}
	c.ops.destroyWindow(state.hwnd)
}

func (c *desktopNotificationCenter) handleClick(hwnd uintptr) {
	c.mu.Lock()
	var target *desktopNotificationWindowState
	for _, state := range c.byKey {
		if state.hwnd == hwnd {
			target = state
			break
		}
	}
	c.mu.Unlock()
	if target == nil {
		return
	}
	c.ops.focusMainWindow()
	c.ops.evalScript("window.dispatchEvent(new CustomEvent('wheelmaker:desktop-notification-click', {detail: {projectId: " +
		strconv.Quote(target.notification.ProjectID) + ", sessionId: " +
		strconv.Quote(target.notification.SessionID) + "}}));")
	c.mu.Lock()
	c.dismissLocked(target.notification.Key)
	c.reflowLocked()
	c.mu.Unlock()
}

func (c *desktopNotificationCenter) handleTimer(hwnd uintptr) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for key, state := range c.byKey {
		if state.hwnd == hwnd {
			c.dismissLocked(key)
			c.reflowLocked()
			return
		}
	}
}

func (c *desktopNotificationCenter) close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, key := range c.order {
		c.ops.destroyWindow(c.byKey[key].hwnd)
	}
	c.order = nil
	c.byKey = map[string]*desktopNotificationWindowState{}
	desktopActiveNotificationCenter.CompareAndSwap(c, nil)
}

var desktopActiveNotificationCenter atomic.Pointer[desktopNotificationCenter]

// --- Win32 presentation layer ---

const (
	desktopNotificationClassName = "WheelMakerDesktopNotification"
	desktopNotificationTimerID   = 1

	wmNCCreate   = 0x0081
	wmDestroy    = 0x0002
	wmPaint      = 0x000f
	wmTimer      = 0x0113
	wmLButtonUp  = 0x0202
	gwlUserData  = -21
	swShowNormal = 1

	wsPopup           = 0x80000000
	wsExTopMost       = 0x00000008
	wsExToolWindow    = 0x00000080
	swShowNA          = 8
	dtWordBreak       = 0x0010
	dtEndEllipsis     = 0x8000
	dtNoPrefix        = 0x0800
	dtSingleLine      = 0x0020
	transparentBkMode = 1
)

var (
	desktopGdi32                        = windows.NewLazySystemDLL("gdi32.dll")
	procGetCurrentThreadID              = kernel32.NewProc("GetCurrentThreadId")
	procSetTimer                        = user32.NewProc("SetTimer")
	procKillTimer                       = user32.NewProc("KillTimer")
	procBeginPaint                      = user32.NewProc("BeginPaint")
	procEndPaint                        = user32.NewProc("EndPaint")
	procFillRect                        = user32.NewProc("FillRect")
	procDrawTextW                       = user32.NewProc("DrawTextW")
	procSetWindowRgn                    = user32.NewProc("SetWindowRgn")
	procIsIconic                        = user32.NewProc("IsIconic")
	procSetForegroundWindow             = user32.NewProc("SetForegroundWindow")
	procGetForegroundWindow             = user32.NewProc("GetForegroundWindow")
	procAttachThreadInput               = user32.NewProc("AttachThreadInput")
	procGetWindowThreadProcessID        = user32.NewProc("GetWindowThreadProcessId")
	procSetActiveWindow                 = user32.NewProc("SetActiveWindow")
	procGetDpiForWindow                 = user32.NewProc("GetDpiForWindow")
	procInvalidateRect                  = user32.NewProc("InvalidateRect")
	procCreateSolidBrush                = desktopGdi32.NewProc("CreateSolidBrush")
	procCreateFontW                     = desktopGdi32.NewProc("CreateFontW")
	procEllipse                         = desktopGdi32.NewProc("Ellipse")
	procCreateRoundRectRgn              = desktopGdi32.NewProc("CreateRoundRectRgn")
	procSelectObject                    = desktopGdi32.NewProc("SelectObject")
	procDeleteObject                    = desktopGdi32.NewProc("DeleteObject")
	procSetBkMode                       = desktopGdi32.NewProc("SetBkMode")
	procSetTextColor                    = desktopGdi32.NewProc("SetTextColor")
	desktopNotificationWndProcCallback  = windows.NewCallback(desktopNotificationWndProc)
	desktopNotificationClassOnce        sync.Once
	desktopNotificationClassRegisterErr error
)

type desktopWndClassEx struct {
	size       uint32
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

type desktopPaintStruct struct {
	hdc       uintptr
	erase     int32
	rcPaint   desktopWindowRect
	restore   int32
	incUpdate int32
	reserved  [32]byte
}

type desktopCreateStruct struct {
	createParams uintptr
	instance     uintptr
	menu         uintptr
	parent       uintptr
	cy           int32
	cx           int32
	y            int32
	x            int32
	style        int32
	name         *uint16
	className    *uint16
	exStyle      uint32
}

type win32DesktopNotificationOps struct {
	mainHwnd uintptr
	eval     func(script string)
}

func newWin32DesktopNotificationOps(mainHwnd uintptr, eval func(script string)) *win32DesktopNotificationOps {
	return &win32DesktopNotificationOps{mainHwnd: mainHwnd, eval: eval}
}

func (o *win32DesktopNotificationOps) dpiScale() float64 {
	dpi, _, _ := procGetDpiForWindow.Call(o.mainHwnd)
	if dpi == 0 {
		return 1
	}
	return float64(dpi) / 96
}

func (o *win32DesktopNotificationOps) metricsForWindow() desktopNotificationMetrics {
	scale := o.dpiScale()
	scaled := func(logical int32) int32 { return int32(float64(logical)*scale + 0.5) }
	return desktopNotificationMetrics{
		width:   scaled(desktopNotificationLogicalWidth),
		height:  scaled(desktopNotificationLogicalHeight),
		gap:     scaled(desktopNotificationLogicalGap),
		marginX: scaled(desktopNotificationLogicalMarginX),
		marginY: scaled(desktopNotificationLogicalMarginY),
	}
}

func (o *win32DesktopNotificationOps) workArea() (desktopWindowRect, bool) {
	monitor, _, _ := procMonitorFromWindow.Call(o.mainHwnd, monitorDefaultToNearest)
	if monitor == 0 {
		return desktopWindowRect{}, false
	}
	info := win32MonitorInfo{cbSize: uint32(unsafe.Sizeof(win32MonitorInfo{}))}
	result, _, _ := procGetMonitorInfoW.Call(monitor, uintptr(unsafe.Pointer(&info)))
	if result == 0 {
		return desktopWindowRect{}, false
	}
	return info.rcWork, true
}

func registerDesktopNotificationClass() error {
	desktopNotificationClassOnce.Do(func() {
		className, err := windows.UTF16PtrFromString(desktopNotificationClassName)
		if err != nil {
			desktopNotificationClassRegisterErr = err
			return
		}
		instance, _, _ := procGetModuleHandleW.Call(0)
		class := desktopWndClassEx{
			wndProc:   desktopNotificationWndProcCallback,
			instance:  instance,
			className: className,
		}
		class.size = uint32(unsafe.Sizeof(class))
		atom, _, callErr := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&class)))
		if atom == 0 {
			desktopNotificationClassRegisterErr = fmt.Errorf("RegisterClassExW failed: %w", callErr)
		}
	})
	return desktopNotificationClassRegisterErr
}

func (o *win32DesktopNotificationOps) createWindow(state *desktopNotificationWindowState, rect desktopWindowRect) (uintptr, error) {
	if err := registerDesktopNotificationClass(); err != nil {
		return 0, err
	}
	className, err := windows.UTF16PtrFromString(desktopNotificationClassName)
	if err != nil {
		return 0, err
	}
	instance, _, _ := procGetModuleHandleW.Call(0)
	hwnd, _, callErr := procCreateWindowExW.Call(
		wsExTopMost|wsExToolWindow|wsExNoActivate,
		uintptr(unsafe.Pointer(className)),
		0,
		wsPopup,
		uintptr(uint32(rect.left)), uintptr(uint32(rect.top)),
		uintptr(uint32(rect.width())), uintptr(uint32(rect.height())),
		0, 0,
		instance,
		uintptr(unsafe.Pointer(state)),
	)
	if hwnd == 0 {
		return 0, fmt.Errorf("CreateWindowExW failed: %w", callErr)
	}
	corner := int32(16 * o.dpiScale())
	region, _, _ := procCreateRoundRectRgn.Call(
		0, 0,
		uintptr(uint32(rect.width()+1)), uintptr(uint32(rect.height()+1)),
		uintptr(uint32(corner)), uintptr(uint32(corner)),
	)
	if region != 0 {
		procSetWindowRgn.Call(hwnd, region, 1)
	}
	showWindow(hwnd, swShowNA)
	return hwnd, nil
}

func (o *win32DesktopNotificationOps) repositionWindow(hwnd uintptr, rect desktopWindowRect) {
	setWindowPosRect(hwnd, rect.left, rect.top, rect.width(), rect.height(), swpNoActivate|swpNoZOrder)
}

func (o *win32DesktopNotificationOps) repaintWindow(hwnd uintptr) {
	procInvalidateRect.Call(hwnd, 0, 1)
}

func (o *win32DesktopNotificationOps) resetDismissTimer(hwnd uintptr, milliseconds int) {
	procKillTimer.Call(hwnd, desktopNotificationTimerID)
	procSetTimer.Call(hwnd, desktopNotificationTimerID, uintptr(milliseconds), 0)
}

func (o *win32DesktopNotificationOps) destroyWindow(hwnd uintptr) {
	procKillTimer.Call(hwnd, desktopNotificationTimerID)
	procDestroyWindow.Call(hwnd)
}

func (o *win32DesktopNotificationOps) focusMainWindow() {
	if result, _, _ := procIsIconic.Call(o.mainHwnd); result != 0 {
		showWindow(o.mainHwnd, swRestore)
	}
	foreground, _, _ := procGetForegroundWindow.Call()
	var foregroundThread uint32
	procGetWindowThreadProcessID.Call(foreground, uintptr(unsafe.Pointer(&foregroundThread)))
	currentThread, _, _ := procGetCurrentThreadID.Call()
	if foregroundThread != 0 && uint32(currentThread) != foregroundThread {
		procAttachThreadInput.Call(uintptr(foregroundThread), currentThread, 1)
		defer procAttachThreadInput.Call(uintptr(foregroundThread), currentThread, 0)
	}
	procSetForegroundWindow.Call(o.mainHwnd)
	procSetActiveWindow.Call(o.mainHwnd)
}

func (o *win32DesktopNotificationOps) evalScript(script string) {
	if o.eval != nil {
		o.eval(script)
	}
}

func desktopNotificationStatusColor(status string) uint32 {
	switch status {
	case "failed":
		value, _ := parseColorRef("#FF453A")
		return value
	case "cancelled", "interrupted":
		value, _ := parseColorRef("#8E8E93")
		return value
	default:
		value, _ := parseColorRef("#34C759")
		return value
	}
}

func desktopNotificationWndProc(hwnd uintptr, msg uint32, wparam, lparam uintptr) uintptr {
	switch msg {
	case wmNCCreate:
		created := (*desktopCreateStruct)(unsafe.Pointer(lparam))
		setWindowLongPtr(hwnd, gwlUserData, created.createParams)
		return defaultDesktopWindowProc(hwnd, uintptr(msg), wparam, lparam)
	case wmPaint:
		stateRaw := getWindowLongPtr(hwnd, gwlUserData)
		if stateRaw != 0 {
			state := (*desktopNotificationWindowState)(unsafe.Pointer(stateRaw))
			paintDesktopNotification(hwnd, state)
			return 0
		}
	case wmTimer:
		if center := desktopActiveNotificationCenter.Load(); center != nil {
			center.handleTimer(hwnd)
		}
		return 0
	case wmLButtonUp:
		if center := desktopActiveNotificationCenter.Load(); center != nil {
			center.handleClick(hwnd)
		}
		return 0
	case wmDestroy:
		return 0
	}
	return defaultDesktopWindowProc(hwnd, uintptr(msg), wparam, lparam)
}

func paintDesktopNotification(hwnd uintptr, state *desktopNotificationWindowState) {
	var paint desktopPaintStruct
	hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&paint)))
	if hdc == 0 {
		return
	}
	defer procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&paint)))

	var client desktopWindowRect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	width := client.width()
	height := client.height()
	scale := float64(height) / float64(desktopNotificationLogicalHeight)

	background, _ := parseColorRef("#202226")
	backgroundBrush, _, _ := procCreateSolidBrush.Call(uintptr(background))
	procFillRect.Call(hdc, uintptr(unsafe.Pointer(&client)), backgroundBrush)
	procDeleteObject.Call(backgroundBrush)

	scaled := func(logical int32) int32 { return int32(float64(logical)*scale + 0.5) }
	pad := scaled(desktopNotificationLogicalPadding)

	// Status dot.
	dotSize := scaled(desktopNotificationLogicalDotSize)
	dotTop := pad + scaled(3)
	dotBrush, _, _ := procCreateSolidBrush.Call(uintptr(desktopNotificationStatusColor(state.notification.Status)))
	procEllipse.Call(hdc,
		uintptr(uint32(pad)), uintptr(uint32(dotTop)),
		uintptr(uint32(pad+dotSize)), uintptr(uint32(dotTop+dotSize)))
	procDeleteObject.Call(dotBrush)

	procSetBkMode.Call(hdc, transparentBkMode)
	textLeft := pad + dotSize + scaled(desktopNotificationLogicalTextGap)

	// Title.
	titleFont := createNotificationFont(scaled(desktopNotificationLogicalTitleFontSize), true)
	if titleFont != 0 {
		procSelectObject.Call(hdc, titleFont)
	}
	titleColor, _ := parseColorRef("#F5F5F5")
	procSetTextColor.Call(hdc, uintptr(titleColor))
	titleRect := desktopWindowRect{
		left:   textLeft,
		top:    pad,
		right:  width - pad,
		bottom: pad + scaled(desktopNotificationLogicalTitleHeight),
	}
	drawNotificationText(hdc, state.notification.Title, &titleRect, dtSingleLine|dtEndEllipsis|dtNoPrefix)
	if titleFont != 0 {
		procDeleteObject.Call(titleFont)
	}

	// Body preview.
	bodyFont := createNotificationFont(scaled(desktopNotificationLogicalBodyFontSize), false)
	if bodyFont != 0 {
		procSelectObject.Call(hdc, bodyFont)
	}
	bodyColor, _ := parseColorRef("#B8BCC4")
	procSetTextColor.Call(hdc, uintptr(bodyColor))
	bodyRect := desktopWindowRect{
		left:   textLeft,
		top:    pad + scaled(desktopNotificationLogicalBodyTop),
		right:  width - pad,
		bottom: height - scaled(desktopNotificationLogicalBodyBottomInset),
	}
	drawNotificationText(hdc, state.notification.Body, &bodyRect, dtWordBreak|dtEndEllipsis|dtNoPrefix)
	if bodyFont != 0 {
		procDeleteObject.Call(bodyFont)
	}
}

func createNotificationFont(size int32, bold bool) uintptr {
	weight := 400
	if bold {
		weight = 700
	}
	face, err := windows.UTF16PtrFromString("Segoe UI")
	if err != nil {
		return 0
	}
	font, _, _ := procCreateFontW.Call(
		uintptr(uint32(size)), 0, 0, 0,
		uintptr(uint32(weight)),
		0, 0, 0, 0, 0, 0, 0, 0,
		uintptr(unsafe.Pointer(face)),
	)
	return font
}

func drawNotificationText(hdc uintptr, text string, rect *desktopWindowRect, flags uintptr) {
	utf16Text := utf16.Encode([]rune(text))
	utf16Text = append(utf16Text, 0)
	procDrawTextW.Call(
		hdc,
		uintptr(unsafe.Pointer(&utf16Text[0])),
		uintptr(uint32(len(utf16Text)-1)),
		uintptr(unsafe.Pointer(rect)),
		flags,
	)
}
