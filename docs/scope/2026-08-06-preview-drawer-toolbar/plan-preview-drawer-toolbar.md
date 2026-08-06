# Preview 文件/Git 抽屉与工具条优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Preview workbench 的文件/Git 展开入口重做为统一风格的悬浮竖排工具条，PC 端 drawer 外置到 preview 左侧（portal 覆盖 chat 列），搜索收进 drawer 面板，并精修文件树与 Git 面板行视觉。

**Architecture:** `PreviewWorkbenchChrome` 仍是工具条/drawer 宿主，新增 `drawerPortalTarget` prop：desktop 模式把 drawer 面板 `createPortal` 到 `WorkspaceApp` 渲染在 `.body` 里的挂载层（`.chat-preview-drawer-host`，绝对定位在 preview 左缘外侧），绕过 `.chat-preview-pane` 的 `overflow: hidden`；mobile 不传 target，面板维持内联。外点关闭/Esc 逻辑不变（基于 DOM contains，对 portal 天然兼容）。行视觉全部落在 `file.css`/`git.css`，缩进参考线通过 `tree-children` 包裹层实现。

**Tech Stack:** React 19 + react-dom portal、jest 30（jsdom docblock + react-dom/client 交互测试；`__tests__/` 源码断言测试）、纯 CSS（主题变量）。

**工作目录：** 所有路径相对 worktree 根 `.worktree/feat-preview-drawer-toolbar/`。

**关键背景（不要重新探索）：**
- `PreviewWorkbenchChrome.tsx:200-242` 是现有 tools+panel JSX；`:118-152` 是外点/Esc 关闭 effect（保持不变）。
- `WorkspaceApp.tsx:20627` `renderPreviewWorkbenchSurface(mode)`；`:20663-20681` `chatPreviewDesktopPane`；`:19737` `previewFileTreeDepthIndent = 8`；`:19780-19834` `renderPreviewFileTreeSearchResults`；`:20592-20615` `previewFileTreeSearch` JSX（不变，只换挂载点）。
- `shell.css:962` `.body` 无定位；`file.css:383-590` 是 drawer 相关样式区。
- 源码断言测试：`app/__tests__/web-chat-file-peek-viewer.test.ts:476-544` 会随改动更新（每个 Task 内附带更新，不积压）。
- 交互测试模式参照 `app/web/src/common/Tooltip.test.tsx`（jsdom + createRoot + act）。

---

### Task 1: PreviewWorkbenchChrome 交互测试（RED）

**Files:**
- Create: `app/web/src/preview/PreviewWorkbenchChrome.test.tsx`

- [ ] **Step 1: 写失败的交互测试**

创建 `app/web/src/preview/PreviewWorkbenchChrome.test.tsx`：

