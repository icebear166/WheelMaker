# Preview Docking and Desktop Floating Window Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Desktop Preview 的 pin 抽屉变为 Preview 内部分栏，并以单一 Preview renderer 支持独立 companion window，同时保持 Chat 来源动作、工作现场和重启边界一致。

**Scope Source:** `docs/scope/2026-08-17-preview-docking-and-desktop-floating-window.md`（已批准 2026-08-17）

**Architecture:** 主 Web App 继续拥有 Preview 状态、Registry/Git 数据和所有业务动作；共享 `PreviewWorkbenchView`/viewer 负责渲染，主窗口和 Preview-only companion 都使用它。两个 WebView 通过 typed `BroadcastChannel` 同步 snapshot 与 intent，Go Desktop 仅负责第二个 WebView2 顶层窗口、任务栏、焦点、系统关闭和 bounds。

**Tech Stack:** TypeScript/React、Jest、CSS、Go/WebView2、Win32 user32、现有 Desktop config store。

**Verification:**
- `cd app && npm test -- --runTestsByPath web/preview/previewWorkbenchChannel.test.ts web/preview/PreviewWorkbenchChrome.test.tsx web/preview/PreviewWorkbenchView.test.tsx web/preview/PreviewWindowApp.test.tsx`
- `cd app && npm run tsc:web && npm run build:web`
- `cd server && go test ./cmd/wheelmaker-desktop/`
- `cd server && go build ./...`

---

## Task 1: 建立 Preview 跨窗口消息契约

**Files:**
- Create: `app/web/src/preview/previewWorkbenchChannel.ts`
- Test: `app/web/src/preview/previewWorkbenchChannel.test.ts`

**Acceptance:** 主窗口与 Preview-only window 使用同一个带版本号的 app-local channel；消息只包含可 structured-clone 的 Preview snapshot、intent 和 lifecycle 事件；关闭 channel 不遗留监听器。

- [ ] **Step 1: Write the failing tests**

测试以下真实行为：

```ts
test('round-trips ready, state and intent messages through the typed channel', () => {
  const first = createPreviewWorkbenchChannel({channelFactory: fakeChannelFactory});
  const second = createPreviewWorkbenchChannel({channelFactory: fakeChannelFactory});
  const received: PreviewWorkbenchMessage[] = [];
  second.subscribe(message => received.push(message));

  first.post({kind: 'preview-ready', version: 1, instanceId: 'detached-1'});
  first.post({kind: 'preview-intent', version: 1, intent: {kind: 'dock'}});

  expect(received).toEqual([
    {kind: 'preview-ready', version: 1, instanceId: 'detached-1'},
    {kind: 'preview-intent', version: 1, intent: {kind: 'dock'}},
  ]);
});

test('close removes the subscription and ignores messages after close', () => {
  const channel = createPreviewWorkbenchChannel({channelFactory: fakeChannelFactory});
  const listener = jest.fn();
  channel.subscribe(listener);
  channel.close();
  channel.post({kind: 'preview-ready', version: 1, instanceId: 'detached-1'});
  expect(listener).not.toHaveBeenCalled();
});
```

契约包含 `PREVIEW_WORKBENCH_CHANNEL_NAME`、`version: 1`、`preview-ready`、`preview-state`、`preview-intent` 和 `preview-host-status`；intent 覆盖 tab select/close、drawer mode、pin、search、scroll、open target、focus、dock。state 使用现有 `PreviewWorkbenchState` 加上 drawer pin、search、file tree、Git snapshot 和代码显示设置的可序列化结构。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- --runTestsByPath web/preview/previewWorkbenchChannel.test.ts`

Expected: FAIL，因为 channel 工厂、消息类型和 fake transport 尚不存在。

- [ ] **Step 3: Write minimal implementation**

实现 typed wrapper：优先使用浏览器 `BroadcastChannel`，测试和不支持 BroadcastChannel 的环境通过注入的 factory；`post` 只发送已声明消息，`subscribe` 返回取消函数，`close` 幂等。不要在 channel 层访问 Registry、Workspace 或 Desktop bridge。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- --runTestsByPath web/preview/previewWorkbenchChannel.test.ts`

