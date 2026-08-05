//go:build windows

package main

import "testing"

type fakeDesktopWindowOps struct {
	maximized bool
	shows     []uintptr
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