```tsx
/**
 * @jest-environment jsdom
 */
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

import {PreviewWorkbenchChrome} from './PreviewWorkbenchChrome';

(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

function createProps(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'desktop' as const,
    activeTab: null,
    tabs: [],
    drawerMode: 'closed' as const,
    fileDrawer: <div data-testid="file-drawer">files</div>,
    fileDrawerSearch: <input aria-label="Search files" />,
    gitDrawer: <div data-testid="git-drawer">git</div>,
    onDrawerModeChange: jest.fn(),
    actionsMenuOpen: false,
    onClose: jest.fn(),
    onTabSelect: jest.fn(),
    onTabClose: jest.fn(),
    onActionsMenuToggle: jest.fn(),
    onActionsMenuClose: jest.fn(),
    children: <div data-testid="preview-body">body</div>,
    ...overrides,
  };
}

describe('PreviewWorkbenchChrome drawer', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
    }
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = '';
  });

  const render = (props: ReturnType<typeof createProps>) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<PreviewWorkbenchChrome {...props} />));
  };

  const pointerDown = (target: Element) => {
    act(() => {
      target.dispatchEvent(new window.MouseEvent('pointerdown', {bubbles: true, cancelable: true}));
    });
  };

  const escape = () => {
    act(() => {
      document.body.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
    });
  };

  test('tool buttons toggle files and git drawer modes', () => {
    const props = createProps();
    render(props);
    const filesButton = document.querySelector('[aria-label="Toggle files"]') as HTMLButtonElement;
    const gitButton = document.querySelector('[aria-label="Toggle Git history"]') as HTMLButtonElement;
    expect(filesButton.className).toContain('preview-workbench-drawer-tool');

    act(() => filesButton.click());
    expect(props.onDrawerModeChange).toHaveBeenLastCalledWith('files');
    act(() => gitButton.click());
    expect(props.onDrawerModeChange).toHaveBeenLastCalledWith('git');
  });

  test('clicking the active tool button closes the drawer', () => {
    const props = createProps({drawerMode: 'files'});
    render(props);
    const filesButton = document.querySelector('[aria-label="Toggle files"]') as HTMLButtonElement;
    act(() => filesButton.click());
    expect(props.onDrawerModeChange).toHaveBeenLastCalledWith('closed');
  });

  test('files drawer renders the search header inside the panel; git drawer does not', () => {
    const props = createProps({drawerMode: 'files'});
    render(props);
    const panel = document.querySelector('.preview-workbench-drawer-panel') as HTMLElement;
    expect(panel.querySelector('.preview-workbench-drawer-search')).toBeTruthy();
    expect(panel.querySelector('[data-testid="file-drawer"]')).toBeTruthy();

    render(createProps({drawerMode: 'git'}));
    const gitPanel = document.querySelector('.preview-workbench-drawer-panel') as HTMLElement;
    expect(gitPanel.querySelector('.preview-workbench-drawer-search')).toBeNull();
    expect(gitPanel.querySelector('[data-testid="git-drawer"]')).toBeTruthy();
  });

  test('outside pointerdown closes the drawer; pointerdown inside panel or tools does not', () => {
    const props = createProps({drawerMode: 'files'});
    render(props);
    const panel = document.querySelector('.preview-workbench-drawer-panel') as HTMLElement;
    const tools = document.querySelector('.preview-workbench-body-tools') as HTMLElement;

    pointerDown(panel);
    pointerDown(tools);
    expect(props.onDrawerModeChange).not.toHaveBeenCalled();

    pointerDown(document.body);
    expect(props.onDrawerModeChange).toHaveBeenCalledWith('closed');
  });

  test('Escape closes the drawer', () => {
    const props = createProps({drawerMode: 'git'});
    render(props);
    escape();
    expect(props.onDrawerModeChange).toHaveBeenCalledWith('closed');
  });

  test('desktop portals the panel into drawerPortalTarget with the external class', () => {
    const host = document.createElement('div');
    host.className = 'chat-preview-drawer-host';
    document.body.appendChild(host);
    render(createProps({drawerMode: 'files', drawerPortalTarget: host}));

    const external = host.querySelector('.preview-workbench-drawer-panel.external');
    expect(external).toBeTruthy();
    expect((external as HTMLElement).querySelector('[data-testid="file-drawer"]')).toBeTruthy();
    expect(container!.querySelector('.preview-workbench-drawer-panel')).toBeNull();
  });

  test('mobile keeps the drawer panel inline without the external class', () => {
    render(createProps({mode: 'mobile', drawerMode: 'files'}));
    const panel = container!.querySelector('.preview-workbench-drawer-panel');
    expect(panel).toBeTruthy();
    expect((panel as HTMLElement).className).not.toContain('external');
  });
});
```

注意：第二个 `render()` 调用（git 用例）复用同一套 afterEach 清理即可；`render` 每次新建 container 并重新赋值 `root`，React 会对新 root 独立挂载，旧 root 在 afterEach 里已置空前被覆盖——为稳妥，git 用例的 `render` 前先 `act(() => root!.unmount())` 不必要（每次 render 覆盖 root 引用导致旧 root 泄漏到 afterEach 之外）——所以 **files/git 用例拆成两个独立 test 也可以接受**，若运行时出现 act 警告就拆开。

