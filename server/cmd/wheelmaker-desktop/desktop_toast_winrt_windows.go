//go:build windows

package main

import (
	"encoding/binary"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// This file implements the real desktopToastOps: HKCU self-registration of the
// toast identity (AUMID + COM activator CLSID), WinRT toast delivery via raw
// COM, and the INotificationActivationCallback local server that routes toast
// clicks back to the UI thread. References:
// - https://learn.microsoft.com/windows/apps/design/shell/tiles-and-notifications/send-local-toast-other-apps
// - Windows SDK: windows.ui.notifications.idl, NotificationActivationCallback.h

const (
	desktopToastAUMID = "WheelMaker.Desktop"

	// desktopToastActivatorCLSID is the fixed CLSID of the toast COM
	// activator. Minted once; never change it.
	desktopToastActivatorCLSID = "{B7C4A9E1-5D2F-4E3A-9C8B-1F6D3A5E7C92}"

	desktopToastAUMIDKey = `Software\Classes\AppUserModelId\WheelMaker.Desktop`
	desktopToastCLSIDKey = `Software\Classes\CLSID\` + desktopToastActivatorCLSID + `\LocalServer32`

	clsctxLocalServer   = 0x4
	regclsMultipleUse   = 0x1
	coinitApartment     = 0x0
	roInitMultithreaded = 0x1

	rpcEChangedMode = 0x80010106
	eNoInterface    = 0x80004002
	coEObjIsReg     = 0x800401FB
)

type winrtGUID struct {
	data1 uint32
	data2 uint16
	data3 uint16
	data4 [8]byte
}

func mustParseGUID(s string) winrtGUID {
	trimmed := strings.TrimPrefix(strings.TrimSuffix(s, "}"), "{")
	parts := strings.Split(trimmed, "-")
	if len(parts) != 5 {
		panic("invalid GUID " + s)
	}
	parse := func(p string) uint64 {
		value, err := strconv.ParseUint(p, 16, 64)
		if err != nil {
			panic("invalid GUID " + s + ": " + err.Error())
		}
		return value
	}
	guid := winrtGUID{
		data1: uint32(parse(parts[0])),
		data2: uint16(parse(parts[1])),
		data3: uint16(parse(parts[2])),
	}
	tail := parts[3] + parts[4]
	if len(tail) != 16 {
		panic("invalid GUID " + s)
	}
	for i := 0; i < 8; i++ {
		guid.data4[i] = byte(parse(tail[i*2 : i*2+2]))
	}
	return guid
}

var (
	iidIUnknown                        = winrtGUID{data4: [8]byte{0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}}
	iidIClassFactory                   = winrtGUID{data1: 0x1, data4: [8]byte{0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}}
	iidIXmlDocument                    = mustParseGUID("{f7f3a506-1e87-42d6-bcfb-b8c809fa5494}")
	iidIXmlDocumentIO                  = mustParseGUID("{6cd0e74e-ee65-4489-9ebf-ca43e87ba637}")
	iidIToastNotificationManagerStats  = mustParseGUID("{50ac103f-d235-4598-bbef-98fe4d1a3ad4}")
	iidIToastNotificationFactory       = mustParseGUID("{04124b20-82c6-4229-b109-fd9ed4662b53}")
	iidIToastNotification2             = mustParseGUID("{9dfb9fd1-143a-490e-90bf-b9fba7132de7}")
	iidINotificationActivationCallback = mustParseGUID("{53e31837-6600-4a81-9395-75cffe746f94}")
	clsidDesktopToastActivator         = mustParseGUID(desktopToastActivatorCLSID)
)

var (
	desktopCombase     = windows.NewLazySystemDLL("combase.dll")
	desktopWinrtCore   = windows.NewLazySystemDLL("api-ms-win-core-winrt-l1-1-0.dll")
	desktopWinrtString = windows.NewLazySystemDLL("api-ms-win-core-winrt-string-l1-1-0.dll")
	desktopOle32       = windows.NewLazySystemDLL("ole32.dll")

	procRoGetActivationFactory = desktopCombase.NewProc("RoGetActivationFactory")
	procRoInitialize           = desktopWinrtCore.NewProc("RoInitialize")
	procRoActivateInstance     = desktopWinrtCore.NewProc("RoActivateInstance")
	procWindowsCreateString    = desktopWinrtString.NewProc("WindowsCreateString")
	procWindowsDeleteString    = desktopWinrtString.NewProc("WindowsDeleteString")
	procCoInitializeEx         = desktopOle32.NewProc("CoInitializeEx")
	procCoRegisterClassObject  = desktopOle32.NewProc("CoRegisterClassObject")
	procCoRevokeClassObject    = desktopOle32.NewProc("CoRevokeClassObject")

	procSetCurrentProcessExplicitAppUserModelID = desktopShell32.NewProc("SetCurrentProcessExplicitAppUserModelID")
)

type comHRESULT uint32

func (h comHRESULT) err(what string) error {
	if int32(h) < 0 {
		return fmt.Errorf("%s failed: HRESULT 0x%08X", what, uint32(h))
	}
	return nil
}

// comCall invokes the index-th vtable method of a COM object.
func comCall(obj uintptr, index int, args ...uintptr) comHRESULT {
	vtable := *(*uintptr)(unsafe.Pointer(obj))
	fn := *(*uintptr)(unsafe.Pointer(vtable + uintptr(index)*unsafe.Sizeof(uintptr(0))))
	callArgs := make([]uintptr, 0, len(args)+1)
	callArgs = append(callArgs, obj)
	callArgs = append(callArgs, args...)
	ret, _, _ := syscall.SyscallN(fn, callArgs...)
	return comHRESULT(uint32(ret))
}

func comRelease(obj uintptr) {
	if obj != 0 {
		comCall(obj, 2)
	}
}

// comQueryInterface calls QueryInterface (vtable index 0).
func comQueryInterface(obj uintptr, iid *winrtGUID, out *uintptr) comHRESULT {
	return comCall(obj, 0, uintptr(unsafe.Pointer(iid)), uintptr(unsafe.Pointer(out)))
}

func newHString(s string) (uintptr, error) {
	encoded := utf16.Encode([]rune(s))
	var source *uint16
	if len(encoded) > 0 {
		source = &encoded[0]
	}
	var h uintptr
	ret, _, _ := procWindowsCreateString.Call(
		uintptr(unsafe.Pointer(source)),
		uintptr(len(encoded)),
		uintptr(unsafe.Pointer(&h)),
	)
	if err := comHRESULT(uint32(ret)).err("WindowsCreateString"); err != nil {
		return 0, err
	}
	return h, nil
}

func deleteHString(h uintptr) {
	if h != 0 {
		procWindowsDeleteString.Call(h)
	}
}

func desktopToastIconPath(home string) string {
	return filepath.Join(home, ".wheelmaker", "desktop", "wheelmaker-toast-icon.png")
}

// removeDesktopToastIconRoute deletes the icon file released by the retired
// registry IconUri route. Best effort.
func removeDesktopToastIconRoute(home string) {
	_ = os.Remove(desktopToastIconPath(home))
}

// desktopToastAUMIDValues are the registry values written under the AUMID
// key. The toast header name/icon come from the Start menu shortcut; the
// registry only needs the display name (fallback) and the COM activator.
func desktopToastAUMIDValues() [][2]string {
	return [][2]string{
		{"DisplayName", "WheelMaker"},
		{"CustomActivator", desktopToastActivatorCLSID},
	}
}

// writeDesktopToastRegistry (re)registers the toast identity under HKCU so
// toast clicks reach our COM activator. All values follow the current exe, so
// dev and release builds overwrite each other (last run wins). Leftover
// values from the retired IconUri route are deleted.
func writeDesktopToastRegistry(exePath string) error {
	aumidKey, _, err := registry.CreateKey(registry.CURRENT_USER, desktopToastAUMIDKey, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("open AUMID key: %w", err)
	}
	defer aumidKey.Close()
	for _, value := range desktopToastAUMIDValues() {
		if err := aumidKey.SetStringValue(value[0], value[1]); err != nil {
			return fmt.Errorf("set %s: %w", value[0], err)
		}
	}
	// Retired registry icon route: the platform ignores these on recent
	// Windows 11 builds and the shortcut now provides the icon.
	_ = aumidKey.DeleteValue("IconUri")
	_ = aumidKey.DeleteValue("IconBackgroundColor")
	clsidKey, _, err := registry.CreateKey(registry.CURRENT_USER, desktopToastCLSIDKey, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("open CLSID key: %w", err)
	}
	defer clsidKey.Close()
	if err := clsidKey.SetStringValue("", exePath); err != nil {
		return fmt.Errorf("set LocalServer32: %w", err)
	}
	return nil
}

func setDesktopProcessAUMID() error {
	id, err := windows.UTF16PtrFromString(desktopToastAUMID)
	if err != nil {
		return err
	}
	ret, _, _ := procSetCurrentProcessExplicitAppUserModelID.Call(uintptr(unsafe.Pointer(id)))
	return comHRESULT(uint32(ret)).err("SetCurrentProcessExplicitAppUserModelID")
}

// --- COM activator (INotificationActivationCallback) ---

const wmToastActivated = wmApp + 2

var (
	desktopToastActivationMu sync.Mutex
	desktopToastActivations  []string
	desktopTrayWindowHwnd    atomic.Uintptr
)

func queueDesktopToastActivation(args string) {
	desktopToastActivationMu.Lock()
	desktopToastActivations = append(desktopToastActivations, args)
	desktopToastActivationMu.Unlock()
	if hwnd := desktopTrayWindowHwnd.Load(); hwnd != 0 {
		postWindowMessage(hwnd, wmToastActivated, 0, 0)
	}
}

func drainDesktopToastActivations() []string {
	desktopToastActivationMu.Lock()
	defer desktopToastActivationMu.Unlock()
	pending := desktopToastActivations
	desktopToastActivations = nil
	return pending
}

type desktopToastActivatorVtbl struct {
	queryInterface uintptr
	addRef         uintptr
	release        uintptr
	activate       uintptr
}

type desktopToastActivator struct {
	vtable *desktopToastActivatorVtbl
}

var desktopToastActivatorInstance = &desktopToastActivator{
	vtable: &desktopToastActivatorVtbl{
		queryInterface: windows.NewCallback(desktopToastActivatorQueryInterface),
		addRef:         windows.NewCallback(desktopToastActivatorAddRef),
		release:        windows.NewCallback(desktopToastActivatorRelease),
		activate:       windows.NewCallback(desktopToastActivatorActivate),
	},
}

func desktopToastActivatorQueryInterface(this uintptr, riid *winrtGUID, out *uintptr) uintptr {
	*out = 0
	if *riid == iidIUnknown || *riid == iidINotificationActivationCallback {
		*out = this
		return 0
	}
	return eNoInterface
}

// The activator lives for the whole process lifetime, so references are not
// counted.
func desktopToastActivatorAddRef(this uintptr) uintptr  { return 1 }
func desktopToastActivatorRelease(this uintptr) uintptr { return 1 }

// Activate runs on an RPC thread. It only copies the arguments and relays them
// to the UI thread through the hidden tray window.
func desktopToastActivatorActivate(this, app, args, data, count uintptr) uintptr {
	if args != 0 {
		queueDesktopToastActivation(windows.UTF16PtrToString((*uint16)(unsafe.Pointer(args))))
	}
	return 0
}

// The shell reaches the activator through standard COM local-server
// activation: it queries the registered class object for IClassFactory and
// calls CreateInstance. The class object must therefore implement
// IClassFactory; without it activation fails with E_NOINTERFACE and toast
// clicks are silently dropped.
type desktopToastClassFactoryVtbl struct {
	queryInterface uintptr
	addRef         uintptr
	release        uintptr
	createInstance uintptr
	lockServer     uintptr
}

type desktopToastClassFactory struct {
	vtable *desktopToastClassFactoryVtbl
}

var desktopToastClassFactoryInstance = &desktopToastClassFactory{
	vtable: &desktopToastClassFactoryVtbl{
		queryInterface: windows.NewCallback(desktopToastFactoryQueryInterface),
		addRef:         windows.NewCallback(desktopToastFactoryAddRef),
		release:        windows.NewCallback(desktopToastFactoryRelease),
		createInstance: windows.NewCallback(desktopToastFactoryCreateInstance),
		lockServer:     windows.NewCallback(desktopToastFactoryLockServer),
	},
}

func desktopToastFactoryQueryInterface(this uintptr, riid *winrtGUID, out *uintptr) uintptr {
	*out = 0
	if *riid == iidIUnknown || *riid == iidIClassFactory {
		*out = this
		return 0
	}
	return eNoInterface
}

func desktopToastFactoryAddRef(this uintptr) uintptr  { return 1 }
func desktopToastFactoryRelease(this uintptr) uintptr { return 1 }

func desktopToastFactoryLockServer(this, lock uintptr) uintptr { return 0 }

func desktopToastFactoryCreateInstance(this, outer uintptr, riid *winrtGUID, out *uintptr) uintptr {
	*out = 0
	if outer != 0 {
		return 0x80040110 // CLASS_E_NOAGGREGATION
	}
	if *riid == iidIUnknown || *riid == iidINotificationActivationCallback {
		*out = uintptr(unsafe.Pointer(desktopToastActivatorInstance))
		return 0
	}
	return eNoInterface
}

// --- WinRT toast delivery ---

// --- Start menu shortcut (toast icon identity) ---
//
// The notification platform ignores the registry IconUri on recent Windows 11
// builds; it resolves the toast header icon from a Start menu shortcut stamped
// with our AUMID, using the shortcut target's embedded icon.
const clsctxInprocServer = 0x1

var (
	clsidShellLink     = mustParseGUID("{00021401-0000-0000-C000-000000000046}")
	iidIShellLinkW     = mustParseGUID("{000214F9-0000-0000-C000-000000000046}")
	iidIPersistFile    = mustParseGUID("{0000010B-0000-0000-C000-000000000046}")
	iidIPropertyStore  = mustParseGUID("{886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99}")
	pkeyAppUserModelID = struct {
		fmtid winrtGUID
		pid   uint32
	}{mustParseGUID("{9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}"), 5}
	procCoCreateInstance = desktopOle32.NewProc("CoCreateInstance")
)

const vtLPWSTR = 31

func desktopToastShortcutPath(appData string) string {
	return filepath.Join(appData, `Microsoft\Windows\Start Menu\Programs`, "WheelMaker.lnk")
}

func desktopToastShortcutIconPath(exePath string) string {
	return exePath
}

func comSetWideString(obj uintptr, index int, value string) error {
	ptr, err := windows.UTF16PtrFromString(value)
	if err != nil {
		return err
	}
	return comCall(obj, index, uintptr(unsafe.Pointer(ptr))).err("comSetWideString")
}

// installDesktopToastShortcut creates or updates the Start menu shortcut that
// carries our AUMID so the toast header shows the exe's embedded icon.
func installDesktopToastShortcut(appData, exePath string) error {
	var link uintptr
	ret, _, _ := procCoCreateInstance.Call(
		uintptr(unsafe.Pointer(&clsidShellLink)),
		0,
		clsctxInprocServer,
		uintptr(unsafe.Pointer(&iidIShellLinkW)),
		uintptr(unsafe.Pointer(&link)),
	)
	if err := comHRESULT(uint32(ret)).err("CoCreateInstance ShellLink"); err != nil {
		return err
	}
	defer comRelease(link)

	if err := comSetWideString(link, 20 /* IShellLinkW::SetPath */, exePath); err != nil {
		return err
	}
	if err := comSetWideString(link, 9 /* IShellLinkW::SetWorkingDirectory */, filepath.Dir(exePath)); err != nil {
		return err
	}
	iconLocation, err := windows.UTF16PtrFromString(desktopToastShortcutIconPath(exePath))
	if err != nil {
		return err
	}
	if err := comCall(link, 17 /* IShellLinkW::SetIconLocation */, uintptr(unsafe.Pointer(iconLocation)), 0).err("SetIconLocation"); err != nil {
		return err
	}

	var store uintptr
	if err := comQueryInterface(link, &iidIPropertyStore, &store).err("QI IPropertyStore"); err != nil {
		return err
	}
	defer comRelease(store)
	aumid, err := windows.UTF16PtrFromString(desktopToastAUMID)
	if err != nil {
		return err
	}
	var propVariant [32]byte // PROPVARIANT, zero-initialized
	binary.LittleEndian.PutUint16(propVariant[0:], vtLPWSTR)
	*(*uintptr)(unsafe.Pointer(&propVariant[8])) = uintptr(unsafe.Pointer(aumid))
	if err := comCall(store, 6, /* IPropertyStore::SetValue */
		uintptr(unsafe.Pointer(&pkeyAppUserModelID)),
		uintptr(unsafe.Pointer(&propVariant[0])),
	).err("IPropertyStore.SetValue"); err != nil {
		return err
	}
	if err := comCall(store, 7 /* IPropertyStore::Commit */).err("IPropertyStore.Commit"); err != nil {
		return err
	}
	runtime.KeepAlive(aumid)

	var persist uintptr
	if err := comQueryInterface(link, &iidIPersistFile, &persist).err("QI IPersistFile"); err != nil {
		return err
	}
	defer comRelease(persist)
	shortcut, err := windows.UTF16PtrFromString(desktopToastShortcutPath(appData))
	if err != nil {
		return err
	}
	if err := comCall(persist, 6 /* IPersistFile::Save */, uintptr(unsafe.Pointer(shortcut)), 1).err("IPersistFile.Save"); err != nil {
		return err
	}
	runtime.KeepAlive(shortcut)
	return nil
}

// --- WinRT toast delivery ---

type win32DesktopToastOps struct {
	mainHwnd    uintptr
	classCookie uintptr
}

func newWin32DesktopToastOps(mainHwnd uintptr) *win32DesktopToastOps {
	return &win32DesktopToastOps{mainHwnd: mainHwnd}
}

func (o *win32DesktopToastOps) registerIdentity() error {
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve exe path: %w", err)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("resolve home dir: %w", err)
	}
	removeDesktopToastIconRoute(home)
	if err := writeDesktopToastRegistry(exePath); err != nil {
		return err
	}
	// Best effort: the shortcut only provides the toast header icon; the
	// registry CustomActivator keeps click activation working without it.
	if err := installDesktopToastShortcut(os.Getenv("APPDATA"), exePath); err != nil {
		log.Printf("[Desktop] toast shortcut registration failed, icon falls back: %v", err)
	}
	if err := setDesktopProcessAUMID(); err != nil {
		return err
	}
	if err := o.registerActivator(); err != nil {
		return err
	}
	ret, _, _ := procRoInitialize.Call(roInitMultithreaded)
	if code := uint32(ret); int32(code) < 0 && code != rpcEChangedMode {
		return fmt.Errorf("RoInitialize failed: HRESULT 0x%08X", code)
	}
	return nil
}

func (o *win32DesktopToastOps) registerActivator() error {
	if o.classCookie != 0 {
		return nil
	}
	ret, _, _ := procCoInitializeEx.Call(0, coinitApartment)
	if code := uint32(ret); int32(code) < 0 && code != rpcEChangedMode {
		return fmt.Errorf("CoInitializeEx failed: HRESULT 0x%08X", code)
	}
	ret, _, _ = procCoRegisterClassObject.Call(
		uintptr(unsafe.Pointer(&clsidDesktopToastActivator)),
		uintptr(unsafe.Pointer(desktopToastClassFactoryInstance)),
		clsctxLocalServer,
		regclsMultipleUse,
		uintptr(unsafe.Pointer(&o.classCookie)),
	)
	if code := uint32(ret); code == coEObjIsReg {
		return nil // already registered by this process
	} else if err := comHRESULT(code).err("CoRegisterClassObject"); err != nil {
		return err
	}
	return nil
}

func (o *win32DesktopToastOps) unregister() {
	if o.classCookie != 0 {
		procCoRevokeClassObject.Call(o.classCookie)
		o.classCookie = 0
	}
}

func roGetActivationFactory(className string, iid *winrtGUID) (uintptr, error) {
	hClass, err := newHString(className)
	if err != nil {
		return 0, err
	}
	defer deleteHString(hClass)
	var factory uintptr
	ret, _, _ := procRoGetActivationFactory.Call(
		hClass,
		uintptr(unsafe.Pointer(iid)),
		uintptr(unsafe.Pointer(&factory)),
	)
	if err := comHRESULT(uint32(ret)).err("RoGetActivationFactory " + className); err != nil {
		return 0, err
	}
	return factory, nil
}

func roCreateToastXMLDocument(xmlPayload string) (uintptr, error) {
	hClass, err := newHString("Windows.Data.Xml.Dom.XmlDocument")
	if err != nil {
		return 0, err
	}
	var inspectable uintptr
	ret, _, _ := procRoActivateInstance.Call(hClass, uintptr(unsafe.Pointer(&inspectable)))
	deleteHString(hClass)
	if err := comHRESULT(uint32(ret)).err("RoActivateInstance XmlDocument"); err != nil {
		return 0, err
	}
	defer comRelease(inspectable)
	var doc uintptr
	if err := comQueryInterface(inspectable, &iidIXmlDocument, &doc).err("QI IXmlDocument"); err != nil {
		return 0, err
	}
	var docIO uintptr
	if err := comQueryInterface(doc, &iidIXmlDocumentIO, &docIO).err("QI IXmlDocumentIO"); err != nil {
		comRelease(doc)
		return 0, err
	}
	hXML, err := newHString(xmlPayload)
	if err != nil {
		comRelease(docIO)
		comRelease(doc)
		return 0, err
	}
	loadResult := comCall(docIO, 6 /* LoadXml */, hXML)
	deleteHString(hXML)
	comRelease(docIO)
	if err := loadResult.err("XmlDocument.LoadXml"); err != nil {
		comRelease(doc)
		return 0, err
	}
	return doc, nil
}

func (o *win32DesktopToastOps) showToast(xmlPayload, tag string) error {
	doc, err := roCreateToastXMLDocument(xmlPayload)
	if err != nil {
		return err
	}
	defer comRelease(doc)

	statics, err := roGetActivationFactory("Windows.UI.Notifications.ToastNotificationManager", &iidIToastNotificationManagerStats)
	if err != nil {
		return err
	}
	defer comRelease(statics)

	hAUMID, err := newHString(desktopToastAUMID)
	if err != nil {
		return err
	}
	var notifier uintptr
	showResult := comCall(statics, 7 /* CreateToastNotifierWithId */, hAUMID, uintptr(unsafe.Pointer(&notifier)))
	deleteHString(hAUMID)
	if err := showResult.err("CreateToastNotifierWithId"); err != nil {
		return err
	}
	defer comRelease(notifier)

	factory, err := roGetActivationFactory("Windows.UI.Notifications.ToastNotification", &iidIToastNotificationFactory)
	if err != nil {
		return err
	}
	defer comRelease(factory)

	var toast uintptr
	if err := comCall(factory, 6 /* CreateToastNotification */, doc, uintptr(unsafe.Pointer(&toast))).err("CreateToastNotification"); err != nil {
		return err
	}
	defer comRelease(toast)

	// put_Tag lives on IToastNotification2 (not on the base IToastNotification
	// interface), so it must be reached through QueryInterface.
	var toast2 uintptr
	if err := comQueryInterface(toast, &iidIToastNotification2, &toast2).err("QI IToastNotification2"); err != nil {
		return err
	}
	defer comRelease(toast2)

	hTag, err := newHString(tag)
	if err != nil {
		return err
	}
	tagResult := comCall(toast2, 6 /* IToastNotification2::put_Tag */, hTag)
	deleteHString(hTag)
	if err := tagResult.err("ToastNotification2.put_Tag"); err != nil {
		return err
	}

	return comCall(notifier, 6 /* Show */, toast).err("ToastNotifier.Show")
}
