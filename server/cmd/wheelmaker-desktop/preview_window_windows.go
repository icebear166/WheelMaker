//go:build windows

package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/url"
	"path"
	"runtime"
	"strconv"
	"strings"
	"sync"

	webview2 "github.com/jchv/go-webview2"
)

const (
	previewWindowDefaultWidth         int32 = 1100
	previewWindowDefaultHeight        int32 = 780
	previewWindowMinimumWidth         int32 = 720
	previewWindowMinimumHeight        int32 = 480
	previewWindowMargin               int32 = 24
	previewWindowMinimumVisibleWidth  int32 = 320
	previewWindowMinimumVisibleHeight int32 = 180
)

type desktopPreviewWindowController struct {
	mainWebView webview2.WebView
	mainWindow  uintptr
	runtime     *desktopRuntime
	channelName string

	mu      sync.Mutex
	window  webview2.WebView
	hwnd    uintptr
	opening bool
	closed  bool
}

func newDesktopPreviewWindowController(mainWebView webview2.WebView, mainWindow uintptr, runtime *desktopRuntime, channelName string) (*desktopPreviewWindowController, error) {
	if mainWindow == 0 || runtime == nil {
		return nil, errors.New("Preview window controller is unavailable")
	}
	if channelName == "" {
		return nil, errors.New("Preview channel is unavailable")
	}
	return &desktopPreviewWindowController{
		mainWebView: mainWebView,
		mainWindow:  mainWindow,
		runtime:     runtime,
		channelName: channelName,
	}, nil
}

func (c *desktopPreviewWindowController) Open() error {
	baseURL := c.runtime.TrustedPreviewURL()
	if baseURL == "" {
		return errors.New("Preview is not connected")
	}
	targetURL, err := previewWindowURL(baseURL)
	if err != nil {
		return err
	}

	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return errors.New("Preview window controller is closed")
	}
	if c.window != nil {
		hwnd := c.hwnd
		c.mu.Unlock()
		focusDesktopPreviewWindow(hwnd)
		return nil
	}
	if c.opening {
		c.mu.Unlock()
		return nil
	}
	c.opening = true
	storedBounds := c.runtime.PreviewWindowBounds()
	c.mu.Unlock()

	go c.run(targetURL, storedBounds)
	return nil
}

func (c *desktopPreviewWindowController) Focus() error {
	c.mu.Lock()
	hwnd := c.hwnd
	c.mu.Unlock()
	if hwnd == 0 || !isWindow(hwnd) {
		return errors.New("Preview window is not open")
	}
	focusDesktopPreviewWindow(hwnd)
	return nil
}

func (c *desktopPreviewWindowController) Dock() error {
	c.mu.Lock()
	window := c.window
	c.mu.Unlock()
	if window == nil {
		return nil
	}
	window.Dispatch(func() { window.Terminate() })
	return nil
}

func (c *desktopPreviewWindowController) Close() {
	c.mu.Lock()
	c.closed = true
	window := c.window
	c.mu.Unlock()
	if window != nil {
		window.Dispatch(func() { window.Terminate() })
	}
}

func (c *desktopPreviewWindowController) run(targetURL string, storedBounds *desktopPreviewWindowBounds) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	window := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: false,
		WindowOptions: webview2.WindowOptions{
			Title:  "WheelMaker Preview",
			Width:  uint(previewWindowDefaultWidth),
			Height: uint(previewWindowDefaultHeight),
			IconId: desktopResourceIconID,
			Center: false,
		},
	})
	if window == nil {
		c.finish(0, desktopWindowRect{})
		return
	}
	hwnd := uintptr(window.Window())
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		window.Destroy()
		c.finish(hwnd, desktopWindowRect{})
		return
	}
	c.window = window
	c.hwnd = hwnd
	c.opening = false
	c.mu.Unlock()

	defer func() {
		if hwnd != 0 {
			if bounds, ok := getWindowRect(hwnd); ok {
				_ = c.runtime.SavePreviewWindowBounds(desktopPreviewWindowBounds{
					Left:   bounds.left,
					Top:    bounds.top,
					Width:  bounds.width(),
					Height: bounds.height(),
				})
			}
		}
		window.Destroy()
		c.finish(hwnd, desktopWindowRect{})
	}()

	baseURL := c.runtime.TrustedPreviewURL()
	mode := c.runtime.security.Mode()
	security, err := newDesktopWebViewSecurityState(baseURL, mode)
	if err != nil {
		return
	}
	companionRuntime := &desktopRuntime{
		config:   desktopConfig{BaseURL: baseURL},
		state:    desktopBootstrapState{BaseURL: baseURL, SupportsLocalhost: true},
		security: security,
	}
	if mode == desktopTrustedLocalhostPage {
		companionRuntime.config.ConnectionMode = desktopConnectionLocalhost
		companionRuntime.localhostURL = baseURL
	} else if mode == desktopTrustedRemotePage {
		companionRuntime.config.ConnectionMode = desktopConnectionGateway
	} else if mode == desktopTrustedLocalDevPage {
		companionRuntime.config = desktopConfig{}
	}
	adapter, err := installDesktopWebViewPolicyAdapter(window, companionRuntime)
	if err != nil {
		return
	}
	defer adapter.Close()

	applyDesktopWindowTheme(hwnd, desktopTitleBarThemeColor)
	initial := resolvePreviewWindowRect(storedBounds, c.mainWindow)
	if hwnd != 0 {
		setWindowPosRect(hwnd, initial.left, initial.top, initial.width(), initial.height(), swpNoZOrder|swpShowWindow)
		showWindow(hwnd, swRestore)
	}
	window.Init(desktopCompanionRuntimeInitScript(c.channelName))
	window.Navigate(targetURL)
	window.Run()
	runtime.KeepAlive(adapter)
}

