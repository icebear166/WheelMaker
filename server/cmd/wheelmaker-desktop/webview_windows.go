//go:build windows

package main

import (
	"context"
	"errors"
	"runtime"
	"strconv"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

type webView2Launcher struct{}

func newWebView2Launcher() desktopLauncher {
	return webView2Launcher{}
}

func (webView2Launcher) Launch(target desktopLaunchTarget, opts desktopWindowOptions) error {
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:  opts.Title,
			Width:  opts.Width,
			Height: opts.Height,
			IconId: opts.IconID,
			Center: true,
		},
	})
	if w == nil {
		return errWebView2Unavailable
	}
	defer w.Destroy()
	adapter, err := installDesktopWebViewPolicyAdapter(w, opts.Runtime)
	if err != nil {
		return err
	}
	defer adapter.Close()
	hwnd := uintptr(w.Window())
	if hwnd != 0 {
		if opts.CustomTitleBar {
			applyCustomTitleBarFrame(hwnd)
		}
		applyDesktopWindowTheme(hwnd, opts.ThemeColor)
		if err := bindDesktopWindowBridge(w, hwnd, opts.Runtime); err != nil {
			return err
		}
		w.Init(desktopRuntimeInitScript())
	}
	if target.HTML != "" {
		w.SetHtml(target.HTML)
	} else {
		w.Navigate(target.URL)
	}
	w.Run()
	runtime.KeepAlive(adapter)
	return nil
}

func bindDesktopWindowBridge(w webview2.WebView, hwnd uintptr, desktopRuntime *desktopRuntime) error {
	if desktopRuntime == nil {
		return errors.New("desktop runtime is unavailable")
	}
	maximizeController := newDesktopMaximizeController(hwnd, win32DesktopWindowOps{})
	authorize := func(action desktopBridgeAction) error {
		if !desktopRuntime.security.AuthorizeCurrent(action) {
			return errors.New("desktop bridge action is not authorized for the current page")
		}
		return nil
	}
	bindings := []struct {
		name string
		fn   interface{}
	}{
		{desktopBootstrapGetStateBinding, func() (desktopBootstrapState, error) {
			if err := authorize(desktopBridgeGetState); err != nil {
				return desktopBootstrapState{}, err
			}
			return desktopRuntime.GetState(), nil
		}},
		{desktopBootstrapSaveBinding, func(raw string) (desktopBootstrapResult, error) {
			if err := authorize(desktopBridgeSaveBaseURL); err != nil {
				return desktopBootstrapResult{}, err
			}
			return desktopRuntime.SaveBaseURL(context.Background(), raw), nil
		}},
		{desktopBootstrapRetryBinding, func() (desktopBootstrapResult, error) {
			if err := authorize(desktopBridgeRetry); err != nil {
				return desktopBootstrapResult{}, err
			}
			return desktopRuntime.Retry(context.Background()), nil
		}},
		{desktopBootstrapResetBinding, func() (desktopBootstrapResult, error) {
			if err := authorize(desktopBridgeReset); err != nil {
				return desktopBootstrapResult{}, err
			}
			return desktopRuntime.Reset(context.Background()), nil
		}},
		{desktopStartDragBinding, func() error {
			if err := authorize(desktopBridgeStartDrag); err != nil {
				return err
			}
			startWindowDrag(hwnd)
			return nil
		}},
		{desktopMinimizeBinding, func() error {
			if err := authorize(desktopBridgeMinimize); err != nil {
				return err
			}
			showWindow(hwnd, swMinimize)
			return nil
		}},
		{desktopToggleMaximizeBinding, func() error {
			if err := authorize(desktopBridgeToggleMaximize); err != nil {
				return err
			}
			maximizeController.toggle()
			return nil
		}},
		{desktopCloseBinding, func() error {
			if err := authorize(desktopBridgeClose); err != nil {
				return err
			}
			postWindowClose(hwnd)
			return nil
		}},
		{desktopRequestServerBinding, func() error {
			if err := authorize(desktopBridgeRequestServerChange); err != nil {
				return err
			}
			return desktopRuntime.RequestServerChange(context.Background())
		}},
	}
	for _, binding := range bindings {
		if err := w.Bind(binding.name, binding.fn); err != nil {
			return err
		}
	}
	return nil
}

func applyCustomTitleBarFrame(hwnd uintptr) {
	style := getWindowLongPtr(hwnd, gwlStyle)
	style &^= wsCaption
	style |= wsSysMenu | wsThickFrame | wsMinimizeBox | wsMaximizeBox
	setWindowLongPtr(hwnd, gwlStyle, style)
	setWindowPos(hwnd, swpNoMove|swpNoSize|swpNoZOrder|swpNoOwnerZOrder|swpFrameChanged)
}

func applyDesktopWindowTheme(hwnd uintptr, hexColor string) {
	var darkMode int32 = 1
	_ = setDwmWindowAttribute(hwnd, dwmwaUseImmersiveDarkMode, unsafe.Pointer(&darkMode), uint32(unsafe.Sizeof(darkMode)))
	if color, ok := parseColorRef(hexColor); ok {
		_ = setDwmWindowAttribute(hwnd, dwmwaCaptionColor, unsafe.Pointer(&color), uint32(unsafe.Sizeof(color)))
		_ = setDwmWindowAttribute(hwnd, dwmwaBorderColor, unsafe.Pointer(&color), uint32(unsafe.Sizeof(color)))
	}
}

func startWindowDrag(hwnd uintptr) {
	releaseCapture()
	sendWindowMessage(hwnd, wmNCLButtonDown, htCaption, 0)
}

func postWindowClose(hwnd uintptr) {
	postWindowMessage(hwnd, wmClose, 0, 0)
}

func parseColorRef(hexColor string) (uint32, bool) {
	if len(hexColor) != 7 || hexColor[0] != '#' {
		return 0, false
	}
	value, err := strconv.ParseUint(hexColor[1:], 16, 32)
	if err != nil {
		return 0, false
	}
	red := value >> 16 & 0xff
	green := value >> 8 & 0xff
	blue := value & 0xff
	return uint32(red | green<<8 | blue<<16), true
}
