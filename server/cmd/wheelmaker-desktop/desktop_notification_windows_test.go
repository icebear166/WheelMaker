//go:build windows

package main

import (
	"errors"
	"strings"
	"testing"
	"unicode/utf16"
)

type fakeBalloon struct {
	hwnd  uintptr
	title string
	body  string
	flags uint32
}

type fakeTrayOps struct {
	installHwnd uintptr
	installErr  error
	balloonErr  error

	installed int
	balloons  []fakeBalloon
	removed   []uintptr
	focused   int
	evaled    []string
}

func newFakeTrayOps() *fakeTrayOps {
	return &fakeTrayOps{installHwnd: 77}
}

func (f *fakeTrayOps) installTrayIcon(_ *desktopTrayNotifier) (uintptr, error) {
	f.installed++
	if f.installErr != nil {
		return 0, f.installErr
	}
	return f.installHwnd, nil
}

func (f *fakeTrayOps) showBalloon(hwnd uintptr, title, body string, flags uint32) error {
	if f.balloonErr != nil {
		return f.balloonErr
	}
	f.balloons = append(f.balloons, fakeBalloon{hwnd: hwnd, title: title, body: body, flags: flags})
	return nil
}

func (f *fakeTrayOps) removeTrayIcon(hwnd uintptr) { f.removed = append(f.removed, hwnd) }

func (f *fakeTrayOps) focusMainWindow() { f.focused++ }

func (f *fakeTrayOps) evalScript(script string) { f.evaled = append(f.evaled, script) }

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

func TestDesktopNotificationBalloonFlags(t *testing.T) {
	cases := []struct {
		status string
		want   uint32
	}{
		{"completed", niifInfo},
		{"", niifInfo},
		{"failed", niifError},
		{"cancelled", niifNone},
		{"interrupted", niifNone},
	}
	for _, tc := range cases {
		if got := desktopNotificationBalloonFlags(tc.status); got != tc.want {
			t.Fatalf("desktopNotificationBalloonFlags(%q) = %d, want %d", tc.status, got, tc.want)
		}
	}
}

func TestTruncateNotificationUTF16(t *testing.T) {
	if got := truncateNotificationUTF16("short", 63); got != "short" {
		t.Fatalf("short string changed: %q", got)
	}
	exact := strings.Repeat("a", 63)
	if got := truncateNotificationUTF16(exact, 63); got != exact {
		t.Fatalf("exact-fit string changed: len %d", len(got))
	}
	over := strings.Repeat("汉", 300)
	if got := truncateNotificationUTF16(over, 255); len(utf16.Encode([]rune(got))) != 255 {
		t.Fatalf("truncated CJK body = %d utf16 units, want 255", len(utf16.Encode([]rune(got))))
	}
	// An emoji (surrogate pair) must never be split: truncate 3 BMP runes + 1 emoji at 4 units.
	mixed := "abc😀def"
	if got := truncateNotificationUTF16(mixed, 4); got != "abc" {
		t.Fatalf("truncation split surrogate pair: %q", got)
	}
}

func TestDesktopTrayNotifierInstallsTrayIconOnStart(t *testing.T) {
	ops := newFakeTrayOps()
	newDesktopTrayNotifierWithOps(ops)
	if ops.installed != 1 {
		t.Fatalf("installed = %d, want 1", ops.installed)
	}
}

func TestDesktopTrayNotifierShowShowsBalloon(t *testing.T) {
	ops := newFakeTrayOps()
	notifier := newDesktopTrayNotifierWithOps(ops)
	if got := notifier.show(validNotificationJSON("Fix bug", "done")); !strings.Contains(got, `"ok":true`) {
		t.Fatalf("show = %s, want ok", got)
	}
	if len(ops.balloons) != 1 {
		t.Fatalf("balloons = %v, want 1", ops.balloons)
	}
	balloon := ops.balloons[0]
	if balloon.hwnd != ops.installHwnd || balloon.title != "Fix bug" || balloon.body != "done" || balloon.flags != niifInfo {
		t.Fatalf("balloon = %+v", balloon)
	}
}

func TestDesktopTrayNotifierShowMapsStatusToBalloonFlags(t *testing.T) {
	ops := newFakeTrayOps()
	notifier := newDesktopTrayNotifierWithOps(ops)
	notifier.show(`{"type":"chat.prompt.completed","projectId":"p1","sessionId":"s1","title":"A","body":"b","status":"failed"}`)
	if len(ops.balloons) != 1 || ops.balloons[0].flags != niifError {
		t.Fatalf("failed status balloon = %+v, want NIIF_ERROR", ops.balloons)
	}
	notifier.show(`{"type":"chat.prompt.completed","projectId":"p1","sessionId":"s1","title":"A","body":"b","status":"cancelled"}`)
	if len(ops.balloons) != 2 || ops.balloons[1].flags != niifNone {
		t.Fatalf("cancelled status balloon = %+v, want NIIF_NONE", ops.balloons[1])
	}
}

