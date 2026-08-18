# Desktop WinRT Toast Notifications Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** exe 端 prompt 完成通知从托盘气球换成 WinRT 系统 Toast（图标+应用名 header、session title + 内容两行、按 session 去重、COM 激活器点击回跳），托盘图标保留但不再是通知通道。

**Scope Source:** `docs/scope/2026-08-18-desktop-winrt-toast-notifications.md`（已批准 2026-08-18）

**Architecture:** 通知器 `desktopToastNotifier` 实现既有 `desktopNotificationSink` 接口；全部 COM/WinRT 调用收敛在注入的 `desktopToastOps` 之后，单测用 fake ops。真实 ops 手写 WinRT 互操作（`RoGetActivationFactory` + HSTRING + `XmlDocument.LoadXml`），点击回跳走进程内 COM local server（`INotificationActivationCallback`），Activate 在 RPC 线程，经 `PostMessage` 中转到托盘隐藏窗口所在 UI 线程执行 focus + eval。托盘图标（`Shell_NotifyIcon` NIM_ADD + 单击聚焦）保留，删除气球发送。

**Tech Stack:** Go 1.26、`golang.org/x/sys/windows`（含 `windows/registry` 子包）、手写 Win32/WinRT/COM；无新第三方依赖。

**Verification:** `cd server && go build ./cmd/wheelmaker-desktop && go test ./cmd/wheelmaker-desktop`（在 worktree `.worktree/desktop-winrt-toast` 内执行）。

---

## 固定常量（全部任务共用，Task 4 落地）

```go
const desktopToastAUMID = "WheelMaker.Desktop"

// 固定 CLSID（COM 激活器），minted once, never changes。
const desktopToastActivatorCLSID = "{B7C4A9E1-5D2F-4E3A-9C8B-1F6D3A5E7C92}"
```

已核实的 IID（来源：Windows SDK IDL 头 / Microsoft Learn）：

| 接口 | IID | 关键 vtable 索引（0 起，含 IUnknown 3 + IInspectable 3） |
|---|---|---|
| IInspectable | `af86e2e0-b12d-4c6a-9c5a-d7aa65101e90` | — |
| IXmlDocument | `f7f3a506-1e87-42d6-bcfb-b8c809fa5494` | — |
| IXmlDocumentIO | `6cd0e74e-ee65-4489-9ebf-ca43e87ba637` | LoadXml=6 |
| IToastNotificationManagerStatics | `50ac103f-d235-4598-bbef-98fe4d1a3ad4` | CreateToastNotifierWithId=7 |
| IToastNotificationFactory | `04124b20-82c6-4229-b109-fd9ed4662b53` | CreateToastNotification=6 |
| IToastNotification | （仅 vtable 调用，不需 IID） | put_Tag=15, put_Group=17 |
| IToastNotifier | （仅 vtable 调用，不需 IID） | Show=6 |
| INotificationActivationCallback | `53e31837-6600-4a81-9395-75cffe746f94` | Activate=3 |

Runtime class 名字符串：`Windows.Data.Xml.Dom.XmlDocument`、`Windows.UI.Notifications.ToastNotificationManager`、`Windows.UI.Notifications.ToastNotification`。

DLL proc（lazy load）：`combase!RoGetActivationFactory`、`api-ms-win-core-winrt-l1-1-0!RoInitialize/RoUninitialize/RoActivateInstance`、`api-ms-win-core-winrt-string-l1-1-0!WindowsCreateString/WindowsDeleteString/WindowsGetStringRawBuffer`、`ole32!CoInitializeEx/CoRegisterClassObject/CoRevokeClassObject`、`shell32!SetCurrentProcessExplicitAppUserModelID`。

注册表（HKCU，x/sys `windows/registry`）：
- `Software\Classes\AppUserModelId\WheelMaker.Desktop`：`DisplayName`="WheelMaker"（REG_SZ）、`IconUri`=<图标 PNG 路径>（REG_SZ）、`CustomActivator`="{B7C4A9E1-...}"（REG_SZ）
- `Software\Classes\CLSID\{B7C4A9E1-5D2F-4E3A-9C8B-1F6D3A5E7C92}\LocalServer32`：（默认）= 当前 exe 路径

COM 常量：`CLSCTX_LOCAL_SERVER=0x4`、`REGCLS_MULTIPLEUSE=1`、`COINIT_APARTMENTTHREADED=0x0`、`RPC_E_CHANGED_MODE=0x80010106`（RoInitialize/CoInitializeEx 遇此值视为可继续）。

