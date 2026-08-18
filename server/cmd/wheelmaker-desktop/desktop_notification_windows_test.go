//go:build windows

package main

import (
	"bytes"
	"errors"
	"os"
	"strings"
	"testing"
)

type fakeTrayOps struct {
	installHwnd uintptr
	installErr  error

	installed int
	removed   []uintptr
	focused   int
	evaled    []string
}

func newFakeTrayOps() *fakeTrayOps {
	return &fakeTrayOps{installHwnd: 77}
}

func (f *fakeTrayOps) installTrayIcon(_ *desktopToastNotifier) (uintptr, error) {
	f.installed++
	if f.installErr != nil {
		return 0, f.installErr
	}
	return f.installHwnd, nil
}

func (f *fakeTrayOps) removeTrayIcon(hwnd uintptr) { f.removed = append(f.removed, hwnd) }

func (f *fakeTrayOps) focusMainWindow() { f.focused++ }

func (f *fakeTrayOps) evalScript(script string) { f.evaled = append(f.evaled, script) }

type fakeToastOps struct {
	registerErr error
	showErr     error
	registered  int
	shown       []struct{ xml, tag string }
	unreg       int
}

func (f *fakeToastOps) registerIdentity() error {
	f.registered++
	return f.registerErr
}

func (f *fakeToastOps) showToast(xml, tag string) error {
	if f.showErr != nil {
		return f.showErr
	}
	f.shown = append(f.shown, struct{ xml, tag string }{xml, tag})
	return nil
}

func (f *fakeToastOps) unregister() { f.unreg++ }

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

func TestDesktopNotificationStatusPrefix(t *testing.T) {
	cases := map[string]string{
		"completed": "✓ ", "": "✓ ",
		"failed":    "✗ ",
		"cancelled": "■ ", "interrupted": "■ ",
	}
	for status, want := range cases {
		if got := desktopNotificationStatusPrefix(status); got != want {
			t.Fatalf("prefix(%q) = %q, want %q", status, got, want)
		}
	}
}

func TestDesktopToastContentFor(t *testing.T) {
	n := desktopNotification{Key: "p1:s1", ProjectID: "p1", SessionID: "s1", Title: "Fix bug", Body: "done", Status: "failed"}
	c := desktopToastContentFor(n)
	if c.Title != "Fix bug" || c.Body != "✗ done" || c.Tag != "p1:s1" ||
		c.Launch != "projectId=p1&sessionId=s1" {
		t.Fatalf("content = %+v", c)
	}
}

func TestMarshalDesktopToastXMLEscapesAndShapes(t *testing.T) {
	c := desktopToastContent{
		Title: `A<b>&"c"`, Body: "✓ done",
		Tag: "p1:s1", Launch: "projectId=p1&sessionId=s1",
	}
	got := marshalDesktopToastXML(c)
	for _, want := range []string{
		`activationType="foreground"`,
		`launch="projectId=p1&amp;sessionId=s1"`,
		`template="ToastGeneric"`,
		`<text>A&lt;b&gt;&amp;&#34;c&#34;</text>`,
		`<text>✓ done</text>`,
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("xml missing %q:\n%s", want, got)
		}
	}
}

func TestDesktopToastNotifierShowBuildsAndSendsToast(t *testing.T) {
	toast := &fakeToastOps{}
	tray := newFakeTrayOps()
	n := newDesktopToastNotifierWithOps(toast, tray)
	if toast.registered != 1 {
		t.Fatalf("registered = %d, want 1 at construction", toast.registered)
	}
	if got := n.show(validNotificationJSON("Fix bug", "done")); !strings.Contains(got, `"ok":true`) {
		t.Fatalf("show = %s, want ok", got)
	}
	if len(toast.shown) != 1 {
		t.Fatalf("shown = %v, want 1 toast", toast.shown)
	}
	if toast.shown[0].tag != "p1:s1" || !strings.Contains(toast.shown[0].xml, "<text>Fix bug</text>") {
		t.Fatalf("shown = %+v", toast.shown[0])
	}
}

func TestDesktopToastNotifierRegisterFailureDropsNotification(t *testing.T) {
	toast := &fakeToastOps{registerErr: errors.New("registry denied")}
	tray := newFakeTrayOps()
	n := newDesktopToastNotifierWithOps(toast, tray)
	if got := n.show(validNotificationJSON("A", "b")); !strings.Contains(got, `"ok":false`) {
		t.Fatalf("show = %s, want failure json", got)
	}
	if len(toast.shown) != 0 {
		t.Fatalf("shown = %v, want none", toast.shown)
	}
	toast.registerErr = nil
	if got := n.show(validNotificationJSON("A", "b")); !strings.Contains(got, `"ok":true`) {
		t.Fatalf("retry show = %s, want ok", got)
	}
	if toast.registered != 3 {
		t.Fatalf("registered = %d, want construct + failed retry + success retry", toast.registered)
	}
}

