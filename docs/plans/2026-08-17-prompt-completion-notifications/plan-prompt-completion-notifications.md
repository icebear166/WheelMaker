# Prompt Completion Notifications Unification Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify prompt-completion notifications across PWA / APK / exe — IM-style content (session title + reply preview), per-session replace, and consistent click-to-session behavior — and fix each platform's defects.

**Scope Source:** `docs/scope/2026-08-17-prompt-completion-notifications.md`（已批准 2026-08-17）

**Architecture:** Hub 在 `prompt_done` param 中嵌入清洗后的 `replyPreview`（增量字段，不动协议版本）；web 统一组装 payload 并按 android → desktop → pwa → unsupported 选择 provider；exe 由 Go 宿主自绘 Win32 置顶小窗（绕开 WebView2 通知管道），点击经 Eval 事件回传 web 跳转会话；PWA 换 PNG 图标 + tag 替换 + 同源聚焦；APK 换单色小图标 + 通知 ID 收敛 + setColor。

**Tech Stack:** Go（hub client、wheelmaker-desktop Win32）、TypeScript/React（app/web）、Kotlin（mobile/android）、Jest、Go test、JUnit 源码断言测试。

**Verification:**
- `cd server && go build ./... && go test ./internal/protocol/ ./internal/hub/client/ ./cmd/wheelmaker-desktop/`
- `cd app && npm test -- --runTestsByPath __tests__/web-prompt-completion-notifications.test.ts __tests__/web-notification-provider.test.ts __tests__/web-chat-notification-settings.test.ts`（末尾跑全量 `npm test`）
- `gradle -p mobile/android testDebugUnitTest --tests "com.wheelmaker.android.AndroidNotificationRuntimeTest"`（系统 gradle，无 wrapper）

工作区：`D:\Code\WheelMaker\.worktree\prompt-completion-notifications`（branch `prompt-completion-notifications`）。以下所有相对路径相对该工作区根目录。

---

### Task 1: Wiki 页面（第一个工作单元）

**Files:**
- Create: `docs/wiki/features/prompt-completion-notifications.md`
- Modify: `docs/wiki/features/features.md`（目录索引加一行，若该文件含子页面列表）

**Acceptance:** wiki 记录通知功能的稳定约定（内容模型、替换语义、点击行为、三端呈现差异），不含一次性任务步骤。

- [ ] **Step 1: 调用 wiki skill 创建页面**

通过 `wiki` skill 新建 `docs/wiki/features/prompt-completion-notifications.md`，内容要点（均为 scope 已确认结论）：

- 功能边界：prompt 完成通知，触发条件（页面不可见或查看其他会话时 `prompt_done` 弹出），四种状态都弹、视觉三类（成功绿/失败红/停止灰）。
- 统一内容模型：标题=会话标题；正文=回复预览（Hub 在 `prompt_done` param 的 `replyPreview` 提供，清洗后尾部 160 字符；失败时兜底 error message）；预览为空回落状态短语；状态差异由图标/颜色承担。
- 同会话替换：替换键 `projectId:sessionId`，新通知替换旧内容并重新提醒。
- 点击行为：聚焦应用 + 跳转对应会话，三端一致。
- 平台呈现：PWA=service worker 通知（PNG 图标、tag、renotify、正文符号前缀）；APK=NotificationCompat（`ic_notification` 单色小图标、渠道 `chat_prompt_completion`、setColor、深链 PendingIntent）；exe=Go 自绘 Win32 置顶小窗（topmost/toolwindow/noactivate，点击 Eval 回传），不走 WebView2 通知管道、不需要系统通知权限。
- 兼容：`replyPreview` 为可选增量字段，旧客户端忽略。

- [ ] **Step 2: Git checkpoint**

调用 `git-workflow` checkpoint，提交本任务 wiki 文件。

---

### Task 2: Hub 在 prompt_done 嵌入 replyPreview

**Files:**
- Modify: `server/internal/protocol/session_turn.go`（`SessionTurnPromptResult` 加字段）
- Modify: `server/internal/hub/client/session.go`（预览构造 + recordPromptDone/结果路径嵌入）
- Modify: `server/internal/hub/client/session_recorder.go`（parseSessionViewEvent 透传字段）
- Test: `server/internal/hub/client/client_test.go`

**Acceptance:** completed 的 `prompt_done` param 含清洗后的 `replyPreview`；failed 无回复文本时 `replyPreview` = error message；旧字段与行为不回归。

- [ ] **Step 1: 写失败测试**

在 `client_test.go` 追加（参考现有 `TestPromptDoneIsPublishedAsFinishedRealTurn` 的驱动方式，约 client_test.go:5369）：

```go
func TestBuildPromptReplyPreview(t *testing.T) {
	long := strings.Repeat("word ", 60)
	cases := []struct{ name, raw, want string }{
		{"collapses whitespace", "line one\n\n  line\t two", "line one line two"},
		{"strips markdown", "## Title\n- **bold** and `code`\n[link](https://x.y)", "Title bold and code link"},
		{"drops fenced code markers", "```go\nfmt.Println()\n```", "fmt.Println()"},
		{"plain short text unchanged", "Done, fixed the bug.", "Done, fixed the bug."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := buildPromptReplyPreview(tc.raw); got != tc.want {
				t.Fatalf("buildPromptReplyPreview(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
	t.Run("keeps the tail of long replies", func(t *testing.T) {
		got := buildPromptReplyPreview(long)
		if !strings.HasPrefix(got, "…") || !strings.HasSuffix(got, "word") {
			t.Fatalf("tail preview = %q", got)
		}
		if n := len([]rune(got)); n > 170 {
			t.Fatalf("preview too long: %d runes", n)
		}
	})
	t.Run("empty for whitespace only", func(t *testing.T) {
		if got := buildPromptReplyPreview(" \n\t "); got != "" {
			t.Fatalf("got %q, want empty", got)
		}
	})
}
```

