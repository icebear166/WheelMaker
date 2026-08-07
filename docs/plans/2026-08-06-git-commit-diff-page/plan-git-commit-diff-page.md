# 整提交 diff 单页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `project.git.commit.diff` 协议方法一次返回整提交 diff，App 的 commit git-diff tab 改为提交粒度单页（`files[]` + `activeFilePath` + 锚点跳转），替换原"一文件一 tab"模式。

**Architecture:** Server 在 `reporter.go` 新增 `replyGitCommitDiff`（`git show --no-color --unified=N <sha>` 不带路径，返回原始输出）；App 用现有 `splitUnifiedDiffFileBlocks` 在客户端拆分，与 `commitFilesBySha` 元数据按 path 合并。tab 模型统一为 `files[]`（worktree tab 即单元素数组），渲染复用 `UnifiedDiffPreview` 的多文件能力，点击跳转用 `data-preview-diff-path` 锚点。

**Tech Stack:** Go（hub reporter + protocol route table）、React 19 + TS、jest（jsdom/源码断言）、go test。

**工作目录：** 所有路径相对 worktree 根 `.worktree/feat-git-commit-diff-page/`。

**关键背景（不要重新探索）：**
- Server 方法分发在 `server/internal/hub/reporter.go:789-806`；单文件 handler `replyGitCommitFileDiff` 在 :2702-2750（新方法仿它去掉 path）；`validateGitRevision`/`gitRevisionArgs` 在 `server/internal/hub/git_args.go`（`"HEAD"` 可通过校验）；正向测试 fixture 是 `TestReporterFSHashNegotiationAndGitStatus`（`hub_test.go:4713-4849`，repo 里 HEAD 提交含 hello.txt 内容 alpha/beta）。
- App 加载在 `WorkspaceApp.tsx:8496-8538`（`loadRestoredPreviewTab` git-diff 分支）；打开在 :8389-8412（`openGitDiffPreview`）；渲染在 :20485-20502；`togglePromptArtifactPreviewFile` 在 :17146-17164（git 版仿它）；`gitBrowserStore.snapshot` 可在回调内直接读（:5467-5475）。
- 拆分器 `splitUnifiedDiffFileBlocks` 在 `app/web/src/git/unifiedDiffFiles.ts`（已有测试）。
- 会受影响的测试：`app/__tests__/web-preview-workbench-state.test.ts:427-436, 630-683`、`web-git-browser-workspace.test.tsx:25-30`、`web-workspace-tab-removal.test.ts:56`（断言 service 方法签名，保留不动）。

---

### Task 1: Server — `project.git.commit.diff` 方法

**Files:**
- Modify: `server/internal/protocol/registry_methods.go`（:93 后、:228 后）
- Modify: `server/internal/hub/reporter.go`（:797 后、:2750 后）
- Test: `server/internal/protocol/registry_methods_test.go:449`、`server/internal/hub/hub_test.go:4606 与 :4848 后`

- [ ] **Step 1: 写失败的测试**

`server/internal/protocol/registry_methods_test.go` 在 `"project.git.commit.fileDiff",`（:449）后插入：

```go
		"project.git.commit.diff",
```

`server/internal/hub/hub_test.go` 注入用例表（:4605-4608 区域）在 `{name: "sha diff", method: "project.git.commit.fileDiff", payload: map[string]any{"sha": "--help", "path": "tracked.txt"}},` 后插入：

```go
		{name: "commit diff", method: "project.git.commit.diff", payload: map[string]any{"sha": "--help"}},
```

`server/internal/hub/hub_test.go` 的 `TestReporterFSHashNegotiationAndGitStatus` 末尾（:4848 的 `}` 之前）追加正向用例：

```go
	mustWriteJSON(t, app, testEnvelope{
		RequestID: 9,
		Type:      "request",
		Method:    "project.git.commit.diff",
		ProjectID: rp.ProjectID("hub-hash", "proj1"),
		Payload:   map[string]any{"sha": "HEAD", "contextLines": 2},
	})
	commitDiffResp := mustReadResponseEnvelope(t, app, 9)
	commitDiffText, _ := commitDiffResp.Payload["diff"].(string)
	if !strings.Contains(commitDiffText, "diff --git") || !strings.Contains(commitDiffText, "hello.txt") {
		t.Fatalf("unexpected commit diff: %q", commitDiffText)
	}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && go test ./internal/protocol/ ./internal/hub/ -run 'TestRegistry|TestReporter' -count=1 2>&1 | tail -20`