func TestDesktopToastNotifierShowToastFailureReturnsNotOk(t *testing.T) {
	toast := &fakeToastOps{showErr: errors.New("com error")}
	n := newDesktopToastNotifierWithOps(toast, newFakeTrayOps())
	if got := n.show(validNotificationJSON("A", "b")); !strings.Contains(got, `"ok":false`) {
		t.Fatalf("show = %s, want failure json", got)
	}
}

func TestDesktopToastNotifierRejectsInvalidPayload(t *testing.T) {
	toast := &fakeToastOps{}
	n := newDesktopToastNotifierWithOps(toast, newFakeTrayOps())
	if got := n.show(`not-json`); !strings.Contains(got, `"ok":false`) {
		t.Fatalf("show = %s, want failure json", got)
	}
	if len(toast.shown) != 0 {
		t.Fatalf("shown = %v, want none", toast.shown)
	}
}

func TestDesktopToastNotifierTrayLifecycle(t *testing.T) {
	toast := &fakeToastOps{}
	tray := newFakeTrayOps()
	n := newDesktopToastNotifierWithOps(toast, tray)
	if tray.installed != 1 {
		t.Fatalf("tray installed = %d, want 1", tray.installed)
	}
	n.handleTrayClick()
	if tray.focused != 1 || len(tray.evaled) != 0 {
		t.Fatalf("tray click focused = %d evaled = %v, want focus only", tray.focused, tray.evaled)
	}
	n.close()
	if len(tray.removed) != 1 || toast.unreg != 1 {
		t.Fatalf("close removed = %v unreg = %d, want tray removed + unregistered", tray.removed, toast.unreg)
	}
	n.close()
	if len(tray.removed) != 1 || toast.unreg != 1 {
		t.Fatalf("second close = %v/%d, want idempotent", tray.removed, toast.unreg)
	}
}

func TestParseDesktopToastLaunchArgs(t *testing.T) {
	pid, sid, ok := parseDesktopToastLaunchArgs("projectId=p1&sessionId=s1")
	if !ok || pid != "p1" || sid != "s1" {
		t.Fatalf("parse = %q %q %v", pid, sid, ok)
	}
	for _, bad := range []string{"", "projectId=p1", "sessionId=s1", "a=b&c=d"} {
		if _, _, ok := parseDesktopToastLaunchArgs(bad); ok {
			t.Fatalf("parse(%q) = ok, want not ok", bad)
		}
	}
}

func TestDesktopToastNotifierActivationFocusesAndRoutes(t *testing.T) {
	tray := newFakeTrayOps()
	n := newDesktopToastNotifierWithOps(&fakeToastOps{}, tray)
	n.handleToastActivation("projectId=p2&sessionId=s2")
	if tray.focused != 1 {
		t.Fatalf("focused = %d, want 1", tray.focused)
	}
	if len(tray.evaled) != 1 ||
		!strings.Contains(tray.evaled[0], "wheelmaker:desktop-notification-click") ||
		!strings.Contains(tray.evaled[0], `"p2"`) || !strings.Contains(tray.evaled[0], `"s2"`) {
		t.Fatalf("evaled = %v", tray.evaled)
	}
}

func TestDesktopToastNotifierActivationWithBadArgsDoesNothing(t *testing.T) {
	tray := newFakeTrayOps()
	n := newDesktopToastNotifierWithOps(&fakeToastOps{}, tray)
	n.handleToastActivation("garbage")
	if tray.focused != 0 || len(tray.evaled) != 0 {
		t.Fatalf("focused = %d evaled = %v, want none", tray.focused, tray.evaled)
	}
}

func TestDesktopToastIconReleaseWritesEmbeddedPNG(t *testing.T) {
	home := t.TempDir()
	path, err := releaseDesktopToastIcon(home)
	if err != nil {
		t.Fatalf("release icon: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read icon: %v", err)
	}
	if len(data) == 0 || !bytes.Equal(data, desktopToastIconPNG) {
		t.Fatalf("icon bytes mismatch, len=%d", len(data))
	}
	if got := desktopToastIconPath(home); got != path {
		t.Fatalf("path = %q, want %q", path, got)
	}
	info1, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat icon: %v", err)
	}
	if _, err := releaseDesktopToastIcon(home); err != nil {
		t.Fatalf("second release: %v", err)
	}
	info2, err := os.Stat(path)
	if err != nil {
		t.Fatalf("second stat: %v", err)
	}
	if !info1.ModTime().Equal(info2.ModTime()) {
		t.Fatalf("icon rewritten unnecessarily")
	}
}

func TestDesktopToastAUMIDValues(t *testing.T) {
	got := map[string]string{}
	for _, v := range desktopToastAUMIDValues(`C:\icon.png`) {
		got[v[0]] = v[1]
	}
	for want, value := range map[string]string{
		"DisplayName":         "WheelMaker",
		"IconUri":             `C:\icon.png`,
		"IconBackgroundColor": "FF0A1E44",
		"CustomActivator":     desktopToastActivatorCLSID,
	} {
		if got[want] != value {
			t.Fatalf("%s = %q, want %q", want, got[want], value)
		}
	}
}