再追加事件级测试：prompt 流出两段 assistant chunk（含 markdown 与换行）后正常结束，断言发布的 `prompt_done` param 的 `replyPreview` 等于清洗后的拼接文本；失败路径（无 chunk，`recordPromptFailed("boom")`）断言 `replyPreview == "boom"`。驱动方式完全复用 `TestPromptDoneIsPublishedAsFinishedRealTurn` 的 fake agent harness。

- [ ] **Step 2: 运行测试确认 RED**

Run: `cd server && go test ./internal/hub/client/ -run 'TestBuildPromptReplyPreview|TestPromptDoneIncludesReplyPreview' -v`
Expected: 编译失败/断言失败（函数与字段尚不存在）。

- [ ] **Step 3: 实现**

`server/internal/protocol/session_turn.go` 的 `SessionTurnPromptResult` 增加：

```go
ReplyPreview string `json:"replyPreview,omitempty"`
```

`server/internal/hub/client/session.go` 增加（regex 包级变量 + 函数）：

```go
const promptReplyPreviewMaxRunes = 160

var (
	promptPreviewLinkPattern    = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	promptPreviewMarkerPattern  = regexp.MustCompile("[*_~`]+")
	promptPreviewLinePrefix     = regexp.MustCompile(`^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)`)
	promptPreviewFenceLine      = regexp.MustCompile("(?m)^\\s*```.*$")
	promptPreviewWhitespaceRuns = regexp.MustCompile(`\s+`)
)

// buildPromptReplyPreview collapses an assistant reply into a single-line
// notification preview, keeping the tail so the final summary survives.
func buildPromptReplyPreview(raw string) string {
	withoutFences := promptPreviewFenceLine.ReplaceAllString(raw, "")
	lines := strings.Split(withoutFences, "\n")
	for i, line := range lines {
		lines[i] = promptPreviewLinePrefix.ReplaceAllString(line, "")
	}
	joined := strings.Join(lines, " ")
	linked := promptPreviewLinkPattern.ReplaceAllString(joined, "$1")
	plain := promptPreviewMarkerPattern.ReplaceAllString(linked, "")
	cleaned := promptPreviewWhitespaceRuns.ReplaceAllString(plain, " ")
	cleaned = strings.TrimSpace(cleaned) // boundary normalization of agent-sourced text
	if cleaned == "" {
		return ""
	}
	runes := []rune(cleaned)
	if len(runes) <= promptReplyPreviewMaxRunes {
		return cleaned
	}
	tail := string(runes[len(runes)-promptReplyPreviewMaxRunes:])
	if idx := strings.IndexByte(tail, ' '); idx >= 0 && idx+1 < len(tail) {
		tail = tail[idx+1:]
	}
	return "…" + tail
}
```

调用点改动（session.go）：

1. `recordPromptDone(stopReason, message string)` 改为 `recordPromptDone(stopReason, message, replyPreview string)`，result 中 `ReplyPreview: firstNonEmpty(replyPreview, message)`（failed 兜底 message）；全部调用点编译器驱动更新：流内取消点（现 1662 行）传 `buildPromptReplyPreview(buf.String())`，流外早失败点传 `""`。
2. `recordPromptFailed(message string)` 改为 `recordPromptFailed(message, replyPreview string)`；流内两个失败点（现 1676/1678 行）传 `buildPromptReplyPreview(buf.String())`，其余传 `""`。
3. 成功结果路径（现 1718 行）`acp.SessionTurnPromptResult{...}` 增加 `ReplyPreview: buildPromptReplyPreview(buf.String())`。

`session_recorder.go` 的 `parseSessionViewEvent`（现 1890 行）重组 struct 时透传：`ReplyPreview: promptResult.ReplyPreview`（构造时已清洗，不再二次清洗）。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `cd server && go test ./internal/hub/client/ -run 'TestBuildPromptReplyPreview|TestPromptDoneIncludesReplyPreview' -v`
Expected: PASS。

- [ ] **Step 5: 回归**

Run: `cd server && go build ./... && go test ./internal/protocol/ ./internal/hub/client/`
Expected: PASS。

- [ ] **Step 6: Git checkpoint**

`git-workflow` checkpoint，只提交本任务三个源文件 + client_test.go。

---

### Task 3: Web 统一 payload 与组装规则

**Files:**
- Modify: `app/web/src/notifications/notificationPayload.ts`
- Modify: `app/web/src/chat/notifications/promptCompletionNotification.ts`
- Test: `app/__tests__/web-prompt-completion-notifications.test.ts`

**Acceptance:** payload 新增 `preview`、`tag`；`body` = 预览或状态短语（不含符号，符号由 PWA SW 按 status 加）；旧 Hub（无 replyPreview）failed 时 body = error message；完成键/替换键规则一致。

- [ ] **Step 1: 改写测试（新契约）**

`web-prompt-completion-notifications.test.ts` 中替换 “privacy-preserving payload” 用例为新契约用例：

```ts
test('builds IM-style payload with reply preview and session tag', () => {
  const promptDone = message('prompt_done', 9, {
    stopReason: 'end_turn',
    replyPreview: 'Fixed the login bug and added tests',
  });
  const payload = buildPromptCompletionNotification({
    message: promptDone,
    projectId: 'proj-1',
    session,
  });
  expect(payload).toMatchObject({
    type: 'chat.prompt.completed',
    status: 'completed',
    title: 'Build Android',
    preview: 'Fixed the login bug and added tests',
    body: 'Fixed the login bug and added tests',
    tag: 'proj-1:sess-1',
  });
  expect(payload.url).toContain('wmProjectId=proj-1');
});

