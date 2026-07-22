# Pin Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为活跃 Session 增加由 Hub 共享持久化的 Pin/Unpin 能力，在 project 完整列表中置顶，并统一桌面菜单、移动端长按菜单和 pinned 行尾图标交互。

**Architecture:** Registry `2.6` 保持不变，新增 project-scoped `session.pin`；Hub 把 `pinned` 写入现有 `sessions.session_sync_json` projection，不修改 SQLite schema；Web 规范化 summary 后只对 project 完整 Session 列表执行 pinned 分组排序，Recent 继续使用纯时间/候选规则；写操作以响应 summary 更新当前客户端且不广播实时事件。

**Tech Stack:** Go（Hub、Registry protocol、SQLite store tests），React/TypeScript（Registry repository/service、Workspace UI、CSS），Jest、Go test、Web TypeScript compiler、Webpack production build。

参考 spec：`docs/scope/2026-07-22-pin-session/spec-pin-session.md`

---

### Task 1: 固化已确认的 spec、wiki 与执行计划

**Files:**
- Add: `docs/scope/2026-07-22-pin-session/spec-pin-session.md`
- Add: `docs/scope/2026-07-22-pin-session/plan-pin-session.md`
- Add: `docs/wiki/frontend-interaction/session-list.md`
- Modify: `docs/wiki/frontend-interaction/frontend-interaction.md`

- [x] **Step 1: 检查文档范围与链接**

Run（仓库根目录）：

```powershell
rg -n "session\.pin|session_sync_json|Recent|移动端|2\.6" docs/scope/2026-07-22-pin-session docs/wiki/frontend-interaction/session-list.md
rg -n "session-list\.md" docs/wiki/frontend-interaction/frontend-interaction.md
```

Expected：spec、plan、session list wiki 均明确协议不升级、SQLite 不改 schema、Recent 不被 pin 排序、移动端从菜单执行；wiki 索引包含新页面。

- [x] **Step 2: 检查文档质量与 diff**

Run（仓库根目录）：

```powershell
rg -n "TODO|TBD|待定|placeholder|<fill-me>" docs/scope/2026-07-22-pin-session/spec-pin-session.md docs/wiki/frontend-interaction/session-list.md
git diff --check
```

Expected：第一条无输出；`git diff --check` 退出码为 0。

- [x] **Step 3: Commit**

```powershell
git add docs/scope/2026-07-22-pin-session docs/wiki/frontend-interaction/frontend-interaction.md docs/wiki/frontend-interaction/session-list.md
git commit -m "docs: specify shared session pinning"
```

---

### Task 2: Registry protocol 注册 `session.pin`，保持 2.6

**Files:**
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `app/web/src/registry/registryMethods.ts`
- Test: `app/__tests__/web-session-actions-service.test.ts`

- [x] **Step 1: 写 Go 协议失败测试**

在 `server/internal/protocol/registry_methods_test.go` 增加：

```go
func TestSessionPinIsClientProjectForwardWithoutVersionChange(t *testing.T) {
	if DefaultProtocolVersion != "2.6" {
		t.Fatalf("DefaultProtocolVersion = %q, want 2.6", DefaultProtocolVersion)
	}
	desc, ok := RegistryMethod(RegistryMethodSessionPin)
	if !ok {
		t.Fatal("session.pin descriptor missing")
	}
	if desc.Route != RegistryRouteSessionForward {
		t.Fatalf("session.pin route = %q, want %q", desc.Route, RegistryRouteSessionForward)
	}
	if !desc.RequiresProjectID {
		t.Fatal("session.pin must require projectId")
	}
	if !RegistryMethodAllowed(string(RegistryRoleClient), desc.Method) {
		t.Fatal("session.pin must allow client role")
	}
	if RegistryMethodAllowed(string(RegistryRoleHub), desc.Method) {
		t.Fatal("session.pin must not allow hub role")
	}
}
```

- [x] **Step 2: 运行测试确认失败**

Run（`server/`）：

```powershell
go test ./internal/protocol -run 'TestSessionPinIsClientProjectForwardWithoutVersionChange|TestRegistryDefaultProtocolVersionIs26' -v
```

Expected：编译或测试失败，因为 `RegistryMethodSessionPin` 尚未定义。

- [x] **Step 3: 注册服务端 method**

在 `registry_methods.go` 的 Session 常量和 descriptor map 中分别加入：

```go
RegistryMethodSessionPin = "session.pin"
```

```go
RegistryMethodSessionPin: registryProjectMethod(RegistryMethodSessionPin, RegistryRouteSessionForward),
```

不得修改 `DefaultProtocolVersion`。

- [x] **Step 4: 增加 Web method 常量和 source contract**

在 `app/web/src/registry/registryMethods.ts` 的 Session methods 中加入：

```ts
SessionPin: 'session.pin',
```

在 `app/__tests__/web-session-actions-service.test.ts` 的协议常量测试中增加：