Expected: PASS。

- [ ] **Step 5: Git checkpoint**

通过后只 checkpoint `previewWorkbenchChannel.ts` 与对应测试。

## Task 2: 提取共享 Preview 视图并实现 PC pinned internal split

**Files:**
- Create: `app/web/src/preview/PreviewWorkbenchView.tsx`
- Modify: `app/web/src/preview/PreviewWorkbenchChrome.tsx`
- Modify: `app/web/src/styles/file.css`
- Test: `app/web/src/preview/PreviewWorkbenchChrome.test.tsx`
- Test: `app/web/src/preview/PreviewWorkbenchView.test.tsx`

**Acceptance:** unpinned Desktop 继续 portal 到外部 host；pinned Desktop 不 portal，drawer 在 Preview body 左侧占据固定列，内容滚动层位于右侧；mobile 继续 inline overlay，不受 pinned split CSS 影响。共享 View 负责 Chrome、drawer、tabs、search slot 和 body slot，不把 WorkspaceApp 状态带入。

- [ ] **Step 1: Write the failing tests**

追加测试：

```tsx
test('pinned desktop renders an internal split instead of the external portal', () => {
  render(createProps({drawerMode: 'files', drawerPinned: true}));
  const surface = container!.querySelector('.preview-workbench-surface') as HTMLElement;
  expect(surface.className).toContain('drawer-pinned');
  expect(surface.querySelector('.preview-workbench-drawer-panel.external')).toBeNull();
  expect(surface.querySelector('.preview-workbench-drawer-panel')).toBeTruthy();
});

test('unpinned desktop keeps the external drawer portal', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(createProps({drawerMode: 'files', drawerPortalTarget: host}));
  expect(host.querySelector('.preview-workbench-drawer-panel.external')).toBeTruthy();
});
```

`PreviewWorkbenchView.test.tsx` 断言 inline 与 detached mode 都消费同一 `PreviewWorkbenchView`，并将 `onDrawerModeChange`、`onTabSelect`、`onTabClose`、`onDock`/`onFloat` 等 intent callback 原样转交。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- --runTestsByPath web/preview/PreviewWorkbenchChrome.test.tsx web/preview/PreviewWorkbenchView.test.tsx`

Expected: pinned surface 缺少 internal split class，新增 View 尚不能编译。

- [ ] **Step 3: Write minimal implementation**

在 `PreviewWorkbenchView.tsx` 收纳当前 `PreviewWorkbenchChrome` 的通用 props，inline 与 detached 只提供 view model 和 intent callbacks。`PreviewWorkbenchChrome` 根据 `mode === 'desktop' && drawerPinned && !drawerPortalTarget` 增加 `drawer-pinned` surface/body 标记；CSS 只对该标记启用 flex 分栏，保留外部 portal 和 mobile 规则。删除“关闭 drawer 清 pin”的行为，显式 Unpin 才改变 pin。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- --runTestsByPath web/preview/PreviewWorkbenchChrome.test.tsx web/preview/PreviewWorkbenchView.test.tsx`

Expected: PASS。

- [ ] **Step 5: Run focused regression checks**

Run: `cd app && npm run tsc:web`

Expected: TypeScript 检查通过，mobile drawer 和既有 external portal 测试均通过。

- [ ] **Step 6: Git checkpoint**

只提交本任务的 shared View、Chrome/CSS 与测试文件。

## Task 3: 抽取 Preview viewer 并实现 Preview-only window Web App

**Files:**
- Create: `app/web/src/preview/PreviewWorkbenchViewers.tsx`
- Create: `app/web/src/preview/PreviewWindowApp.tsx`
- Create: `app/web/src/preview/PreviewWindowApp.test.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`（将现有 file/attachment/prompt viewer 改为共享导出）
- Modify: `app/web/src/main.tsx`

**Acceptance:** companion 路径只挂载 `PreviewWindowApp`、GlobalTooltip 和既有全局样式，不导入 `WorkspaceApp`，不创建第二套 RegistryWorkspaceService/WorkspaceController。Preview-only app 能用主窗口 snapshot 渲染 file、prompt diff、git diff、attachment、port relay 的当前 tab，并通过 channel 发出用户 intent。