test('falls back to status phrase when no preview, and to error message for failed', () => {
  const done = buildPromptCompletionNotification({
    message: message('prompt_done', 10, {stopReason: 'end_turn'}),
    projectId: 'proj-1',
    session,
  });
  expect(done.body).toBe('Prompt completed');
  expect(done.preview).toBe('');

  const failedOldHub = buildPromptCompletionNotification({
    message: message('prompt_done', 11, {stopReason: 'failed', message: 'agent crashed'}),
    projectId: 'proj-1',
    session,
  });
  expect(failedOldHub.status).toBe('failed');
  expect(failedOldHub.body).toBe('agent crashed');
});

test('status phrase covers cancelled and interrupted', () => {
  expect(promptCompletionStatusPhrase('cancelled')).toBe('Prompt cancelled');
  expect(promptCompletionStatusPhrase('interrupted')).toBe('Prompt interrupted');
  expect(promptCompletionStatusPhrase('failed')).toBe('Prompt failed');
  expect(promptCompletionStatusPhrase('completed')).toBe('Prompt completed');
});
```

并修正 “uses the same resolved session title...” 用例：`payload.title` 仍为解析后的会话标题，`payload.body` 为 `'Prompt completed'`（无 preview 回落），`payload.tag === 'proj-1:sess-1'`。

- [ ] **Step 2: 运行确认 RED**

Run: `cd app && npm test -- --runTestsByPath __tests__/web-prompt-completion-notifications.test.ts`
Expected: FAIL（preview/tag 字段与新函数不存在）。

- [ ] **Step 3: 实现**

`notificationPayload.ts`：

```ts
export type WheelMakerNotificationPayload = {
  type: WheelMakerNotificationType;
  projectId: string;
  sessionId: string;
  turnIndex: number;
  title: string;
  body: string;
  preview: string;
  status: PromptCompletionNotificationStatus;
  tag: string;
  url: string;
};
```

`promptCompletionNotification.ts`：

- `notificationTitle` 改名导出为 `promptCompletionStatusPhrase`（文案不变），内部调用点同步。
- 新增 `promptCompletionSessionKey(projectId, sessionId)` 返回 `` `${projectId}:${sessionId}` ``。
- `buildPromptCompletionNotification`：

```ts
const preview = typeof message.param.replyPreview === 'string' ? message.param.replyPreview : '';
const fallback = status === 'failed' && typeof message.param.message === 'string' ? message.param.message : '';
const resolvedPreview = preview || fallback;
// ...
return {
  type: 'chat.prompt.completed',
  projectId, sessionId, turnIndex,
  title: sessionTitle,
  body: resolvedPreview || promptCompletionStatusPhrase(status),
  preview: resolvedPreview,
  status,
  tag: promptCompletionSessionKey(projectId, sessionId),
  url: `/?wmProjectId=...` /* 现状不变 */,
};
```

- [ ] **Step 4: 运行确认 GREEN + 关联回归**

Run: `cd app && npm test -- --runTestsByPath __tests__/web-prompt-completion-notifications.test.ts __tests__/web-notification-provider.test.ts`
Expected: prompt-completion PASS；provider 测试若因 payload 类型多了必填字段报错，则在该测试的 payload 字面量补 `preview: ''`、`tag: 'proj-1:sess-1'`（仅此机械修正）。

- [ ] **Step 5: Git checkpoint**

`git-workflow` checkpoint 本任务文件。

---

### Task 4: Web desktop provider 与 provider 选择顺序

**Files:**
- Create: `app/web/src/platform/desktop/desktopNotificationBridge.ts`
- Modify: `app/web/src/platform/desktop/desktopRuntime.ts`（bridge 类型加 `showNotification`）
- Modify: `app/web/src/notifications/NotificationProvider.ts`（desktop provider 接入，顺序 android → desktop → pwa → unsupported）
- Test: `app/__tests__/web-notification-provider.test.ts`

**Acceptance:** `WheelMakerDesktop` 且带 `showNotification` 时选中 desktop provider；权限恒 granted；show 序列化 JSON 调用 bridge 并解析 ok。

- [ ] **Step 1: 写失败测试**

在 `web-notification-provider.test.ts` 追加：

```ts
test('prefers desktop bridge over pwa when WheelMakerDesktop exposes showNotification', async () => {
  const calls: string[] = [];
  const provider = createNotificationProvider({
    WheelMakerDesktop: {
      enabled: true,
      showNotification: (raw: string) => {
        calls.push(raw);
        return JSON.stringify({ok: true});
      },
    },
    isSecureContext: true,
    Notification: {permission: 'granted'},
    navigator: {serviceWorker: {getRegistration: async () => null}},
  } as any);

  expect(provider.kind).toBe('desktop');
  await expect(provider.getPermissionState()).resolves.toBe('granted');
  await expect(provider.requestPermission()).resolves.toBe('granted');
  await expect(provider.show(payload)).resolves.toBe(true);
  expect(JSON.parse(calls[0])).toMatchObject({type: 'chat.prompt.completed', tag: 'proj-1:sess-1'});
});

test('desktop show returns false on bridge failure and malformed results', async () => {
  const failing = createNotificationProvider({
    WheelMakerDesktop: {enabled: true, showNotification: () => { throw new Error('gone'); }},
  } as any);
  await expect(failing.show(payload)).resolves.toBe(false);

  const malformed = createNotificationProvider({
    WheelMakerDesktop: {enabled: true, showNotification: () => 'not-json'},
  } as any);
  await expect(malformed.show(payload)).resolves.toBe(false);
});