Expected: FAIL —— `project.git.commit.diff should be registered`、注入用例报 `unsupported method on hub` 差异、正向用例无 diff。

- [ ] **Step 3: 实现**

`server/internal/protocol/registry_methods.go`：

1) 常量区 `RegistryMethodProjectGitCommitFileDiff`（:93）后插入：

```go
	RegistryMethodProjectGitCommitDiff          = "project.git.commit.diff"
```

2) 路由表 `RegistryMethodProjectGitCommitFileDiff:`（:228）后插入：

```go
	RegistryMethodProjectGitCommitDiff:          registryProjectMethod(RegistryMethodProjectGitCommitDiff, RegistryRouteProjectForward),
```

`server/internal/hub/reporter.go`：

3) 分发 switch 中 `case rp.RegistryMethodProjectGitCommitFileDiff:` 块（:797-798）后插入：

```go
	case rp.RegistryMethodProjectGitCommitDiff:
		r.replyGitCommitDiff(conn, in)
```

4) `replyGitCommitFileDiff` 函数（:2750 结尾）后新增：

```go
func (r *Reporter) replyGitCommitDiff(conn *websocket.Conn, req envelope) {
	type payload struct {
		SHA          string `json:"sha"`
		ContextLines int    `json:"contextLines,omitempty"`
	}
	var p payload
	if err := decodePayload(req.Payload, &p); err != nil {
		_ = r.writeError(conn, req.RequestID, codeInvalidArgument, "invalid git.commit.diff payload")
		return
	}
	sha, err := validateGitRevision(p.SHA)
	if err != nil {
		_ = r.writeError(conn, req.RequestID, codeInvalidArgument, "invalid git.commit.diff revision")
		return
	}
	p.SHA = sha
	root, err := r.projectRoot(req.ProjectID)
	if err != nil {
		_ = r.writeError(conn, req.RequestID, codeNotFound, err.Error())
		return
	}
	contextLines := p.ContextLines
	if contextLines < 0 || contextLines > 20 {
		contextLines = 3
	}
	revisionArgs, _ := gitRevisionArgs(p.SHA)
	args := append([]string{"show", "--no-color", fmt.Sprintf("--unified=%d", contextLines)}, revisionArgs...)
	diff, err := runGit(root, args...)
	if err != nil {
		_ = r.writeError(conn, req.RequestID, codeInternal, err.Error())
		return
	}
	_ = r.writeJSON(conn, "->", envelope{
		RequestID: req.RequestID,
		Type:      rp.RegistryEnvelopeTypeResponse,
		Method:    req.Method,
		ProjectID: req.ProjectID,
		Payload: rp.MustRaw(map[string]any{
			"sha":  p.SHA,
			"diff": diff,
		}),
	})
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd server && go test ./internal/protocol/ ./internal/hub/ -count=1 2>&1 | tail -5`
Expected: PASS（ok 两个包）

- [ ] **Step 5: Commit**

```bash
cd .worktree/feat-git-commit-diff-page
git add server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go server/internal/hub/reporter.go server/internal/hub/hub_test.go
git commit -m "feat(registry): add project.git.commit.diff for whole-commit diffs"
```

---

### Task 2: App 数据层 — 常量 + Repository + Service

**Files:**
- Modify: `app/web/src/registry/registryMethods.ts:32 后`
- Modify: `app/web/src/registry/registryTypes.ts:1262 后`
- Modify: `app/web/src/registry/RegistryRepository.ts:1552 后`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts:506 后`

薄封装层，无独立行为测试；类型检查 + Task 4 的加载断言覆盖。

- [ ] **Step 1: 加常量与类型**

`registryMethods.ts` 在 `ProjectGitCommitFileDiff: 'project.git.commit.fileDiff',`（:32）后插入：

```ts
  ProjectGitCommitDiff: 'project.git.commit.diff',
