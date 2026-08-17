//go:build windows

package main

import (
	"strings"
	"testing"
)

type fakeNotificationOps struct {
	metrics      desktopNotificationMetrics
	workAreaRect desktopWindowRect

	created      []uintptr
	createdState map[uintptr]*desktopNotificationWindowState
	destroyed    []uintptr
	repainted    []uintptr
	timers       []int
	repositioned []uintptr
	focused      int
	evaled       []string
	nextHwnd     uintptr
}

func newFakeNotificationOps() *fakeNotificationOps {
	return &fakeNotificationOps{
		metrics: desktopNotificationMetrics{
			width: 480, height: 112, gap: 10, marginX: 16, marginY: 16,
		},
		workAreaRect: desktopWindowRect{left: 0, top: 0, right: 1920, bottom: 1040},
		createdState: map[uintptr]*desktopNotificationWindowState{},
		nextHwnd:     100,
	}
}

func (f *fakeNotificationOps) metricsForWindow() desktopNotificationMetrics { return f.metrics }
func (f *fakeNotificationOps) workArea() (desktopWindowRect, bool)          { return f.workAreaRect, true }

func (f *fakeNotificationOps) createWindow(state *desktopNotificationWindowState, rect desktopWindowRect) (uintptr, error) {
	f.nextHwnd++
	state.hwnd = f.nextHwnd
	state.rect = rect
	f.created = append(f.created, state.hwnd)
	f.createdState[state.hwnd] = state
	return state.hwnd, nil
}

func (f *fakeNotificationOps) repositionWindow(hwnd uintptr, rect desktopWindowRect) {
	f.repositioned = append(f.repositioned, hwnd)
	if state, ok := f.createdState[hwnd]; ok {
		state.rect = rect
	}
}

func (f *fakeNotificationOps) repaintWindow(hwnd uintptr) { f.repainted = append(f.repainted, hwnd) }

func (f *fakeNotificationOps) resetDismissTimer(_ uintptr, milliseconds int) {
	f.timers = append(f.timers, milliseconds)
}

func (f *fakeNotificationOps) destroyWindow(hwnd uintptr) {
	f.destroyed = append(f.destroyed, hwnd)
	delete(f.createdState, hwnd)
}

func (f *fakeNotificationOps) focusMainWindow() { f.focused++ }

func (f *fakeNotificationOps) evalScript(script string) { f.evaled = append(f.evaled, script) }

func validNotificationJSON(title, body string) string {
	return `{"type":"chat.prompt.completed","projectId":"p1","sessionId":"s1","title":"` + title +
		`","body":"` + body + `","status":"completed","tag":"p1:s1"}`
}

func TestParseDesktopNotification(t *testing.T) {
	n, err := parseDesktopNotification(validNotificationJSON("Fix bug", "done"))
	if err != nil {
		t.Fatalf("parse valid payload: %v", err)
	}
	if n.Key != "p1:s1" || n.ProjectID != "p1" || n.SessionID != "s1" ||
		n.Title != "Fix bug" || n.Body != "done" || n.Status != "completed" {
		t.Fatalf("parse = %+v", n)
	}
	for _, raw := range []string{
		`{"type":"chat.prompt.completed","projectId":"","sessionId":"s1"}`,
		`{"type":"chat.prompt.completed","projectId":"p1"}`,
		`{"type":"other","projectId":"p1","sessionId":"s1"}`,
		`not-json`,
	} {
		if _, err := parseDesktopNotification(raw); err == nil {
			t.Fatalf("parseDesktopNotification(%s) expected error", raw)
		}
	}
}

func TestDesktopNotificationMetricsUseLargerCard(t *testing.T) {
	ops := newWin32DesktopNotificationOps(0, nil)
	metrics := ops.metricsForWindow()
	if metrics.width != 480 || metrics.height != 112 {
		t.Fatalf("metrics = %+v, want 480x112 logical pixels at 100%% DPI", metrics)
	}
}