test('ignores desktop bridge without showNotification and falls through to pwa', () => {
  const provider = createNotificationProvider({
    WheelMakerDesktop: {enabled: true},
    isSecureContext: true,
    Notification: {permission: 'granted'},
    navigator: {serviceWorker: {getRegistration: async () => null}},
  } as any);
  expect(provider.kind).toBe('pwa');
});
```

- [ ] **Step 2: 运行确认 RED**

Run: `cd app && npm test -- --runTestsByPath __tests__/web-notification-provider.test.ts`
Expected: FAIL（kind 无 desktop / 未选 desktop）。

- [ ] **Step 3: 实现**

`desktopRuntime.ts` 的 `DesktopWindowBridge` 增加：

```ts
showNotification?: (rawJson: string) => Promise<string> | string;
```

新建 `desktopNotificationBridge.ts`：

```ts
import type { DesktopWindowBridge } from './desktopRuntime';

export function createDesktopNotificationProvider(bridge: DesktopWindowBridge) {
  return {
    kind: 'desktop' as const,
    isSupported: () => typeof bridge.showNotification === 'function',
    getPermissionState: async () => 'granted' as const,
    requestPermission: async () => 'granted' as const,
    show: async (payload: unknown): Promise<boolean> => {
      if (typeof bridge.showNotification !== 'function') return false;
      try {
        const raw = await bridge.showNotification(JSON.stringify(payload));
        const parsed = JSON.parse(typeof raw === 'string' ? raw : '{}') as { ok?: boolean };
        return parsed.ok === true;
      } catch {
        return false;
      }
    },
  };
}
```

`NotificationProvider.ts`：`WheelMakerNotificationProvider.kind` 联合类型加 `'desktop'`；`NotificationProviderEnv` 加 `WheelMakerDesktop?: DesktopWindowBridge`；`createNotificationProvider` 在 android 分支之后插入：

```ts
const desktopBridge = env.WheelMakerDesktop;
if (desktopBridge?.enabled === true) {
  const desktopProvider = createDesktopNotificationProvider(desktopBridge);
  if (desktopProvider.isSupported()) {
    return desktopProvider;
  }
}
```

- [ ] **Step 4: 运行确认 GREEN**

Run: `cd app && npm test -- --runTestsByPath __tests__/web-notification-provider.test.ts`
Expected: PASS。

- [ ] **Step 5: Git checkpoint**

`git-workflow` checkpoint 本任务文件。

---

### Task 5: Web 跳转会话运行时入口 + SW 消息监听

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`（抽取运行时跳转入口、注册 exe Eval 事件与 SW message 监听）
- Modify: `app/web/src/chat/notifications/promptCompletionNotification.ts`（URL→会话键解析 helper，可测试）
- Test: `app/__tests__/web-prompt-completion-notifications.test.ts`

**Acceptance:** 运行中收到 `wheelmaker:desktop-notification-click` 或 SW `WM_NOTIFICATION_NAVIGATE` 时，复用 `applyPendingNotificationTarget` 链路跳转到对应会话；启动时 URL 深链行为不变。

- [ ] **Step 1: 写失败测试（helper）**

`web-prompt-completion-notifications.test.ts` 追加：

```ts
test('parses chat session key from notification urls', () => {
  expect(chatSessionKeyFromNotificationUrl('/?wmProjectId=proj-1&wmSessionId=sess-1'))
    .toEqual({projectId: 'proj-1', sessionId: 'sess-1'});
  expect(chatSessionKeyFromNotificationUrl('/')).toBeNull();
  expect(chatSessionKeyFromNotificationUrl('not a url')).toBeNull();
});
```

- [ ] **Step 2: 运行确认 RED**