```

`registryTypes.ts` 在 `RegistryGitFileDiff` interface（:1256-1262）后插入：

```ts
export interface RegistryGitCommitDiff {
  sha: string;
  diff: string;
}
```

- [ ] **Step 2: Repository 方法**

`RegistryRepository.ts` 在 `gitCommitFileDiff` 方法（:1534-1553 区域）结束后插入：

```ts
  async gitCommitDiff(
    projectId: string,
    sha: string,
    contextLines = 3,
  ): Promise<RegistryGitCommitDiff> {
    const resp = await this.client.request({
      method: RegistryMethods.ProjectGitCommitDiff,
      projectId,
      payload: { sha, contextLines },
      timeoutMs: 30000,
    });
    const payload = (resp.payload ?? {}) as RegistryGitCommitDiff;
    return {
      sha: payload.sha ?? sha,
      diff: payload.diff ?? '',
    };
  }
```

- [ ] **Step 3: Service 方法**

`RegistryWorkspaceService.ts` 在 `readProjectGitFileDiff`（:497-506）后插入：

```ts
  async readProjectGitCommitDiff(
    projectId: string,
    sha: string,
  ): Promise<RegistryGitCommitDiff> {
    if (!this.repository || !projectId) {
      return {sha, diff: ''};
    }
    return this.repository.gitCommitDiff(projectId, sha, 3);
  }
```

并确认 `RegistryGitCommitDiff` 已加入该文件的类型 import（与 `RegistryGitFileDiff` 同一来源 `registryTypes`）。

- [ ] **Step 4: 类型检查 + Commit**

Run: `cd app && npm run tsc:web`
Expected: 无错

```bash
git add app/web/src/registry/registryMethods.ts app/web/src/registry/registryTypes.ts app/web/src/registry/RegistryRepository.ts app/web/src/registry/RegistryWorkspaceService.ts
git commit -m "feat(app): add readProjectGitCommitDiff service path"
```

---

### Task 3: 状态层 — git-diff tab 改 files[] + activeFilePath

**Files:**
- Modify: `app/web/src/preview/previewWorkbenchState.ts`
- Test: `app/__tests__/web-preview-workbench-state.test.ts:427-436, 630-683`

- [ ] **Step 1: 改测试为失败状态**

`app/__tests__/web-preview-workbench-state.test.ts`：

1) 'creates stable commit and worktree git diff tab ids'（:427-436）：commit 期望改为提交粒度：

```ts
    expect(previewTabId({
      type: 'git-diff',
      source: {kind: 'commit', sha: 'abc', path: 'src/a.ts'},
    })).toBe('git-diff:commit:abc');
```

2) 'searches git diff content and resolves its repository path'（:630-654）整段替换为：

```ts
  test('searches git diff content and resolves its repository path', () => {
    const state = openPreviewTab(createPreviewWorkbenchState('p1'), {
      type: 'git-diff',
      projectId: 'p1',
      title: 'a.ts',
      source: {kind: 'commit', sha: 'abc', path: 'src/a.ts'},
      files: [{path: 'src/a.ts', status: 'M', additions: 2, deletions: 1}],
      activeFilePath: 'src/a.ts',
    });
    const loaded = updatePreviewTabAfterLoad(
      state,
      'p1',
      'git-diff:commit:abc',
      0,
      tab => tab.type === 'git-diff'
        ? {...tab, files: tab.files.map(file => ({...file, diff: '@@ -1 +1 @@\n+needle'}))}
        : tab,
    );
    const tab = activePreviewTab(loaded)!;

    expect(resolvePreviewDesktopFilePath(tab)).toBe('src/a.ts');
    expect(buildPreviewSearchMatches(tab, 'needle')).toMatchObject([
      {kind: 'diff', path: 'src/a.ts', line: 2},
    ]);
    expect(previewSearchDocumentKey(tab)).toContain('needle');
  });
