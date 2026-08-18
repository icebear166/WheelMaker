//go:build windows

package main

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

// desktopNotification is the trusted-page payload rendered as a WinRT system
// toast. The WebView2 notification pipeline is intentionally not used: it
// denies permission requests without host handling and never routes toast
// clicks back to the page.
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

// desktopNotificationStatusPrefix returns the status symbol prepended to the
// toast body, matching the PWA notification convention.
func desktopNotificationStatusPrefix(status string) string {
	switch status {
	case "failed":
		return "✗ "
	case "cancelled", "interrupted":
		return "■ "
	default:
		return "✓ "
	}
}

type desktopToastContent struct {
	Title  string
	Body   string
	Tag    string
	Launch string
}

func desktopToastContentFor(n desktopNotification) desktopToastContent {
	return desktopToastContent{
		Title:  n.Title,
		Body:   desktopNotificationStatusPrefix(n.Status) + n.Body,
		Tag:    n.Key,
		Launch: "projectId=" + n.ProjectID + "&sessionId=" + n.SessionID,
	}
}

func marshalDesktopToastXML(c desktopToastContent) string {
	escape := func(s string) string {
		var b strings.Builder
		_ = xml.EscapeText(&b, []byte(s))
		return b.String()
	}
	return `<toast launch="` + escape(c.Launch) + `" activationType="foreground">` +
		`<visual><binding template="ToastGeneric">` +
		`<text>` + escape(c.Title) + `</text>` +
		`<text>` + escape(c.Body) + `</text>` +
		`</binding></visual></toast>`
}

const (
	nimAdd    = 0x0
	nimDelete = 0x2

	nifMessage = 0x1
	nifIcon    = 0x2
	nifTip     = 0x4

	wmApp       = 0x8000
	wmLButtonUp = 0x0202

	desktopTrayIconID          = 1
	desktopTrayCallbackMessage = wmApp + 1
	desktopTrayClassName       = "WheelMakerDesktopTray"
	desktopTrayTooltip         = "WheelMaker"
)

// desktopToastOps abstracts the WinRT/COM toast machinery so the notifier
// stays testable without touching real COM.
type desktopToastOps interface {
	registerIdentity() error
	showToast(xml, tag string) error
	unregister()
}

type desktopTrayOps interface {
	installTrayIcon(notifier *desktopToastNotifier) (uintptr, error)
	removeTrayIcon(hwnd uintptr)
	focusMainWindow()
	evalScript(script string)
}

// desktopToastNotifier sends WinRT toasts and owns the persistent tray icon.
// The tray icon is no longer a notification channel; it only provides the
// click-to-focus entry point and hosts the hidden window that toast
// activations are relayed to.
type desktopToastNotifier struct {
	toast desktopToastOps
	tray  desktopTrayOps

	mu                 sync.Mutex
	trayHwnd           uintptr
	trayInstalled      bool
	identityRegistered bool
}

func newDesktopToastNotifier(mainHwnd uintptr, eval func(script string)) *desktopToastNotifier {
	return newDesktopToastNotifierWithOps(
		newWin32DesktopToastOps(mainHwnd),
		newWin32DesktopTrayOps(mainHwnd, eval),
	)
}

func newDesktopToastNotifierWithOps(toast desktopToastOps, tray desktopTrayOps) *desktopToastNotifier {
	notifier := &desktopToastNotifier{toast: toast, tray: tray}
	desktopActiveTrayNotifier.Store(notifier)
	notifier.mu.Lock()
	defer notifier.mu.Unlock()
	notifier.registerLocked()
	notifier.installTrayLocked()
	return notifier
}

// registerLocked self-registers the toast identity. A failure leaves the
// notifier unregistered so a later show retries.
func (n *desktopToastNotifier) registerLocked() {
	if n.identityRegistered {
		return
	}
	if err := n.toast.registerIdentity(); err != nil {
		return
	}
	n.identityRegistered = true
}

// installTrayLocked adds the tray icon. A failure leaves the tray
// uninstalled so a later show retries; toast delivery does not depend on it.
func (n *desktopToastNotifier) installTrayLocked() {
	if n.trayInstalled {
		return
	}
	hwnd, err := n.tray.installTrayIcon(n)
	if err != nil {
		return
	}
	n.trayHwnd = hwnd
	n.trayInstalled = true
}

func (n *desktopToastNotifier) show(raw string) string {
	notification, err := parseDesktopNotification(raw)
	if err != nil {
		return desktopNotificationResult(false, "invalid_payload")
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	n.installTrayLocked()
	n.registerLocked()
	if !n.identityRegistered {
		return desktopNotificationResult(false, "identity_unavailable")
	}
	content := desktopToastContentFor(notification)
	if err := n.toast.showToast(marshalDesktopToastXML(content), content.Tag); err != nil {
		return desktopNotificationResult(false, "toast_failed")
	}
	return desktopNotificationResult(true, "")
}

func (n *desktopToastNotifier) handleTrayClick() {
	n.tray.focusMainWindow()
}

// parseDesktopToastLaunchArgs parses the toast launch attribute produced by
// desktopToastContentFor ("projectId=<pid>&sessionId=<sid>").
func parseDesktopToastLaunchArgs(args string) (projectID, sessionID string, ok bool) {
	values, err := url.ParseQuery(args)
	if err != nil {
		return "", "", false
	}
	projectID = values.Get("projectId")
	sessionID = values.Get("sessionId")
	return projectID, sessionID, projectID != "" && sessionID != ""
}

// handleToastActivation runs on the UI thread; the COM activator relays toast
// clicks here via PostMessage to the hidden tray window.
func (n *desktopToastNotifier) handleToastActivation(args string) {
	projectID, sessionID, ok := parseDesktopToastLaunchArgs(args)
	if !ok {
		return
	}
	n.tray.focusMainWindow()
	n.tray.evalScript("window.dispatchEvent(new CustomEvent('wheelmaker:desktop-notification-click', {detail: {projectId: " +
		strconv.Quote(projectID) + ", sessionId: " +
		strconv.Quote(sessionID) + "}}));")
}

func (n *desktopToastNotifier) close() {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.trayInstalled {
		n.tray.removeTrayIcon(n.trayHwnd)
		n.trayInstalled = false
		n.trayHwnd = 0
	}
	if n.identityRegistered {
		n.toast.unregister()
		n.identityRegistered = false
	}
	desktopActiveTrayNotifier.CompareAndSwap(n, nil)
}

var desktopActiveTrayNotifier atomic.Pointer[desktopToastNotifier]

// --- Win32 tray layer ---

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

func (o *win32DesktopTrayOps) installTrayIcon(_ *desktopToastNotifier) (uintptr, error) {
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
	desktopTrayWindowHwnd.Store(hwnd)
	return hwnd, nil
}

func (o *win32DesktopTrayOps) removeTrayIcon(hwnd uintptr) {
	desktopTrayWindowHwnd.Store(0)
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
		if lparam == wmLButtonUp {
			if notifier := desktopActiveTrayNotifier.Load(); notifier != nil {
				notifier.handleTrayClick()
			}
		}
		return 0
	}
	if msg == wmToastActivated {
		if notifier := desktopActiveTrayNotifier.Load(); notifier != nil {
			for _, args := range drainDesktopToastActivations() {
				notifier.handleToastActivation(args)
			}
		}
		return 0
	}
	return defaultDesktopWindowProc(hwnd, uintptr(msg), wparam, lparam)
}