Run: `cd app && npm test -- --runTestsByPath __tests__/web-prompt-completion-notifications.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`promptCompletionNotification.ts` 新增（`ChatSessionKey`/`chatSessionKeyFromParts` 复用 WorkspaceApp 现有 import 来源 `../session/...`，按现有 import 路径）：

```ts
export function chatSessionKeyFromNotificationUrl(rawUrl: string): ChatSessionKey | null {
  let url: URL;
  try {
    url = new URL(rawUrl, 'https://wheelmaker.invalid');
  } catch {
    return null;
  }
  return chatSessionKeyFromParts(
    url.searchParams.get('wmProjectId') ?? '',
    url.searchParams.get('wmSessionId') ?? '',
  );
}
```

`WorkspaceApp.tsx`：

1. 在 `applyPendingNotificationTarget` 旁新增：

```ts
const requestChatSessionJump = (target: ChatSessionKey | null) => {
  if (!target) {
    return;
  }
  pendingNotificationTargetRef.current = target;
  applyPendingNotificationTarget().catch(() => undefined);
};
```

2. 新增 effect（与现有启动 effect 并列）：

```ts
useEffect(() => {
  const onDesktopNotificationClick = (event: Event) => {
    const detail = (event as CustomEvent<{projectId?: string; sessionId?: string}>).detail;
    requestChatSessionJump(chatSessionKeyFromParts(detail?.projectId ?? '', detail?.sessionId ?? ''));
  };
  window.addEventListener('wheelmaker:desktop-notification-click', onDesktopNotificationClick);
  const serviceWorker = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  const onServiceWorkerMessage = (event: MessageEvent) => {
    if (event.data?.type !== 'WM_NOTIFICATION_NAVIGATE') {
      return;
    }
    requestChatSessionJump(chatSessionKeyFromNotificationUrl(String(event.data.url ?? '')));
  };
  serviceWorker?.addEventListener('message', onServiceWorkerMessage);
  return () => {
    window.removeEventListener('wheelmaker:desktop-notification-click', onDesktopNotificationClick);
    serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
  };
}, []);
```

3. `readPromptCompletionNotificationTarget` 保持现状（启动深链路径不变）。

- [ ] **Step 4: 运行确认 GREEN + 类型检查**

Run: `cd app && npm test -- --runTestsByPath __tests__/web-prompt-completion-notifications.test.ts && npx tsc --noEmit`
Expected: PASS / 无类型错误。

- [ ] **Step 5: Git checkpoint**

`git-workflow` checkpoint 本任务文件。

---

### Task 6: PWA 图标 PNG + service worker 修复

**Files:**
- Create: `app/web/public/icons/icon-192.png`（由 icon.svg 渲染）
- Create: `app/web/public/icons/badge-96.png`（白色单色剪影）
- Modify: `app/web/public/service-worker.js`
- Test: `app/__tests__/web-notification-provider.test.ts`（追加 SW 源码断言，沿用该文件已有 fs 断言风格）

**Acceptance:** SW 使用 PNG icon/badge；同会话 `tag`+`renotify` 替换；notificationclick 同源聚焦 + postMessage，无客户端时 openWindow；缓存版本升级。

- [ ] **Step 1: 写失败测试（源码断言）**

`web-notification-provider.test.ts` 追加：

```ts
test('service worker uses png icons, session tag replacement and origin-focus click', () => {
  const root = path.resolve(__dirname, '..');
  const sw = fs.readFileSync(path.join(root, 'web/public/service-worker.js'), 'utf8');
  expect(sw).toContain("'/icons/icon-192.png'");
  expect(sw).toContain("'/icons/badge-96.png'");
  expect(sw).toContain('renotify');
  expect(sw).toContain('payload.tag');
  expect(sw).toContain('WM_NOTIFICATION_NAVIGATE');
  expect(sw).not.toContain('client.url === targetUrl');
  expect(fs.existsSync(path.join(root, 'web/public/icons/icon-192.png'))).toBe(true);
  expect(fs.existsSync(path.join(root, 'web/public/icons/badge-96.png'))).toBe(true);
});
```

- [ ] **Step 2: 运行确认 RED**

Run: `cd app && npm test -- --runTestsByPath __tests__/web-notification-provider.test.ts`
Expected: FAIL。

- [ ] **Step 3: 生成 PNG 资源**

```powershell
cd app
node scripts/render_svg_icon.js web/public/icons/icon.svg web/public/icons/icon-192.png 192
node -e "const fs=require('fs');let s=fs.readFileSync('web/public/icons/icon-mark.svg','utf8');s=s.replace(/fill=\"url\(#g(?:Blue|Orange)\)\"/g,'fill=\"#FFFFFF\"');fs.writeFileSync('web/public/icons/.badge-tmp.svg',s)"
node scripts/render_svg_icon.js web/public/icons/.badge-tmp.svg web/public/icons/badge-96.png 96
Remove-Item web/public/icons/.badge-tmp.svg
```

渲染后 Read 两张 PNG 目检（icon-192 为完整图标；badge-96 为白色剪影、透明底）。

- [ ] **Step 4: 改写 service-worker.js**

- `CACHE_NAME` → `'wheelmaker-web-pwa-v9'`；`ICON_ASSETS` 改为 `['/icons/icon.svg', '/icons/icon-192.png', '/icons/badge-96.png']`。
- `showLocalNotification`：

```js
const STATUS_SYMBOL = { completed: '✓', failed: '✗', cancelled: '■', interrupted: '■' };

