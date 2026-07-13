//go:build windows

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

var (
	desktopShell32          = windows.NewLazySystemDLL("shell32.dll")
	desktopShellExecuteW    = desktopShell32.NewProc("ShellExecuteW")
	desktopCoreWebView2_13  = edge.NewGUID("{f75f09a8-667e-4983-88d6-c8773f315e84}")
	desktopWebView2Profile2 = edge.NewGUID("{fa740d4b-5eae-4344-a8ad-74be31925397}")
)

type desktopIUnknownVtbl struct {
	QueryInterface edge.ComProc
	AddRef         edge.ComProc
	Release        edge.ComProc
}

type desktopControllerVtbl struct {
	desktopIUnknownVtbl
	BeforeGetCoreWebView2 [22]edge.ComProc
	GetCoreWebView2       edge.ComProc
}

type desktopControllerCOM struct {
	Vtbl *desktopControllerVtbl
}

type desktopCoreWebView2Vtbl struct {
	desktopIUnknownVtbl
	GetSettings                            edge.ComProc
	GetSource                              edge.ComProc
	Navigate                               edge.ComProc
	NavigateToString                       edge.ComProc
	AddNavigationStarting                  edge.ComProc
	RemoveNavigationStarting               edge.ComProc
	AddContentLoading                      edge.ComProc
	RemoveContentLoading                   edge.ComProc
	AddSourceChanged                       edge.ComProc
	RemoveSourceChanged                    edge.ComProc
	AddHistoryChanged                      edge.ComProc
	RemoveHistoryChanged                   edge.ComProc
	AddNavigationCompleted                 edge.ComProc
	RemoveNavigationCompleted              edge.ComProc
	AddFrameNavigationStarting             edge.ComProc
	RemoveFrameNavigationStarting          edge.ComProc
	AddFrameNavigationCompleted            edge.ComProc
	RemoveFrameNavigationCompleted         edge.ComProc
	AddScriptDialogOpening                 edge.ComProc
	RemoveScriptDialogOpening              edge.ComProc
	AddPermissionRequested                 edge.ComProc
	RemovePermissionRequested              edge.ComProc
	AddProcessFailed                       edge.ComProc
	RemoveProcessFailed                    edge.ComProc
	AddScriptToExecuteOnDocumentCreated    edge.ComProc
	RemoveScriptToExecuteOnDocumentCreated edge.ComProc
	ExecuteScript                          edge.ComProc
	CapturePreview                         edge.ComProc
	Reload                                 edge.ComProc
	PostWebMessageAsJSON                   edge.ComProc
	PostWebMessageAsString                 edge.ComProc
	AddWebMessageReceived                  edge.ComProc
	RemoveWebMessageReceived               edge.ComProc
	CallDevToolsProtocolMethod             edge.ComProc
	GetBrowserProcessID                    edge.ComProc
	GetCanGoBack                           edge.ComProc
	GetCanGoForward                        edge.ComProc
	GoBack                                 edge.ComProc
	GoForward                              edge.ComProc
	GetDevToolsProtocolEventReceiver       edge.ComProc
	Stop                                   edge.ComProc
	AddNewWindowRequested                  edge.ComProc
	RemoveNewWindowRequested               edge.ComProc
}

type desktopCoreWebView2COM struct {
	Vtbl *desktopCoreWebView2Vtbl
}

type desktopNavigationStartingArgsVtbl struct {
	desktopIUnknownVtbl
	GetURI             edge.ComProc
	GetIsUserInitiated edge.ComProc
	GetIsRedirected    edge.ComProc
	GetRequestHeaders  edge.ComProc
	GetCancel          edge.ComProc
	PutCancel          edge.ComProc
	GetNavigationID    edge.ComProc
}

type desktopNavigationStartingArgsCOM struct {
	Vtbl *desktopNavigationStartingArgsVtbl
}

type desktopNavigationCompletedArgsVtbl struct {
	desktopIUnknownVtbl
	GetIsSuccess      edge.ComProc
	GetWebErrorStatus edge.ComProc
	GetNavigationID   edge.ComProc
}

type desktopNavigationCompletedArgsCOM struct {
	Vtbl *desktopNavigationCompletedArgsVtbl
}