```

3) 'round trips git diff descriptors without persisting content'（:656-683）整段替换为：

```ts
  test('round trips git diff descriptors without persisting content', () => {
    const state = openPreviewTab(createPreviewWorkbenchState('p1'), {
      type: 'git-diff',
      projectId: 'p1',
      title: 'a.ts',
      source: {kind: 'commit', sha: 'abc', path: 'src/a.ts'},
      files: [{path: 'src/a.ts', status: 'M', additions: 2, deletions: 1}],
      activeFilePath: 'src/a.ts',
    });
    const loaded = updatePreviewTabAfterLoad(
      state,
      'p1',
      'git-diff:commit:abc',
      0,
      tab => tab.type === 'git-diff'
        ? {...tab, files: tab.files.map(file => ({...file, diff: 'diff --git a/src/a.ts b/src/a.ts'}))}
        : tab,
    );
    const snapshot = previewWorkbenchSnapshotFromState({...loaded, drawerMode: 'git'});

    expect(JSON.stringify(snapshot)).not.toContain('diff --git');
    const restored = previewWorkbenchStateFromSnapshot(snapshot);
    expect(restored).toMatchObject({drawerMode: 'git'});
    expect(activePreviewTab(restored)).toMatchObject({
      type: 'git-diff',
      source: {kind: 'commit', sha: 'abc', path: 'src/a.ts'},
      files: [{path: 'src/a.ts', diff: ''}],
      activeFilePath: 'src/a.ts',
    });
  });
```

4) 新增 merge 保留已加载 diff 的用例（追加到该 describe 末尾）：

```ts
  test('re-opening a loaded commit tab keeps fetched diffs and moves the active file', () => {
    const opened = openPreviewTab(createPreviewWorkbenchState('p1'), {
      type: 'git-diff',
      projectId: 'p1',
      title: 'Ship Git',
      source: {kind: 'commit', sha: 'abc', path: 'src/a.ts'},
      files: [
        {path: 'src/a.ts', status: 'M', additions: 2, deletions: 1},
        {path: 'src/b.ts', status: 'A', additions: 5, deletions: 0},
      ],
      activeFilePath: 'src/a.ts',
    });
    const loaded = updatePreviewTab(opened, 'p1', 'git-diff:commit:abc', tab =>
      tab.type === 'git-diff'
        ? {...tab, files: tab.files.map(file => ({...file, diff: `diff-for-${file.path}`}))}
        : tab,
    );
    const reopened = openPreviewTab(loaded, {
      type: 'git-diff',
      projectId: 'p1',
      title: 'Ship Git',
      source: {kind: 'commit', sha: 'abc', path: 'src/b.ts'},
      files: [
        {path: 'src/a.ts', status: 'M', additions: 2, deletions: 1},
        {path: 'src/b.ts', status: 'A', additions: 5, deletions: 0},
      ],
      activeFilePath: 'src/b.ts',
    });
    const tab = activePreviewTab(reopened)!;

    expect(tab.id).toBe('git-diff:commit:abc');
    expect(tab.type === 'git-diff' ? tab.activeFilePath : '').toBe('src/b.ts');
    expect(tab.type === 'git-diff' ? tab.files.map(file => file.diff) : []).toEqual([
      'diff-for-src/a.ts',
      'diff-for-src/b.ts',
    ]);
  });
```

注意：`updatePreviewTab` 需要在测试 import 中（该文件已 import 一批 state 函数，缺则补）。

- [ ] **Step 2: 运行确认失败**

Run: `cd app && npx jest __tests__/web-preview-workbench-state.test.ts`
Expected: FAIL —— tab id 不符、`files`/`activeFilePath` 输入不被识别。

- [ ] **Step 3: 实现状态层改造**

`app/web/src/preview/previewWorkbenchState.ts` 按以下要点改（只列变更块）：

1) `GitDiffPreviewTab`（:58-64）改为：

```ts
export type GitDiffPreviewTab = PreviewWorkbenchTabBase & {
  type: 'git-diff';
  source: GitDiffSource;
  files: GitDiffPreviewFile[];
  activeFilePath: string;
  loadedWorktreeRev: string;
};
```

2) `PreviewWorkbenchOpenInput` 的 git-diff 分支（:129-137）改为：

```ts
    | {
        type: 'git-diff';
        projectId: string;
        title: string;
        source: GitDiffSource;
        files: GitDiffFileMeta[];
        activeFilePath?: string;
        loadedWorktreeRev?: string;
      };