```ts
expect(RegistryProtocolVersion).toBe('2.6');
expect(RegistryMethods.SessionPin).toBe('session.pin');
```

- [x] **Step 5: 运行协议测试**

Run：

```powershell
go test ./internal/protocol -v
```

工作目录 `app/`：

```powershell
npx jest __tests__/web-session-actions-service.test.ts --runInBand
```

Expected：全部 PASS，协议仍为 2.6。

- [x] **Step 6: Commit**

```powershell
git add server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go app/web/src/registry/registryMethods.ts app/__tests__/web-session-actions-service.test.ts
git commit -m "feat(protocol): register project-scoped session pin method"
```

---

### Task 3: Hub 在现有 sync projection 中持久化 pin

**Files:**
- Modify: `server/internal/hub/client/session_recorder.go`
- Modify: `server/internal/hub/client/session_recovery.go`
- Modify: `server/internal/hub/client/client.go`
- Modify: `server/internal/hub/client/client_test.go`
- Modify: `server/internal/hub/hub_test.go`

**约束:** 不修改 `server/internal/hub/client/sqlite_store.go` 的 table DDL、`expectedStoreSchemaColumns`、schema version 或 migration。`pinned` 仅属于 `SessionSyncJSON`。

- [x] **Step 1: 写 recorder/request 失败测试**

在 `server/internal/hub/client/client_test.go` 使用 `newSessionViewTestClient(t)` 和现有 request helper 增加覆盖：

```go
func TestHandleSessionPinPersistsSummaryWithoutPublishingUpdate(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Pinned")); err != nil {
		t.Fatalf("RecordEvent: %v", err)
	}
	var published []string
	c.sessionRecorder.SetEventPublisher(func(method string, payload any) error {
		published = append(published, method)
		return nil
	})

	result, err := c.HandleSessionRequest(ctx, "proj1", acp.RegistryMethodSessionPin, map[string]any{
		"sessionId": "sess-1",
		"pinned":    true,
	})
	if err != nil {
		t.Fatalf("HandleSessionRequest(pin): %v", err)
	}
	summary := sessionSummaryMap(t, result)
	if pinned, _ := summary["pinned"].(bool); !pinned {
		t.Fatalf("response pinned = %#v, want true", summary["pinned"])
	}
	if len(published) != 0 {
		t.Fatalf("published methods = %v, want none", published)
	}

	sessions, err := c.listSessionViews(ctx)
	if err != nil {
		t.Fatalf("listSessionViews: %v", err)
	}
	if len(sessions) != 1 || !sessions[0].Pinned {
		t.Fatalf("listed sessions = %#v, want pinned sess-1", sessions)
	}

	if _, err := c.HandleSessionRequest(ctx, "proj1", acp.RegistryMethodSessionPin, map[string]any{
		"sessionId": "sess-1",
		"pinned":    false,
	}); err != nil {
		t.Fatalf("HandleSessionRequest(unpin): %v", err)
	}
	rec, err := c.store.LoadSession(ctx, "proj1", "sess-1")
	if err != nil || rec == nil {
		t.Fatalf("LoadSession = %#v, %v", rec, err)
	}
	if sessionSyncProjectionFromJSON(rec.SessionSyncJSON).Pinned {
		t.Fatal("stored pinned = true, want false")
	}
}
```

按现有 publisher setter 的实际名称调整 `SetEventPublisher` 调用；断言必须直接证明 pin 没有发布 `session.updated`，不能只断言 UI 没收到事件。

同文件再增加表驱动测试，覆盖空 `sessionId`、不存在 session、另一个 project 下存在同 ID 时均返回错误且不创建/修改当前 project 记录；增加 running prompt 后调用 pin 成功的用例，证明未复用 archive/reload/delete 的 running guard。

- [x] **Step 2: 写 projection 生命周期失败测试**

新增或扩展测试以依次证明：

1. pin 后 `MarkSessionRead` 保留 `Pinned=true`；
2. prompt started/done 更新 turn cursor 后保留 `Pinned=true`；
3. 用同一个 SQLite store 重建 `SessionRecorder` 后 list summary 仍为 pinned；
4. reload/reset（包括 replay 返回错误的路径）清空 cursor 但保留 pin；
5. archive/delete 删除活跃 row；archive restore 产生的 summary 为 `Pinned=false`。

重建读取的核心断言使用真实 store，而不是复用旧 recorder 内存：

```go
rec, err := c.store.LoadSession(ctx, "proj1", "sess-1")
if err != nil || rec == nil {
	t.Fatalf("LoadSession = %#v, %v", rec, err)
}
rebuilt := newSessionRecorder("proj1", c.store, nil)
summary := rebuilt.sessionViewSummaryFromRecord(*rec)
if !summary.Pinned {
	t.Fatal("rebuilt summary pinned = false, want true")
}
```