function showLocalNotification(payload = {}) {
  const title = payload.title || 'WheelMaker';
  const rawBody = payload.body || 'You have new updates';
  const symbol = STATUS_SYMBOL[payload.status] || '';
  const body = symbol ? `${symbol} ${rawBody}` : rawBody;
  const url = payload.url || '/';
  return self.registration.showNotification(title, {
    body,
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/badge-96.png',
    tag: payload.tag || undefined,
    renotify: Boolean(payload.tag),
    data: { url },
  });
}
```

- `notificationclick` 改为同源聚焦：

```js
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        for (const client of windowClients) {
          if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
            client.postMessage({ type: 'WM_NOTIFICATION_NAVIGATE', url: targetUrl });
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
        return undefined;
      }),
  );
});
```

- [ ] **Step 5: 运行确认 GREEN**

Run: `cd app && npm test -- --runTestsByPath __tests__/web-notification-provider.test.ts`
Expected: PASS。

- [ ] **Step 6: Git checkpoint**

`git-workflow` checkpoint 本任务文件（含两张 PNG）。

---

### Task 7: Desktop binding、policy 授权与 init 脚本

**Files:**
- Modify: `server/cmd/wheelmaker-desktop/desktop_bridge.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_policy.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows.go`
- Test: `server/cmd/wheelmaker-desktop/webview_policy_test.go`、`server/cmd/wheelmaker-desktop/app_test.go`（init 脚本断言按现有归属文件选择）

**Acceptance:** 受信页面注入的 `WheelMakerDesktop` 含 `showNotification`；policy 在 trusted remote/localhost/localdev 三种模式授权 `desktopBridgeShowNotification`；bootstrap 页面不授权。

- [ ] **Step 1: 写失败测试**

`webview_policy_test.go` 追加：三种 trusted 模式 `AllowsBridge(mode, 合法URL, true, desktopBridgeShowNotification)` 为 true；`desktopBootstrapPage` 与非受信 URL 为 false。

init 脚本断言（找现有断言 `desktopRuntimeInitScript` 的测试文件，追加）：脚本包含 `showNotification: invoke('__wheelMakerDesktopShowNotification')`（trusted 与 localdev 两个对象字面量各一次，断言出现次数 ≥2）。

- [ ] **Step 2: 运行确认 RED**

Run: `cd server && go test ./cmd/wheelmaker-desktop/ -run 'Notification|InitScript' -v`
Expected: FAIL。

- [ ] **Step 3: 实现**

- `desktop_bridge.go`：const 增加 `desktopShowNotificationBinding = "__wheelMakerDesktopShowNotification"`；`desktopRuntimeInitScript` 的 trusted 对象与 localdev 对象各加一行 `showNotification: invoke('` + desktopShowNotificationBinding + `'),`。
- `webview_policy.go`：`desktopBridgeAction` 枚举末尾加 `desktopBridgeShowNotification`；`AllowsBridge` 的 trusted switch 与 localdev switch 各加入该 action；bootstrap 白名单不加。
- `webview_windows.go`：`bindDesktopWindowBridge` bindings 追加：

```go
{desktopShowNotificationBinding, func(raw string) (string, error) {
	if err := authorize(desktopBridgeShowNotification); err != nil {
		return "", err
	}
	return notifications.show(raw),
}},
```

`notifications` 为 Task 8 的 `*desktopNotificationCenter`，在 `Launch` 中创建、`defer notifications.close()`，作为新参数传入 `bindDesktopWindowBridge(w, hwnd, opts.Runtime, notifications)`。

- [ ] **Step 4: 运行确认 GREEN + 包级回归**

Run: `cd server && go test ./cmd/wheelmaker-desktop/`
Expected: PASS（Task 8 的 center 未落地前，可先用占位 `show` 返回 `{"ok":false,"error":"unavailable"}` 保证编译；Task 8 完成后占位被替换——若按 Task 7→8 顺序执行，此处允许该占位，Task 8 Step 中移除）。

- [ ] **Step 5: Git checkpoint**

`git-workflow` checkpoint 本任务文件。

---

### Task 8: Desktop 自绘通知小窗

**Files:**
- Create: `server/cmd/wheelmaker-desktop/desktop_notification_windows.go`
- Create: `server/cmd/wheelmaker-desktop/desktop_notification_windows_test.go`（新组件，比照 desktop_maximize_windows.go ↔ _test.go 的既有配对模式）
- Modify: `server/cmd/wheelmaker-desktop/webview_windows.go`（Task 7 占位替换为真实 center）

**Acceptance:** `show(rawJSON)` 校验并按会话键归并；小窗右下角堆叠、5 秒自动消失；点击聚焦主窗口（最小化则还原）并 Eval 派发 `wheelmaker:desktop-notification-click`；逻辑层（解析、归并、布局、动作计划）单测覆盖。

- [ ] **Step 1: 写失败测试（逻辑层，fake ops）**

`desktop_notification_windows_test.go`：

```go
type fakeNotificationOps struct {
	created   []uintptr
	destroyed []uintptr
	updated   []string // session keys repainted
	timers    []uint32
	focused   int
	evaled    []string
	workArea  desktopWindowRect // e.g. {0, 0, 1920, 1040}
	nextHwnd  uintptr
}
// fake 实现：createWindow 返回自增 hwnd 并记录 rect；其余记录调用。

func TestParseDesktopNotification(t *testing.T) {
	n, err := parseDesktopNotification(`{"type":"chat.prompt.completed","projectId":"p1","sessionId":"s1","title":"Fix bug","body":"done","status":"completed"}`)
	if err != nil || n.Key != "p1:s1" || n.Title != "Fix bug" || n.Body != "done" || n.Status != "completed" {
		t.Fatalf("parse = %+v, %v", n, err)
	}
	for _, raw := range []string{
		`{"type":"chat.prompt.completed","projectId":"","sessionId":"s1"}`,
		`{"type":"other","projectId":"p1","sessionId":"s1"}`,
		`not-json`,
	} {
		if _, err := parseDesktopNotification(raw); err == nil {
			t.Fatalf("parseDesktopNotification(%s) expected error", raw)
		}
	}
}

func TestNotificationCenterCoalescesBySessionKey(t *testing.T) {
	ops := &fakeNotificationOps{workArea: desktopWindowRect{0, 0, 1920, 1040}}
	c := newDesktopNotificationCenterForTest(ops)
	c.show(`{"type":"chat.prompt.completed","projectId":"p1","sessionId":"s1","title":"A","body":"one","status":"completed"}`)
	c.show(`{"type":"chat.prompt.completed","projectId":"p1","sessionId":"s1","title":"A","body":"two","status":"completed"}`)
	if len(ops.created) != 1 {
		t.Fatalf("created = %d, want 1", len(ops.created))
	}
	if len(ops.updated) != 1 || len(ops.timers) != 2 {
		t.Fatalf("updated = %v, timers = %v, want 1 update and 2 timer resets", ops.updated, ops.timers)
	}
}

func TestNotificationCenterClickFocusesEvalsAndDismisses(t *testing.T) {
	ops := &fakeNotificationOps{workArea: desktopWindowRect{0, 0, 1920, 1040}}
	c := newDesktopNotificationCenterForTest(ops)
	c.show(`{"type":"chat.prompt.completed","projectId":"p1","sessionId":"s1","title":"A","body":"b","status":"completed"}`)
	c.handleClick(ops.created[0])
	if ops.focused != 1 {
		t.Fatalf("focused = %d, want 1", ops.focused)
	}
	if len(ops.evaled) != 1 || !strings.Contains(ops.evaled[0], "wheelmaker:desktop-notification-click") ||
		!strings.Contains(ops.evaled[0], `"p1"`) || !strings.Contains(ops.evaled[0], `"s1"`) {
		t.Fatalf("evaled = %v", ops.evaled)
	}
	if len(ops.destroyed) != 1 {
		t.Fatalf("destroyed = %v, want the clicked window", ops.destroyed)
	}
}

