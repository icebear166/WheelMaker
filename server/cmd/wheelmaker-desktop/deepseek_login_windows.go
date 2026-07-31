//go:build windows

package main

import (
	"errors"
	"sync"
	"time"

	webview2 "github.com/jchv/go-webview2"
)

// launchDeepSeekLoginWindow opens a modal WebView2 window on the official
// DeepSeek platform page, polls localStorage for the session token, and
// returns it. Closing the window or the 10-minute timeout returns an error.
func launchDeepSeekLoginWindow() (string, error) {
	window := webview2.NewWithOptions(webview2.WebViewOptions{
		WindowOptions: webview2.WindowOptions{
			Title:  "DeepSeek Login",
			Width:  480,
			Height: 720,
			IconId: desktopResourceIconID,
			Center: true,
		},
	})
	if window == nil {
		return "", errWebView2Unavailable
	}
	loginSecurity, err := newDesktopWebViewSecurityState(deepSeekLoginURL, desktopTrustedRemotePage)
	if err != nil {
		window.Destroy()
		return "", err
	}
	loginRuntime := &desktopRuntime{security: loginSecurity}
	if _, err := installDesktopWebViewPolicyAdapter(window, loginRuntime); err != nil {
		window.Destroy()
		return "", err
	}

	tokenCh := make(chan string, 1)
	closedCh := make(chan struct{})
	var closeOnce sync.Once
	markClosed := func() { closeOnce.Do(func() { close(closedCh) }) }

	window.Bind("__wheelMakerDeepSeekToken", func(token string) {
		tokenCh <- token
	})
	window.Bind("__wheelMakerDeepSeekClose", func() {
		markClosed()
	})
	window.Init(deepSeekLoginPollScript())

	runDone := make(chan struct{})
	go func() {
		window.Run()
		close(runDone)
	}()
	window.Navigate(deepSeekLoginURL)

	select {
	case token := <-tokenCh:
		window.Terminate()
		<-runDone
		window.Destroy()
		return token, nil
	case <-closedCh:
		window.Terminate()
		<-runDone
		window.Destroy()
		return "", errors.New("deepseek login window closed")
	case <-time.After(deepSeekLoginTimeout):
		window.Terminate()
		<-runDone
		window.Destroy()
		return "", errors.New("deepseek login timed out")
	}
}