若 `DesktopDragRegion`（WorkbenchChrome 依赖）在 jsdom 下因 desktop bridge 抛错，在文件顶部加：

```tsx
jest.mock('../shell/layouts/desktop/DesktopTitleBar', () => ({
  DesktopDragRegion: ({className, children}: {className?: string; children: React.ReactNode}) => (
    <div className={className}>{children}</div>
  ),
}));
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd app && npx jest web/src/preview/PreviewWorkbenchChrome.test.tsx`
Expected: FAIL —— portal/external/search-header/tool 类相关断言失败（`drawerPortalTarget` prop 尚不存在，`preview-workbench-drawer-tool`/`preview-workbench-drawer-search` 类不存在）。

- [ ] **Step 3: Commit（测试先行）**

```bash
cd .worktree/feat-preview-drawer-toolbar
git add app/web/src/preview/PreviewWorkbenchChrome.test.tsx
git commit -m "test(preview): add drawer chrome interaction tests"
```

---

### Task 2: PreviewWorkbenchChrome 重构（portal + 工具条 + 面板结构）

**Files:**
- Modify: `app/web/src/preview/PreviewWorkbenchChrome.tsx`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts:482,502`

- [ ] **Step 1: 改组件**

`app/web/src/preview/PreviewWorkbenchChrome.tsx`：

1) 顶部 import 增加 portal：

```tsx
import {createPortal} from 'react-dom';
```

2) props 类型增加（放在 `gitDrawer: React.ReactNode;` 之后）：

```tsx
  drawerPortalTarget?: HTMLElement | null;
```

3) 解构增加（放在 `gitDrawer,` 之后）：

```tsx
  drawerPortalTarget = null,
```

4) 在 `const toolbarActions = (...)` 之前，插入面板元素定义：

```tsx
  const useDrawerPortal = mode === 'desktop' && !!drawerPortalTarget;
  const drawerPanel = drawerOpen && drawerContent ? (
    <div
      ref={drawerPanelRef}
      className={`preview-workbench-drawer-panel${useDrawerPortal ? ' external' : ''}`}
    >
      {drawerMode === 'files' && fileDrawerSearch ? (
        <div className="preview-workbench-drawer-search">{fileDrawerSearch}</div>
      ) : null}
      <div className="preview-workbench-drawer-content">{drawerContent}</div>
    </div>
  ) : null;
  const renderedDrawerPanel = useDrawerPortal && drawerPanel
    ? createPortal(drawerPanel, drawerPortalTarget)
    : drawerPanel;
```

5) 用下面的 JSX **整体替换**现有 `{fileDrawer || gitDrawer ? (...)} : null}` 块（当前 200-237 行，含 search shell 与 fab-rail）和 `{drawerOpen && drawerContent ? (...)} : null}` 块（当前 238-242 行）：

```tsx
      {fileDrawer || gitDrawer ? (
        <div ref={drawerToolsRef} className="preview-workbench-body-tools">
          {fileDrawer ? (
            <button
              type="button"
              className={`preview-workbench-drawer-tool${drawerMode === 'files' ? ' active' : ''}`}
              onClick={() => onDrawerModeChange(drawerMode === 'files' ? 'closed' : 'files')}
              aria-label="Toggle files"
              data-tooltip="Toggle files"
              aria-pressed={drawerMode === 'files'}
            >
              <Icon name="files" />
            </button>
          ) : null}
          {gitDrawer ? (
            <button
              type="button"
              className={`preview-workbench-drawer-tool${drawerMode === 'git' ? ' active' : ''}`}
              onClick={() => onDrawerModeChange(drawerMode === 'git' ? 'closed' : 'git')}
              aria-label="Toggle Git history"
              data-tooltip="Toggle Git history"
              aria-pressed={drawerMode === 'git'}
            >
              <Icon name="gitBranch" />
            </button>
          ) : null}
        </div>
      ) : null}
      {renderedDrawerPanel}
