//go:build windows

package main

import "testing"

func TestDesktopResizeGripSpecsCoverOnlyWindowBorders(t *testing.T) {
	specs := desktopResizeGripSpecs(desktopWindowPoint{x: 100, y: 80}, desktopWindowPoint{x: 8, y: 8})
	want := []desktopResizeGripSpec{
		{hitTest: htTopLeft, rect: desktopWindowRect{left: 0, top: 0, right: 8, bottom: 8}},
		{hitTest: htTop, rect: desktopWindowRect{left: 8, top: 0, right: 92, bottom: 8}},
		{hitTest: htTopRight, rect: desktopWindowRect{left: 92, top: 0, right: 100, bottom: 8}},
		{hitTest: htLeft, rect: desktopWindowRect{left: 0, top: 8, right: 8, bottom: 72}},
		{hitTest: htRight, rect: desktopWindowRect{left: 92, top: 8, right: 100, bottom: 72}},
		{hitTest: htBottomLeft, rect: desktopWindowRect{left: 0, top: 72, right: 8, bottom: 80}},
		{hitTest: htBottom, rect: desktopWindowRect{left: 8, top: 72, right: 92, bottom: 80}},
		{hitTest: htBottomRight, rect: desktopWindowRect{left: 92, top: 72, right: 100, bottom: 80}},
	}

	if len(specs) != len(want) {
		t.Fatalf("grip count=%d, want %d", len(specs), len(want))
	}
	for index := range want {
		if specs[index] != want[index] {
			t.Errorf("grip[%d]=%+v, want %+v", index, specs[index], want[index])
		}
	}
}

func TestDesktopResizeOverlayForwardsResizeDragToParent(t *testing.T) {
	hitTest := desktopResizeOverlayMessage(wmNCLButtonDown, htBottomRight)
	if !hitTest.forward || hitTest.result != 0 {
		t.Fatalf("WM_NCLBUTTONDOWN action=%+v, want forward with zero result", hitTest)
	}

	nonClientHitTest := desktopResizeOverlayMessage(wmNCHitTest, htBottomRight)
	if nonClientHitTest.forward || nonClientHitTest.result != htBottomRight {
		t.Fatalf("WM_NCHITTEST action=%+v, want local hit-test result", nonClientHitTest)
	}
}