```

3) `PreviewWorkbenchSnapshotGitDiffTab`（:178-185）改为：

```ts
export type PreviewWorkbenchSnapshotGitDiffTab = {
  type: 'git-diff';
  projectId: string;
  title: string;
  source: GitDiffSource;
  files: Array<GitDiffFileMeta & {expanded: boolean}>;
  activeFilePath?: string;
  loadedWorktreeRev: string;
};
```

4) `resolvePreviewDesktopFilePath`（:275-286）的 git-diff 分支改为：

```ts
  if (tab.type === 'git-diff') {
    return tab.activeFilePath || tab.source.path;
  }
```

5) `previewTabId`（:295-298）的 git-diff 分支改为：

```ts
    case 'git-diff': // fallthrough of input.type === 'git-diff'
```

即：

```ts
  if (input.type === 'git-diff') {
    return input.source.kind === 'commit'
      ? `git-diff:commit:${input.source.sha}`
      : `git-diff:worktree:${input.source.scope}:${input.source.path}`;
  }
```

6) `previewWorkbenchTabTooltip`（:331-334）的 git-diff 分支改为：

```ts
  if (tab.type === 'git-diff') {
    return tab.source.kind === 'commit'
      ? [tab.title, tab.source.sha, fileCountLabel(tab.files.length)].filter(Boolean).join(' - ')
      : [tab.activeFilePath, 'Working Tree', tab.source.scope].filter(Boolean).join(' - ');
  }
```

7) `previewWorkbenchHeaderTitle`（:355-360）的 git-diff 分支改为：

```ts
  if (tab.type === 'git-diff') {
    const context = tab.source.kind === 'commit'
      ? tab.source.sha.slice(0, 8)
      : 'Working Tree';
    const target = tab.source.kind === 'commit'
      ? fileCountLabel(tab.files.length)
      : tab.activeFilePath;
    return `Git diff · ${context} · ${target}`;
  }
