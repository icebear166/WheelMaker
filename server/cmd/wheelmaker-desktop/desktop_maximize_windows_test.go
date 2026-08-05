//go:build windows

package main

import "testing"

type fakeDesktopWindowOps struct {
	maximized bool
	shows     []uintptr
}

type fakeDesktopMonitorOps struct {
	info desktopMonitorInfo
	ok   bool
}

func (f fakeDesktopMonitorOps) monitorInfo(uintptr) (desktopMonitorInfo, bool) {
	return f.info, f.ok
}

type fakeDesktopWindowSubclassOps struct {
	fakeDesktopMonitorOps
	originalProc            uintptr
	replacementProc         uintptr
	restoredProc            uintptr
	callResult              uintptr
	callCount               int
	constraintAfterOriginal bool
}

func (f *fakeDesktopWindowSubclassOps) monitorInfo(hwnd uintptr) (desktopMonitorInfo, bool) {
	f.constraintAfterOriginal = f.callCount > 0
	return f.fakeDesktopMonitorOps.monitorInfo(hwnd)
}

func (f *fakeDesktopWindowSubclassOps) replaceWindowProc(_ uintptr, replacement uintptr) (uintptr, bool) {
	f.replacementProc = replacement
	return f.originalProc, f.originalProc != 0
}

func (f *fakeDesktopWindowSubclassOps) restoreWindowProc(_ uintptr, original uintptr) {
	f.restoredProc = original
}

func (f *fakeDesktopWindowSubclassOps) callWindowProc(_ uintptr, _ uintptr, _ uintptr, _ uintptr, _ uintptr) uintptr {
	f.callCount++
	return f.callResult
}

func (f *fakeDesktopWindowOps) showWindow(_ uintptr, command uintptr) {
	f.shows = append(f.shows, command)
	if command == swRestore {
		f.maximized = false
	}
}

func (f *fakeDesktopWindowOps) isMaximized(uintptr) bool {
	return f.maximized
}

func TestDesktopMaximizeControllerUsesNativeMaximizeWhenRestored(t *testing.T) {
	ops := &fakeDesktopWindowOps{}
	controller := newDesktopMaximizeController(42, ops)

	controller.toggle()

	if len(ops.shows) != 1 || ops.shows[0] != swMaximize {
		t.Fatalf("toggle should call ShowWindow(SW_MAXIMIZE), shows=%v", ops.shows)
	}
}

func TestDesktopMaximizeControllerRestoresNativeMaximizedWindow(t *testing.T) {
	ops := &fakeDesktopWindowOps{maximized: true}
	controller := newDesktopMaximizeController(42, ops)

	controller.toggle()

	if len(ops.shows) != 1 || ops.shows[0] != swRestore {
		t.Fatalf("toggle should call ShowWindow(SW_RESTORE), shows=%v", ops.shows)
	}
}

func TestDesktopMaximizeBoundsUseBottomTaskbarWorkArea(t *testing.T) {
	monitor := desktopWindowRect{left: 0, top: 0, right: 2048, bottom: 1152}
	workArea := desktopWindowRect{left: 0, top: 0, right: 2048, bottom: 1104}

	position, size := desktopMaximizeBounds(monitor, workArea)

	if want := (desktopWindowPoint{x: 0, y: 0}); position != want {
		t.Fatalf("position=%+v, want %+v", position, want)
	}
	if want := (desktopWindowPoint{x: 2048, y: 1104}); size != want {
		t.Fatalf("size=%+v, want %+v", size, want)
	}
}

func TestDesktopMaximizeBoundsAreRelativeToNegativeMonitorOrigin(t *testing.T) {
	monitor := desktopWindowRect{left: -1920, top: -120, right: 0, bottom: 960}
	workArea := desktopWindowRect{left: -1872, top: -80, right: 0, bottom: 960}

	position, size := desktopMaximizeBounds(monitor, workArea)

	if want := (desktopWindowPoint{x: 48, y: 40}); position != want {
		t.Fatalf("position=%+v, want %+v", position, want)
	}
	if want := (desktopWindowPoint{x: 1872, y: 1040}); size != want {
		t.Fatalf("size=%+v, want %+v", size, want)
	}
}

