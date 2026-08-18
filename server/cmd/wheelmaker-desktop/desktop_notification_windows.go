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

// desktopNotification is the trusted-page payload delivered through the tray
// balloon pipeline. Balloons are converted to system toasts by the shell on
// Windows 10/11 and land in the action center. The WebView2 notification
// pipeline is intentionally not used: it denies permission requests without
// host handling and never routes toast clicks back to the page.
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

// Balloon fields are fixed-size UTF-16 buffers: szInfoTitle holds 64 WCHARs
// and szInfo 256, both including the terminator.
const (
	desktopNotificationTitleMaxUTF16 = 63
	desktopNotificationBodyMaxUTF16  = 255
)

const (
	nimAdd    = 0x0
	nimModify = 0x1
	nimDelete = 0x2

	nifMessage = 0x1
	nifIcon    = 0x2
	nifTip     = 0x4
	nifInfo    = 0x10

	niifNone  = 0x0
	niifInfo  = 0x1
	niifError = 0x3

	wmApp               = 0x8000
	wmLButtonUp         = 0x0202
	ninBalloonUserClick = 0x0405

	desktopTrayIconID          = 1
	desktopTrayCallbackMessage = wmApp + 1
	desktopTrayClassName       = "WheelMakerDesktopTray"
	desktopTrayTooltip         = "WheelMaker"
)

func desktopNotificationBalloonFlags(status string) uint32 {
	switch status {
	case "failed":
		return niifError
	case "cancelled", "interrupted":
		return niifNone
	default:
		return niifInfo
	}
}

// truncateNotificationUTF16 cuts s to at most maxUnits UTF-16 code units
// without splitting a surrogate pair.
func truncateNotificationUTF16(s string, maxUnits int) string {
	units := 0
	for i, r := range s {
		need := 1
		if r > 0xFFFF {
			need = 2
		}
		if units+need > maxUnits {
			return s[:i]
		}
		units += need
	}
	return s
}

type desktopTrayOps interface {
	installTrayIcon(notifier *desktopTrayNotifier) (uintptr, error)
	showBalloon(hwnd uintptr, title, body string, flags uint32) error
	removeTrayIcon(hwnd uintptr)
	focusMainWindow()
	evalScript(script string)
}

// desktopTrayNotifier owns the persistent tray icon that hosts balloon
// notifications. A single balloon is showing at any time: a new notification
// replaces the one still on screen. Only a click on the showing balloon can
// be routed back to its session; action center history entries cannot.
type desktopTrayNotifier struct {
	ops       desktopTrayOps
	mu        sync.Mutex
	hwnd      uintptr
	installed bool
	last      desktopNotification
	hasLast   bool
}

func newDesktopTrayNotifier(mainHwnd uintptr, eval func(script string)) *desktopTrayNotifier {
	return newDesktopTrayNotifierWithOps(newWin32DesktopTrayOps(mainHwnd, eval))
}

func newDesktopTrayNotifierWithOps(ops desktopTrayOps) *desktopTrayNotifier {
	notifier := &desktopTrayNotifier{ops: ops}
	desktopActiveTrayNotifier.Store(notifier)
	notifier.mu.Lock()
	notifier.installLocked()
	notifier.mu.Unlock()
	return notifier
}

// installLocked adds the tray icon. A failure leaves the notifier
// uninstalled so a later show retries once the shell is ready.
func (n *desktopTrayNotifier) installLocked() {
	if n.installed {
		return
	}
	hwnd, err := n.ops.installTrayIcon(n)
	if err != nil {
		return
	}
	n.hwnd = hwnd
	n.installed = true
}