func (c *desktopPreviewWindowController) finish(hwnd uintptr, _ desktopWindowRect) {
	c.mu.Lock()
	notifyMain := !c.closed
	if c.hwnd == hwnd || hwnd == 0 {
		c.window = nil
		c.hwnd = 0
	}
	c.opening = false
	c.mu.Unlock()
	if notifyMain && c.mainWebView != nil {
		c.mainWebView.Dispatch(func() {
			c.mainWebView.Eval(previewWindowClosedScript(c.channelName))
		})
	}
}

func previewWindowClosedScript(channelName string) string {
	return `(() => {
  try {
    const channel = new BroadcastChannel(` + strconv.Quote(channelName) + `);
    channel.postMessage({kind: 'preview-window-closed', version: 1});
    channel.close();
  } catch (_) {}
})();`
}

func newDesktopPreviewChannelName() (string, error) {
	var randomBytes [16]byte
	if _, err := rand.Read(randomBytes[:]); err != nil {
		return "", errors.New("generate Preview channel name: " + err.Error())
	}
	return "wheelmaker.preview-workbench.v1." + hex.EncodeToString(randomBytes[:]), nil
}

func focusDesktopPreviewWindow(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	showWindow(hwnd, swRestore)
	setForegroundWindow(hwnd)
}

func previewWindowURL(baseURL string) (string, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("invalid Preview base URL")
	}
	basePath := strings.TrimSuffix(parsed.Path, "/")
	parsed.Path = path.Join(basePath, "preview-window")
	parsed.RawPath = ""
	return parsed.String(), nil
}

func resolvePreviewWindowRect(stored *desktopPreviewWindowBounds, mainHwnd uintptr) desktopWindowRect {
	areas := getDesktopMonitorWorkAreas()
	if len(areas) == 0 {
		return desktopWindowRect{left: 80, top: 80, right: 80 + previewWindowDefaultWidth, bottom: 80 + previewWindowDefaultHeight}
	}
	if stored != nil && stored.Width >= previewWindowMinimumWidth && stored.Height >= previewWindowMinimumHeight {
		candidate := desktopWindowRect{
			left:   stored.Left,
			top:    stored.Top,
			right:  stored.Left + stored.Width,
			bottom: stored.Top + stored.Height,
		}
		if desktopWindowRectVisible(candidate, areas) {
			return candidate
		}
	}
	mainArea := desktopWindowWorkAreaForWindow(mainHwnd, areas)
	for _, area := range areas {
		if area.workArea != mainArea {
			return placePreviewWindowInWorkArea(area.workArea)
		}
	}
	return placePreviewWindowNearMain(mainArea, mainHwnd)
}

func desktopWindowWorkAreaForWindow(hwnd uintptr, areas []desktopMonitorWorkArea) desktopWindowRect {
	if hwnd != 0 {
		if rect, ok := getWindowRect(hwnd); ok {
			centerX := rect.left + rect.width()/2
			centerY := rect.top + rect.height()/2
			for _, area := range areas {
				if centerX >= area.monitor.left && centerX < area.monitor.right &&
					centerY >= area.monitor.top && centerY < area.monitor.bottom {
					return area.workArea
				}
			}
		}
	}
	return areas[0].workArea
}

func placePreviewWindowInWorkArea(area desktopWindowRect) desktopWindowRect {
	width := previewWindowDefaultWidth
	height := previewWindowDefaultHeight
	if area.width() < width+previewWindowMargin*2 {
		width = area.width() - previewWindowMargin*2
	}
	if area.height() < height+previewWindowMargin*2 {
		height = area.height() - previewWindowMargin*2
	}
	if width < previewWindowMinimumWidth {
		width = previewWindowMinimumWidth
	}
	if height < previewWindowMinimumHeight {
		height = previewWindowMinimumHeight
	}
	return desktopWindowRect{
		left:   area.left + previewWindowMargin,
		top:    area.top + previewWindowMargin,
		right:  area.left + previewWindowMargin + width,
		bottom: area.top + previewWindowMargin + height,
	}
}

func placePreviewWindowNearMain(area desktopWindowRect, mainHwnd uintptr) desktopWindowRect {
	width := previewWindowDefaultWidth
	height := previewWindowDefaultHeight
	if mainHwnd != 0 {
		if mainRect, ok := getWindowRect(mainHwnd); ok {
			x := mainRect.right + previewWindowMargin
			top := maxInt32(area.top+previewWindowMargin, mainRect.top)
			maxTop := area.bottom - previewWindowMargin - height
			if maxTop < area.top {
				maxTop = area.top
			}
			top = minInt32(top, maxTop)
			if x+width <= area.right {
				return desktopWindowRect{left: x, top: top, right: x + width, bottom: top + height}
			}
		}
	}
	return placePreviewWindowInWorkArea(area)
}

func desktopWindowRectVisible(rect desktopWindowRect, areas []desktopMonitorWorkArea) bool {
	for _, area := range areas {
		left := maxInt32(rect.left, area.workArea.left)
		top := maxInt32(rect.top, area.workArea.top)
		right := minInt32(rect.right, area.workArea.right)
		bottom := minInt32(rect.bottom, area.workArea.bottom)
		if right-left >= previewWindowMinimumVisibleWidth && bottom-top >= previewWindowMinimumVisibleHeight {
			return true
		}
	}
	return false
}

func minInt32(left, right int32) int32 {
	if left < right {
		return left
	}
	return right
}

func maxInt32(left, right int32) int32 {
	if left > right {
		return left
	}
	return right
}