func TestDesktopTrayNotifierShowTruncatesTitleAndBody(t *testing.T) {
	ops := newFakeTrayOps()
	notifier := newDesktopTrayNotifierWithOps(ops)
	title := strings.Repeat("t", 100)
	body := strings.Repeat("汉", 300)
	notifier.show(validNotificationJSON(title, body))
	if len(ops.balloons) != 1 {
		t.Fatalf("balloons = %v, want 1", ops.balloons)
	}
	balloon := ops.balloons[0]
	if got := len(utf16.Encode([]rune(balloon.title))); got != 63 {
		t.Fatalf("title = %d utf16 units, want 63", got)
	}
	if got := len(utf16.Encode([]rune(balloon.body))); got != 255 {
		t.Fatalf("body = %d utf16 units, want 255", got)
	}
}

func TestDesktopTrayNotifierRejectsInvalidPayload(t *testing.T) {
	ops := newFakeTrayOps()
	notifier := newDesktopTrayNotifierWithOps(ops)
	if got := notifier.show(`not-json`); !strings.Contains(got, `"ok":false`) {
		t.Fatalf("show = %s, want failure json", got)
	}
	if len(ops.balloons) != 0 {
		t.Fatalf("balloons = %v, want none", ops.balloons)
	}
}

func TestDesktopTrayNotifierBalloonFailureReturnsNotOk(t *testing.T) {
	ops := newFakeTrayOps()
	ops.balloonErr = errors.New("balloon rejected")
	notifier := newDesktopTrayNotifierWithOps(ops)
	if got := notifier.show(validNotificationJSON("A", "b")); !strings.Contains(got, `"ok":false`) {
		t.Fatalf("show = %s, want failure json", got)
	}
}

func TestDesktopTrayNotifierInstallFailureDropsAndRetries(t *testing.T) {
	ops := newFakeTrayOps()
	ops.installErr = errors.New("explorer not ready")
	notifier := newDesktopTrayNotifierWithOps(ops)
	if got := notifier.show(validNotificationJSON("A", "b")); !strings.Contains(got, `"ok":false`) {
		t.Fatalf("show = %s, want failure json", got)
	}
	if len(ops.balloons) != 0 {
		t.Fatalf("balloons = %v, want none", ops.balloons)
	}
	ops.installErr = nil
	if got := notifier.show(validNotificationJSON("A", "b")); !strings.Contains(got, `"ok":true`) {
		t.Fatalf("retry show = %s, want ok", got)
	}
	if ops.installed != 3 {
		t.Fatalf("installed = %d, want start + failed retry + success retry", ops.installed)
	}
	if len(ops.balloons) != 1 {
		t.Fatalf("balloons = %v, want 1 after retry", ops.balloons)
	}
}

func TestDesktopTrayNotifierBalloonClickFocusesAndRoutesLatest(t *testing.T) {
	ops := newFakeTrayOps()
	notifier := newDesktopTrayNotifierWithOps(ops)
	notifier.show(validNotificationJSON("A", "one"))
	notifier.show(`{"type":"chat.prompt.completed","projectId":"p2","sessionId":"s2","title":"B","body":"two","status":"completed"}`)

	notifier.handleBalloonClick()
	if ops.focused != 1 {
		t.Fatalf("focused = %d, want 1", ops.focused)
	}
	if len(ops.evaled) != 1 ||
		!strings.Contains(ops.evaled[0], "wheelmaker:desktop-notification-click") ||
		!strings.Contains(ops.evaled[0], `"p2"`) || !strings.Contains(ops.evaled[0], `"s2"`) {
		t.Fatalf("evaled = %v, want latest notification session", ops.evaled)
	}
}

func TestDesktopTrayNotifierBalloonClickWithoutNotificationDoesNothing(t *testing.T) {
	ops := newFakeTrayOps()
	notifier := newDesktopTrayNotifierWithOps(ops)
	notifier.handleBalloonClick()
	if ops.focused != 0 || len(ops.evaled) != 0 {
		t.Fatalf("focused = %d, evaled = %v, want none", ops.focused, ops.evaled)
	}
}

func TestDesktopTrayNotifierTrayClickFocusesOnly(t *testing.T) {
	ops := newFakeTrayOps()
	notifier := newDesktopTrayNotifierWithOps(ops)
	notifier.handleTrayClick()
	if ops.focused != 1 {
		t.Fatalf("focused = %d, want 1", ops.focused)
	}
	if len(ops.evaled) != 0 {
		t.Fatalf("evaled = %v, want none", ops.evaled)
	}
}

func TestDesktopTrayNotifierCloseRemovesTrayIcon(t *testing.T) {
	ops := newFakeTrayOps()
	notifier := newDesktopTrayNotifierWithOps(ops)
	notifier.close()
	if len(ops.removed) != 1 || ops.removed[0] != ops.installHwnd {
		t.Fatalf("removed = %v, want tray hwnd %d", ops.removed, ops.installHwnd)
	}
	notifier.close()
	if len(ops.removed) != 1 {
		t.Fatalf("second close removed = %v, want idempotent", ops.removed)
	}
}