- [ ] **Step 1: Write the failing tests**

在 `PreviewWindowApp.test.tsx` 使用 fake channel 和可序列化 fixture，断言：ready 后收到 state 会显示 tab title 与当前 file 内容；点击 tab 发送 `select-tab`；点击 Dock 发送 `dock`；drawer pin/send mode intent 使用同一通道。

```tsx
test('preview-only app renders the received workbench and sends dock intent', () => {
  const transport = createFakePreviewTransport();
  render(<PreviewWindowApp channel={transport.channel} />);
  transport.emit(stateMessage(singleFilePreviewState()));
  expect(screen.getByRole('tab', {name: 'a.ts'})).toBeTruthy();
  act(() => screen.getByRole('button', {name: 'Dock preview'}).click());
  expect(transport.posts).toContainEqual({kind: 'preview-intent', version: 1, intent: {kind: 'dock'}});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- --runTestsByPath web/preview/PreviewWindowApp.test.tsx`

Expected: FAIL，因为 Preview-only entry 和共享 viewer 尚不存在。

- [ ] **Step 3: Write minimal implementation**

将 `WorkspaceApp.tsx` 中的 `ChatFilePeekViewer`、attachment viewer、prompt artifact viewer 及其纯 helper 移到 `PreviewWorkbenchViewers.tsx`，保持现有 props 和渲染分支；WorkspaceApp 改为导入它们。`PreviewWindowApp` 使用 channel state、`PreviewWorkbenchView`、`FileExplorerTree`/`GitHistoryPanel` 的序列化快照适配器，所有点击只产生 Preview intent。Detached toolbar 显示明确的 `Dock preview`；不显示浏览器 popup 或移动端入口。

`main.tsx` 通过专用 pathname（`/preview-window` 及 base path 下的该子路径）选择 Preview-only app；普通 pathname 继续等待 `workspaceAppReady` 后渲染 App。该路由不使用 query/hash。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- --runTestsByPath web/preview/PreviewWindowApp.test.tsx web/preview/PreviewWorkbenchChrome.test.tsx`

Expected: PASS。

- [ ] **Step 5: Run focused regression checks**

Run: `cd app && npm run tsc:web`

Expected: WorkspaceApp viewer 渲染和 Preview-only entry 均通过类型检查。

- [ ] **Step 6: Git checkpoint**

只提交 viewer 抽取、PreviewWindowApp、main route 与对应测试。

## Task 4: 主 Web App 接入 detach、snapshot 同步和 Chat 来源路由

**Files:**
- Create: `app/web/src/preview/previewWorkbenchHost.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/platform/desktop/desktopRuntime.ts`
- Modify: `app/web/src/styles/file.css`
- Test: `app/web/src/preview/previewWorkbenchHost.test.ts`
- Test: `app/web/src/app/WorkspaceApp.test.tsx`（若现有测试文件覆盖入口；否则新增最小源码/渲染测试）

**Acceptance:** Desktop Preview 可 Float；detach 后主窗口只显示 Chat，主入口变为 Bring Preview to front；main 继续作为 state/data authority，收到 companion ready 后发送完整 mirror state；所有主窗口 Preview 来源动作在 detached 时更新 snapshot 并 focus companion；companion dock/close 恢复 inline。

- [ ] **Step 1: Write the failing tests**

`previewWorkbenchHost.test.ts` 覆盖：

- `open` 成功后发送 `preview-state` 和 `preview-host-status(detached)`；
- `preview-intent(select-tab/drawer/search/scroll)` 调用注入的主 controller；
- `dock` 将 detached 变为 inline；
- companion `closed` 事件也触发 dock；
- `buildPreviewMirrorState` 保留当前 tab 内容、drawer pin、search query/index 和 scrollTop。

WorkspaceApp 入口测试断言 detached 时按钮文案/aria-label 为 `Bring Preview to front`，inline 时为 `Float Preview`。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- --runTestsByPath web/preview/previewWorkbenchHost.test.ts`