type desktopNewWindowArgsVtbl struct {
	desktopIUnknownVtbl
	GetURI             edge.ComProc
	PutNewWindow       edge.ComProc
	GetNewWindow       edge.ComProc
	PutHandled         edge.ComProc
	GetHandled         edge.ComProc
	GetIsUserInitiated edge.ComProc
	GetDeferral        edge.ComProc
	GetWindowFeatures  edge.ComProc
}

type desktopNewWindowArgsCOM struct {
	Vtbl *desktopNewWindowArgsVtbl
}

type desktopCoreWebView2_13Vtbl struct {
	desktopIUnknownVtbl
	GetProfile edge.ComProc
}

type desktopCoreWebView2_13COM struct {
	Vtbl *desktopCoreWebView2_13Vtbl
}

type desktopProfileCOM struct {
	Vtbl *desktopIUnknownVtbl
}

type desktopProfile2Vtbl struct {
	desktopIUnknownVtbl
	ClearBrowsingData            edge.ComProc
	ClearBrowsingDataInTimeRange edge.ComProc
	ClearBrowsingDataAll         edge.ComProc
}

type desktopProfile2COM struct {
	Vtbl *desktopProfile2Vtbl
}

type desktopEventToken struct {
	Value int64
}

type desktopWebViewPolicyAdapter struct {
	webview webview2.WebView
	core    *desktopCoreWebView2COM
	runtime *desktopRuntime

	navigationStarting      *desktopNavigationStartingHandler
	frameNavigationStarting *desktopNavigationStartingHandler
	newWindowRequested      *desktopNewWindowHandler
	navigationToken         desktopEventToken
	frameNavigationToken    desktopEventToken
	newWindowToken          desktopEventToken

	mu          sync.Mutex
	navigations map[uint64]uint64
	pending     sync.Map
}

func installDesktopWebViewPolicyAdapter(w webview2.WebView, runtime *desktopRuntime) (*desktopWebViewPolicyAdapter, error) {
	if runtime == nil {
		return nil, errors.New("desktop runtime is required")
	}
	chromium, err := desktopChromiumFromWebView(w)
	if err != nil {
		return nil, err
	}
	settings, err := chromium.GetSettings()
	if err != nil {
		return nil, fmt.Errorf("get WebView2 settings: %w", err)
	}
	if err := settings.PutIsBuiltInErrorPageEnabled(false); err != nil {
		return nil, fmt.Errorf("disable WebView2 certificate error pages: %w", err)
	}

	controller := chromium.GetController()
	if controller == nil {
		return nil, errors.New("WebView2 controller is unavailable")
	}
	var core *desktopCoreWebView2COM
	rawController := (*desktopControllerCOM)(unsafe.Pointer(controller))
	if hr, _, _ := rawController.Vtbl.GetCoreWebView2.Call(
		uintptr(unsafe.Pointer(rawController)),
		uintptr(unsafe.Pointer(&core)),
	); desktopHRESULTFailed(hr) || core == nil {
		return nil, fmt.Errorf("get CoreWebView2 failed: HRESULT 0x%08x", uint32(hr))
	}

	adapter := &desktopWebViewPolicyAdapter{
		webview:     w,
		core:        core,
		runtime:     runtime,
		navigations: make(map[uint64]uint64),
	}
	adapter.navigationStarting = newDesktopNavigationStartingHandler(adapter, true)
	adapter.frameNavigationStarting = newDesktopNavigationStartingHandler(adapter, false)
	adapter.newWindowRequested = newDesktopNewWindowHandler(adapter)

	if err := desktopAddEvent(core.Vtbl.AddNavigationStarting, core, adapter.navigationStarting, &adapter.navigationToken); err != nil {
		return nil, fmt.Errorf("add NavigationStarting: %w", err)
	}
	if err := desktopAddEvent(core.Vtbl.AddFrameNavigationStarting, core, adapter.frameNavigationStarting, &adapter.frameNavigationToken); err != nil {
		adapter.Close()
		return nil, fmt.Errorf("add FrameNavigationStarting: %w", err)
	}
	if err := desktopAddEvent(core.Vtbl.AddNewWindowRequested, core, adapter.newWindowRequested, &adapter.newWindowToken); err != nil {
		adapter.Close()
		return nil, fmt.Errorf("add NewWindowRequested: %w", err)
	}

	chromium.NavigationCompletedCallback = func(_ *edge.ICoreWebView2, args *edge.ICoreWebView2NavigationCompletedEventArgs) {
		adapter.navigationCompleted((*desktopNavigationCompletedArgsCOM)(unsafe.Pointer(args)))
	}
	runtime.AttachSurface(adapter)
	return adapter, nil
}