---

### Task 1: Toast 内容模型与 XML 构建（纯函数）

**Files:**
- Modify: `server/cmd/wheelmaker-desktop/desktop_notification_windows.go`
- Test: `server/cmd/wheelmaker-desktop/desktop_notification_windows_test.go`

**Acceptance:** `desktopNotificationStatusPrefix`、`desktopToastContentFor`、`marshalDesktopToastXML` 三个纯函数行为正确；符号前缀映射与 XML 转义有测试覆盖。

- [ ] **Step 1: Write the failing tests**（追加到 desktop_notification_windows_test.go）

```go
func TestDesktopNotificationStatusPrefix(t *testing.T) {
	cases := map[string]string{
		"completed": "✓ ", "": "✓ ",
		"failed":      "✗ ",
		"cancelled":   "■ ", "interrupted": "■ ",
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
	xml := marshalDesktopToastXML(c)
	for _, want := range []string{
		`activationType="foreground"`,
		`launch="projectId=p1&amp;sessionId=s1"`,
		`template="ToastGeneric"`,
		`<text>A&lt;b&gt;&amp;&#34;c&#34;</text>`,
		`<text>✓ done</text>`,
	} {
		if !strings.Contains(xml, want) {
			t.Fatalf("xml missing %q:\n%s", want, xml)
		}
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && go test ./cmd/wheelmaker-desktop -run 'TestDesktopNotificationStatusPrefix|TestDesktopToastContentFor|TestMarshalDesktopToastXML' -v`
Expected: 编译失败 `undefined: desktopNotificationStatusPrefix` 等（功能缺失，非笔误）。

- [ ] **Step 3: Minimal implementation**（desktop_notification_windows.go 追加）

```go
// desktopNotificationStatusPrefix returns the status symbol prepended to the
// toast body, matching the PWA notification convention.
func desktopNotificationStatusPrefix(status string) string {
	switch status {
	case "failed":
		return "✗ "
	case "cancelled", "interrupted":
		return "■ "
	default:
		return "✓ "
	}
}

type desktopToastContent struct {
	Title string
	Body  string
	Tag   string
	Launch string
}

func desktopToastContentFor(n desktopNotification) desktopToastContent {
	return desktopToastContent{
		Title:  n.Title,
		Body:   desktopNotificationStatusPrefix(n.Status) + n.Body,
		Tag:    n.Key,
		Launch: "projectId=" + n.ProjectID + "&sessionId=" + n.SessionID,
	}
}

func marshalDesktopToastXML(c desktopToastContent) string {
	escape := func(s string) string {
		var b strings.Builder
		_ = xml.EscapeText(&b, []byte(s))
		return b.String()
	}
	return `<toast launch="` + escape(c.Launch) + `" activationType="foreground">` +
		`<visual><binding template="ToastGeneric">` +
		`<text>` + escape(c.Title) + `</text>` +
		`<text>` + escape(c.Body) + `</text>` +
		`</binding></visual></toast>`
}
```

注意：`xml.EscapeText` 把 `"` 转成 `&#34;`、单引号转 `&#39;`，符合 XML 属性与文本安全要求；新增 import `encoding/xml`、`strings`（如已存在则复用）。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && go test ./cmd/wheelmaker-desktop -run 'TestDesktopNotificationStatusPrefix|TestDesktopToastContentFor|TestMarshalDesktopToastXML' -v`
Expected: PASS。

- [ ] **Step 5: Regression** — `go build ./cmd/wheelmaker-desktop`，预期通过（旧气球代码此时尚存，编译不受影响）。

- [ ] **Step 6: Git checkpoint** — 本任务与 Task 2/3 同属通知器核心单元，合并到 Task 3 后一次 checkpoint；本步记录"随 Task 3 提交"。

---

### Task 2: desktopToastNotifier sink + 托盘去气球化

**Files:**
- Modify: `server/cmd/wheelmaker-desktop/desktop_notification_windows.go`
- Test: `server/cmd/wheelmaker-desktop/desktop_notification_windows_test.go`

**Acceptance:** 通知器经注入 ops 发 toast（身份注册幂等、失败丢弃返回 ok:false）；托盘图标保留（安装/单击聚焦/关闭移除）；气球相关代码与测试全部删除。

- [ ] **Step 1: Rewrite the failing tests**（重写 desktop_notification_windows_test.go：删除 `TestDesktopNotificationBalloonFlags`、`TestTruncateNotificationUTF16`、气球点击/失败/重试等气球测试；保留 `TestParseDesktopNotification` 与 Task 1 新增测试；新增）

```go
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
	// 失败后下一次 show 重试注册
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
```

`fakeTrayOps` 精简为托盘职责：`installTrayIcon(*desktopToastNotifier) (uintptr, error)`、`removeTrayIcon(hwnd)`、`focusMainWindow()`、`evalScript(script)`（删除 `showBalloon`/`balloons` 字段）。

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && go test ./cmd/wheelmaker-desktop -run TestDesktopToastNotifier -v`
Expected: 编译失败 `undefined: desktopToastNotifier / newDesktopToastNotifierWithOps`（功能缺失）。

- [ ] **Step 3: Minimal implementation**（desktop_notification_windows.go）

```go
type desktopToastOps interface {
	registerIdentity() error
	showToast(xml, tag string) error
	unregister()
}

type desktopTrayOps interface { // 删除 showBalloon
	installTrayIcon(notifier *desktopToastNotifier) (uintptr, error)
	removeTrayIcon(hwnd uintptr)
	focusMainWindow()
	evalScript(script string)
}

type desktopToastNotifier struct {
	toast             desktopToastOps
	tray              desktopTrayOps
	mu                sync.Mutex
	trayHwnd          uintptr
	trayInstalled     bool
	identityRegistered bool
}

func newDesktopToastNotifier(mainHwnd uintptr, eval func(script string)) *desktopToastNotifier {
	return newDesktopToastNotifierWithOps(newWin32DesktopToastOps(mainHwnd), newWin32DesktopTrayOps(mainHwnd, eval))
}

func newDesktopToastNotifierWithOps(toast desktopToastOps, tray desktopTrayOps) *desktopToastNotifier {
	n := &desktopToastNotifier{toast: toast, tray: tray}
	desktopActiveTrayNotifier.Store(n)
	n.mu.Lock()
	defer n.mu.Unlock()
	n.registerLocked()
	n.installTrayLocked()
	return n
}

func (n *desktopToastNotifier) registerLocked() {
	if n.identityRegistered {
		return
	}
	if err := n.toast.registerIdentity(); err != nil {
		return // 下次 show 重试
	}
	n.identityRegistered = true
}

func (n *desktopToastNotifier) installTrayLocked() {
	if n.trayInstalled {
		return
	}
	hwnd, err := n.tray.installTrayIcon(n)
	if err != nil {
		return // 下次 show 重试
	}
	n.trayHwnd = hwnd
	n.trayInstalled = true
}

func (n *desktopToastNotifier) show(raw string) string {
	notification, err := parseDesktopNotification(raw)
	if err != nil {
		return desktopNotificationResult(false, "invalid_payload")
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	n.installTrayLocked()
	n.registerLocked()
	if !n.identityRegistered {
		return desktopNotificationResult(false, "identity_unavailable")
	}
	content := desktopToastContentFor(notification)
	if err := n.toast.showToast(marshalDesktopToastXML(content), content.Tag); err != nil {
		return desktopNotificationResult(false, "toast_failed")
	}
	return desktopNotificationResult(true, "")
}

func (n *desktopToastNotifier) handleTrayClick() { n.tray.focusMainWindow() }

func (n *desktopToastNotifier) close() {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.trayInstalled {
		n.tray.removeTrayIcon(n.trayHwnd)
		n.trayInstalled = false
		n.trayHwnd = 0
	}
	if n.identityRegistered {
		n.toast.unregister()
		n.identityRegistered = false
	}
	desktopActiveTrayNotifier.CompareAndSwap(n, nil)
}
```

托盘 Win32 层（`win32DesktopTrayOps`）删除 `showBalloon`；删除常量 `niifNone/niifInfo/niifError/ninBalloonUserClick/nifInfo/nimModify`、`truncateNotificationUTF16`、`desktopNotificationTitleMaxUTF16/desktopNotificationBodyMaxUTF16`、`wmApp` 保留；托盘 wndproc 删除气球 case。`desktopTrayNotifier` 旧类型及其测试全部移除；`desktopActiveTrayNotifier` 类型改为 `atomic.Pointer[desktopToastNotifier]`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && go test ./cmd/wheelmaker-desktop -v`
Expected: 全部 PASS（注意 `newWin32DesktopToastOps` 在 Task 4 才落地——Step 3 先在 desktop_notification_windows.go 保留一个编译占位：`newWin32DesktopToastOps` 返回真实类型的最小空实现骨架会被 Task 4 补全；若选择保持测试编译，Task 2 允许该构造函数暂以 `return &win32DesktopToastOps{mainHwnd: mainHwnd}` 形式存在且方法体返回错误）。

- [ ] **Step 5: Regression** — `go build ./cmd/wheelmaker-desktop && go vet ./cmd/wheelmaker-desktop`，预期无新增告警。

- [ ] **Step 6: Git checkpoint** — 随 Task 3 后一次提交；记录"随 Task 3 提交"。

---

### Task 3: 激活参数解析与点击回跳处理

**Files:**
- Modify: `server/cmd/wheelmaker-desktop/desktop_notification_windows.go`
- Test: `server/cmd/wheelmaker-desktop/desktop_notification_windows_test.go`

**Acceptance:** launch args 解析正确；有效激活 → 聚焦 + 派发 `wheelmaker:desktop-notification-click`（带正确 projectId/sessionId）；无效激活静默忽略。

- [ ] **Step 1: Write the failing tests**（追加）

```go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && go test ./cmd/wheelmaker-desktop -run 'ToastLaunchArgs|Activation' -v`
Expected: 编译失败 `undefined: parseDesktopToastLaunchArgs / handleToastActivation`。

- [ ] **Step 3: Minimal implementation**

```go
// parseDesktopToastLaunchArgs parses the toast launch attribute produced by
// desktopToastContentFor ("projectId=<pid>&sessionId=<sid>").
func parseDesktopToastLaunchArgs(args string) (projectID, sessionID string, ok bool) {
	values, err := url.ParseQuery(args)
	if err != nil {
		return "", "", false
	}
	projectID = values.Get("projectId")
	sessionID = values.Get("sessionId")
	return projectID, sessionID, projectID != "" && sessionID != ""
}

// handleToastActivation runs on the UI thread (relayed from the COM activator
// via PostMessage to the tray window).
func (n *desktopToastNotifier) handleToastActivation(args string) {
	projectID, sessionID, ok := parseDesktopToastLaunchArgs(args)
	if !ok {
		return
	}
	n.tray.focusMainWindow()
	n.tray.evalScript("window.dispatchEvent(new CustomEvent('wheelmaker:desktop-notification-click', {detail: {projectId: " +
		strconv.Quote(projectID) + ", sessionId: " + strconv.Quote(sessionID) + "}}));")
}
```

新增 import `net/url`。托盘 wndproc 增加 case `wmToastActivated`（`= wmApp + 2`）：从全局 pending 队列取出激活参数并调用 `handleToastActivation`（队列本身在 Task 4 实现，本任务只接 wndproc 分支 + 类型方法）。

- [ ] **Step 4: Run tests to verify they pass** — 同上命令，Expected: PASS。

- [ ] **Step 5: Regression** — `cd server && go test ./cmd/wheelmaker-desktop` 全绿。

- [ ] **Step 6: Git checkpoint**

git-workflow checkpoint（Task 1-3 文件：`desktop_notification_windows.go` + `desktop_notification_windows_test.go`）。建议提交信息：`feat(desktop): toast notification content model and notifier core`。记录 hash + subject。

---

### Task 4: WinRT/COM ops 实现 + 自注册 + 图标释放 + 接线

**Files:**
- Create: `server/cmd/wheelmaker-desktop/desktop_toast_winrt_windows.go`
- Modify: `server/cmd/wheelmaker-desktop/desktop_notification_windows.go`（托盘 wndproc 接入激活中转）
- Modify: `server/cmd/wheelmaker-desktop/webview_windows.go`（一行构造替换）
- Test: `server/cmd/wheelmaker-desktop/desktop_notification_windows_test.go`（图标释放测试追加于此，遵守"合并到现有测试文件"约定）

**Acceptance:** 真实 ops 完成 HKCU 自注册 + AUMID 设置 + COM 激活器注册 + WinRT toast 发送；托盘隐藏窗口接收激活中转消息；装配替换；全量构建与测试通过。

- [ ] **Step 1: Write the failing tests**（图标释放是纯文件逻辑，先测）

```go
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
	// 幂等：内容一致时跳过重写
	info1, _ := os.Stat(path)
	if _, err := releaseDesktopToastIcon(home); err != nil {
		t.Fatalf("second release: %v", err)
	}
	info2, _ := os.Stat(path)
	if !info1.ModTime().Equal(info2.ModTime()) {
		t.Fatalf("icon rewritten unnecessarily")
	}
}
```

新增 import `bytes`、`os`。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./cmd/wheelmaker-desktop -run TestDesktopToastIconRelease -v`
Expected: 编译失败 `undefined: releaseDesktopToastIcon / desktopToastIconPNG`。

- [ ] **Step 3: Implementation**（desktop_toast_winrt_windows.go，要点全量落地）

3a. GUID 类型与常量（用"固定常量"表的全部值）：

```go
type winrtGUID struct {
	data1 uint32
	data2 uint16
	data3 uint16
	data4 [8]byte
}

func mustParseGUID(s string) winrtGUID // 解析 "{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"；非法 panic

var (
	iidIInspectable                      = mustParseGUID("{af86e2e0-b12d-4c6a-9c5a-d7aa65101e90}")
	iidIXmlDocument                      = mustParseGUID("{f7f3a506-1e87-42d6-bcfb-b8c809fa5494}")
	iidIXmlDocumentIO                    = mustParseGUID("{6cd0e74e-ee65-4489-9ebf-ca43e87ba637}")
	iidIToastNotificationManagerStatics  = mustParseGUID("{50ac103f-d235-4598-bbef-98fe4d1a3ad4}")
	iidIToastNotificationFactory         = mustParseGUID("{04124b20-82c6-4229-b109-fd9ed4662b53}")
	iidINotificationActivationCallback   = mustParseGUID("{53e31837-6600-4a81-9395-75cffe746f94}")
	clsidDesktopToastActivator           = mustParseGUID(desktopToastActivatorCLSID)
)
```

3b. lazy procs（按"固定常量"节的 DLL 清单逐个 `windows.NewLazySystemDLL(...).NewProc(...)`；`desktopShell32` 已存在于 webview_profile_windows.go，直接复用其 NewProc("SetCurrentProcessExplicitAppUserModelID")）。

3c. HSTRING 辅助：

```go
func newHString(s string) (uintptr, error) // utf16 + WindowsCreateString；调用方负责 deleteHString
func deleteHString(h uintptr)
func hStringToGo(h uintptr) string // WindowsGetStringRawBuffer + utf16 解码
```

3d. COM vtable 调用约定：`comCall(obj uintptr, index int, args ...uintptr) uintptr`——读取 `*(**uintptr)(*obj)` 取 vtable，取第 index 个函数指针，`syscall.SyscallN(fn, obj, args...)`。HRESULT >= 0x80000000 视为错误（`type comError uint32`）。

3e. `win32DesktopToastOps`（实现 desktopToastOps）：

```go
type win32DesktopToastOps struct {
	mainHwnd      uintptr
	classCookie   uintptr
}

func newWin32DesktopToastOps(mainHwnd uintptr) *win32DesktopToastOps

func (o *win32DesktopToastOps) registerIdentity() error
```

`registerIdentity` 顺序：
1. `os.Executable()` 取 exe 路径；`os.UserHomeDir()` + `releaseDesktopToastIcon(home)` 得 IconUri。
2. `x/sys/windows/registry`：`registry.CreateKey(registry.CURRENT_USER, `Software\Classes\AppUserModelId\WheelMaker.Desktop`, registry.SET_VALUE)` → SetStringValue DisplayName="WheelMaker"、SetStringValue IconUri=图标路径、SetStringValue CustomActivator=desktopToastActivatorCLSID；再建 `Software\Classes\CLSID\{...}\LocalServer32` → SetStringValue ""=exe 路径。
3. `SetCurrentProcessExplicitAppUserModelID("WheelMaker.Desktop")`（HSTRING 不需要——该 API 收 PCWSTR，直接 utf16 指针）。
4. `CoInitializeEx(0, COINIT_APARTMENTTHREADED)`，容忍 `S_FALSE`/`RPC_E_CHANGED_MODE`。
5. 注册 COM 激活器：构造全局 `desktopToastActivator`（vtable：QueryInterface/AddRef/Release/Activate，`windows.NewCallback`），`CoRegisterClassObject(clsid, activatorIUnknown, CLSCTX_LOCAL_SERVER, REGCLS_MULTIPLEUSE, &cookie)`；cookie 存入 ops。
6. `RoInitialize(RO_INIT_MULTITHREADED=1)`，容忍 `RPC_E_CHANGED_MODE`。

3f. `showToast(xml, tag string) error`（严格按已验证调用序列）：

```
RoGetActivationFactory("Windows.Data.Xml.Dom.XmlDocument"→RoActivateInstance→IInspectable
  → QI(IXmlDocument) → doc；QI(IXmlDocumentIO) → docIO；comCall(docIO, 6 /*LoadXml*/, hXml)
RoGetActivationFactory("Windows.UI.Notifications.ToastNotificationManager", IID_...Statics)
  → comCall(statics, 7 /*CreateToastNotifierWithId*/, hAUMID, &notifier)
RoGetActivationFactory("Windows.UI.Notifications.ToastNotification", IID_...Factory)
  → comCall(factory, 6 /*CreateToastNotification*/, doc, &toast)
comCall(toast, 15 /*put_Tag*/, hTag)
comCall(notifier, 6 /*Show*/, toast)
全部对象用 defer comCall(x, 2 /*Release*/) 释放；HSTRING 同理 deleteHString。
```

3g. `unregister()`：`CoRevokeClassObject(cookie)`（注册表项保留，下次启动覆盖写）。

3h. 图标释放：

```go
//go:embed winres/icon.png
var desktopToastIconPNG []byte

func desktopToastIconPath(home string) string {
	return filepath.Join(home, ".wheelmaker", "desktop", "wheelmaker-toast-icon.png")
}

func releaseDesktopToastIcon(home string) (string, error) {
	path := desktopToastIconPath(home)
	if existing, err := os.ReadFile(path); err == nil && bytes.Equal(existing, desktopToastIconPNG) {
		return path, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	return path, os.WriteFile(path, desktopToastIconPNG, 0o644)
}
```

3i. COM 激活器与中转：

```go
const wmToastActivated = wmApp + 2

// vtable: [0]QueryInterface [1]AddRef [2]Release [3]Activate
type desktopToastActivator struct { ... }

// Activate(app, args, data, count)：args → hStringToGo → 入全局 pending 队列
//（sync.Mutex + []string）→ PostMessage(desktopTrayWindowHwnd.Load(), wmToastActivated, 0, 0) → return S_OK
```

`desktopTrayWindowHwnd atomic.Uintptr` 在托盘 `installTrayIcon` 成功时 Store、`removeTrayIcon` 时 Store(0)。托盘 wndproc 的 `wmToastActivated` 分支：从 pending 队列 drain，逐条 `notifier.handleToastActivation(args)`（notifier 从 `desktopActiveTrayNotifier.Load()` 取）。激活器 QI 只认 IID_IUnknown 与 IID_INotificationActivationCallback，其余返回 E_NOINTERFACE；AddRef/Release 返回 1（进程生命周期内常驻，不做真实计数）。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && go test ./cmd/wheelmaker-desktop -v`
Expected: 全绿（含 Task 1-3 全部测试 + 图标释放测试）。

- [ ] **Step 5: 接线**

`webview_windows.go:74`：`newDesktopTrayNotifier(hwnd, ...)` → `newDesktopToastNotifier(hwnd, func(script string) { w.Eval(script) })`。

Run: `cd server && gofmt -w cmd/wheelmaker-desktop && go build ./cmd/wheelmaker-desktop && go vet ./cmd/wheelmaker-desktop && go test ./cmd/wheelmaker-desktop`
Expected: 构建通过、无新增 vet 告警、测试全绿。

- [ ] **Step 6: Git checkpoint**

git-workflow checkpoint（Task 4 文件：`desktop_toast_winrt_windows.go`、`desktop_notification_windows.go`、`desktop_notification_windows_test.go`、`webview_windows.go`）。建议提交信息：`feat(desktop): winrt toast ops with com activator and self-registration`。记录 hash + subject。

---

## 手测清单（finalize 前向用户说明，由用户执行）

1. prompt 完成 → Toast header 显示 WheelMaker 图标与名称；第一行 session title；第二行带 ✓/✗/■ 前缀的回复预览。
2. 同一会话连续完成 → 操作中心该会话只保留最新一条且重新弹出。
3. 点击横幅与操作中心历史条目 → 聚焦主窗口并跳转对应会话。
4. 托盘图标存在，单击聚焦主窗口；退出应用托盘图标消失。
