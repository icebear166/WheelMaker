//go:build windows

package main

import (
	"errors"
	"runtime"
	"time"

	webview2 "github.com/jchv/go-webview2"
)

const (
	deepSeekLoginOverlayWidth  = 460
	deepSeekLoginOverlayHeight = 640
)

// launchDeepSeekLoginWindow opens the DeepSeek platform login page as an owned
// popup of the main window: no taskbar entry, always above the main window,
// and tracked to its center. The popup window, its message loop, and every
// shutdown signal live on one locked OS thread, so WM_QUIT can never reach the
// main window's loop. The popup is deliberately NOT embedded as a child of the
// main window: reparenting across threads attaches both threads' input queues,
// which lets the popup's WM_QUIT (posted by go-webview2 on window destroy)
// leak into the main loop and kill the whole app — the bug this version fixes.
func launchDeepSeekLoginWindow(parentHwnd uintptr) (string, error) {
	type loginOutcome struct {
		token string
		err   error
	}
	outcomeCh := make(chan loginOutcome, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()

		window := webview2.NewWithOptions(webview2.WebViewOptions{
			WindowOptions: webview2.WindowOptions{
				Title:  "DeepSeek Login",
				Width:  deepSeekLoginOverlayWidth,
				Height: deepSeekLoginOverlayHeight,
				IconId: desktopResourceIconID,
				Center: true,
			},
		})
		if window == nil {
			outcomeCh <- loginOutcome{err: errWebView2Unavailable}
			return
		}
		hwnd := uintptr(window.Window())
		loginSecurity, err := newDesktopWebViewSecurityState(deepSeekLoginURL, desktopTrustedRemotePage)
		if err != nil {
			destroyDeepSeekLoginWindow(window, hwnd)
			outcomeCh <- loginOutcome{err: err}
			return
		}
		loginRuntime := &desktopRuntime{security: loginSecurity}
		adapter, err := installDesktopWebViewPolicyAdapter(window, loginRuntime)
		if err != nil {
			destroyDeepSeekLoginWindow(window, hwnd)
			outcomeCh <- loginOutcome{err: err}
			return
		}
		defer adapter.Close()

		makeDeepSeekLoginOwnedPopup(hwnd, parentHwnd)
		stopTracking := trackDeepSeekLoginPopup(window, hwnd, parentHwnd)

		var token string
		timedOut := false
		window.Bind("__wheelMakerDeepSeekToken", func(value string) {
			token = value
			window.Terminate()
		})
		window.Bind("__wheelMakerDeepSeekClose", func() {
			window.Terminate()
		})
		window.Init(deepSeekLoginPollScript())
		timeout := time.AfterFunc(deepSeekLoginTimeout, func() {
			window.Dispatch(func() {
				timedOut = true
				window.Terminate()
			})
		})
		window.SetHtml(deepSeekLoginSplashHTML)
		window.Navigate(deepSeekLoginURL)
		window.Run()
		timeout.Stop()
		stopTracking()
		destroyDeepSeekLoginWindow(window, hwnd)
		runtime.KeepAlive(adapter)
		switch {
		case token != "":
			outcomeCh <- loginOutcome{token: token}
		case timedOut:
			outcomeCh <- loginOutcome{err: errors.New("deepseek login timed out")}
		default:
			outcomeCh <- loginOutcome{err: errors.New("deepseek login window closed")}
		}
	}()
	outcome := <-outcomeCh
	return outcome.token, outcome.err
}

// destroyDeepSeekLoginWindow closes the popup window if it still exists,
// pumping the teardown messages on the current (owning) thread.
func destroyDeepSeekLoginWindow(window webview2.WebView, hwnd uintptr) {
	if !isWindow(hwnd) {
		return
	}
	window.Destroy()
	window.Run()
}

// makeDeepSeekLoginOwnedPopup marks the login window as owned by the main
// window (stays above it, no taskbar entry) and centers it over the owner.
func makeDeepSeekLoginOwnedPopup(hwnd, parentHwnd uintptr) {
	setWindowLongPtr(hwnd, gwlHwndParent, parentHwnd)
	centerDeepSeekLoginPopup(hwnd, parentHwnd)
	applyDesktopWindowTheme(hwnd, desktopTitleBarThemeColor)
}

func centerDeepSeekLoginPopup(hwnd, parentHwnd uintptr) {
	parentRect, ok := getWindowRect(parentHwnd)
	if !ok {
		return
	}
	width, height := int32(deepSeekLoginOverlayWidth), int32(deepSeekLoginOverlayHeight)
	x := parentRect.left + (parentRect.width()-width)/2
	y := parentRect.top + (parentRect.height()-height)/2
	if x < 0 {
		x = 0
	}
	if y < 0 {
		y = 0
	}
	setWindowPosRect(hwnd, x, y, width, height, swpNoZOrder|swpNoActivate)
}

// trackDeepSeekLoginPopup keeps the popup centered over the main window while
// it moves. Repositioning is dispatched back onto the popup's own thread.
func trackDeepSeekLoginPopup(window webview2.WebView, hwnd, parentHwnd uintptr) func() {
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		var last desktopWindowRect
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				rect, ok := getWindowRect(parentHwnd)
				if !ok || rect == last {
					continue
				}
				last = rect
				window.Dispatch(func() { centerDeepSeekLoginPopup(hwnd, parentHwnd) })
			}
		}
	}()
	return func() { close(done) }
}

// deepSeekLoginSplashHTML covers the WebView2 default white background while
// the platform page is being fetched; navigation replaces it on commit.
const deepSeekLoginSplashHTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; height: 100%; background: #1b1b1b; }
body { display: grid; place-items: center; color: #a3a3a3; font: 13px system-ui, sans-serif; }
strong { display: block; margin-bottom: 6px; color: #dedede; font-size: 14px; text-align: center; }
</style></head>
<body><div><strong>DeepSeek Login</strong>Loading platform.deepseek.com…</div></body></html>`