```

注意：`drawerToolsRef`/`drawerPanelRef`、外点关闭 effect、`mode === 'mobile'` 的 port-relay 刷新按钮全部保留不动。`preview-workbench-tree-search-shell`、`preview-workbench-drawer-fab-rail`、`preview-workbench-drawer-fab` 三个类从组件中消失。

- [ ] **Step 2: 运行交互测试确认通过**

Run: `cd app && npx jest web/src/preview/PreviewWorkbenchChrome.test.tsx`
Expected: PASS（7 个用例）

- [ ] **Step 3: 同步源码断言**

`app/__tests__/web-chat-file-peek-viewer.test.ts`：

- 第 482 行 `expect(chromeTsx).toContain('preview-workbench-drawer-fab');` 改为：

```ts
    expect(chromeTsx).toContain('preview-workbench-drawer-tool');
    expect(chromeTsx).toContain('drawerPortalTarget');
    expect(chromeTsx).toContain('createPortal(');
```

- 第 502 行 `expect(chromeTsx).toContain('className="preview-workbench-tree-search-shell"');` 改为：

```ts
    expect(chromeTsx).toContain('className="preview-workbench-drawer-search"');
```

- [ ] **Step 4: 运行断言测试**

Run: `cd app && npx jest __tests__/web-chat-file-peek-viewer.test.ts`
Expected: 本任务改的两处通过；CSS 断言（`.preview-workbench-tree-search-shell` 仍存在旧 CSS）暂不失败——旧 CSS 删除在 Task 4。

- [ ] **Step 5: Commit**

```bash
git add app/web/src/preview/PreviewWorkbenchChrome.tsx app/web/src/preview/PreviewWorkbenchChrome.test.tsx app/__tests__/web-chat-file-peek-viewer.test.ts
git commit -m "feat(preview): portal drawer panel and restyle drawer tools rail"
```

---

### Task 3: WorkspaceApp 挂载层 + shell 定位

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`（约 :3157 state、:20632 chrome props、:20663-20681 desktop pane）
- Modify: `app/web/src/styles/shell.css:962`

- [ ] **Step 1: 加 state**

`WorkspaceApp.tsx` 在 `const previewFileTreeSearchInputRef = useRef<HTMLInputElement | null>(null);`（:3157）后一行加：

```tsx
  const [previewDrawerHost, setPreviewDrawerHost] = useState<HTMLDivElement | null>(null);
```

- [ ] **Step 2: chrome 传 portal target**

`renderPreviewWorkbenchSurface`（:20627）的 `<PreviewWorkbenchChrome` props 中，在 `drawerMode={previewWorkbench.drawerMode}` 一行后加：

```tsx
      drawerPortalTarget={mode === 'desktop' ? previewDrawerHost : null}
```

- [ ] **Step 3: desktop pane 加挂载层**

把 `chatPreviewDesktopPane`（:20663-20681）整体替换为：

```tsx
  const chatPreviewDesktopPane = isWide && chatPreviewOpen ? (
    <>
      <aside
        className="chat-preview-pane"
        style={{ '--chat-file-peek-width': `${effectiveChatFilePeekWidth}px` } as React.CSSProperties}
      >
        <button
          type="button"
          className={`chat-file-peek-resize-handle${chatFilePeekResizing ? ' resizing' : ''}`}
          aria-label="Resize preview"
          data-tooltip="Resize preview"
          onPointerDown={beginChatFilePeekResize}
          onPointerMove={moveChatFilePeekResize}
          onPointerUp={finishChatFilePeekResize}
          onPointerCancel={finishChatFilePeekResize}
          onLostPointerCapture={commitChatFilePeekResize}
        />
        {renderPreviewWorkbenchSurface('desktop')}
      </aside>
      <div
        ref={setPreviewDrawerHost}
        className="chat-preview-drawer-host"
        style={{right: `${effectiveChatFilePeekWidth}px`}}
      />
    </>
  ) : null;
```