使用现有 package-private constructor，不引入仅用于测试的生产 API。

- [x] **Step 3: 运行 Hub 测试确认失败**

Run（`server/`）：

```powershell
go test ./internal/hub/client -run 'TestHandleSessionPin|TestSessionPin|TestSessionReload.*Pin|TestSessionArchive.*Pin|TestSessionDelete.*Pin' -v
```

Expected：编译或测试失败，因为 summary/projection/handler 尚无 pin。

- [x] **Step 4: 扩展 summary 与 projection**

在 `sessionViewSummary` 和 `sessionSyncProjection` 增加：

```go
Pinned bool `json:"pinned"`
```

```go
Pinned bool `json:"pinned,omitempty"`
```

在 `sessionViewSummaryFromRecordLocked` 构造完 summary 后赋值：

```go
summary.Pinned = projection.Pinned
```

现有 `sessionSyncProjectionFromJSON` / `sessionSyncProjectionJSON` 会让 mark-read、prompt 和 operation cursor 更新自然保留该字段。

- [x] **Step 5: 实现 recorder 写入且不广播**

在 `MarkSessionRead` 附近加入：

```go
func (r *SessionRecorder) SetSessionPinned(ctx context.Context, sessionID string, pinned bool) (sessionViewSummary, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return sessionViewSummary{}, fmt.Errorf("sessionId is required")
	}
	rec, err := r.store.LoadSession(ctx, r.projectName, sessionID)
	if err != nil {
		return sessionViewSummary{}, err
	}
	if rec == nil {
		return sessionViewSummary{}, fmt.Errorf("session not found: %s", sessionID)
	}
	projection := sessionSyncProjectionFromJSON(rec.SessionSyncJSON)
	projection.Pinned = pinned
	rec.SessionSyncJSON = sessionSyncProjectionJSON(projection)
	if err := r.store.SaveSession(ctx, rec); err != nil {
		return sessionViewSummary{}, err
	}
	return r.sessionViewSummaryFromRecord(*rec), nil
}
```

该方法不得调用 `publishSessionUpdated`。

- [x] **Step 6: 实现 `session.pin` request handler**

在 `client.go` 的 mark-read/rename 分支附近加入：

```go
case acp.RegistryMethodSessionPin:
	var req struct {
		SessionID string `json:"sessionId"`
		Pinned    bool   `json:"pinned"`
	}
	if err := decodeSessionRequestPayload(payload, &req); err != nil {
		return nil, fmt.Errorf("invalid session.pin payload: %w", err)
	}
	summary, err := c.sessionRecorder.SetSessionPinned(ctx, req.SessionID, req.Pinned)
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "sessionId": summary.SessionID, "session": summary}, nil
```

不要调用 `sessionIsRunning`，project 隔离由 recorder 的 `r.projectName` store lookup 保证。

- [x] **Step 7: reload/reset 保留 pin**

把 `session_recovery.go` 中：

```go
rec.SessionSyncJSON = sessionSyncJSON(0)
```

替换为：

```go
projection := sessionSyncProjectionFromJSON(rec.SessionSyncJSON)
rec.SessionSyncJSON = sessionSyncProjectionJSON(sessionSyncProjection{
	Pinned: projection.Pinned,
})
```

这样 cursor、done/read 状态归零，但 pin 原样保留。Archive/Delete 继续删除活跃 row，Restore 继续用默认 projection，无需 schema 或 migration 修改。

- [x] **Step 8: 增加 Hub forwarding 测试**

在 `server/internal/hub/hub_test.go` 复制现有 rename/delete forwarding 测试结构，发送：

```go
acp.RegistryMethodSessionPin
map[string]any{"sessionId": "sess-1", "pinned": true}
```

断言请求只转发给 envelope `projectId` 对应 client，response 返回调用方；未携带 `projectId` 的请求按现有 project-scoped 验证返回错误。

- [x] **Step 9: 运行 Hub/协议测试**

Run（`server/`）：

```powershell
gofmt -w internal/protocol/registry_methods.go internal/protocol/registry_methods_test.go internal/hub/client/client.go internal/hub/client/session_recorder.go internal/hub/client/session_recovery.go internal/hub/client/client_test.go internal/hub/hub_test.go
go test ./internal/protocol ./internal/hub/client ./internal/hub -v
```

Expected：全部 PASS；`git diff -- server/internal/hub/client/sqlite_store.go` 无输出。

- [x] **Step 10: Commit**

```powershell
git add server/internal/hub/client/client.go server/internal/hub/client/session_recorder.go server/internal/hub/client/session_recovery.go server/internal/hub/client/client_test.go server/internal/hub/hub_test.go
git commit -m "feat(hub): persist shared session pin state"
```

---

