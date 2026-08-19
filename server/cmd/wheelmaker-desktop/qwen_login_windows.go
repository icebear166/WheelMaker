//go:build windows

package main

import (
	"errors"
	"runtime"

	webview2 "github.com/jchv/go-webview2"
)

func newQwenLoginWebViewSecurityState(baseURL string) (*desktopWebViewSecurityState, error) {
	state, err := newDesktopWebViewSecurityState(baseURL, desktopTrustedRemotePage)
	if err != nil {
		return nil, err
	}
	state.mu.Lock()
	if state.policy != nil {
		state.policy.trustedHosts = []string{
			"bailian.console.aliyun.com",
			"modelstudio.console.alibabacloud.com",
			"account.aliyun.com",
			"passport.aliyun.com",
			"login.aliyun.com",
		}
		state.policy.trustedHostSuffixes = nil
	}
	state.mu.Unlock()
	return state, nil
}

func launchQwenLoginWindow(parentHwnd uintptr) (string, error) {
	type loginOutcome struct {
		credential string
		err        error
	}
	outcomeCh := make(chan loginOutcome, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		callback, err := newQwenLoginCallback("domestic")
		if err != nil {
			outcomeCh <- loginOutcome{err: err}
			return
		}
		defer callback.Close()
		window := webview2.NewWithOptions(webview2.WebViewOptions{
			WindowOptions: webview2.WindowOptions{
				Title: "Qwen / Bailian Login", Width: deepSeekLoginOverlayWidth, Height: deepSeekLoginOverlayHeight,
				IconId: desktopResourceIconID, Center: true,
			},
		})
		if window == nil {
			callback.Close()
			outcomeCh <- loginOutcome{err: errWebView2Unavailable}
			return
		}
		hwnd := uintptr(window.Window())
		loginSecurity, err := newQwenLoginWebViewSecurityState(qwenLoginURL)
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
		var credential string
		timedOut := false
		callbackDone := make(chan struct{})
		go func() {
			defer close(callbackDone)
			value, waitErr := callback.Wait()
			if waitErr == nil {
				window.Dispatch(func() {
					credential = extractQwenOAuth(value)
					window.Terminate()
				})
				return
			}
			if errors.Is(waitErr, errQwenLoginTimeout) {
				window.Dispatch(func() { timedOut = true; window.Terminate() })
			}
		}()
		window.SetHtml(deepSeekLoginSplashHTML)
		window.Navigate(callback.LoginURL())
		window.Run()
		callback.Close()
		<-callbackDone
		stopTracking()
		destroyDeepSeekLoginWindow(window, hwnd)
		runtime.KeepAlive(adapter)
		switch {
		case credential != "":
			outcomeCh <- loginOutcome{credential: credential}
		case timedOut:
			outcomeCh <- loginOutcome{err: errors.New("qwen login timed out")}
		default:
			outcomeCh <- loginOutcome{err: errQwenLoginClosed}
		}
	}()
	outcome := <-outcomeCh
	return outcome.credential, outcome.err
}