说明：host 是 `.body` flex 行里的绝对定位层（Task 4 给 CSS），`right = preview 宽度` 使其右缘贴 preview 左缘；resize 时 `effectiveChatFilePeekWidth` 驱动重渲染自动跟随；`pointer-events: none` 在 CSS 里保证空层不挡 chat 点击。

- [ ] **Step 4: shell.css 给 `.body` 定位**

`app/web/src/styles/shell.css` 在 `.body { ... }` 规则（:962-967）后追加：

```css
.desktop-shell > .body {
  position: relative;
}
```

- [ ] **Step 5: 类型检查 + 断言测试**

Run: `cd app && npm run tsc:web && npx jest __tests__/web-chat-file-peek-viewer.test.ts`
Expected: tsc 无错；断言测试通过（本任务未触碰被断言字符串）。

- [ ] **Step 6: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/styles/shell.css
git commit -m "feat(preview): mount desktop drawer host beside preview pane"
```

---

### Task 4: drawer/工具条/搜索样式（file.css）

**Files:**
- Modify: `app/web/src/styles/file.css:383-515, 580-590`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts:489-491, 539-540`

- [ ] **Step 1: 替换工具条与 drawer 样式**

`file.css`：删除 `.preview-workbench-body-tools`（:383-393）、`.preview-workbench-tree-search-shell` 及 `[data-open='true']`（:395-429）、`.preview-workbench-drawer-fab-rail` 与 `.preview-workbench-drawer-fab` 系列（:471-503）、`.preview-workbench-drawer-panel`（:505-515），原位替换为：

```css
.preview-workbench-body-tools {
  position: absolute;
  top: 8px;
  left: 10px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.preview-workbench-drawer-tool {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 78%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-panel) 88%, transparent);
  color: var(--text-secondary);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
}

.preview-workbench-drawer-tool:hover {
  color: var(--accent-primary);
  border-color: color-mix(in srgb, var(--accent-primary) 34%, transparent);
}

.preview-workbench-drawer-tool:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-primary) 74%, transparent);
  outline-offset: 2px;
}

.preview-workbench-drawer-tool.active {
  color: var(--accent-primary);
  border-color: color-mix(in srgb, var(--accent-primary) 46%, transparent);
  background: color-mix(in srgb, var(--accent-primary) 16%, var(--surface-panel));
}

.chat-preview-drawer-host {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 30;
  width: 360px;
  pointer-events: none;
}

.preview-workbench-drawer-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--surface-panel);
}

.preview-workbench-surface .preview-workbench-drawer-panel {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 9;
  width: min(360px, calc(100% - 56px));
  border-right: 1px solid var(--border-subtle);
  box-shadow: 18px 0 48px color-mix(in srgb, #000 30%, transparent);
}

.preview-workbench-drawer-panel.external {
  width: 100%;
  height: 100%;
  pointer-events: auto;
  border-right: 1px solid var(--border-subtle);
  box-shadow: 20px 0 44px color-mix(in srgb, #000 30%, transparent);
  animation: preview-workbench-drawer-in 160ms ease;
}

@keyframes preview-workbench-drawer-in {
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.preview-workbench-drawer-search {
  flex: 0 0 auto;
  min-height: 40px;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}

.preview-workbench-drawer-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

保留：`.preview-workbench-tree-search-icon`、`.preview-workbench-tree-search-input`、`.preview-workbench-tree-tool-button`（搜索 JSX 仍用），以及 `.preview-workbench-file-tree-content`（`height: 100%; overflow: auto`，现在滚动于 drawer-content 内）。

- [ ] **Step 2: 更新移动端覆盖**

`file.css:580-590` 的移动端块替换为：

```css
.preview-workbench-surface.mobile .preview-workbench-body-tools {
  left: auto;
  right: max(10px, var(--wm-safe-area-right));
}