func desktopChromiumFromWebView(w webview2.WebView) (*edge.Chromium, error) {
	value := reflect.ValueOf(w)
	if value.Kind() != reflect.Pointer || value.IsNil() {
		return nil, errors.New("unexpected WebView2 implementation")
	}
	field := value.Elem().FieldByName("browser")
	if !field.IsValid() || !field.CanAddr() {
		return nil, errors.New("WebView2 browser adapter is unavailable")
	}
	browser := reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Interface()
	chromium, ok := browser.(*edge.Chromium)
	if !ok || chromium == nil {
		return nil, errors.New("WebView2 Chromium adapter is unavailable")
	}
	return chromium, nil
}

func desktopAddEvent(proc edge.ComProc, core *desktopCoreWebView2COM, handler any, token *desktopEventToken) error {
	value := reflect.ValueOf(handler)
	if value.Kind() != reflect.Pointer || value.IsNil() {
		return errors.New("invalid COM event handler")
	}
	hr, _, _ := proc.Call(
		uintptr(unsafe.Pointer(core)),
		value.Pointer(),
		uintptr(unsafe.Pointer(token)),
	)
	if desktopHRESULTFailed(hr) {
		return syscall.Errno(hr)
	}
	return nil
}

func (a *desktopWebViewPolicyAdapter) Close() {
	if a == nil || a.core == nil {
		return
	}
	if a.navigationToken.Value != 0 {
		_, _, _ = a.core.Vtbl.RemoveNavigationStarting.Call(uintptr(unsafe.Pointer(a.core)), uintptr(a.navigationToken.Value))
		a.navigationToken.Value = 0
	}
	if a.frameNavigationToken.Value != 0 {
		_, _, _ = a.core.Vtbl.RemoveFrameNavigationStarting.Call(uintptr(unsafe.Pointer(a.core)), uintptr(a.frameNavigationToken.Value))
		a.frameNavigationToken.Value = 0
	}
	if a.newWindowToken.Value != 0 {
		_, _, _ = a.core.Vtbl.RemoveNewWindowRequested.Call(uintptr(unsafe.Pointer(a.core)), uintptr(a.newWindowToken.Value))
		a.newWindowToken.Value = 0
	}
	_, _, _ = a.core.Vtbl.Release.Call(uintptr(unsafe.Pointer(a.core)))
	a.core = nil
}

func (a *desktopWebViewPolicyAdapter) handleNavigation(args *desktopNavigationStartingArgsCOM, mainFrame bool) uintptr {
	rawURL, err := desktopNavigationURI(args)
	if err != nil {
		_ = desktopCancelNavigation(args)
		return 0
	}
	action := a.runtime.security.DecideNavigation(rawURL, mainFrame, false)
	if !mainFrame {
		if action != desktopNavigationAllow {
			_ = desktopCancelNavigation(args)
		}
		return 0
	}

	navigationID, err := desktopNavigationID(args)
	if err != nil {
		_ = desktopCancelNavigation(args)
		return 0
	}
	epoch := a.runtime.security.BeginTopLevelNavigation(rawURL)

	switch action {
	case desktopNavigationAllow:
		a.mu.Lock()
		a.navigations[navigationID] = epoch
		a.mu.Unlock()
		return 0
	case desktopNavigationOpenExternal:
		a.mu.Lock()
		delete(a.navigations, navigationID)
		a.mu.Unlock()
		_ = desktopCancelNavigation(args)
		a.runtime.security.RejectTopLevelNavigation(epoch)
		_ = openDesktopExternalURL(rawURL)
	default:
		a.mu.Lock()
		delete(a.navigations, navigationID)
		a.mu.Unlock()
		_ = desktopCancelNavigation(args)
		a.runtime.security.RejectTopLevelNavigation(epoch)
	}
	return 0
}