### Task 4: Web repository/service 同步 `pinned` summary

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/__tests__/web-session-actions-service.test.ts`
- Modify: `app/__tests__/web-chat-project-service.test.ts`
- Modify: `app/__tests__/web-session-list-schema.test.ts`

- [x] **Step 1: 写 repository/service 失败测试**

在 `web-session-actions-service.test.ts` 按现有 fake request 模式增加：

```ts
test('pins a project session and normalizes pinned summaries', async () => {
  const request = jest.fn().mockResolvedValue({
    payload: {
      ok: true,
      sessionId: 's1',
      session: {
        sessionId: 's1',
        title: 'One',
        preview: '',
        updatedAt: '2026-07-22T10:00:00Z',
        messageCount: 1,
        pinned: true,
      },
    },
  });
  const repository = new RegistryRepository({request} as never);

  const result = await repository.pinSession('p1', 's1', true);

  expect(request).toHaveBeenCalledWith({
    method: RegistryMethods.SessionPin,
    projectId: 'p1',
    payload: {sessionId: 's1', pinned: true},
    timeoutMs: 15000,
  });
  expect(result.session.pinned).toBe(true);
});
```

再让 fake response 省略 `pinned`，断言 `result.session.pinned === false`。在 `web-chat-project-service.test.ts` 增加 `pinProjectSession('p1','s1',false)` 委托到 repository `pinSession` 的断言。

- [x] **Step 2: 运行测试确认失败**

Run（`app/`）：

```powershell
npx jest __tests__/web-session-actions-service.test.ts __tests__/web-chat-project-service.test.ts --runInBand
```

Expected：类型或测试失败，因为 method/type/repository/service 尚未完整实现。

- [x] **Step 3: 扩展 summary 和 normalize**

在 `RegistrySessionSummary` 增加：

```ts
pinned?: boolean;
```

在 `normalizeSessionSummary` 返回对象中增加：

```ts
pinned: input.pinned === true,
```

在 `web-session-list-schema.test.ts` 增加 source assertions：

```ts
expect(registryTypes).toContain('pinned?: boolean;');
expect(repositoryTs).toContain('pinned: input.pinned === true');
expect(repositoryTs).toContain('RegistryMethods.SessionPin');
expect(serviceTs).toContain('async pinProjectSession(');
```

- [x] **Step 4: 实现 repository 和 project-scoped service**

在 `RegistryRepository.renameSession` 附近加入：

```ts
async pinSession(
  projectId: string,
  sessionId: string,
  pinned: boolean,
): Promise<{ok: boolean; sessionId: string; session: RegistrySessionSummary}> {
  const resp = await this.client.request({
    method: RegistryMethods.SessionPin,
    projectId,
    payload: {sessionId, pinned},
    timeoutMs: 15000,
  });
  const body = (resp.payload ?? {}) as {ok?: boolean; sessionId?: string; session?: unknown};
  const session = this.normalizeSessionSummary(body.session) ?? {
    sessionId,
    title: '',
    preview: '',
    updatedAt: '',
    messageCount: 0,
    pinned,
  };
  return {ok: body.ok ?? false, sessionId: body.sessionId ?? sessionId, session};
}
```

在 `RegistryWorkspaceService` 加入：

```ts
async pinProjectSession(
  projectId: string,
  sessionId: string,
  pinned: boolean,
): Promise<{ok: boolean; sessionId: string; session: RegistrySessionSummary}> {
  if (!this.repository) {
    throw new Error('session is not ready');
  }
  return this.repository.pinSession(projectId, sessionId, pinned);
}
```

不新增 browser local persistence。

- [x] **Step 5: 运行 Web service 测试和类型检查**

Run（`app/`）：

```powershell
npx jest __tests__/web-session-actions-service.test.ts __tests__/web-chat-project-service.test.ts __tests__/web-session-list-schema.test.ts --runInBand
npx tsc -p web/tsconfig.web.json --noEmit
```

Expected：全部 PASS。

- [x] **Step 6: Commit**

```powershell
git add app/web/src/registry/registryTypes.ts app/web/src/registry/RegistryRepository.ts app/web/src/registry/RegistryWorkspaceService.ts app/__tests__/web-session-actions-service.test.ts app/__tests__/web-chat-project-service.test.ts app/__tests__/web-session-list-schema.test.ts
git commit -m "feat(app): add session pin registry service"
```

---

### Task 5: Project Session 列表按 pinned 分组，Recent 保持纯时间语义

**Files:**
- Modify: `app/web/src/chat/session/chatSessionOrdering.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-session-ordering.test.ts`
- Test: `app/__tests__/web-mobile-chat-quick-switch.test.ts`

- [x] **Step 1: 写排序与 merge 失败测试**

在 `web-chat-session-ordering.test.ts` 增加：

```ts
test('sorts project sessions by pinned group then updatedAt descending', () => {
  const result = sortProjectChatSessions([
    session('new-unpinned', '2026-07-22T12:00:00Z'),
    {...session('old-pinned', '2026-07-20T12:00:00Z'), pinned: true},
    {...session('new-pinned', '2026-07-21T12:00:00Z'), pinned: true},
    session('old-unpinned', '2026-07-19T12:00:00Z'),
  ]);
  expect(result.map(item => item.sessionId)).toEqual([
    'new-pinned',
    'old-pinned',
    'new-unpinned',
    'old-unpinned',
  ]);
});