.preview-workbench-surface.mobile .preview-workbench-drawer-panel {
  width: min(88vw, 360px);
}
```

删除 `.preview-workbench-surface.mobile .preview-workbench-tree-search-shell[data-open='true']` 规则。

- [ ] **Step 3: 同步源码断言**

`web-chat-file-peek-viewer.test.ts`：

- 第 489-491 行区域（'files and Git toggles' 用例内），在 `expect(stylesCss).toContain('.preview-workbench-surface.mobile .preview-workbench-drawer-panel');` 后追加：

```ts
    expect(stylesCss).toContain('.chat-preview-drawer-host');
    expect(stylesCss).toContain('.preview-workbench-drawer-panel.external');
    expect(stylesCss).toContain('.preview-workbench-drawer-tool');
```

- 第 539-540 行：

```ts
    expect(stylesCss).toContain('.preview-workbench-tree-search-shell');
    expect(stylesCss).toContain(".preview-workbench-tree-search-shell[data-open='true']");
```

改为：

```ts
    expect(stylesCss).toContain('.preview-workbench-drawer-search');
    expect(stylesCss).toContain('.preview-workbench-drawer-content');
```

- [ ] **Step 4: 运行断言测试**

Run: `cd app && npx jest __tests__/web-chat-file-peek-viewer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/web/src/styles/file.css app/__tests__/web-chat-file-peek-viewer.test.ts
git commit -m "feat(preview): style drawer tools, external drawer, and panel search header"
```

---

### Task 5: 文件树缩进参考线（FileExplorerTree + 搜索结果树）

**Files:**
- Modify: `app/web/src/file/FileExplorerTree.tsx:39-92`
- Modify: `app/web/src/app/WorkspaceApp.tsx:19737, 19780-19834`
- Modify: `app/web/src/styles/file.css`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts:512-513, 536, 542 附近`

- [ ] **Step 1: FileExplorerTree 改包裹层结构**

`FileExplorerTree.tsx` 的 `renderFileTree` 替换为（行内 padding 移除，目录子级用 `tree-children` 包裹，`depthIndent` 变成每层 margin；行内容偏移与之前完全一致：`10 + depth*depthIndent`）：

```tsx
  const renderFileTree = (path: string, depth: number): React.ReactNode => {
    const entries = dirEntries[path] ?? [];
    return entries.map(entry => {
      if (entry.kind === 'dir') {
        const expanded = isExpanded(entry.path);
        return (
          <div key={entry.path}>
            <div
              className="item dir"
              onClick={() => {
                toggleDirectory(entry.path);
              }}
            >
              <Icon
                name={expanded ? 'chevronDown' : 'chevronRight'}
                className="caret"
              />
              <Icon
                name={expanded ? 'folderOpen' : 'folder'}
                className="node-icon"
              />
              <span className="label">{entry.name}</span>
              {loadingDirs[entry.path] ? (
                <span className="muted">...</span>
              ) : null}
            </div>
            {expanded ? (
              <div className="tree-children" style={{marginLeft: depthIndent}}>
                {renderFileTree(entry.path, depth + 1)}
              </div>
            ) : null}
          </div>
        );
      }

      const fileIcon = resolveFileIcon(entry.name);
      return (
        <div
          key={entry.path}
          className={`item file${selectedFile === entry.path ? ' selected' : ''}`}
          onClick={() => {
            onFileSelect(entry.path);
          }}
        >
          <span className="caret placeholder" aria-hidden="true" />
          <span
            className="node-icon seti-icon"
            style={{ color: fileIcon.color }}
          >
            <span className="seti-glyph">{fileIcon.glyph}</span>
          </span>
          <span className="label">{entry.name}</span>
        </div>
      );
    });
  };
```

同时把 `previewFileTreeDepthIndent`（WorkspaceApp.tsx:19737）从 `8` 改为 `14`（与组件默认值一致；8px 缩进下参考线过密）：

```tsx
  const previewFileTreeDepthIndent = 14;
```

- [ ] **Step 2: 搜索结果树同样处理**