func TestDesktopWorkAreaConstraintUpdatesNativeMaximizeBounds(t *testing.T) {
	ops := fakeDesktopMonitorOps{
		ok: true,
		info: desktopMonitorInfo{
			monitor:  desktopWindowRect{left: -1920, top: 0, right: 0, bottom: 1080},
			workArea: desktopWindowRect{left: -1920, top: 0, right: 0, bottom: 1040},
		},
	}
	info := desktopWindowMinMaxInfo{
		maxTrackSize: desktopWindowPoint{x: 3840, y: 2160},
	}

	if !constrainDesktopMaximizeToWorkArea(42, &info, ops) {
		t.Fatal("constraint should apply when monitor information is available")
	}
	if want := (desktopWindowPoint{x: 0, y: 0}); info.maxPosition != want {
		t.Fatalf("maxPosition=%+v, want %+v", info.maxPosition, want)
	}
	if want := (desktopWindowPoint{x: 1920, y: 1040}); info.maxSize != want {
		t.Fatalf("maxSize=%+v, want %+v", info.maxSize, want)
	}
	if want := (desktopWindowPoint{x: 3840, y: 2160}); info.maxTrackSize != want {
		t.Fatalf("maxTrackSize=%+v, want unchanged %+v", info.maxTrackSize, want)
	}
}

func TestDesktopWorkAreaConstraintPreservesDefaultsWithoutMonitorInfo(t *testing.T) {
	want := desktopWindowMinMaxInfo{
		maxPosition: desktopWindowPoint{x: -8, y: -8},
		maxSize:     desktopWindowPoint{x: 1936, y: 1096},
	}
	info := want

	if constrainDesktopMaximizeToWorkArea(42, &info, fakeDesktopMonitorOps{}) {
		t.Fatal("constraint should not apply without monitor information")
	}
	if info != want {
		t.Fatalf("info=%+v, want unchanged %+v", info, want)
	}
}

func TestDesktopWindowWorkAreaHookConstrainsAfterOriginalWindowProc(t *testing.T) {
	ops := &fakeDesktopWindowSubclassOps{
		fakeDesktopMonitorOps: fakeDesktopMonitorOps{
			ok: true,
			info: desktopMonitorInfo{
				monitor:  desktopWindowRect{left: 0, top: 0, right: 1920, bottom: 1080},
				workArea: desktopWindowRect{left: 0, top: 0, right: 1920, bottom: 1040},
			},
		},
		originalProc: 99,
		callResult:   73,
	}
	cleanup, err := installDesktopWindowWorkAreaConstraintWithOps(42, ops)
	if err != nil {
		t.Fatalf("installDesktopWindowWorkAreaConstraintWithOps: %v", err)
	}
	defer cleanup()
	info := desktopWindowMinMaxInfo{
		maxPosition: desktopWindowPoint{x: -8, y: -8},
		maxSize:     desktopWindowPoint{x: 1936, y: 1096},
	}

	result := desktopWindowWorkAreaProcWithInfo(42, wmGetMinMaxInfo, 0, 0, &info)

	if result != 73 {
		t.Fatalf("window proc result=%d, want original result 73", result)
	}
	if ops.callCount != 1 {
		t.Fatalf("original window proc call count=%d, want 1", ops.callCount)
	}
	if !ops.constraintAfterOriginal {
		t.Fatal("work-area constraint ran before the original window proc")
	}
	if want := (desktopWindowPoint{x: 0, y: 0}); info.maxPosition != want {
		t.Fatalf("maxPosition=%+v, want %+v", info.maxPosition, want)
	}
	if want := (desktopWindowPoint{x: 1920, y: 1040}); info.maxSize != want {
		t.Fatalf("maxSize=%+v, want %+v", info.maxSize, want)
	}
}

func TestDesktopWindowWorkAreaHookRestoresOriginalWindowProc(t *testing.T) {
	ops := &fakeDesktopWindowSubclassOps{originalProc: 99}
	cleanup, err := installDesktopWindowWorkAreaConstraintWithOps(43, ops)
	if err != nil {
		t.Fatalf("installDesktopWindowWorkAreaConstraintWithOps: %v", err)
	}

	cleanup()

	if ops.restoredProc != 99 {
		t.Fatalf("restored window proc=%d, want 99", ops.restoredProc)
	}
}