test('keeps pure recency sorting available for Recent', () => {
  const result = sortChatSessions([
    {...session('old-pinned', '2026-07-20T12:00:00Z'), pinned: true},
    session('new-unpinned', '2026-07-22T12:00:00Z'),
  ]);
  expect(result.map(item => item.sessionId)).toEqual(['new-unpinned', 'old-pinned']);
});

test('reorders a project list when pin changes without updatedAt changing', () => {
  const existing = [
    session('newer', '2026-07-22T12:00:00Z'),
    session('older', '2026-07-20T12:00:00Z'),
  ];
  expect(mergeChatSession(existing, {sessionId: 'older', pinned: true}).map(item => item.sessionId))
    .toEqual(['older', 'newer']);
});

test('preserves pin when a partial session patch omits it', () => {
  const merged = mergeChatSession(
    [{...session('s1', '2026-07-22T12:00:00Z'), pinned: true}],
    {sessionId: 's1', preview: 'patched'},
  );
  expect(merged[0].pinned).toBe(true);
});
```

同时增加 unpin 后回到更新时间位置、list refresh 在 pinned 变化时重排、相同 key 稳定排序的断言。

- [x] **Step 2: 运行排序测试确认失败**

Run（`app/`）：

```powershell
npx jest __tests__/web-chat-session-ordering.test.ts --runInBand
```

Expected：失败，因为 `sortProjectChatSessions` 不存在且 merge 未处理 pin。

- [x] **Step 3: 实现两套排序语义**

保留 `sortChatSessions` 的纯时间行为，并新增：

```ts
export function sortProjectChatSessions(items: RegistryChatSession[]): RegistryChatSession[] {
  return [...items].sort((left, right) => {
    const pinOrder = Number(right.pinned === true) - Number(left.pinned === true);
    if (pinOrder !== 0) {
      return pinOrder;
    }
    return compareChatSessionUpdatedAtDesc(left.updatedAt || '', right.updatedAt || '');
  });
}
```

`mergeSessionSummary` 增加：

```ts
pinned: next.pinned ?? existing?.pinned ?? false,
```

`mergeChatSession` 的原位替换条件改成 `updatedAt` 与 `pinned` 均未改变；否则调用 `sortProjectChatSessions`。`mergeChatSessionList` 的 `orderChanged` 比较同样加入 `next.pinned !== session.pinned`，并用 project sorter 返回。

- [x] **Step 4: Project 列表入口改用 project sorter**

在 `WorkspaceApp.tsx` 导入 `sortProjectChatSessions`。把下列完整 project Session list 路径从 `sortChatSessions` 改为 `sortProjectChatSessions`：cached sessions、`session.list` refresh、session event list、active project refresh、target project refresh。

不得修改 `chatIndexState.ts` 的 `latestSessionUpdatedAt`；它继续使用 `sortChatSessions`，确保 project 最近活跃时间不被 pin 改写。`mobileChatQuickSwitch.ts` 的候选选择和 section 排序也不调用 project sorter。

- [x] **Step 5: 运行排序与 Recent 回归**

Run（`app/`）：

```powershell
npx jest __tests__/web-chat-session-ordering.test.ts __tests__/web-mobile-chat-quick-switch.test.ts --runInBand
npx tsc -p web/tsconfig.web.json --noEmit
```

Expected：全部 PASS；Recent 的候选数量、优先级、project 分组与组内时间顺序没有因 pin 改变。

- [x] **Step 6: Commit**

```powershell
git add app/web/src/chat/session/chatSessionOrdering.ts app/web/src/app/WorkspaceApp.tsx app/__tests__/web-chat-session-ordering.test.ts
git commit -m "feat(app): pin sessions within project lists"
```

---

### Task 6: Session 菜单、行尾 pin icon 与请求状态

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/__tests__/web-chat-recent-sessions-ui.test.ts`

- [x] **Step 1: 写 UI contract 失败测试**

在现有 source-contract 测试中增加断言，覆盖：

```ts
expect(mainTsx).toContain('const [chatPinningSessionKey, setChatPinningSessionKey]');
expect(mainTsx).toContain('service.pinProjectSession(targetProjectId, sessionId, pinned)');
expect(mainTsx).toContain('session.pinned ? \'Unpin\' : \'Pin\'');
expect(mainTsx).toContain('className="wide-session-pin-btn"');
expect(mainTsx).toContain('aria-pressed={true}');
expect(mainTsx).toContain('event.stopPropagation();');
expect(mainTsx).toContain('handlePinProjectSession(targetProjectId, session.sessionId, false)');
expect(stylesCss).toContain('.wide-session-pin-btn');
expect(stylesCss).toContain('.project-session-row-wrap.has-pin-action');
```

