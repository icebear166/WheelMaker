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

// launchDeepSeekLoginWindow embeds the DeepSeek platform login page as a child
// overlay of the main window. The overlay window, its message loop, and every
// shutdown signal live on one locked OS thread, so WM_QUIT can never reach the
// main window's loop (the previous standalone-window version white-screened
// because the loop ran on a different thread than the window, and closing it
// posted WM_QUIT into a queue shared with the main app).
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

		embedDeepSeekLoginOverlay(hwnd, parentHwnd)

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

// destroyDeepSeekLoginWindow closes the overlay window if it still exists,
// pumping the teardown messages on the current (owning) thread.
func destroyDeepSeekLoginWindow(window webview2.WebView, hwnd uintptr) {
	if !isWindow(hwnd) {
		return
	}
	window.Destroy()
	window.Run()
}

// embedDeepSeekLoginOverlay reparents the login window into the main window so
// it renders as an in-app dialog instead of a separate system window.
func embedDeepSeekLoginOverlay(hwnd, parentHwnd uintptr) {
	setWindowParent(hwnd, parentHwnd)
	style := getWindowLongPtr(hwnd, gwlStyle)
	style &^= wsMinimizeBox | wsMaximizeBox
	style |= wsChild | wsClipSiblings
	setWindowLongPtr(hwnd, gwlStyle, style)
	width, height := int32(deepSeekLoginOverlayWidth), int32(deepSeekLoginOverlayHeight)
	x, y := int32(0), int32(0)
	if rect, ok := getClientRect(parentHwnd); ok {
		x = (rect.right - width) / 2
		y = (rect.bottom - height) / 2
		if x < 0 {
			x = 0
		}
		if y < 0 {
			y = 0
		}
	}
	setWindowPosRect(hwnd, x, y, width, height, swpNoZOrder|swpFrameChanged|swpShowWindow)
	applyDesktopWindowTheme(hwnd, desktopTitleBarThemeColor)
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