func TestNotificationCenterStacksNewestAtBottom(t *testing.T) {
	// show two different sessions; assert second window bottom edge == workArea.bottom - margin,
	// first window sits above it by height+gap; after dismissing the second, the first reflows down.
}

func TestNotificationCenterCloseDestroysAll(t *testing.T) {
	// show two, close(), assert destroyed contains both hwnds
}
```

- [ ] **Step 2: 运行确认 RED**

Run: `cd server && go test ./cmd/wheelmaker-desktop/ -run 'NotificationCenter|ParseDesktopNotification' -v`
Expected: 编译失败。

- [ ] **Step 3: 实现 desktop_notification_windows.go**

结构（逻辑/平台分离，ops 接口为测试缝）：

```go
//go:build windows

package main

type desktopNotification struct {
	Key       string // projectId:sessionId
	ProjectID string
	SessionID string
	Title     string
	Body      string
	Status    string // completed | failed | cancelled | interrupted
}

func parseDesktopNotification(raw string) (desktopNotification, error) {
	// json decode; require type == "chat.prompt.completed", non-blank projectId/sessionId
	// title fallback "WheelMaker"; body fallback "Prompt completed"
}

type desktopNotificationOps interface {
	workArea() (desktopWindowRect, bool)              // monitor of the main window
	createWindow(state *desktopNotificationWindowState, rect desktopWindowRect) (uintptr, error)
	repositionWindow(hwnd uintptr, rect desktopWindowRect)
	repaintWindow(hwnd uintptr)
	resetDismissTimer(hwnd uintptr, milliseconds uint32)
	destroyWindow(hwnd uintptr)
	focusMainWindow()
	evalScript(script string)
}

type desktopNotificationWindowState struct {
	notification desktopNotification
	hwnd         uintptr
	rect         desktopWindowRect
}

type desktopNotificationCenter struct {
	mainHwnd uintptr
	ops      desktopNotificationOps
	mu       sync.Mutex
	order    []string // session keys, bottom-most (newest) last
	byKey    map[string]*desktopNotificationWindowState
}

func newDesktopNotificationCenter(mainHwnd uintptr, eval func(script string)) *desktopNotificationCenter
	// 生产构造：内部组装 win32DesktopNotificationOps{mainHwnd, eval}
func newDesktopNotificationCenterWithOps(ops desktopNotificationOps) *desktopNotificationCenter
	// 测试构造：直接注入 fake ops（测试里的 newDesktopNotificationCenterForTest 即此函数）

func (c *desktopNotificationCenter) show(raw string) string         // parse + upsert; returns {"ok":...} JSON
func (c *desktopNotificationCenter) handleClick(hwnd uintptr)        // focus + eval + dismiss
func (c *desktopNotificationCenter) handleTimer(hwnd uintptr)        // dismiss
func (c *desktopNotificationCenter) dismiss(key string)              // destroy + reflow remaining upward
func (c *desktopNotificationCenter) close()                          // destroy all
```

布局常量与规则：逻辑宽度 360px、高度 88px、间距 8px、右边距 12px、下边距 12px，全部按 `GetDpiForWindow(主窗口)/96` 缩放；锚定主窗口所在显示器 work area 右下角；新通知在通知栈最底部（最新最靠下），关闭时其余下移补齐；数量超出 work area 高度时销毁最旧。

win32 实现（`win32DesktopNotificationOps`）：

- 窗口类一次性注册（`RegisterClassExW`，proc = `windows.NewCallback(desktopNotificationWndProc)`），类名常量 `"WheelMakerDesktopNotification"`。
- `CreateWindowExW(WS_EX_TOPMOST|WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE, class, "", WS_POPUP, ...)`；创建后 `SetWindowRgn(CreateRoundRectRgn(..., 16dpi, 16dpi))`；`GWLP_USERDATA` 存 `*desktopNotificationWindowState`。
- `WM_PAINT`：`BeginPaint` → 深色底（`#202226`，`CreateSolidBrush`+`FillRect`）→ 状态色点（`Ellipse`，颜色 completed `#34C759` / failed `#FF453A` / 其余 `#8E8E93`，复用 `parseColorRef`）→ 标题（`DrawTextW`，bold `CreateFontW` "Segoe UI" 13px 逻辑）→ 正文（`DrawTextW` + `DT_WORDBREAK|DT_END_ELLIPSIS|DT_NOPREFIX`，常规字体，最多两行区域）→ `EndPaint`；GDI 对象用后即 `DeleteObject`。
- `WM_TIMER`（`SetTimer(hwnd, 1, 5000)`）：调 center.handleTimer。
- `WM_LBUTTONUP`：调 center.handleClick。
- `focusMainWindow`：`IsIconic` 时 `ShowWindow(SW_RESTORE)`；`GetForegroundWindow`→`GetWindowThreadProcessId` 取前台线程，`AttachThreadInput` 挂接后 `SetForegroundWindow(mainHwnd)` 再分离（标准前置窗口手法），最后 `SetActiveWindow`。
- `evalScript` 脚本（JSON 经 `strconv.Quote`）：

```js
window.dispatchEvent(new CustomEvent('wheelmaker:desktop-notification-click', {detail: {projectId: "...", sessionId: "..."}}));
```