`WorkspaceApp.tsx` 的 `renderPreviewFileTreeSearchResults`（:19780-19834）：

- 删除 `const paddingLeft = 10 + depth * previewFileTreeDepthIndent;` 及两处 `style={{paddingLeft}}`。
- dir 节点的 `{collapsed ? null : renderPreviewFileTreeSearchResults(node.children, depth + 1)}` 替换为：

```tsx
            {collapsed ? null : (
              <div
                className="preview-workbench-file-search-children"
                style={{marginLeft: previewFileTreeDepthIndent}}
              >
                {renderPreviewFileTreeSearchResults(node.children, depth + 1)}
              </div>
            )}
```

（`depth` 参数保留给递归签名。）

- [ ] **Step 3: CSS**

`file.css` 追加（放在 `.preview-workbench-file-tree-content` 规则附近）：

```css
.preview-workbench-file-tree-content .tree-children {
  border-left: 1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent);
}

.preview-workbench-file-search-children {
  border-left: 1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent);
}
```

并把 `.preview-workbench-file-search-node` 规则补上左内边距（原 `padding-right: 8px` 不变）：

```css
.preview-workbench-file-search-node {
  padding-left: 10px;
}
```

- [ ] **Step 4: 同步源码断言**

`web-chat-file-peek-viewer.test.ts`：

- 第 512 行 `'const previewFileTreeDepthIndent = 8;'` → `'const previewFileTreeDepthIndent = 14;'`
- 第 513 行 `expect(mainTsx).toContain('const paddingLeft = 10 + depth * previewFileTreeDepthIndent;');` → `expect(mainTsx).toContain('className="preview-workbench-file-search-children"');`
- 第 536 行 `expect(mainTsx).toContain('{collapsed ? null : renderPreviewFileTreeSearchResults(node.children, depth + 1)}');` → `expect(mainTsx).toContain('renderPreviewFileTreeSearchResults(node.children, depth + 1)');`
- 第 47-54 行读取 `fileTreeTsx` 的用例中追加一行：`expect(fileTreeTsx).toContain('className="tree-children"');`
- CSS 断言区（'inline search' 用例内 `:542` 附近）追加：`expect(stylesCss).toContain('.preview-workbench-file-search-children');` 与 `expect(stylesCss).toContain('.tree-children');`

- [ ] **Step 5: 运行测试 + 类型检查**

Run: `cd app && npx jest __tests__/web-chat-file-peek-viewer.test.ts web/src/preview/PreviewWorkbenchChrome.test.tsx && npm run tsc:web`
Expected: PASS / 无错

- [ ] **Step 6: Commit**

```bash
git add app/web/src/file/FileExplorerTree.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/file.css app/__tests__/web-chat-file-peek-viewer.test.ts
git commit -m "feat(preview): add indent guides to file and search trees"
```

---

### Task 6: 行视觉精修（文件树 + Git 面板）

**Files:**
- Modify: `app/web/src/styles/file.css`
- Modify: `app/web/src/styles/git.css`

纯 CSS 任务，无新测试；靠现有套件回归 + 人工验收。

- [ ] **Step 1: drawer 内文件树行视觉（scoped，不影响侧边栏共享的 `.item`）**

`file.css` 追加：

```css
.preview-workbench-file-tree-content .item {
  min-height: 26px;
  font-size: 12px;
}

.preview-workbench-file-tree-content .item.dir .label {
  font-weight: 550;
}

.preview-workbench-file-tree-content .item.selected {
  background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
  box-shadow: inset 2px 0 0 var(--accent-primary);
}
```

并把搜索结果选中态对齐：

```css
.preview-workbench-file-search-node.file.selected {
  box-shadow: inset 2px 0 0 var(--accent-primary);
}

.preview-workbench-file-search-node.dir:hover,
.preview-workbench-file-search-node.file:hover {
  background: var(--hover);
}
```