Recent UI test 断言 `liveSession.pinned` 控制同一个 pin button 和菜单动作；draft renderer 与 archive renderer 片段中不出现 `wide-session-pin-btn` 或 `handlePinProjectSession`。若测试已有 helper 可抽取函数片段，使用函数边界断言，避免全文件 `not.toContain` 误判。

- [x] **Step 2: 运行 UI 测试确认失败**

Run（`app/`）：

```powershell
npx jest __tests__/web-chat-ui.test.ts __tests__/web-chat-recent-sessions-ui.test.ts --runInBand
```

Expected：新增断言 FAIL。

- [x] **Step 3: 增加 per-project/session 请求状态和 handler**

在 Session mutation states 旁加入：

```ts
const [chatPinningSessionKey, setChatPinningSessionKey] = useState('');
```

实现：

```ts
const handlePinProjectSession = async (
  targetProjectId: string,
  sessionId: string,
  pinned: boolean,
) => {
  const actionKey = projectSessionActionKey(targetProjectId, sessionId);
  if (!targetProjectId || !sessionId || chatPinningSessionKey === actionKey) return;
  setError('');
  setChatPinningSessionKey(actionKey);
  try {
    const result = await service.pinProjectSession(targetProjectId, sessionId, pinned);
    if (!result.ok) throw new Error(pinned ? 'Failed to pin session' : 'Failed to unpin session');
    setProjectSessionsByProjectId(current => ({
      ...current,
      [targetProjectId]: mergeChatSession(current[targetProjectId] ?? [], result.session),
    }));
    if (targetProjectId === projectIdRef.current) {
      setChatSessions(current => mergeChatSession(current, result.session));
    }
    rememberChatSessionSummary(targetProjectId, result.session);
    setProjectSessionActionMenu(null);
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    setChatPinningSessionKey(current => current === actionKey ? '' : current);
  }
};
```

若 `rememberChatSessionSummary` 已同时更新 `projectSessionsByProjectId`，保留单一状态更新路径，避免重复 merge；无论采用哪条现有 helper，必须用服务端 response summary，不能先 optimistic toggle。

- [x] **Step 4: Session 菜单增加 Pin/Unpin**

在 Rename 之前加入 menu item。禁用条件仅为当前 action key 正在请求，不包含 `session.running`：

```tsx
<button
  type="button"
  className="project-session-menu-btn pin"
  role="menuitem"
  disabled={chatPinningSessionKey === projectSessionActionKey(targetProjectId, sessionId)}
  onClick={event => {
    event.stopPropagation();
    handlePinProjectSession(targetProjectId, sessionId, session.pinned !== true).catch(() => undefined);
  }}
>
  <span className={`codicon ${
    chatPinningSessionKey === projectSessionActionKey(targetProjectId, sessionId)
      ? 'codicon-loading codicon-modifier-spin'
      : 'codicon-pinned'
  }`} />
  <span className="project-session-menu-label">{session.pinned ? 'Unpin' : 'Pin'}</span>
</button>
```

桌面右键和 ellipsis 已复用此 menu，不新增第二套菜单。

- [x] **Step 5: Project 与 Recent 行渲染独立 pin button**

在两个活跃行 wrapper 加 `${session.pinned ? ' has-pin-action' : ''}`（Recent 使用 `liveSession.pinned`）。Pinned 时不渲染 `.wide-session-time`，改在 row `<button>` 的 sibling 位置渲染：

```tsx
{session.pinned ? (
  <button
    type="button"
    className="wide-session-pin-btn"
    title="Unpin session"
    aria-label={`Unpin session ${resolveSessionDisplayTitle(session) || session.sessionId}`}
    aria-pressed={true}
    disabled={chatPinningSessionKey === projectSessionActionKey(targetProjectId, session.sessionId)}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => {
      event.preventDefault();
      event.stopPropagation();
      handlePinProjectSession(targetProjectId, session.sessionId, false).catch(() => undefined);
    }}
  >
    <span className={`codicon ${
      chatPinningSessionKey === projectSessionActionKey(targetProjectId, session.sessionId)
        ? 'codicon-loading codicon-modifier-spin'
        : 'codicon-pinned'
    }`} aria-hidden="true" />
  </button>
) : null}
```

Recent 版本替换为 `liveSession`。按钮必须是 row button 的 sibling，禁止嵌套 `<button>`；点击 icon 不触发选择或打开 Session。未 pinned 时仍在 row 内显示 `.wide-session-time`。

- [x] **Step 6: 添加样式并协调 ellipsis**

在 `chat.css` 的 `.project-session-row-wrap` 区域加入：