func (a *desktopWebViewPolicyAdapter) navigationCompleted(args *desktopNavigationCompletedArgsCOM) {
	if args == nil {
		return
	}
	var success int32
	if hr, _, _ := args.Vtbl.GetIsSuccess.Call(uintptr(unsafe.Pointer(args)), uintptr(unsafe.Pointer(&success))); desktopHRESULTFailed(hr) {
		return
	}
	var navigationID uint64
	if hr, _, _ := args.Vtbl.GetNavigationID.Call(uintptr(unsafe.Pointer(args)), uintptr(unsafe.Pointer(&navigationID))); desktopHRESULTFailed(hr) {
		return
	}
	a.mu.Lock()
	epoch := a.navigations[navigationID]
	delete(a.navigations, navigationID)
	a.mu.Unlock()
	if epoch == 0 || success == 0 {
		a.runtime.security.RejectTopLevelNavigation(epoch)
		if epoch != 0 {
			a.runtime.HandleNavigationFailure("The secure server navigation failed. Retry or change the address.")
		}
		return
	}
	rawURL, err := a.source()
	if err != nil {
		a.runtime.security.RejectTopLevelNavigation(epoch)
		return
	}
	a.runtime.security.CommitTopLevelNavigation(epoch, rawURL)
}

func (a *desktopWebViewPolicyAdapter) source() (string, error) {
	var value *uint16
	hr, _, _ := a.core.Vtbl.GetSource.Call(uintptr(unsafe.Pointer(a.core)), uintptr(unsafe.Pointer(&value)))
	if desktopHRESULTFailed(hr) || value == nil {
		return "", syscall.Errno(hr)
	}
	defer windows.CoTaskMemFree(unsafe.Pointer(value))
	return windows.UTF16PtrToString(value), nil
}

func (a *desktopWebViewPolicyAdapter) Navigate(baseURL string) {
	a.webview.Dispatch(func() { a.webview.Navigate(baseURL) })
}

func (a *desktopWebViewPolicyAdapter) ShowBootstrapHTML(html string) {
	a.webview.Dispatch(func() { a.webview.SetHtml(html) })
}

func (a *desktopWebViewPolicyAdapter) Logout(ctx context.Context, baseURL string) error {
	baseJSON, err := json.Marshal(baseURL)
	if err != nil {
		return err
	}
	script := `(() => { try {
  const base = new URL(` + string(baseJSON) + `);
  const status = new XMLHttpRequest();
  status.open('GET', new URL('ws?auth=status', base), false);
  status.withCredentials = true;
  status.send(null);
  if (status.status < 200 || status.status >= 300) return false;
  const csrf = JSON.parse(status.responseText).csrfToken;
  if (!csrf) return false;
  const logout = new XMLHttpRequest();
  logout.open('POST', new URL('ws?auth=logout', base), false);
  logout.withCredentials = true;
  logout.setRequestHeader('X-WheelMaker-CSRF', csrf);
  logout.send(null);
  return logout.status >= 200 && logout.status < 300;
} catch (_) { return false; } })()`
	return a.executeScript(ctx, script)
}

