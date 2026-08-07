# Session Sorting Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 session 列表的 `updatedAt` 恢复"最后一次 prompt start/done"语义以消除流式期间的排序跳动；Recent Sessions 同 project 内按时间排序；整体删除右键/长按 quick-switch 菜单。

**Architecture:** 服务端断开运行时快照对 `LastActiveAt` 的回写泄漏并移除 compact 操作的时间推进；前端 merge 时在 `updatedAt` 未变时保持原位；Recent Sessions 分组后组内按 `updatedAt` 降序；删除 quick-switch 菜单组件、触发、样式与测试。

**Tech Stack:** Go (server/internal/hub/client, `go test`), React/TypeScript (app, jest + `tsc -p web/tsconfig.web.json`)。

参考 spec:`docs/scope/2026-07-20-session-sorting-stability.md`

---

### Task 1: Server — 运行时快照不再推进 stored `LastActiveAt`

**Files:**
- Modify: `server/internal/hub/client/session.go`(约 912-923,`toRecord()`)
- Test: `server/internal/hub/client/client_test.go`

**背景:** `toRecord()` 生成的运行时快照携带 `LastActiveAt: s.lastActiveAt`,而 `s.lastActiveAt` 在每个 session 事件都推进(`recordSessionViewEvent`),`sqliteStore.SaveSession` 又取 `maxTime(rec, existing)`,导致 usage update 触发的 `persistSessionBestEffort` 把"最后一个 turn"的时间写进 store。修复:快照不再携带 `LastActiveAt`(零值),`SaveSession` 已有的零值处理(回退 `CreatedAt` 再与 existing 取 `maxTime`)会自然保留 store 现值。内存 `sess.lastActiveAt` 不变,Suspended 驱逐不受影响。

- [ ] **Step 1: Write the failing test**

在 `server/internal/hub/client/client_test.go` 中 `TestSessionPersistKeepsRecorderLastActiveAtAndStoresLocalOffset` 之后新增:

```go
func TestSessionPersistDoesNotAdvanceStoredLastActiveAt(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	createdAt := mustRFC3339Time(t, "2026-05-06T12:00:00Z")
	startedAt := mustRFC3339Time(t, "2026-05-06T12:01:02Z")
	finishedAt := mustRFC3339Time(t, "2026-05-06T12:01:27Z")

	created := sessionViewCreatedEvent("sess-1", "Timing")
	created.UpdatedAt = createdAt
	if err := c.RecordEvent(ctx, created); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	started := sessionViewPromptEvent("sess-1", "measure", nil)
	started.UpdatedAt = startedAt
	if err := c.RecordEvent(ctx, started); err != nil {
		t.Fatalf("RecordEvent prompt started: %v", err)
	}
	finished := sessionViewPromptFinishedEvent("sess-1", "end_turn")
	finished.UpdatedAt = finishedAt
	if err := c.RecordEvent(ctx, finished); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	sess, err := c.SessionByID(ctx, "sess-1")
	if err != nil {
		t.Fatalf("SessionByID: %v", err)
	}
	sess.mu.Lock()
	sess.lastActiveAt = finishedAt.Add(10 * time.Minute)
	sess.mu.Unlock()
	if err := sess.persistSession(ctx); err != nil {
		t.Fatalf("persistSession: %v", err)
	}

	rec, err := c.store.LoadSession(ctx, "proj1", "sess-1")
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if rec == nil {
		t.Fatal("LoadSession returned nil record")
	}
	if !rec.LastActiveAt.Equal(finishedAt) {
		t.Fatalf("session LastActiveAt = %q, want %q", rec.LastActiveAt.Format(time.RFC3339Nano), finishedAt.Format(time.RFC3339Nano))
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run(工作目录 `server/`): `go test ./internal/hub/client/ -run TestSessionPersistDoesNotAdvanceStoredLastActiveAt -v`
Expected: FAIL — `LastActiveAt` 被推进到 `finishedAt + 10min`。

- [ ] **Step 3: Write minimal implementation**

`server/internal/hub/client/session.go` 的 `toRecord()`(约 912-923),从返回的 `SessionRecord` 字面量中删除 `LastActiveAt` 字段:

```go
	return &SessionRecord{
		ID:          s.acpSessionID,
		ProjectName: s.projectName,
		Status:      s.Status,
		AgentType:   s.agentType,
		AgentJSON:   agentJSON,
		// Session title is owned by SessionRecorder projection (latest prompt title).
		// Keep snapshot writes title-neutral so runtime state does not overwrite recorder title.
		Title: "",
		// LastActiveAt is owned by the SessionRecorder projection (last prompt
		// start/done). Runtime snapshots leave it zero so SaveSession keeps the
		// stored value instead of advancing it with per-turn activity.
		CreatedAt: s.createdAt,
	}, nil