```css
.project-session-row-wrap.has-pin-action .wide-session-row {
  padding-right: 48px;
}

.wide-session-pin-btn {
  position: absolute;
  right: 27px;
  top: 50%;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 4px;
  color: var(--text-secondary);
  background: transparent;
  transform: translateY(-50%);
  z-index: 2;
}

.wide-session-pin-btn:hover,
.wide-session-pin-btn:focus-visible {
  color: var(--text-primary);
  background: var(--hover);
}

.wide-session-pin-btn:disabled {
  cursor: default;
  opacity: 0.65;
}

.mobile-session-row + .wide-session-pin-btn {
  right: 4px;
}
```

结合现有 mobile selector 调整 padding，保证 mobile 无 ellipsis 时 icon 占用原时间位置；desktop pin icon 位于 ellipsis 左侧。以实际 CSS cascade 为准，但不得覆盖 session title 或状态 marker。

- [x] **Step 7: 运行 UI 测试、类型检查**

Run（`app/`）：

```powershell
npx jest __tests__/web-chat-ui.test.ts __tests__/web-chat-recent-sessions-ui.test.ts __tests__/web-session-list-schema.test.ts --runInBand
npx tsc -p web/tsconfig.web.json --noEmit
```

Expected：全部 PASS；失败请求测试证明本地 summary 未被错误翻转，running session menu 中 Pin 仍 enabled。

- [x] **Step 8: Commit**

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-chat-ui.test.ts app/__tests__/web-chat-recent-sessions-ui.test.ts
git commit -m "feat(app): add session pin menu and row control"
```

---

### Task 7: 移动端 Project 长按统一打开操作菜单

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-recent-sessions-ui.test.ts`
- Modify: `app/__tests__/web-chat-ui.test.ts`

- [x] **Step 1: 更新移动端交互失败测试**

把现有“project long press 直接 toggle pin”的断言改为：

```ts
expect(mainTsx).toContain("openMobileProjectActionMenu(targetProjectId, 'actions')");
expect(projectLongPressBlock).not.toContain('togglePinnedProject(targetProjectId);');
expect(mainTsx).toContain("sheetMenu.kind === 'actions'");
expect(mainTsx).toContain("pinnedProjectIds.includes(sheetMenu.projectId) ? 'Unpin Project' : 'Pin Project'");
```

并断言 mobile project row action buttons 中不再出现直接 `togglePinnedProject(targetProjectId)` 的 pin button；desktop project pin 入口保持原样。Session mobile long press 继续打开 `projectSessionActionMenu`，其中已包含 Task 6 的 Pin/Unpin。

- [x] **Step 2: 运行移动端 UI 测试确认失败**

Run（`app/`）：

```powershell
npx jest __tests__/web-chat-recent-sessions-ui.test.ts __tests__/web-chat-ui.test.ts --runInBand
```

Expected：旧实现因 long press 直接 toggle 而失败。

- [x] **Step 3: 扩展 mobile action menu state**

把别名改成 discriminated union：

```ts
type MobileProjectActionMenuState =
  | WideProjectActionMenuState
  | {
      projectId: string;
      kind: 'actions';
      phase: 'actions';
      agentType: '';
      popover: null;
    };
```

`openMobileProjectActionMenu` 的 `kind` 扩为 `'new' | 'resume' | 'actions'`；actions 分支写入 `{projectId, kind:'actions', phase:'actions', agentType:'', popover:null}`，new/resume 分支保持原有 agents state。

- [x] **Step 4: long press 改为开菜单**

timer callback 改为：

```ts
projectPinLongPressTimerRef.current = window.setTimeout(() => {
  projectPinLongPressTimerRef.current = null;
  projectPinLongPressTargetRef.current = targetProjectId;
  triggerMobileHaptic();
  openMobileProjectActionMenu(targetProjectId, 'actions');
}, PROJECT_PIN_LONG_PRESS_MS);
```

处理 callback 声明顺序：若 `openMobileProjectActionMenu` 当前定义在 callback 之后，将其改为 `useCallback` 并移动到 long-press block 之前，或让 long-press callback 调用一个先定义的稳定 helper；禁止通过关闭 exhaustive-deps 或使用 `any` 绕过。

- [x] **Step 5: actions sheet 渲染 Project Pin/Unpin**

Sheet 的 `aria-label`、icon、title 增加 actions 分支：`Project actions`、`codicon-list-selection`、`Project Actions`。body 在 agents/sessions 分支之前处理：

```tsx
{sheetMenu.kind === 'actions' ? (
  <button
    type="button"
    className="wide-project-action-menu-item mobile-project-sheet-item"
    onClick={() => {
      togglePinnedProject(sheetMenu.projectId);
      setMobileProjectActionMenu(null);
    }}
  >
    <span className="codicon codicon-pinned" aria-hidden="true" />
    <span className="mobile-project-sheet-item-label">
      {pinnedProjectIds.includes(sheetMenu.projectId) ? 'Unpin Project' : 'Pin Project'}
    </span>
  </button>
) : sheetMenu.phase === 'agents' ? (
  /* 保留现有 agent items */
) : (
  /* 保留现有 resume session items */
)}
```