func (a *desktopWebViewPolicyAdapter) executeScript(ctx context.Context, script string) error {
	done := make(chan error, 1)
	a.webview.Dispatch(func() {
		handler := newDesktopExecuteScriptHandler(a, done)
		a.pending.Store(handler, struct{}{})
		wide, err := windows.UTF16PtrFromString(script)
		if err != nil {
			a.pending.Delete(handler)
			done <- err
			return
		}
		hr, _, _ := a.core.Vtbl.ExecuteScript.Call(
			uintptr(unsafe.Pointer(a.core)),
			uintptr(unsafe.Pointer(wide)),
			uintptr(unsafe.Pointer(handler)),
		)
		if desktopHRESULTFailed(hr) {
			a.pending.Delete(handler)
			done <- syscall.Errno(hr)
		}
	})
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (a *desktopWebViewPolicyAdapter) ClearSiteData(ctx context.Context, _ string) error {
	done := make(chan error, 1)
	a.webview.Dispatch(func() {
		profile, profile2, err := a.profile2()
		if err != nil {
			done <- err
			return
		}
		handler := newDesktopClearBrowsingDataHandler(a, done, profile, profile2)
		a.pending.Store(handler, struct{}{})
		hr, _, _ := profile2.Vtbl.ClearBrowsingDataAll.Call(
			uintptr(unsafe.Pointer(profile2)),
			uintptr(unsafe.Pointer(handler)),
		)
		if desktopHRESULTFailed(hr) {
			a.pending.Delete(handler)
			desktopReleaseCOM(profile2)
			desktopReleaseCOM(profile)
			done <- syscall.Errno(hr)
		}
	})
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (a *desktopWebViewPolicyAdapter) profile2() (*desktopProfileCOM, *desktopProfile2COM, error) {
	var version13 *desktopCoreWebView2_13COM
	hr, _, _ := a.core.Vtbl.QueryInterface.Call(
		uintptr(unsafe.Pointer(a.core)),
		uintptr(unsafe.Pointer(desktopCoreWebView2_13)),
		uintptr(unsafe.Pointer(&version13)),
	)
	if desktopHRESULTFailed(hr) || version13 == nil {
		return nil, nil, fmt.Errorf("query ICoreWebView2_13: HRESULT 0x%08x", uint32(hr))
	}
	defer desktopReleaseCOM(version13)

	var profile *desktopProfileCOM
	hr, _, _ = version13.Vtbl.GetProfile.Call(uintptr(unsafe.Pointer(version13)), uintptr(unsafe.Pointer(&profile)))
	if desktopHRESULTFailed(hr) || profile == nil {
		return nil, nil, fmt.Errorf("get WebView2 profile: HRESULT 0x%08x", uint32(hr))
	}
	var profile2 *desktopProfile2COM
	hr, _, _ = profile.Vtbl.QueryInterface.Call(
		uintptr(unsafe.Pointer(profile)),
		uintptr(unsafe.Pointer(desktopWebView2Profile2)),
		uintptr(unsafe.Pointer(&profile2)),
	)
	if desktopHRESULTFailed(hr) || profile2 == nil {
		desktopReleaseCOM(profile)
		return nil, nil, fmt.Errorf("query ICoreWebView2Profile2: HRESULT 0x%08x", uint32(hr))
	}
	return profile, profile2, nil
}

func desktopNavigationURI(args *desktopNavigationStartingArgsCOM) (string, error) {
	var value *uint16
	hr, _, _ := args.Vtbl.GetURI.Call(uintptr(unsafe.Pointer(args)), uintptr(unsafe.Pointer(&value)))
	if desktopHRESULTFailed(hr) || value == nil {
		return "", syscall.Errno(hr)
	}
	defer windows.CoTaskMemFree(unsafe.Pointer(value))
	return windows.UTF16PtrToString(value), nil
}

func desktopNavigationID(args *desktopNavigationStartingArgsCOM) (uint64, error) {
	var value uint64
	hr, _, _ := args.Vtbl.GetNavigationID.Call(uintptr(unsafe.Pointer(args)), uintptr(unsafe.Pointer(&value)))
	if desktopHRESULTFailed(hr) {
		return 0, syscall.Errno(hr)
	}
	return value, nil
}

func desktopCancelNavigation(args *desktopNavigationStartingArgsCOM) error {
	hr, _, _ := args.Vtbl.PutCancel.Call(uintptr(unsafe.Pointer(args)), 1)
	if desktopHRESULTFailed(hr) {
		return syscall.Errno(hr)
	}
	return nil
}

func openDesktopExternalURL(rawURL string) error {
	operation, _ := windows.UTF16PtrFromString("open")
	target, err := windows.UTF16PtrFromString(rawURL)
	if err != nil {
		return err
	}
	result, _, _ := desktopShellExecuteW.Call(0, uintptr(unsafe.Pointer(operation)), uintptr(unsafe.Pointer(target)), 0, 0, 1)
	if result <= 32 {
		return fmt.Errorf("ShellExecuteW failed with code %d", result)
	}
	return nil
}

func desktopHRESULTFailed(value uintptr) bool {
	return int32(value) < 0
}

func desktopReleaseCOM(value any) {
	pointer := reflect.ValueOf(value)
	if pointer.Kind() != reflect.Pointer || pointer.IsNil() {
		return
	}
	unknown := (*struct{ Vtbl *desktopIUnknownVtbl })(unsafe.Pointer(pointer.Pointer()))
	_, _, _ = unknown.Vtbl.Release.Call(pointer.Pointer())
}

type desktopNavigationStartingHandlerVtbl struct {
	desktopIUnknownVtbl
	Invoke edge.ComProc
}

type desktopNavigationStartingHandler struct {
	Vtbl      *desktopNavigationStartingHandlerVtbl
	refs      atomic.Uint32
	adapter   *desktopWebViewPolicyAdapter
	mainFrame bool
}

func newDesktopNavigationStartingHandler(adapter *desktopWebViewPolicyAdapter, mainFrame bool) *desktopNavigationStartingHandler {
	handler := &desktopNavigationStartingHandler{Vtbl: &desktopNavigationStartingHandlerFunctions, adapter: adapter, mainFrame: mainFrame}
	handler.refs.Store(1)
	return handler
}

func desktopNavigationStartingQueryInterface(this *desktopNavigationStartingHandler, _ uintptr, object uintptr) uintptr {
	*(*unsafe.Pointer)(unsafe.Pointer(object)) = unsafe.Pointer(this)
	desktopNavigationStartingAddRef(this)
	return 0
}

func desktopNavigationStartingAddRef(this *desktopNavigationStartingHandler) uintptr {
	return uintptr(this.refs.Add(1))
}

func desktopNavigationStartingRelease(this *desktopNavigationStartingHandler) uintptr {
	return uintptr(this.refs.Add(^uint32(0)))
}

func desktopNavigationStartingInvoke(this *desktopNavigationStartingHandler, _ uintptr, args *desktopNavigationStartingArgsCOM) uintptr {
	return this.adapter.handleNavigation(args, this.mainFrame)
}

var desktopNavigationStartingHandlerFunctions = desktopNavigationStartingHandlerVtbl{
	desktopIUnknownVtbl{
		QueryInterface: edge.NewComProc(desktopNavigationStartingQueryInterface),
		AddRef:         edge.NewComProc(desktopNavigationStartingAddRef),
		Release:        edge.NewComProc(desktopNavigationStartingRelease),
	},
	edge.NewComProc(desktopNavigationStartingInvoke),
}

type desktopNewWindowHandlerVtbl struct {
	desktopIUnknownVtbl
	Invoke edge.ComProc
}

type desktopNewWindowHandler struct {
	Vtbl    *desktopNewWindowHandlerVtbl
	refs    atomic.Uint32
	adapter *desktopWebViewPolicyAdapter
}

func newDesktopNewWindowHandler(adapter *desktopWebViewPolicyAdapter) *desktopNewWindowHandler {
	handler := &desktopNewWindowHandler{Vtbl: &desktopNewWindowHandlerFunctions, adapter: adapter}
	handler.refs.Store(1)
	return handler
}

func desktopNewWindowQueryInterface(this *desktopNewWindowHandler, _ uintptr, object uintptr) uintptr {
	*(*unsafe.Pointer)(unsafe.Pointer(object)) = unsafe.Pointer(this)
	desktopNewWindowAddRef(this)
	return 0
}

func desktopNewWindowAddRef(this *desktopNewWindowHandler) uintptr { return uintptr(this.refs.Add(1)) }
func desktopNewWindowRelease(this *desktopNewWindowHandler) uintptr {
	return uintptr(this.refs.Add(^uint32(0)))
}

func desktopNewWindowInvoke(this *desktopNewWindowHandler, _ uintptr, args *desktopNewWindowArgsCOM) uintptr {
	_, _, _ = args.Vtbl.PutHandled.Call(uintptr(unsafe.Pointer(args)), 1)
	var value *uint16
	hr, _, _ := args.Vtbl.GetURI.Call(uintptr(unsafe.Pointer(args)), uintptr(unsafe.Pointer(&value)))
	if desktopHRESULTFailed(hr) || value == nil {
		return 0
	}
	rawURL := windows.UTF16PtrToString(value)
	windows.CoTaskMemFree(unsafe.Pointer(value))
	if action := this.adapter.runtime.security.DecideNavigation(rawURL, true, false); action == desktopNavigationOpenExternal || action == desktopNavigationAllow {
		_ = openDesktopExternalURL(rawURL)
	}
	return 0
}

var desktopNewWindowHandlerFunctions = desktopNewWindowHandlerVtbl{
	desktopIUnknownVtbl{
		QueryInterface: edge.NewComProc(desktopNewWindowQueryInterface),
		AddRef:         edge.NewComProc(desktopNewWindowAddRef),
		Release:        edge.NewComProc(desktopNewWindowRelease),
	},
	edge.NewComProc(desktopNewWindowInvoke),
}

type desktopExecuteScriptHandlerVtbl struct {
	desktopIUnknownVtbl
	Invoke edge.ComProc
}

type desktopExecuteScriptHandler struct {
	Vtbl  *desktopExecuteScriptHandlerVtbl
	refs  atomic.Uint32
	owner *desktopWebViewPolicyAdapter
	done  chan<- error
}

func newDesktopExecuteScriptHandler(owner *desktopWebViewPolicyAdapter, done chan<- error) *desktopExecuteScriptHandler {
	handler := &desktopExecuteScriptHandler{Vtbl: &desktopExecuteScriptHandlerFunctions, owner: owner, done: done}
	handler.refs.Store(1)
	return handler
}

func desktopExecuteScriptQueryInterface(this *desktopExecuteScriptHandler, _ uintptr, object uintptr) uintptr {
	*(*unsafe.Pointer)(unsafe.Pointer(object)) = unsafe.Pointer(this)
	desktopExecuteScriptAddRef(this)
	return 0
}

func desktopExecuteScriptAddRef(this *desktopExecuteScriptHandler) uintptr {
	return uintptr(this.refs.Add(1))
}
func desktopExecuteScriptRelease(this *desktopExecuteScriptHandler) uintptr {
	return uintptr(this.refs.Add(^uint32(0)))
}

func desktopExecuteScriptInvoke(this *desktopExecuteScriptHandler, errorCode uintptr, result *uint16) uintptr {
	this.owner.pending.Delete(this)
	if result != nil {
		windows.CoTaskMemFree(unsafe.Pointer(result))
	}
	if desktopHRESULTFailed(errorCode) {
		this.done <- syscall.Errno(errorCode)
	} else {
		this.done <- nil
	}
	return 0
}

var desktopExecuteScriptHandlerFunctions = desktopExecuteScriptHandlerVtbl{
	desktopIUnknownVtbl{
		QueryInterface: edge.NewComProc(desktopExecuteScriptQueryInterface),
		AddRef:         edge.NewComProc(desktopExecuteScriptAddRef),
		Release:        edge.NewComProc(desktopExecuteScriptRelease),
	},
	edge.NewComProc(desktopExecuteScriptInvoke),
}

type desktopClearBrowsingDataHandlerVtbl struct {
	desktopIUnknownVtbl
	Invoke edge.ComProc
}

type desktopClearBrowsingDataHandler struct {
	Vtbl     *desktopClearBrowsingDataHandlerVtbl
	refs     atomic.Uint32
	owner    *desktopWebViewPolicyAdapter
	done     chan<- error
	profile  *desktopProfileCOM
	profile2 *desktopProfile2COM
}

func newDesktopClearBrowsingDataHandler(owner *desktopWebViewPolicyAdapter, done chan<- error, profile *desktopProfileCOM, profile2 *desktopProfile2COM) *desktopClearBrowsingDataHandler {
	handler := &desktopClearBrowsingDataHandler{Vtbl: &desktopClearBrowsingDataHandlerFunctions, owner: owner, done: done, profile: profile, profile2: profile2}
	handler.refs.Store(1)
	return handler
}

func desktopClearBrowsingDataQueryInterface(this *desktopClearBrowsingDataHandler, _ uintptr, object uintptr) uintptr {
	*(*unsafe.Pointer)(unsafe.Pointer(object)) = unsafe.Pointer(this)
	desktopClearBrowsingDataAddRef(this)
	return 0
}

func desktopClearBrowsingDataAddRef(this *desktopClearBrowsingDataHandler) uintptr {
	return uintptr(this.refs.Add(1))
}

func desktopClearBrowsingDataRelease(this *desktopClearBrowsingDataHandler) uintptr {
	return uintptr(this.refs.Add(^uint32(0)))
}

func desktopClearBrowsingDataInvoke(this *desktopClearBrowsingDataHandler, errorCode uintptr) uintptr {
	this.owner.pending.Delete(this)
	desktopReleaseCOM(this.profile2)
	desktopReleaseCOM(this.profile)
	if desktopHRESULTFailed(errorCode) {
		this.done <- syscall.Errno(errorCode)
	} else {
		this.done <- nil
	}
	return 0
}

var desktopClearBrowsingDataHandlerFunctions = desktopClearBrowsingDataHandlerVtbl{
	desktopIUnknownVtbl{
		QueryInterface: edge.NewComProc(desktopClearBrowsingDataQueryInterface),
		AddRef:         edge.NewComProc(desktopClearBrowsingDataAddRef),
		Release:        edge.NewComProc(desktopClearBrowsingDataRelease),
	},
	edge.NewComProc(desktopClearBrowsingDataInvoke),
}