```

- [ ] **Step 4: Run tests to verify they pass**

Run(工作目录 `server/`): `go test ./internal/hub/client/ -run 'TestSessionPersistDoesNotAdvanceStoredLastActiveAt|TestSessionPersistKeepsRecorderLastActiveAtAndStoresLocalOffset|TestSessionRecorderPromptTimingUpdatesSessionSummaryAndDuration|TestSessionViewListPreservesStoredProjectionMetadataForRuntimeSessions' -v`
Expected: 全部 PASS(旧测试靠 `maxTime`/`CreatedAt` 回退保持兼容)。

- [ ] **Step 5: Commit**

```bash
git add server/internal/hub/client/session.go server/internal/hub/client/client_test.go
git commit -m "fix(server): stop runtime session snapshots from advancing stored LastActiveAt"
```

---

### Task 2: Server — compact 等 session operation 不再推进 `LastActiveAt`

**Files:**
- Modify: `server/internal/hub/client/session_recorder.go`(约 293-301,`RecordSessionOperation`)
- Test: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: Write the failing test**

在 `server/internal/hub/client/client_test.go` 中 `TestSessionRecorderPersistsOperationLifecycle` 之后新增:

```go
func TestSessionRecorderOperationDoesNotMoveSession(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	olderAt := mustRFC3339Time(t, "2026-05-22T01:00:00Z")
	newerAt := mustRFC3339Time(t, "2026-05-22T02:00:00Z")

	oldSession := sessionViewCreatedEvent("sess-old", "Old title")
	oldSession.UpdatedAt = olderAt
	if err := c.RecordEvent(ctx, oldSession); err != nil {
		t.Fatalf("RecordEvent old session: %v", err)
	}
	newSession := sessionViewCreatedEvent("sess-new", "Newer title")
	newSession.UpdatedAt = newerAt
	if err := c.RecordEvent(ctx, newSession); err != nil {
		t.Fatalf("RecordEvent new session: %v", err)
	}

	if err := c.sessionRecorder.RecordSessionOperation(ctx, "sess-old", acp.SessionOperationPayload{
		OperationID: "op-1",
		Type:        acp.SessionOperationTypeCompact,
		Status:      acp.SessionOperationStatusStarted,
		StartedAt:   time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("RecordSessionOperation(started): %v", err)
	}

	rec, err := c.store.LoadSession(ctx, "proj1", "sess-old")
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if rec == nil {
		t.Fatal("LoadSession returned nil record")
	}
	if !rec.LastActiveAt.Equal(olderAt) {
		t.Fatalf("LastActiveAt = %s, want %s", rec.LastActiveAt.Format(time.RFC3339), olderAt.Format(time.RFC3339))
	}
	sessions, err := c.listSessionViews(ctx)
	if err != nil {
		t.Fatalf("listSessionViews: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("sessions len = %d, want 2", len(sessions))
	}
	if sessions[0].SessionID != "sess-new" || sessions[1].SessionID != "sess-old" {
		t.Fatalf("session order = [%s %s], want [sess-new sess-old]", sessions[0].SessionID, sessions[1].SessionID)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run(工作目录 `server/`): `go test ./internal/hub/client/ -run TestSessionRecorderOperationDoesNotMoveSession -v`
Expected: FAIL — `LastActiveAt` 被推进到操作时间,session 顺序变成 `[sess-old sess-new]`。

- [ ] **Step 3: Write minimal implementation**

`server/internal/hub/client/session_recorder.go` 的 `RecordSessionOperation`,删除 293-301 的时间计算与回写(`projection.LatestPersistedTurnIndex` 与 `SessionSyncJSON` 更新保留):

```go
	projection.LatestPersistedTurnIndex = turnIndex
	rec.SessionSyncJSON = sessionSyncProjectionJSON(projection)
	// Session operations (e.g. compact) are not prompt activity and must not
	// advance LastActiveAt; only session create, prompt start and prompt done do.
	if err := r.store.SaveSession(ctx, rec); err != nil {
		return err
	}
```

- [ ] **Step 4: Run tests to verify they pass**

Run(工作目录 `server/`): `go test ./internal/hub/client/ -run 'TestSessionRecorderOperationDoesNotMoveSession|TestSessionRecorderPersistsOperationLifecycle' -v`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add server/internal/hub/client/session_recorder.go server/internal/hub/client/client_test.go
git commit -m "fix(server): keep session operations from advancing session LastActiveAt"
```

---

### Task 3: App — session merge 在 `updatedAt` 未变时保持原位

**Files:**
- Modify: `app/web/src/chat/session/chatIndexState.ts:153-174`(`mergeChatSessionList`)、`:108-151`(`mergeChatIndexSession`)
- Modify: `app/web/src/app/WorkspaceApp.tsx:1341-1378`(`mergeChatSession`)
- Test: `app/__tests__/web-chat-index-state.test.ts`

**背景:** 秒级精度的 `updatedAt` 相等时,`mergeChatSession` 把被 merge 的 session 放到队首再排序,会在相等 key 间翻转顺序。修复:排序键未变化时按原位置替换,不重排。

- [ ] **Step 1: Write the failing tests**

在 `app/__tests__/web-chat-index-state.test.ts` 的 `describe('chat index state helpers')` 内追加:

```ts
  test('keeps session order when merged summaries do not change updatedAt', () => {
    const existing = [
      session('s-top', '2026-05-01T00:00:00.000Z'),
      session('s-mid', '2026-04-01T00:00:00.000Z'),
      session('s-low', '2026-03-01T00:00:00.000Z'),
    ];
    const merged = mergeChatSessionList(existing, [
      {...session('s-low', '2026-03-01T00:00:00.000Z'), preview: 'new preview'},
      session('s-mid', '2026-04-01T00:00:00.000Z'),
      session('s-top', '2026-05-01T00:00:00.000Z'),
    ]);

    expect(merged.map(item => item.sessionId)).toEqual(['s-top', 's-mid', 's-low']);
    expect(merged[2].preview).toBe('new preview');
  });

  test('re-sorts when a merged summary changes updatedAt', () => {
    const existing = [
      session('s-top', '2026-05-01T00:00:00.000Z'),
      session('s-low', '2026-03-01T00:00:00.000Z'),
    ];
    const merged = mergeChatSessionList(existing, [
      session('s-top', '2026-05-01T00:00:00.000Z'),
      session('s-low', '2026-06-01T00:00:00.000Z'),
    ]);

    expect(merged.map(item => item.sessionId)).toEqual(['s-low', 's-top']);
  });

  test('mergeChatIndexSession keeps position when updatedAt is unchanged', () => {
    let state = {
      ...createChatIndexState(),
      projects: [project('p1', 'Project 1')],
    };
    state = mergeChatIndexSession(state, 'p1', session('s-top', '2026-05-01T00:00:00.000Z'));
    state = mergeChatIndexSession(state, 'p1', session('s-low', '2026-03-01T00:00:00.000Z'));
    state = mergeChatIndexSession(state, 'p1', {
      sessionId: 's-low',
      preview: 'patched',
      updatedAt: '2026-03-01T00:00:00.000Z',
    });

    expect(state.sessionsByProjectId.p1.map(item => item.sessionId)).toEqual(['s-top', 's-low']);
    expect(state.sessionsByProjectId.p1[1].preview).toBe('patched');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run(工作目录 `app/`): `npx jest __tests__/web-chat-index-state.test.ts`
Expected: 新增的第一和第三个 test FAIL(当前实现会把被 merge 的 session 移到前面);第二个 PASS。

- [ ] **Step 3: Implement `mergeChatSessionList` 稳定化**

`app/web/src/chat/session/chatIndexState.ts` 的 `mergeChatSessionList` 末尾改为:

```ts
export function mergeChatSessionList(
  existing: RegistryChatSession[],
  incoming: RegistryChatSession[],
): RegistryChatSession[] {
  const byId = new Map(existing.map(session => [session.sessionId, session]));
  const nextById = new Map<string, RegistryChatSession>();
  for (const item of incoming) {
    const previous = nextById.get(item.sessionId) ?? byId.get(item.sessionId);
    const merged =
      previous &&
      (item.configOptions === undefined || item.commands === undefined || item.usage === undefined)
        ? {
            ...item,
            configOptions: item.configOptions ?? previous.configOptions,
            commands: item.commands ?? previous.commands,
            usage: item.usage ?? previous.usage,
          }
        : item;
    nextById.set(item.sessionId, merged);
  }
  const orderChanged =
    nextById.size !== byId.size ||
    existing.some(session => {
      const next = nextById.get(session.sessionId);
      return !next || (next.updatedAt || '') !== (session.updatedAt || '');
    });
  if (!orderChanged) {
    return existing.map(session => nextById.get(session.sessionId) ?? session);
  }
  return sortChatSessions(Array.from(nextById.values()));
}
```

- [ ] **Step 4: Implement `mergeChatIndexSession` 稳定化**

`app/web/src/chat/session/chatIndexState.ts` 的 `mergeChatIndexSession` 末尾(`const merged` 之后的 return)改为:

```ts
  if (existing && (merged.updatedAt || '') === (existing.updatedAt || '')) {
    return {
      ...state,
      sessionsByProjectId: {
        ...state.sessionsByProjectId,
        [projectId]: current.map(item => (item.sessionId === session.sessionId ? merged : item)),
      },
    };
  }
  return {
    ...state,
    sessionsByProjectId: {
      ...state.sessionsByProjectId,
      [projectId]: sortChatSessions([
        merged,
        ...current.filter(item => item.sessionId !== session.sessionId),
      ]),
    },
  };
```

- [ ] **Step 5: Implement `mergeChatSession`(WorkspaceApp)同步修改**

`app/web/src/app/WorkspaceApp.tsx` 的 `mergeChatSession`(约 1341-1378),`const filtered` 之前插入原位替换分支:

```ts
  if (existing && (merged.updatedAt || '') === (existing.updatedAt || '')) {
    return list.map(item => (item.sessionId === next.sessionId ? merged : item));
  }
  const filtered = list.filter(item => item.sessionId !== next.sessionId);
  return sortChatSessions([merged, ...filtered]);
```

- [ ] **Step 6: Run tests to verify they pass**

Run(工作目录 `app/`): `npx jest __tests__/web-chat-index-state.test.ts`
Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add app/web/src/chat/session/chatIndexState.ts app/web/src/app/WorkspaceApp.tsx app/__tests__/web-chat-index-state.test.ts
git commit -m "fix(app): keep session list position when updatedAt is unchanged"
```

---

### Task 4: App — Recent Sessions 同 project 内按 `updatedAt` 降序

**Files:**
- Modify: `app/web/src/chat/mobileChatQuickSwitch.ts:171-199`(`buildRecentChatSessionProjectSections`)
- Test: `app/__tests__/web-mobile-chat-quick-switch.test.ts`

**背景:** 全局选取(unread/running 优先,top 8)不变;分组后同 project 内严格按 `updatedAt` 降序。

- [ ] **Step 1: Write the failing test**

在 `app/__tests__/web-mobile-chat-quick-switch.test.ts` 中追加:

```ts
  test('sorts sessions within a project by newest update, ignoring priority', () => {
    const sections = buildRecentChatSessionProjectSections({
      projects: [project('p1', 'Alpha')],
      sessionsByProjectId: {
        p1: [
          session('p1-newer', '2026-05-08T00:00:00.000Z'),
          session('p1-unread-old', '2026-01-03T00:00:00.000Z', {unreadCount: 2}),
        ],
      },
      limit: 8,
    });

    expect(sections).toHaveLength(1);
    expect(sections[0].sessions.map(item => item.sessionId)).toEqual(['p1-newer', 'p1-unread-old']);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run(工作目录 `app/`): `npx jest __tests__/web-mobile-chat-quick-switch.test.ts`
Expected: 新 test FAIL(当前顺序为 `['p1-unread-old', 'p1-newer']`)。

- [ ] **Step 3: Write minimal implementation**

`app/web/src/chat/mobileChatQuickSwitch.ts` 的 `buildRecentChatSessionProjectSections`,在 sections 构建完成后、`projectOrder` 排序之前插入组内排序:

```ts
  for (const section of sections) {
    section.sessions.sort((left, right) =>
      compareUpdatedAtDesc(left.updatedAt || '', right.updatedAt || ''),
    );
  }

  const projectOrder = new Map(
    input.projects.map((project, projectIndex) => [project.projectId, projectIndex]),
  );
```

(`compareUpdatedAtDesc` 已存在于本文件 64-75 行。)

- [ ] **Step 4: Run tests to verify they pass**

Run(工作目录 `app/`): `npx jest __tests__/web-mobile-chat-quick-switch.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add app/web/src/chat/mobileChatQuickSwitch.ts app/__tests__/web-mobile-chat-quick-switch.test.ts
git commit -m "feat(app): sort recent sessions by time within each project group"
```

---

### Task 5: App — 删除右键/长按 quick-switch 菜单

**Files:**
- Delete: `app/web/src/chat/ChatQuickSwitchMenu.tsx`
- Delete: `app/web/src/shell/layouts/desktop/chatQuickSwitchContextMenu.ts`
- Delete: `app/__tests__/web-desktop-chat-quick-switch-context-menu.test.ts`
- Delete: `app/__tests__/web-mobile-chat-quick-switch-ui.test.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`(约 20 处)
- Modify: `app/web/src/chat/mobileChatQuickSwitch.ts`(删 `MobileChatQuickSwitchSection` 类型与 `buildMobileChatQuickSwitchSections`)
- Modify: `app/__tests__/web-mobile-chat-quick-switch.test.ts`(删菜单相关用例)
- Modify: `app/__tests__/web-chat-composer-status.test.ts:284`(删 `'.chat-quick-switch-menu',` 一行)
- Modify: `app/web/src/styles/chat.css`(删 quick-switch 样式)

**说明:** 'mobile' placement 已是死代码(只有 desktop context menu 会打开菜单,且只有 desktop 分支渲染),整体一并清除。`getWideProjectAgents`、`selectProjectChatSession`、`renderSessionStateMarker`、`resolveSessionDisplayTitle`、`formatCompactRelativeAge`、`hubAccentStyle` 在其他地方仍使用,保留。

- [ ] **Step 1: 删除四个文件**

```bash
git rm app/web/src/chat/ChatQuickSwitchMenu.tsx app/web/src/shell/layouts/desktop/chatQuickSwitchContextMenu.ts app/__tests__/web-desktop-chat-quick-switch-context-menu.test.ts app/__tests__/web-mobile-chat-quick-switch-ui.test.ts
```

- [ ] **Step 2: 清理 `mobileChatQuickSwitch.ts`**

删除 `MobileChatQuickSwitchSection` 类型(3-9 行)和 `buildMobileChatQuickSwitchSections` 函数(201-231 行)。保留 `buildQuickSwitchCandidates`、`compareQuickSwitchCandidates`、`isPriorityQuickSwitchSession` 等被 `buildRecentChatSessionRows` 使用的部分。

- [ ] **Step 3: 清理 `web-mobile-chat-quick-switch.test.ts`**

- import 中删除 `buildMobileChatQuickSwitchSections`。
- 删除 test `'selects six sessions with unread and running first, then newest updates'` 和 `'returns an empty section list when no known sessions exist'`(两者只测已删除的 `buildMobileChatQuickSwitchSections`)。
- `describe('mobile chat quick switch')` 改名为 `describe('recent chat sessions')`。

- [ ] **Step 4: 清理 `web-chat-composer-status.test.ts`**

删除 284 行的 `'.chat-quick-switch-menu',`。

- [ ] **Step 5: 清理 `WorkspaceApp.tsx` — imports、类型、state**

- 删除 import:`resolveDesktopChatQuickSwitchContextMenu`(38 行)、`ChatQuickSwitchMenu`(111 行);`mobileChatQuickSwitch` 的 import(106-110 行)中删除 `buildMobileChatQuickSwitchSections`,保留 `buildRecentChatSessionProjectSections`、`hasCompletedUnreadChatSession`、`RecentChatSessionProjectSection`。
- 删除类型 `ChatQuickSwitchMenuPlacement`(662-664 行)。
- 删除 state(3455-3459 行):`chatQuickSwitchMenuOpen`/`setChatQuickSwitchMenuOpen`、`chatQuickSwitchMenuPlacement`/`setChatQuickSwitchMenuPlacement`、`chatQuickSwitchCreateProjectId`、`chatQuickSwitchCreatePendingKey`、`chatQuickSwitchMenuRef`。

- [ ] **Step 6: 清理 `WorkspaceApp.tsx` — 逻辑块**

- `handleChatScroll`(4215-4218):删除 `if (chatQuickSwitchMenuPlacement.kind === 'desktop') { setChatQuickSwitchMenuOpen(false); }`,依赖数组改回 `[]`。
- 删除重置 create 状态的 effect(4234-4240)。
- 删除 `mobileChatQuickSwitchSections` memo(5285-5292)。
- `closeSidebarTransientMenus` 中删除 `setChatQuickSwitchMenuOpen(false);`(5348)。
- 删除 selector 字符串中的 `, .chat-quick-switch-menu`(5365)。
- 删除 `mobileChatQuickSwitchMenuStyle` 与 `chatQuickSwitchMenuStyle`(5377-5382)。
- `floatingControlsIdle` 中删除 `&& !chatQuickSwitchMenuOpen`(6933)。
- 删除三个 effect:mobilePortRelayFrameOpen 关闭菜单(6985-6989)、tab/settings 关闭菜单(6990-6994)、outside click/Escape 监听(6995-7017)。
- 删除 handlers:`handleMobileChatQuickSwitchSelect`(15989-16000)、`handleChatQuickSwitchContextMenu`(16002-16019)、`getQuickSwitchProjectAgents`(16069-16075)、`handleQuickSwitchToggleCreateProject`(16077-16079)、`handleQuickSwitchCreateSession`(16081-16093)。
- 删除 `chat-block` 上的 `onContextMenu={handleChatQuickSwitchContextMenu}`(19379)。
- 删除 `chatQuickSwitchMenuBlockedByPreview` 与 `chatQuickSwitchMenu` JSX(20681-20702)。
- 删除渲染点 `{chatQuickSwitchMenuPlacement.kind === 'desktop' ? chatQuickSwitchMenu : null}`(22089)。
- 删除其余散落的 `setChatQuickSwitchMenuOpen(false);` 单行(约 6498、9072、9195、13113、14869、18392、18942、18954、18997)。

- [ ] **Step 7: 验证 WorkspaceApp 无残留引用**

Run(工作目录仓库根): `rg -n "QuickSwitch|quickSwitch|quick-switch" app/web/src/app/WorkspaceApp.tsx`
Expected: 无输出。

- [ ] **Step 8: 清理 `chat.css`**

- 删除文件顶部 quick-switch 专属样式块(约 12-238 行,`.chat-quick-switch-menu {` 到 `.chat-quick-switch-empty {` 段末尾,含 `[data-placement=...]`、`project-*`、`create-*`、`session-list`、`item`、`title`、`time`、`unread`、`empty` 全部 `chat-quick-switch-*` 规则)。
- 删除分组选择器中的 `.chat-quick-switch-menu,` 行(约 5984、6006、6025、6128、6282 处)和 6239-6243 组中 `.chat-quick-switch-menu` 的整条规则引用(该组删除后剩 `.project-session-action-menu, .session-archive-menu, .chat-title-project-menu, .chat-title-prompt-menu`)。

验证: `rg -n "quick-switch" app/web/src/styles/chat.css` 无输出。

- [ ] **Step 9: 全量验证 app**

Run(工作目录 `app/`):
```
npx tsc -p web/tsconfig.web.json --noEmit
npx jest
```
Expected: tsc 无错误;jest 全部 PASS。

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(app): remove chat quick-switch context menu in favor of recent sessions"
```

---

### Task 6: 全量回归 + 推送

**Files:** 无新增。

- [ ] **Step 1: Server 全量测试**

Run(工作目录 `server/`): `go test ./...`
Expected: 全部 PASS。

- [ ] **Step 2: App 全量测试 + 类型检查**

Run(工作目录 `app/`):
```
npx tsc -p web/tsconfig.web.json --noEmit
npx jest
```
Expected: 全部 PASS。

- [ ] **Step 3: 按仓库 Completion Gate 提交并推送**

```bash
git add -A
git status
git push origin feat/chat-session-search
```

Expected: 工作树干净(所有改动已在前序任务提交),push 成功。若 `git status` 有残留改动,先检查是否为预期遗漏并补提交,再 push。