```

8) `buildPreviewSearchMatches`（:392-398）的 git-diff 分支改为：

```ts
  if (tab.type === 'git-diff') {
    return tab.files.flatMap(file =>
      file.diff
        .split('\n')
        .map((text, index) => ({kind: 'diff' as const, path: file.path, line: index + 1, text}))
        .filter(match => match.text.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }
```

9) `previewSearchDocumentKey`（:413-415）的 git-diff 分支改为：

```ts
  if (tab.type === 'git-diff') {
    return tab.files
      .map(file => `${file.path}\0${file.diff}`)
      .join('');
  }
```

10) `createTab`（:779-784）的 git-diff 分支改为：

```ts
  if (input.type === 'git-diff') {
    return {
      ...base,
      type: 'git-diff',
      source: input.source,
      files: input.files.map(file => ({
        ...file,
        diff: '',
        expanded: true,
        isBinary: false,
        truncated: false,
      })),
      activeFilePath: resolvePromptDiffActiveFilePath(input.files, input.activeFilePath ?? input.source.path),
      loadedWorktreeRev: input.loadedWorktreeRev ?? '',
    };
  }
```

11) `previewSnapshotTab`（:479-493）的 git-diff 分支改为：

```ts
  if (tab.type === 'git-diff') {
    return {
      type: 'git-diff',
      projectId: tab.projectId,
      title: tab.title,
      source: tab.source,
      files: tab.files.map(file => ({
        path: file.path,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        expanded: file.expanded,
      })),
      activeFilePath: tab.activeFilePath,
      loadedWorktreeRev: '',
    };
  }
```

12) `previewSnapshotInput`（:573-586）的 git-diff 分支改为：

```ts
  if (tab.type === 'git-diff') {
    return {
      type: 'git-diff',
      projectId: tab.projectId,
      title: tab.title,
      source: tab.source,
      files: tab.files.map(file => ({
        path: file.path,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
      })),
      activeFilePath: tab.activeFilePath,
      loadedWorktreeRev: '',
    };
  }
```

13) `mergeTab`（:824-832）的 git-diff 分支改为（重开时按 path 保留已加载内容）：

```ts
  if (existing.type === 'git-diff' && input.type === 'git-diff') {
    return {
      ...existing,
      title: input.title,
      source: input.source,
      files: input.files.map(file => {
        const existingFile = existing.files.find(item => item.path === file.path);
        return existingFile
          ? {...existingFile, ...file, diff: existingFile.diff, expanded: existingFile.expanded, isBinary: existingFile.isBinary, truncated: existingFile.truncated}
          : {...file, diff: '', expanded: true, isBinary: false, truncated: false};
      }),
      activeFilePath: resolvePromptDiffActiveFilePath(
        input.files,
        input.activeFilePath !== undefined ? input.activeFilePath : existing.activeFilePath,
      ),
      loadedWorktreeRev: input.loadedWorktreeRev ?? existing.loadedWorktreeRev,
    };
  }
```

14) `validPreviewInput`（:429-433）的 git-diff 分支保持 `hasText(input.source.path) && (worktree || hasText(sha))` 不变。

- [ ] **Step 4: 运行确认通过**

Run: `cd app && npx jest __tests__/web-preview-workbench-state.test.ts && npm run tsc:web 2>&1 | tail -20`
Expected: 测试 PASS；tsc 报 WorkspaceApp 里 `tab.file` 相关错误（Task 4 修）——状态层测试必须先绿，tsc 错误清单作为 Task 4 的定位表。

- [ ] **Step 5: Commit**

```bash
git add app/web/src/preview/previewWorkbenchState.ts app/__tests__/web-preview-workbench-state.test.ts
git commit -m "feat(preview): model git diff tabs as per-commit file lists"
```

---

### Task 4: WorkspaceApp — 打开/加载/渲染/跳转

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`（:8389-8412 open、:8496-8538 load、:17146 附近 toggle、:20485-20502 render、跳转 effect）
- Modify: `app/__tests__/web-git-browser-workspace.test.tsx:25-30`

- [ ] **Step 1: 改源码断言为失败状态**

`app/__tests__/web-git-browser-workspace.test.tsx`：

- :25 `expect(main).toContain('service.readProjectGitFileDiff(tab.projectId, tab.source.sha, tab.source.path)');` 改为：

```ts
    expect(main).toContain('service.readProjectGitCommitDiff(tab.projectId, tab.source.sha)');
```

- :30 附近的 `activeTab.loadedWorktreeRev !== previewGitSnapshot.worktreeRev` 保持不变；在 :25 断言后追加：

```ts
    expect(main).toContain('splitUnifiedDiffFileBlocks(result.diff)');
    expect(main).toContain('const toggleGitDiffPreviewFile = useCallback((path: string) => {');
    expect(main).toContain('data-preview-diff-path');
```

并确认文件顶部对 `unifiedDiffFiles` 无额外 import 断言需求（仅字符串断言 `main`）。

- [ ] **Step 2: 运行确认失败**

Run: `cd app && npx jest __tests__/web-git-browser-workspace.test.tsx`
Expected: FAIL —— 新方法名/拆分器/toggle 尚不存在。

- [ ] **Step 3: 实现**

1) import 区：`WorkspaceApp.tsx` 顶部加入（与 `splitUnifiedDiffFileBlocks` 同目录已有 import 组）：

```ts
import {splitUnifiedDiffFileBlocks} from '../git/unifiedDiffFiles';
```

2) `openGitDiffPreview`（:8389-8412）整体替换为：

```tsx
  const openGitDiffPreview = useCallback((
    targetProjectId: string,
    source: GitDiffSource,
    file: GitDiffFileMeta,
  ) => {
    if (!targetProjectId) return;
    setChatPreviewManualOpen(false);
    setChatPreviewManualCollapsed(false);
    const tabId = previewTabId({type: 'git-diff', source});
    const snapshot = gitBrowserStore.snapshot[targetProjectId] ?? gitBrowserStore.project(targetProjectId);
    const commitFiles = source.kind === 'commit'
      ? snapshot.commitFilesBySha[source.sha] ?? []
      : [];
    const files: GitDiffFileMeta[] = source.kind === 'commit' && commitFiles.length > 0
      ? commitFiles.map(item => ({
          path: item.path,
          status: item.status,
          additions: item.additions,
          deletions: item.deletions,
        }))
      : [{path: file.path, status: file.status, additions: file.additions, deletions: file.deletions}];
    const title = source.kind === 'commit'
      ? snapshot.commits.find(commit => commit.sha === source.sha)?.title || source.sha.slice(0, 8)
      : file.path.split('/').pop() || file.path;
    setPreviewWorkbench(current => {
      const opened = openPreviewTab(current, {
        type: 'git-diff',
        projectId: targetProjectId,
        title,
        source,
        files,
        activeFilePath: source.path,
      });
      return updatePreviewTab(opened, targetProjectId, tabId, tab =>
        tab.type === 'git-diff' && tab.error
          ? {...tab, error: '', requestId: 0}
          : tab,
      );
    });
  }, []);
```