func (n *desktopTrayNotifier) show(raw string) string {
	notification, err := parseDesktopNotification(raw)
	if err != nil {
		return desktopNotificationResult(false, "invalid_payload")
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	n.installLocked()
	if !n.installed {
		return desktopNotificationResult(false, "tray_unavailable")
	}
	title := truncateNotificationUTF16(notification.Title, desktopNotificationTitleMaxUTF16)
	body := truncateNotificationUTF16(notification.Body, desktopNotificationBodyMaxUTF16)
	if err := n.ops.showBalloon(n.hwnd, title, body, desktopNotificationBalloonFlags(notification.Status)); err != nil {
		return desktopNotificationResult(false, "balloon_failed")
	}
	n.last = notification
	n.hasLast = true
	return desktopNotificationResult(true, "")
}

func (n *desktopTrayNotifier) handleBalloonClick() {
	n.mu.Lock()
	if !n.hasLast {
		n.mu.Unlock()
		return
	}
	target := n.last
	n.mu.Unlock()
	n.ops.focusMainWindow()
	n.ops.evalScript("window.dispatchEvent(new CustomEvent('wheelmaker:desktop-notification-click', {detail: {projectId: " +
		strconv.Quote(target.ProjectID) + ", sessionId: " +
		strconv.Quote(target.SessionID) + "}}));")
}

func (n *desktopTrayNotifier) handleTrayClick() {
	n.ops.focusMainWindow()
}

func (n *desktopTrayNotifier) close() {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.installed {
		n.ops.removeTrayIcon(n.hwnd)
		n.installed = false
		n.hwnd = 0
	}
	desktopActiveTrayNotifier.CompareAndSwap(n, nil)
}

var desktopActiveTrayNotifier atomic.Pointer[desktopTrayNotifier]

// --- Win32 presentation layer ---

var (
	procShellNotifyIconW         = desktopShell32.NewProc("Shell_NotifyIconW")
	procLoadIconW                = user32.NewProc("LoadIconW")
	procGetCurrentThreadID       = kernel32.NewProc("GetCurrentThreadId")
	procIsIconic                 = user32.NewProc("IsIconic")
	procSetForegroundWindow      = user32.NewProc("SetForegroundWindow")
	procGetForegroundWindow      = user32.NewProc("GetForegroundWindow")
	procAttachThreadInput        = user32.NewProc("AttachThreadInput")
	procGetWindowThreadProcessID = user32.NewProc("GetWindowThreadProcessId")
	procSetActiveWindow          = user32.NewProc("SetActiveWindow")
	desktopTrayWndProcHandler    = windows.NewCallback(desktopTrayWndProc)
	desktopTrayClassOnce         sync.Once
	desktopTrayClassErr          error
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

// desktopNotifyIconData mirrors NOTIFYICONDATAW (Vista+ layout).
type desktopNotifyIconData struct {
	cbSize           uint32
	hwnd             uintptr
	id               uint32
	flags            uint32
	callbackMessage  uint32
	icon             uintptr
	tip              [128]uint16
	state            uint32
	stateMask        uint32
	info             [256]uint16
	timeoutOrVersion uint32
	infoTitle        [64]uint16
	infoFlags        uint32
	guidItem         [16]byte
	balloonIcon      uintptr
}

func setNotifyIconString(dst []uint16, s string) {
	copy(dst, utf16.Encode([]rune(s)))
}

type win32DesktopTrayOps struct {
	mainHwnd uintptr
	eval     func(script string)
}

func newWin32DesktopTrayOps(mainHwnd uintptr, eval func(script string)) *win32DesktopTrayOps {
	return &win32DesktopTrayOps{mainHwnd: mainHwnd, eval: eval}
}

func registerDesktopTrayClass() error {
	desktopTrayClassOnce.Do(func() {
		className, err := windows.UTF16PtrFromString(desktopTrayClassName)
		if err != nil {
			desktopTrayClassErr = err
			return
		}
		instance, _, _ := procGetModuleHandleW.Call(0)
		class := desktopWndClassEx{
			wndProc:   desktopTrayWndProcHandler,
			instance:  instance,
			className: className,
		}
		class.size = uint32(unsafe.Sizeof(class))
		atom, _, callErr := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&class)))
		if atom == 0 {
			desktopTrayClassErr = fmt.Errorf("RegisterClassExW failed: %w", callErr)
		}
	})
	return desktopTrayClassErr
}

func (o *win32DesktopTrayOps) installTrayIcon(_ *desktopTrayNotifier) (uintptr, error) {
	if err := registerDesktopTrayClass(); err != nil {
		return 0, err
	}
	className, err := windows.UTF16PtrFromString(desktopTrayClassName)
	if err != nil {
		return 0, err
	}
	instance, _, _ := procGetModuleHandleW.Call(0)
	hwnd, _, callErr := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		0,
		0,
		0, 0, 0, 0,
		0, 0,
		instance,
		0,
	)
	if hwnd == 0 {
		return 0, fmt.Errorf("CreateWindowExW failed: %w", callErr)
	}
	icon, _, _ := procLoadIconW.Call(instance, uintptr(desktopResourceIconID))
	if icon == 0 {
		procDestroyWindow.Call(hwnd)
		return 0, fmt.Errorf("LoadIconW failed for icon resource %d", desktopResourceIconID)
	}
	data := desktopNotifyIconData{
		hwnd:            hwnd,
		id:              desktopTrayIconID,
		flags:           nifMessage | nifIcon | nifTip,
		callbackMessage: desktopTrayCallbackMessage,
		icon:            icon,
	}
	data.cbSize = uint32(unsafe.Sizeof(data))
	setNotifyIconString(data.tip[:], desktopTrayTooltip)
	result, _, callErr := procShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&data)))
	if result == 0 {
		procDestroyWindow.Call(hwnd)
		return 0, fmt.Errorf("Shell_NotifyIconW NIM_ADD failed: %w", callErr)
	}
	return hwnd, nil
}

func (o *win32DesktopTrayOps) showBalloon(hwnd uintptr, title, body string, flags uint32) error {
	data := desktopNotifyIconData{
		hwnd:      hwnd,
		id:        desktopTrayIconID,
		flags:     nifInfo,
		infoFlags: flags,
	}
	data.cbSize = uint32(unsafe.Sizeof(data))
	setNotifyIconString(data.infoTitle[:], title)
	setNotifyIconString(data.info[:], body)
	result, _, callErr := procShellNotifyIconW.Call(nimModify, uintptr(unsafe.Pointer(&data)))
	if result == 0 {
		return fmt.Errorf("Shell_NotifyIconW NIM_MODIFY balloon failed: %w", callErr)
	}
	return nil
}

func (o *win32DesktopTrayOps) removeTrayIcon(hwnd uintptr) {
	data := desktopNotifyIconData{
		hwnd: hwnd,
		id:   desktopTrayIconID,
	}
	data.cbSize = uint32(unsafe.Sizeof(data))
	procShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&data)))
	procDestroyWindow.Call(hwnd)
}

func (o *win32DesktopTrayOps) focusMainWindow() {
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

func (o *win32DesktopTrayOps) evalScript(script string) {
	if o.eval != nil {
		o.eval(script)
	}
}

func desktopTrayWndProc(hwnd uintptr, msg uint32, wparam, lparam uintptr) uintptr {
	if msg == desktopTrayCallbackMessage {
		if notifier := desktopActiveTrayNotifier.Load(); notifier != nil {
			switch lparam {
			case wmLButtonUp:
				notifier.handleTrayClick()
			case ninBalloonUserClick:
				notifier.handleBalloonClick()
			}
		}
		return 0
	}
	return defaultDesktopWindowProc(hwnd, uintptr(msg), wparam, lparam)
}