Expected: FAIL，因为 host controller、detach state 和 Desktop bridge 方法不存在。

- [ ] **Step 3: Write minimal implementation**

在 `previewWorkbenchHost.ts` 实现主窗口 host：创建/关闭 channel、保存 `detached` runtime state（不写 WorkspacePersistence）、处理 ready/state/intent、向 Desktop bridge 请求 `openPreviewWindow`、`focusPreviewWindow`、`dockPreviewWindow`。WorkspaceApp 将 `chatPreviewOpen` 与 desktop pane 渲染条件排除 detached 状态，但保留 PreviewController/state 以供 sync 和 dock 恢复。

将当前 file tree、Git snapshot、代码主题/字体、HTML endpoint/CSRF、search 与 scroll 状态纳入 mirror state。Chat 文件链接、Changed Files、Quick Open、Git 与标题栏入口统一调用现有 open 函数后 `focusPreviewWindow`；detached 时不重新展开隐藏主 Preview。

pin 只保留为 session-local state，不进入 `previewWorkbenchSnapshot`；应用重启沿用现有 `chatPreviewManualCollapsed = true`，不会恢复 detached。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- --runTestsByPath web/preview/previewWorkbenchHost.test.ts`

Expected: PASS。

- [ ] **Step 5: Run focused regression checks**

Run: `cd app && npm test -- --runTestsByPath web/preview/PreviewWorkbenchChrome.test.tsx web/preview/PreviewWindowApp.test.tsx`

Expected: PASS，且没有重复的 Preview renderer 条件。

- [ ] **Step 6: Git checkpoint**

只提交 host controller、WorkspaceApp、desktopRuntime 类型和测试。

## Task 5: Windows WebView2 companion 生命周期、焦点与 bounds

**Files:**
- Create: `server/cmd/wheelmaker-desktop/desktop_preview_window_windows.go`
- Create: `server/cmd/wheelmaker-desktop/desktop_preview_window_windows_test.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows.go`
- Modify: `server/cmd/wheelmaker-desktop/desktop_bridge.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_policy.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows_test.go`
- Modify: `server/cmd/wheelmaker-desktop/base_url_store.go`
- Test: `server/cmd/wheelmaker-desktop/base_url_store_test.go`（若已有同名测试则追加）

**Acceptance:** Desktop EXE 的 companion 是独立正常顶层 WebView2/任务栏窗口；首次打开优先第二显示器，后续复用 bounds，失效 bounds 回到可见 work area；系统 X 通知 main Web App dock；Go 不传递 Preview 业务状态。

- [ ] **Step 1: Write the failing tests**

逻辑层测试覆盖：

```go
func TestChoosePreviewWindowBoundsPrefersSecondMonitor(t *testing.T) {
    got := choosePreviewWindowBounds(desktopWindowRect{0, 0, 1280, 840}, nil, desktopVirtualScreen{0, 0, 3200, 1080, 2})
    if got.left < 1280 || got.right > 3200 || got.bottom > 1080 { t.Fatalf("bounds = %+v", got) }
}

func TestChoosePreviewWindowBoundsRelocatesInvalidRememberedBounds(t *testing.T) {
    remembered := desktopWindowRect{-3000, -2000, -2100, -1300}
    got := choosePreviewWindowBounds(desktopWindowRect{0, 0, 1280, 840}, &remembered, desktopVirtualScreen{0, 0, 1920, 1040, 1})
    if got.left < 0 || got.top < 0 || got.right > 1920 || got.bottom > 1040 { t.Fatalf("bounds = %+v", got) }
}

func TestPreviewWindowCloseNotifiesMainAndDockIsIdempotent(t *testing.T) {
    // fake companion lifecycle records terminate/focus and main Eval event once.
}
```

`webview_policy_test.go`/`webview_windows_test.go` 追加专用 `/preview-window` 路径允许、query/hash 仍拒绝、companion bridge 只授权已声明窗口动作的测试。config store 测试确认 geometry 可保存但不存在 detached restore flag。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./cmd/wheelmaker-desktop/ -run 'PreviewWindow|DesktopConfig|PreviewPath' -v`