新增 user32/gdi32 procs 就近放在 `win32_window_windows.go`（RegisterClassExW/CreateWindowExW/DestroyWindow/SetTimer/KillTimer/BeginPaint/EndPaint/SetWindowRgn/IsIconic/SetForegroundWindow/GetForegroundWindow/AttachThreadInput/GetWindowThreadProcessId/SetActiveWindow）与 gdi32 新建 proc 块（CreateSolidBrush/FillRect 走 user32/DrawTextW/CreateFontW/Ellipse/CreateRoundRectRgn/SelectObject/DeleteObject/SetBkMode/SetTextColor/GetDpiForWindow 属 user32）。

- [ ] **Step 4: 接入 Launch 并替换占位**

`Launch`：`notifications := newDesktopNotificationCenter(hwnd, win32DesktopNotificationOps{...})`（hwnd 在 window 创建后），`defer notifications.close()`，传入 `bindDesktopWindowBridge`。移除 Task 7 占位。

- [ ] **Step 5: 运行确认 GREEN + 回归**

Run: `cd server && go test ./cmd/wheelmaker-desktop/ && go build ./...`
Expected: PASS。

- [ ] **Step 6: 实机冒烟（人工证据）**

`go run ./cmd/wheelmaker-desktop` 启动，开两个会话跑 prompt：窗口最小化时右下角弹小窗、同会话替换、点击聚焦并跳会话。截图/文字记录结果。

- [ ] **Step 7: Git checkpoint**

`git-workflow` checkpoint 本任务文件。

---

### Task 9: APK 单色小图标 + 通知收敛 + setColor

**Files:**
- Create: `mobile/android/app/src/main/res/drawable/ic_notification.xml`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidNotificationRuntime.kt`
- Test: `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidNotificationRuntimeTest.kt`

**Acceptance:** smallIcon 为透明底单色 vector；通知 ID 不含 turnIndex（同会话原地更新）；按 status setColor；深链与渠道不变。

- [ ] **Step 1: 写失败测试（源码断言，沿用该测试文件现有风格）**

```kotlin
@Test fun `uses monochrome notification icon and per-session notification id`() {
    val runtime = source("src/main/java/com/wheelmaker/android/AndroidNotificationRuntime.kt")
    assertTrue(runtime.contains("R.drawable.ic_notification"))
    assertFalse(runtime.contains("R.mipmap.ic_launcher"))
    assertTrue(runtime.contains("setColor("))
    val icon = source("src/main/res/drawable/ic_notification.xml")
    assertTrue(icon.contains("#FFFFFF"))
}

@Test fun `notification id drops the turn index`() {
    val runtime = source("src/main/java/com/wheelmaker/android/AndroidNotificationRuntime.kt")
    assertTrue(Regex("fun notificationId\\(projectId: String, sessionId: String\\)").containsMatchIn(runtime))
}
```

（`source(...)` 为该测试文件现有 helper；若现有断言引用了旧 ID 形态或 `ic_launcher`，同步更新。）

- [ ] **Step 2: 运行确认 RED**

Run: `gradle -p mobile/android testDebugUnitTest --tests "com.wheelmaker.android.AndroidNotificationRuntimeTest"`
Expected: FAIL。

- [ ] **Step 3: 实现**

`ic_notification.xml`：读取 `app/web/public/icons/icon-mark.svg` 的两个 chevron path，转为 vector drawable，group 用 `android:translateX="-160" android:translateY="-292"` 抵消 viewBox 偏移，填充 `#FFFFFF`：

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="927" android:viewportHeight="600">
    <group android:translateX="-160" android:translateY="-292">
        <path android:fillColor="#FFFFFF" android:pathData="M..."/>
        <path android:fillColor="#FFFFFF" android:pathData="M..."/>
    </group>
</vector>
```

`AndroidNotificationRuntime.kt`：

- `setSmallIcon(R.drawable.ic_notification)`
- `notificationId(projectId: String, sessionId: String)`（去 turnIndex；调用点同步）
- status 染色：

```kotlin
val accent = when (input.optString("status")) {
    "failed" -> 0xFFFF453A.toInt()
    "cancelled", "interrupted" -> 0xFF8E8E93.toInt()
    else -> 0xFF34C759.toInt()
}
// NotificationCompat.Builder ... .setColor(accent)
```

- [ ] **Step 4: 运行确认 GREEN**

Run: `gradle -p mobile/android testDebugUnitTest --tests "com.wheelmaker.android.AndroidNotificationRuntimeTest"`
Expected: PASS。

- [ ] **Step 5: 编译回归**

Run: `gradle -p mobile/android assembleDebug`
Expected: BUILD SUCCESSFUL（SDK 缺失等环境问题则记录证据并上报，不视为 RED）。

- [ ] **Step 6: Git checkpoint**

`git-workflow` checkpoint 本任务文件。

---

### Task 10: 全量验证与收尾

- [ ] **Step 1: server 全量** — `cd server && go build ./... && go test ./...`，Expected: PASS。
- [ ] **Step 2: app 全量** — `cd app && npm test`，Expected: PASS；`npm run build`（按 package.json 实际脚本名）确认 webpack 构建通过。
- [ ] **Step 3: 验收逐项核对** — 对照 spec「验收」清单逐项记录结果与证据（实机项以 Task 8 Step 6 与人工确认记录为准）。
- [ ] **Step 4: wiki 回顾** — 实施中产生的约定偏差补充进 `docs/wiki/features/prompt-completion-notifications.md`（仅限该已确认目标）。
- [ ] **Step 5: finalize** — 调用 `git-workflow` finalize，按偏好 push 当前分支、main 干净则合入并 push main、cleanup worktree。