3) `loadRestoredPreviewTab` 的 git-diff commit 分支（:8499-8538）改为（worktree 分支不变）：

```tsx
        const result = tab.source.kind === 'commit'
          ? await service.readProjectGitCommitDiff(tab.projectId, tab.source.sha)
          : await service.readProjectWorkingTreeFileDiff(
            tab.projectId,
            tab.source.path,
            tab.source.scope,
          );
        if (tab.source.kind === 'commit') {
          const commitResult = result as RegistryGitCommitDiff;
          const diffByPath = new Map(
            splitUnifiedDiffFileBlocks(commitResult.diff).map(block => [block.path, block.diff]),
          );
          setPreviewWorkbench(current =>
            updatePreviewTabAfterLoad(current, tab.projectId, tab.id, requestSeq, currentTab =>
              currentTab.type === 'git-diff'
                ? {
                  ...currentTab,
                  files: currentTab.files.map(file => {
                    const fileDiff = diffByPath.get(file.path) ?? '';
                    return {
                      ...file,
                      diff: fileDiff,
                      expanded: file.expanded,
                      isBinary: fileDiff.includes('Binary files'),
                      truncated: false,
                    };
                  }),
                  loading: false,
                  error: '',
                }
                : currentTab,
            ),
          );
          return;
        }
        setPreviewWorkbench(current =>
          updatePreviewTabAfterLoad(current, tab.projectId, tab.id, requestSeq, currentTab =>
            currentTab.type === 'git-diff'
              ? {
                ...currentTab,
                files: currentTab.files.map(file =>
                  file.path === (result as RegistryWorkingTreeFileDiff).path
                    ? {
                      ...file,
                      diff: (result as RegistryWorkingTreeFileDiff).diff,
                      expanded: true,
                      isBinary: (result as RegistryWorkingTreeFileDiff).isBinary,
                      truncated: (result as RegistryWorkingTreeFileDiff).truncated,
                    }
                    : file,
                ),
                loadedWorktreeRev: projectGitSnapshot.worktreeRev,
                loading: false,
                error: '',
              }
              : currentTab,
          ),
        );
        return;
```

说明：commit 分支不写 `loadedWorktreeRev`（worktree 专用）；`RegistryGitCommitDiff`/`RegistryWorkingTreeFileDiff` 类型需在文件已有 registryTypes import 中补齐（若无）。

4) 在 `togglePromptArtifactPreviewFile`（:17146-17164）后新增：

```tsx
  const toggleGitDiffPreviewFile = useCallback((path: string) => {
    const tab = activePreviewTab(previewWorkbenchRef.current);
    if (!tab || tab.type !== 'git-diff') {
      return;
    }
    setPreviewWorkbench(current =>
      updatePreviewTab(current, tab.projectId, tab.id, item =>
        item.type === 'git-diff'
          ? {
              ...item,
              activeFilePath: path,
              files: item.files.map(file =>
                file.path === path ? {...file, expanded: !file.expanded} : file,
              ),
            }
          : item,
      ),
    );
  }, []);
```

5) git-diff 渲染分支（:20485-20502）替换为：

```tsx
    if (tab.type === 'git-diff') {
      return (
        <UnifiedDiffPreview
          files={tab.files}
          activeFilePath={tab.activeFilePath}
          loading={tab.loading}
          error={tab.error}
          overviewLabel={tab.source.kind === 'commit'
            ? `${tab.source.sha.slice(0, 7)} · ${tab.files.length} files`
            : `${tab.source.scope} · ${tab.activeFilePath}`}
          onToggleFile={toggleGitDiffPreviewFile}
          themeMode={themeMode}
          codeTheme={codeTheme}
          codeFont={codeFont}
          codeFontFamily={codeFontFamily}
          codeFontSize={codeFontSize}
          codeLineHeight={codeLineHeight}
          codeTabSize={codeTabSize}
        />
      );
    }
```