func TestNotificationCenterCoalescesBySessionKey(t *testing.T) {
	ops := newFakeNotificationOps()
	c := newDesktopNotificationCenterWithOps(ops)
	if got := c.show(validNotificationJSON("A", "one")); !strings.Contains(got, `"ok":true`) {
		t.Fatalf("show = %s, want ok", got)
	}
	if got := c.show(validNotificationJSON("A", "two")); !strings.Contains(got, `"ok":true`) {
		t.Fatalf("show = %s, want ok", got)
	}
	if len(ops.created) != 1 {
		t.Fatalf("created = %d, want 1 window", len(ops.created))
	}
	if len(ops.repainted) != 1 || len(ops.timers) != 2 {
		t.Fatalf("repainted = %v, timers = %v, want 1 repaint and 2 timer resets", ops.repainted, ops.timers)
	}
	state := ops.createdState[ops.created[0]]
	if state.notification.Body != "two" {
		t.Fatalf("notification body = %q, want updated content", state.notification.Body)
	}
}

func TestNotificationCenterRejectsInvalidPayload(t *testing.T) {
	ops := newFakeNotificationOps()
	c := newDesktopNotificationCenterWithOps(ops)
	if got := c.show(`not-json`); !strings.Contains(got, `"ok":false`) {
		t.Fatalf("show = %s, want failure json", got)
	}
	if len(ops.created) != 0 {
		t.Fatalf("created = %v, want none", ops.created)
	}
}

func TestNotificationCenterStacksNewestAtBottom(t *testing.T) {
	ops := newFakeNotificationOps()
	c := newDesktopNotificationCenterWithOps(ops)
	c.show(`{"type":"chat.prompt.completed","projectId":"p1","sessionId":"s1","title":"A","body":"b","status":"completed"}`)
	c.show(`{"type":"chat.prompt.completed","projectId":"p1","sessionId":"s2","title":"B","body":"b","status":"completed"}`)

	first := ops.createdState[ops.created[0]]
	second := ops.createdState[ops.created[1]]
	wantBottom := ops.workAreaRect.bottom - ops.metrics.marginY
	if second.rect.bottom != wantBottom {
		t.Fatalf("newest bottom = %d, want %d", second.rect.bottom, wantBottom)
	}
	if first.rect.bottom+ops.metrics.gap != second.rect.top {
		t.Fatalf("first bottom %d + gap != second top %d", first.rect.bottom, second.rect.top)
	}
	if first.rect.right != ops.workAreaRect.right-ops.metrics.marginX {
		t.Fatalf("right edge = %d", first.rect.right)
	}

	// Dismissing the newest reflows the older window down to the bottom slot.
	repositionedBefore := len(ops.repositioned)
	c.handleTimer(second.hwnd)
	if len(ops.repositioned) != repositionedBefore+1 || ops.repositioned[len(ops.repositioned)-1] != first.hwnd {
		t.Fatalf("repositioned = %v, want first window reflowed once more", ops.repositioned)
	}
	if first.rect.bottom != wantBottom {
		t.Fatalf("after reflow first bottom = %d, want %d", first.rect.bottom, wantBottom)
	}
}

func TestNotificationCenterClickFocusesEvalsAndDismisses(t *testing.T) {
	ops := newFakeNotificationOps()
	c := newDesktopNotificationCenterWithOps(ops)
	c.show(validNotificationJSON("A", "b"))
	hwnd := ops.created[0]

	c.handleClick(hwnd)
	if ops.focused != 1 {
		t.Fatalf("focused = %d, want 1", ops.focused)
	}
	if len(ops.evaled) != 1 ||
		!strings.Contains(ops.evaled[0], "wheelmaker:desktop-notification-click") ||
		!strings.Contains(ops.evaled[0], `"p1"`) || !strings.Contains(ops.evaled[0], `"s1"`) {
		t.Fatalf("evaled = %v", ops.evaled)
	}
	if len(ops.destroyed) != 1 || ops.destroyed[0] != hwnd {
		t.Fatalf("destroyed = %v, want clicked window", ops.destroyed)
	}
}

func TestNotificationCenterCloseDestroysAll(t *testing.T) {
	ops := newFakeNotificationOps()
	c := newDesktopNotificationCenterWithOps(ops)
	c.show(`{"type":"chat.prompt.completed","projectId":"p1","sessionId":"s1","title":"A","body":"b","status":"completed"}`)
	c.show(`{"type":"chat.prompt.completed","projectId":"p1","sessionId":"s2","title":"B","body":"b","status":"completed"}`)
	c.close()
	if len(ops.destroyed) != 2 {
		t.Fatalf("destroyed = %v, want both windows", ops.destroyed)
	}
}