（原 `.preview-workbench-file-search-node.file:hover, .file.selected` 的 accent 15% 背景保留给 selected；hover 改为统一的 `var(--hover)`——即修改原 `:561-564` 规则：`.file:hover` 从该规则移除，只留 `.file.selected` 的 accent 背景。）

- [ ] **Step 2: Git 面板行视觉**

`git.css` 修改/追加：

```css
.git-file-row {
  min-height: 30px;
}

.git-file-row:hover {
  background: var(--hover);
}

.git-file-status.status-a {
  color: var(--state-success);
}

.git-file-status.status-m {
  color: var(--accent-primary);
}

.git-file-status.status-d {
  color: var(--state-danger);
}

.git-file-parent {
  opacity: 0.75;
}

.git-file-stats {
  font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;
}

.git-worktree-group-label .git-count,
.git-section-heading .git-count {
  min-width: 16px;
  border-radius: 999px;
  padding: 1px 5px;
  background: color-mix(in srgb, var(--text-primary) 8%, transparent);
  text-align: center;
}

.git-commit-trigger:hover {
  background: var(--hover);
}
```

（`.git-file-row` 原 `min-height: 32px` 改为 30；原 hover 的 `text-primary 7%` 替换为 `var(--hover)`；status 字母着色只覆盖 A/M/D，其他状态回退默认 secondary。）

- [ ] **Step 3: 回归 + Commit**

Run: `cd app && npx jest && npm run tsc:web`
Expected: 全套 PASS

```bash
git add app/web/src/styles/file.css app/web/src/styles/git.css
git commit -m "feat(preview): polish file tree and git panel row visuals"
```

---

### Task 7: 全量验证

- [ ] **Step 1: 完整测试套件**

Run: `cd app && npx jest`
Expected: 全部 PASS（含历史源码断言与既有组件测试）

- [ ] **Step 2: 类型检查 + 生产构建**

Run: `cd app && npm run tsc:web && npm run build:web`
Expected: tsc 无错；webpack 构建成功（产物输出到 `~/.wheelmaker/web`，不扫描 dist）

- [ ] **Step 3: 人工验收清单（交回用户确认）**

- PC：工具条在 preview 内侧左缘悬浮、不占宽度；resize 把手可拖；drawer 外置覆盖 chat、不遮 preview、随 resize 跟随；点文件不关 drawer；点外部/Esc/激活按钮关闭；按钮组可切换。
- 移动端：按钮在右上角、drawer 内部打开；样式与 PC 统一。
- files drawer 顶部搜索 + 定位按钮可用；空查询 Esc 关 drawer；git drawer 无搜索。
- 文件树/搜索树：参考线、层级、当前文件高亮；git 面板：状态着色、count pill、父目录弱化。
- 浅/深主题（`theme-dark`/`theme-light`）各过一次。

---

## 自我审查记录

- **Spec 覆盖**：工具条（T2/T4）、PC 外置 drawer（T2/T3/T4）、关闭语义（T1 测试锁定）、移动端不变（T4 移动端覆盖 + T1 用例）、搜索进面板（T2/T4）、文件树/git 视觉精修（T5/T6）、`overflow: hidden` 约束（T3 挂载层）、现有测试回归（T7）。验收标准逐条有对应任务；持久化/git 树形化在范围之外，无任务。
- **占位符**：无 TBD/TODO；每个代码步骤含完整代码；唯一的条件分支（jsdom 下 DesktopDragRegion mock）给了完整 mock 代码。
- **类型一致**：`drawerPortalTarget`（T2 定义 / T3 传入）、`previewDrawerHost`/`setPreviewDrawerHost`（T3）、`preview-workbench-drawer-tool`/`preview-workbench-drawer-search`/`preview-workbench-drawer-content`/`chat-preview-drawer-host`/`external`（T2 组件 ↔ T4 CSS ↔ T1 测试）、`tree-children`/`preview-workbench-file-search-children`（T5 组件 ↔ CSS ↔ 断言）三处命名交叉核对一致。