实现时保留现有 JSX 内容，不把注释字面量写入生产代码。

- [x] **Step 6: 删除 mobile project 行上的直接 pin button**

删除 mobile project row action group 中 `.wide-project-pin-btn` 的按钮；desktop project row 的 pin button 不删。Project 和 Session 在 mobile 上均由长按菜单提供 Pin/Unpin。

- [x] **Step 7: 运行移动端和全套相关 UI 测试**

Run（`app/`）：

```powershell
npx jest __tests__/web-chat-recent-sessions-ui.test.ts __tests__/web-chat-ui.test.ts __tests__/web-mobile-chat-quick-switch.test.ts --runInBand
npx tsc -p web/tsconfig.web.json --noEmit
```

Expected：全部 PASS；Project 长按只打开菜单，普通点击/折叠行为不变，Session 长按仍打开 Session actions。

- [x] **Step 8: Commit**

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/__tests__/web-chat-recent-sessions-ui.test.ts app/__tests__/web-chat-ui.test.ts
git commit -m "feat(app): unify mobile pin actions in menus"
```

---

### Task 8: 全量验证、同步远端并合并 main

**Files:**
- Modify: `docs/scope/2026-07-22-pin-session/plan-pin-session.md`（勾选实际完成项并记录任何与计划不同但已验证的实现）

**Implementation notes:**
- Hub forwarding 测试首次运行暴露 `Reporter.handleRegistryRequest` 未分发 `session.pin`；已补入现有 session request 白名单，并验证只路由到目标 project handler、缺少 `projectId` 返回错误。
- Active summary 支持 `pinned`；archive normalize 会显式移除该字段，保证归档与恢复语义仍为 unpinned。
- 最终基于最新 `origin/main` 验证：Server `go test ./...` 通过；App 206 suites / 1151 tests 通过；TypeScript no-emit 检查和 production Web build 通过。

- [x] **Step 1: Server 全量验证**

Run（`server/`）：

```powershell
go test ./...
```

Expected：全部 PASS。

- [x] **Step 2: App 相关测试、全量测试、类型检查和 production build**

Run（`app/`）：

```powershell
npx jest __tests__/web-session-actions-service.test.ts __tests__/web-chat-project-service.test.ts __tests__/web-chat-session-ordering.test.ts __tests__/web-chat-ui.test.ts __tests__/web-chat-recent-sessions-ui.test.ts __tests__/web-session-list-schema.test.ts __tests__/web-mobile-chat-quick-switch.test.ts --runInBand
npx jest --runInBand
npx tsc -p web/tsconfig.web.json --noEmit
npm run build:web
```

Expected：全部 PASS；build 成功。不得扫描或提交 `dist` 产物。

- [x] **Step 3: 静态边界检查**

Run（仓库根目录）：

```powershell
git diff --check
git diff -- server/internal/hub/client/sqlite_store.go
rg -n "RegistryProtocolVersion = '2\.6'|DefaultProtocolVersion.*2\.6" app/web/src/registry/registryMethods.ts server/internal/protocol
git status --short
```

Expected：diff check 通过；SQLite store diff 无输出；protocol 仍为 2.6；status 只包含计划勾选/最终预期变更，不包含 build artifacts。

- [x] **Step 4: 与远端 main rebase，重新运行风险相关验证**

Run（feature worktree）：

```powershell
git fetch origin
git rebase origin/main
```

若发生冲突，按 spec 保留双方有效改动，重新运行 Step 1–3；不得使用 `git reset --hard` 或丢弃用户改动。

- [x] **Step 5: Feature branch 最终提交与推送**

在 plan 中勾选所有已实际完成步骤后执行：

```powershell
git add -A
git commit -m "chore: complete pin session implementation"
git push origin feat/pin-session
```

Expected：严格按以上顺序成功；feature branch 已推送，工作树干净。

- [x] **Step 6: 在 main worktree 自动合并但不清理 feature worktree**

先在 `D:\Code\WheelMaker` 运行只读检查：

```powershell
git status --short
git branch --show-current
```

Expected：main worktree 干净且当前分支为 `main`。若不干净，停止并向用户说明，不能把既有用户改动混进 merge。

然后执行：

```powershell
git pull --rebase origin main
git merge --no-commit --no-ff feat/pin-session
```

检查 staged diff 确实只属于 Pin Session。最后严格执行仓库 Completion Gate：

```powershell
git add -A
git commit -m "feat: add shared session pinning"
git push origin main
```

Expected：main 推送成功。由于 worktree/branch 清理策略未确认，保留 `feat/pin-session` 分支和 `.worktree/feat/pin-session`，不自动删除。