Expected: 编译失败或断言失败，因为 bounds 选择器、manager 和 bridge 尚不存在。

- [ ] **Step 3: Write minimal implementation**

实现 `desktopPreviewWindowManager`：

- 主窗口 binding `openPreviewWindow`/`focusPreviewWindow`/`dockPreviewWindow`；companion 在独立 `runtime.LockOSThread` goroutine 创建 `webview2.NewWithOptions` 并运行自己的 message loop，避免两个 WebView 共用一个 `Run` queue。
- companion 导航到 base URL 下的专用 `/preview-window` path；为 companion 使用独立 security state，不能复用 main 的 committed navigation epoch。
- companion system close、显式 Dock 和创建失败都通过 main WebView `Dispatch` 执行 `wheelmaker:preview-window-closed`/状态事件；重复 close/dock 幂等。
- 使用普通顶层 WebView2 window 保证独立任务栏项；focus/restore/minimize 通过现有 Win32 helpers 和新增最小 user32 bindings 完成。
- `desktopConfig` 新增可选 Preview bounds（left/top/width/height），仅保存几何，不保存 detached；用 virtual screen/monitor count 做首次 second-monitor placement，使用当前可见边界修正失效 bounds。
- `desktopRuntimeInitScript` 的主 trusted bridge 增加 companion open/focus/dock；companion init script 只暴露 `enabled`, `previewWindow`, `dockPreviewWindow` 及必要的原生窗口动作。Policy 允许 `/preview-window` 子路径，仍拒绝 query/hash 和 bootstrap 页面。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && go test ./cmd/wheelmaker-desktop/ -run 'PreviewWindow|DesktopConfig|PreviewPath' -v`

Expected: PASS。

- [ ] **Step 5: Run focused regression checks**

Run: `cd server && go test ./cmd/wheelmaker-desktop/`

Expected: Desktop 现有 bridge、policy、titlebar、notification 测试通过。

- [ ] **Step 6: Git checkpoint**

只提交 companion manager、bridge/policy/init script、config geometry 与对应 Go 测试。

## Task 6: Wiki 同步与全量验证

**Files:**
- Modify: `docs/wiki/frontend-interaction/workbench-chrome.md`
- Create: `docs/wiki/architecture/desktop-companion-window.md`
- Modify: `docs/wiki/architecture/architecture.md`

**Acceptance:** Wiki 只记录已实施的稳定事实：PC drawer 两种布局、companion window 与 Web channel 的职责边界、geometry/restart 语义和移动端/浏览器边界；索引完整，新增页面第一行是摘要。

- [ ] **Step 1: 调用 wiki skill 同步已确认目标**

更新 Workbench Chrome 的 Preview drawer 段落，新增 architecture 页面并在目录索引登记；记录来源 scope 文档链接，不写执行 checklist 或未落地方案。

- [ ] **Step 2: Run documentation checks**

Run: `git diff --check`

Expected: PASS；新页面第一行摘要、标题、目录索引和来源链接齐全。

- [ ] **Step 3: Run full verification**

Run: `cd app && npm test`

Expected: PASS。

Run: `cd app && npm run tsc:web && npm run build:web`

Expected: PASS。

Run: `cd server && go build ./... && go test ./...`

Expected: PASS；若非 Windows 环境跳过实际 WebView2 smoke，只记录 Windows 编译/测试结果。

- [ ] **Step 4: 对照 spec 验收**

逐项记录 pinned split、unpinned overlay、独立任务栏、唯一 renderer、Bring to front、Dock/system close、Chat 来源路由、smart bounds、重启不恢复 detached、browser/mobile 不变和无 Registry protocol 变更的验证证据。

- [ ] **Step 5: Git checkpoint**

只提交两个 Wiki 页面、目录索引和本任务验证相关文件。

- [ ] **Step 6: Git finalize**

调用 `git-workflow` finalize，按项目偏好提交剩余修改、push 当前分支；仅在主工作树干净且 finalize 结果允许时合入并 push `main`，之后清理已成功合入的 worktree/branch。