6) 跳转 effect：在 `useEffect`（:8657 的 git-diff 加载 effect）后新增：

```tsx
  useEffect(() => {
    const activeTab = activePreviewTab(previewWorkbench);
    if (activeTab?.type !== 'git-diff' || activeTab.source.kind !== 'commit' || activeTab.loading) {
      return;
    }
    const container = chatFilePeekScrollRef.current;
    if (!container) {
      return;
    }
    const section = Array.from(
      container.querySelectorAll<HTMLElement>('[data-preview-diff-path]'),
    ).find(node => node.dataset.previewDiffPath === activeTab.activeFilePath);
    section?.scrollIntoView({block: 'start'});
  }, [previewWorkbench]);
```

（commit tab 每次 activeFilePath/内容变化后把当前文件区块滚动到顶部；worktree 单文件无需滚动。）

- [ ] **Step 4: 运行确认通过**

Run: `cd app && npx jest __tests__/web-git-browser-workspace.test.tsx __tests__/web-preview-workbench-state.test.ts && npm run tsc:web`
Expected: PASS / 无错

- [ ] **Step 5: 全量 jest（收编其他断言连带）**

Run: `cd app && npx jest 2>&1 | tail -15`
Expected: 全绿；若其他源码断言（如 `openGitDiffPreview` 结构、tooltip 文本）连带失败，按本任务的既定形态就地同步该断言，不放宽语义。

- [ ] **Step 6: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/__tests__/web-git-browser-workspace.test.tsx
git commit -m "feat(preview): open whole-commit diffs in a single tab"
```

---

### Task 5: 全量验证 + wiki/spec 文档提交

- [ ] **Step 1: Server 全量**

Run: `cd server && go test ./... -count=1 2>&1 | tail -10`
Expected: 全部 ok

- [ ] **Step 2: App 全量 + 构建**

Run: `cd app && npx jest && npm run tsc:web && npm run build:web`
Expected: jest 全绿（除会话开始已知的 2 个 Hub menu 陈旧断言——若仍存在则单独注明）、tsc 无错、webpack 成功

- [ ] **Step 3: 提交文档**

```bash
git add docs/scope/2026-08-06-git-commit-diff-page.md docs/wiki/features/git-browser.md docs/wiki/protocols/registry.md
git commit -m "docs(git): spec, plan, and wiki for whole-commit diff page"
```

- [ ] **Step 4: 人工验收清单（交回用户确认）**

- git 抽屉点 commit 文件：单 tab 展示整提交；再点同提交其他文件 → 不新开 tab、滚动到对应区块；文件头可折叠。
- tab 标题为提交标题、头部为 `Git diff · <短sha> · N files`；tooltip 含完整 sha。
- 右键菜单的复制路径/VS Code 等按当前定位文件生效；预览内搜索能命中整提交任意文件。
- worktree 文件与桌面 Git 状态卡行为不变；刷新页面恢复后重新拉取整提交 diff。

---

## 自我审查记录

- **Spec 覆盖**：新方法（T1）、App 数据层（T2）、tab 模型+snapshot+搜索+tooltip/标题（T3）、打开/加载/渲染/跳转（T4）、双端验证与验收（T5）。范围之外项（worktree 汇总、截断、protocol version）无任务。`project.git.commit.fileDiff` 方法保留不删（其他客户端可能调用，App 侧 commit 分支停用即可）。
- **占位符**：无 TBD；所有代码块完整（含 Go handler、状态层 14 处变更、WorkspaceApp 6 处变更）。
- **类型一致**：`readProjectGitCommitDiff(projectId, sha)`/`gitCommitDiff(projectId, sha, contextLines)`/`RegistryGitCommitDiff{sha,diff}` 三层一致；tab 输入 `files: GitDiffFileMeta[]` + `activeFilePath?` 在 open/merge/create/snapshot/restore 五处一致；`toggleGitDiffPreviewFile` 在 T4 定义并被渲染分支引用；断言文本与实现字符串逐字一致。
