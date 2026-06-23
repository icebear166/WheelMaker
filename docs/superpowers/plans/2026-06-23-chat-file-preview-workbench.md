# Chat File Preview Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a project-aware, multi-tab file preview workbench inside the chat right preview pane.

**Architecture:** Add a small pure state module for project-partitioned file preview tabs, then wire it into `WorkspaceApp.tsx` while keeping the existing attachment, prompt diff, and port relay preview states single-instance. Add a project-scoped directory listing service method so the right-side floating tree can browse a selected project without changing the existing workspace project selector.

**Tech Stack:** React 19, TypeScript, Jest, webpack, existing codicon/seti icon styles.

---

### Task 1: File Preview Workbench State Module

**Files:**
- Create: `app/web/src/file/filePreviewWorkbenchState.ts`
- Test: `app/__tests__/web-file-preview-workbench-state.test.ts`

- [ ] **Step 1: Write the failing state tests**

```typescript
import {
  activeFilePreviewTab,
  beginFilePreviewTabLoad,
  closeFilePreviewTab,
  createFilePreviewWorkbenchState,
  ensureFilePreviewProjectVisible,
  openFilePreviewTab,
  selectFilePreviewProject,
} from '../web/src/file/filePreviewWorkbenchState';

describe('file preview workbench state', () => {
  test('reuses an existing path within the same project and updates the target line', () => {
    const first = openFilePreviewTab(createFilePreviewWorkbenchState('p1'), 'p1', 'src/a.ts', 4);
    const second = openFilePreviewTab(first, 'p1', 'src/b.ts', null);
    const reused = openFilePreviewTab(second, 'p1', 'src/a.ts', 9);

    expect(reused.activeProjectId).toBe('p1');
    expect(reused.tabsByProjectId.p1.map(tab => tab.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(activeFilePreviewTab(reused)?.path).toBe('src/a.ts');
    expect(activeFilePreviewTab(reused)?.targetLine).toBe(9);
  });

  test('keeps tabs partitioned by project and restores them when project changes', () => {
    const state = openFilePreviewTab(
      openFilePreviewTab(createFilePreviewWorkbenchState('p1'), 'p1', 'src/a.ts', null),
      'p2',
      'README.md',
      2,
    );

    const p1 = selectFilePreviewProject(state, 'p1');
    expect(activeFilePreviewTab(p1)?.path).toBe('src/a.ts');
    const p2 = selectFilePreviewProject(p1, 'p2');
    expect(activeFilePreviewTab(p2)?.path).toBe('README.md');
  });

  test('closes the active tab to a neighboring tab and keeps an empty project state', () => {
    const state = openFilePreviewTab(
      openFilePreviewTab(createFilePreviewWorkbenchState('p1'), 'p1', 'one.ts', null),
      'p1',
      'two.ts',
      null,
    );

    const afterClose = closeFilePreviewTab(state, 'p1', 'two.ts');
    expect(activeFilePreviewTab(afterClose)?.path).toBe('one.ts');
    const empty = closeFilePreviewTab(afterClose, 'p1', 'one.ts');
    expect(empty.tabsByProjectId.p1).toEqual([]);
    expect(activeFilePreviewTab(empty)).toBeNull();
    expect(empty.activeProjectId).toBe('p1');
  });

  test('switches to a visible preferred project when the active project is hidden', () => {
    const state = selectFilePreviewProject(createFilePreviewWorkbenchState('hidden'), 'hidden');
    const next = ensureFilePreviewProjectVisible(state, ['p2', 'p3'], 'p3');

    expect(next.activeProjectId).toBe('p3');
  });

  test('updates only the matching project tab during async load completion', () => {
    const state = openFilePreviewTab(
      openFilePreviewTab(createFilePreviewWorkbenchState('p1'), 'p1', 'src/a.ts', null),
      'p2',
      'src/a.ts',
      null,
    );

    const loading = beginFilePreviewTabLoad(state, 'p1', 'src/a.ts', 7);

    expect(loading.tabsByProjectId.p1[0].loading).toBe(true);
    expect(loading.tabsByProjectId.p2[0].loading).toBe(false);
  });
});
```

- [ ] **Step 2: Run the state test and verify RED**

Run: `npm test -- web-file-preview-workbench-state.test.ts --runInBand`

Expected: FAIL because `filePreviewWorkbenchState.ts` does not exist.

- [ ] **Step 3: Implement the pure state module**

```typescript
import type {RegistryFsInfo} from '../registry/registryTypes';

export type FilePreviewWorkbenchTab = {
  path: string;
  targetLine: number | null;
  content: string;
  info: RegistryFsInfo | null;
  loading: boolean;
  error: string;
  requestId: number;
};

export type FilePreviewWorkbenchState = {
  activeProjectId: string;
  tabsByProjectId: Record<string, FilePreviewWorkbenchTab[]>;
  activePathByProjectId: Record<string, string>;
  treeOpen: boolean;
};

const normalizeLine = (line: number | null): number | null =>
  typeof line === 'number' && Number.isFinite(line) && line > 0 ? Math.trunc(line) : null;

const emptyTab = (path: string, targetLine: number | null): FilePreviewWorkbenchTab => ({
  path,
  targetLine: normalizeLine(targetLine),
  content: '',
  info: null,
  loading: false,
  error: '',
  requestId: 0,
});

export function createFilePreviewWorkbenchState(activeProjectId = ''): FilePreviewWorkbenchState {
  return {
    activeProjectId,
    tabsByProjectId: activeProjectId ? {[activeProjectId]: []} : {},
    activePathByProjectId: {},
    treeOpen: false,
  };
}

export function selectFilePreviewProject(
  state: FilePreviewWorkbenchState,
  projectId: string,
): FilePreviewWorkbenchState {
  if (!projectId || projectId === state.activeProjectId) {
    return state;
  }
  return {
    ...state,
    activeProjectId: projectId,
    tabsByProjectId: {
      ...state.tabsByProjectId,
      [projectId]: state.tabsByProjectId[projectId] ?? [],
    },
  };
}

export function ensureFilePreviewProjectVisible(
  state: FilePreviewWorkbenchState,
  visibleProjectIds: string[],
  preferredProjectId = '',
): FilePreviewWorkbenchState {
  if (state.activeProjectId && visibleProjectIds.includes(state.activeProjectId)) {
    return state;
  }
  const nextProjectId =
    preferredProjectId && visibleProjectIds.includes(preferredProjectId)
      ? preferredProjectId
      : visibleProjectIds[0] ?? '';
  return nextProjectId ? selectFilePreviewProject(state, nextProjectId) : state;
}

export function openFilePreviewTab(
  state: FilePreviewWorkbenchState,
  projectId: string,
  path: string,
  targetLine: number | null,
): FilePreviewWorkbenchState {
  if (!projectId || !path) {
    return state;
  }
  const projectState = selectFilePreviewProject(state, projectId);
  const tabs = projectState.tabsByProjectId[projectId] ?? [];
  const normalizedLine = normalizeLine(targetLine);
  const existing = tabs.find(tab => tab.path === path);
  const nextTabs = existing
    ? tabs.map(tab => (tab.path === path ? {...tab, targetLine: normalizedLine} : tab))
    : [...tabs, emptyTab(path, normalizedLine)];
  return {
    ...projectState,
    tabsByProjectId: {...projectState.tabsByProjectId, [projectId]: nextTabs},
    activePathByProjectId: {...projectState.activePathByProjectId, [projectId]: path},
  };
}

export function beginFilePreviewTabLoad(
  state: FilePreviewWorkbenchState,
  projectId: string,
  path: string,
  requestId: number,
): FilePreviewWorkbenchState {
  const tabs = state.tabsByProjectId[projectId] ?? [];
  return {
    ...state,
    tabsByProjectId: {
      ...state.tabsByProjectId,
      [projectId]: tabs.map(tab =>
        tab.path === path ? {...tab, loading: true, error: '', requestId} : tab,
      ),
    },
  };
}

export function completeFilePreviewTabLoad(
  state: FilePreviewWorkbenchState,
  projectId: string,
  path: string,
  requestId: number,
  info: RegistryFsInfo,
  content: string,
): FilePreviewWorkbenchState {
  const tabs = state.tabsByProjectId[projectId] ?? [];
  return {
    ...state,
    tabsByProjectId: {
      ...state.tabsByProjectId,
      [projectId]: tabs.map(tab =>
        tab.path === path && tab.requestId === requestId
          ? {...tab, info, content, loading: false, error: ''}
          : tab,
      ),
    },
  };
}

export function failFilePreviewTabLoad(
  state: FilePreviewWorkbenchState,
  projectId: string,
  path: string,
  requestId: number,
  error: string,
): FilePreviewWorkbenchState {
  const tabs = state.tabsByProjectId[projectId] ?? [];
  return {
    ...state,
    tabsByProjectId: {
      ...state.tabsByProjectId,
      [projectId]: tabs.map(tab =>
        tab.path === path && tab.requestId === requestId
          ? {...tab, content: '', info: null, loading: false, error}
          : tab,
      ),
    },
  };
}

export function closeFilePreviewTab(
  state: FilePreviewWorkbenchState,
  projectId: string,
  path: string,
): FilePreviewWorkbenchState {
  const tabs = state.tabsByProjectId[projectId] ?? [];
  const closingIndex = tabs.findIndex(tab => tab.path === path);
  if (closingIndex < 0) {
    return state;
  }
  const nextTabs = tabs.filter(tab => tab.path !== path);
  const currentActivePath = state.activePathByProjectId[projectId] ?? '';
  const nextActivePath =
    currentActivePath === path
      ? nextTabs[Math.min(closingIndex, Math.max(0, nextTabs.length - 1))]?.path ?? ''
      : currentActivePath;
  return {
    ...state,
    tabsByProjectId: {...state.tabsByProjectId, [projectId]: nextTabs},
    activePathByProjectId: {...state.activePathByProjectId, [projectId]: nextActivePath},
  };
}

export function activeFilePreviewTab(state: FilePreviewWorkbenchState): FilePreviewWorkbenchTab | null {
  const projectId = state.activeProjectId;
  const activePath = state.activePathByProjectId[projectId] ?? '';
  return (state.tabsByProjectId[projectId] ?? []).find(tab => tab.path === activePath) ?? null;
}
```

- [ ] **Step 4: Run the state test and verify GREEN**

Run: `npm test -- web-file-preview-workbench-state.test.ts --runInBand`

Expected: PASS.

### Task 2: Project-Scoped Directory Listing

**Files:**
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Test: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [ ] **Step 1: Write failing service wiring expectations**

Add a test to `web-chat-file-peek-viewer.test.ts`:

```typescript
test('right preview workbench uses project-scoped directory listing without switching workspace project', () => {
  const serviceTs = readSourceText(path.join(projectRoot, 'web', 'src', 'registry', 'RegistryWorkspaceService.ts'));
  const mainTsx = readSourceText(mainPath);

  expect(serviceTs).toContain('async listProjectDirectory(');
  expect(serviceTs).toContain('this.readRepositoryForProject(projectId).listFiles(projectId, path || \'.\', knownHash)');
  expect(mainTsx).toContain('service.listProjectDirectory(targetProjectId,');
  expect(mainTsx).not.toContain('syncWorkspaceProject(chatFilePreviewWorkbench.activeProjectId');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- web-chat-file-peek-viewer.test.ts --runInBand`

Expected: FAIL because `listProjectDirectory` is not implemented or used.

- [ ] **Step 3: Add `listProjectDirectory`**

```typescript
  async listProjectDirectory(projectId: string, path: string, knownHash?: string): Promise<{entries: RegistryFsEntry[]; hash?: string; notModified: boolean}> {
    if (!this.repository || !projectId) {
      return {entries: [], hash: '', notModified: false};
    }
    const result = await this.readRepositoryForProject(projectId).listFiles(projectId, path || '.', knownHash);
    return {
      entries: result.entries ?? [],
      hash: result.hash,
      notModified: result.notModified,
    };
  }
```

- [ ] **Step 4: Update right-tree directory loading to call the project-scoped service**

Add `loadPreviewDirectory(projectId, path)` in `WorkspaceApp.tsx` using `service.listProjectDirectory(targetProjectId, path, knownHash)`, separate from the existing workspace `loadDirectory` path.

- [ ] **Step 5: Run the service wiring test**

Run: `npm test -- web-chat-file-peek-viewer.test.ts --runInBand`

Expected: PASS for the new wiring test.

### Task 3: WorkspaceApp Workbench State and File Reads

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Test: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [ ] **Step 1: Write failing integration expectations**

Add tests asserting these source markers:

```typescript
test('chat file preview keeps project-partitioned tabs and does not clear them for non-file previews', () => {
  const mainTsx = readSourceText(mainPath);

  expect(mainTsx).toContain('const [chatFilePreviewWorkbench, setChatFilePreviewWorkbench] = useState');
  expect(mainTsx).toContain('openFilePreviewTab(');
  expect(mainTsx).toContain('completeFilePreviewTabLoad(');
  expect(mainTsx).toContain('const chatFilePreviewActiveTab = activeFilePreviewTab(chatFilePreviewWorkbench);');
  expect(mainTsx).toContain('const chatFilePreviewHasTabs = Object.values(chatFilePreviewWorkbench.tabsByProjectId).some(tabs => tabs.length > 0);');

  const attachmentStart = mainTsx.indexOf('const openChatAttachmentPreview = useCallback');
  const attachmentEnd = mainTsx.indexOf('const buildLineRange', attachmentStart);
  const attachmentBody = mainTsx.slice(attachmentStart, attachmentEnd);
  expect(attachmentBody).not.toContain('setChatFilePeek(null)');
});
```

```typescript
test('chat file links and mention previews open files in the selected chat project', () => {
  const mainTsx = readSourceText(mainPath);

  expect(mainTsx).toContain('const resolveChatFilePreviewProjectId = useCallback(');
  expect(mainTsx).toContain('openChatFilePeek(targetFile.path, jumpLine ?? null, resolveChatFilePreviewProjectId())');
  expect(mainTsx).toContain('openChatFilePeek(path, null, resolveChatFilePreviewProjectId())');
});
```

- [ ] **Step 2: Run the integration tests and verify RED**

Run: `npm test -- web-chat-file-peek-viewer.test.ts --runInBand`

Expected: FAIL on the new expectations.

- [ ] **Step 3: Import state helpers and replace single file peek state with workbench state**

Use:

```typescript
import {
  activeFilePreviewTab,
  beginFilePreviewTabLoad,
  closeFilePreviewTab,
  completeFilePreviewTabLoad,
  createFilePreviewWorkbenchState,
  ensureFilePreviewProjectVisible,
  failFilePreviewTabLoad,
  openFilePreviewTab,
  selectFilePreviewProject,
  type FilePreviewWorkbenchTab,
} from '../file/filePreviewWorkbenchState';
```

Keep `ChatFilePeekViewer` props compatible by passing the active tab as `peek`.

- [ ] **Step 4: Add workbench state and derived values**

```typescript
const [chatFilePreviewWorkbench, setChatFilePreviewWorkbench] = useState(() => createFilePreviewWorkbenchState());
const chatFilePreviewActiveTab = activeFilePreviewTab(chatFilePreviewWorkbench);
const chatFilePreviewHasTabs = Object.values(chatFilePreviewWorkbench.tabsByProjectId).some(tabs => tabs.length > 0);
const chatPreviewHasContent = chatFilePreviewHasTabs || !!chatPromptArtifactPreview || !!chatAttachmentPreview || chatPortRelayPreviewOpen;
```

- [ ] **Step 5: Implement `resolveChatFilePreviewProjectId` and workbench file reading**

Use selected chat project first, then right workbench active project, then workspace project:

```typescript
const resolveChatFilePreviewProjectId = useCallback(
  (explicitProjectId = '') => explicitProjectId || selectedChatKeyRef.current?.projectId || chatFilePreviewWorkbench.activeProjectId || projectIdRef.current,
  [chatFilePreviewWorkbench.activeProjectId],
);
```

Read files with `service.getProjectFileInfo(targetProjectId, path)` and `service.readProjectFile(path, targetProjectId)`, updating only matching tabs through request ids.

- [ ] **Step 6: Ensure non-file previews do not clear file tabs**

Remove file-tab clearing from attachment and prompt artifact opening. Opening a file should still close attachment, prompt artifact, and port relay states so the file workbench becomes visible.

- [ ] **Step 7: Run integration tests**

Run: `npm test -- web-chat-file-peek-viewer.test.ts --runInBand`

Expected: PASS for workbench state wiring expectations.

### Task 4: Project Selector, Tab Strip, and Floating File Tree UI

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/file/FileExplorerTree.tsx`
- Modify: `app/web/src/styles/file.css`
- Test: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [ ] **Step 1: Write failing UI expectations**

Add tests:

```typescript
test('chat file workbench renders project selector, tab strip, tab close controls, and a desktop tree popover', () => {
  const mainTsx = readSourceText(mainPath);
  const stylesCss = readWebStyles(projectRoot);

  expect(mainTsx).toContain('className="chat-file-workbench-project-select"');
  expect(mainTsx).toContain('className="chat-file-workbench-tabs"');
  expect(mainTsx).toContain('className="chat-file-workbench-tab-close"');
  expect(mainTsx).toContain('className="chat-file-workbench-tree-popover"');
  expect(mainTsx).toContain('aria-label="Toggle file tree"');
  expect(mainTsx).toContain('closeFilePreviewTab(');

  expect(stylesCss).toContain('.chat-file-workbench-tabs');
  expect(stylesCss).toContain('.chat-file-workbench-tree-popover');
  expect(stylesCss).toContain('.chat-file-workbench-empty');
});
```

```typescript
test('chat file workbench project selector is limited to visible projects', () => {
  const mainTsx = readSourceText(mainPath);

  expect(mainTsx).toContain('const chatFilePreviewProjects = visibleProjectItems;');
  expect(mainTsx).toContain('chatFilePreviewProjects.map(projectItem =>');
  expect(mainTsx).toContain('ensureFilePreviewProjectVisible(');
});
```

- [ ] **Step 2: Run UI tests and verify RED**

Run: `npm test -- web-chat-file-peek-viewer.test.ts --runInBand`

Expected: FAIL on missing UI markers.

- [ ] **Step 3: Add reusable file tree click hook**

Extend `FileExplorerTree` with optional `onFileSelect?: (path: string) => void`. Default behavior remains `setSelectedFile`.

- [ ] **Step 4: Render the workbench chrome**

In the file workbench viewer, render:
- project `<select>` from `visibleProjectItems`
- tree icon button on desktop
- tab strip with close buttons
- empty state that keeps project selector and tree button visible
- active file content using the existing `ChatFilePeekViewer` body rendering logic

- [ ] **Step 5: Add CSS**

Use compact utility-style classes in `app/web/src/styles/file.css`: fixed 30px top rows, horizontal tab overflow, absolute popover inside `.chat-file-peek-surface`, and existing panel colors.

- [ ] **Step 6: Run UI tests**

Run: `npm test -- web-chat-file-peek-viewer.test.ts --runInBand`

Expected: PASS.

### Task 5: Verification and Cleanup

**Files:**
- Modify as needed based on failing tests.

- [ ] **Step 1: Run targeted Jest tests**

Run:

```powershell
npm test -- web-file-preview-workbench-state.test.ts web-chat-file-peek-viewer.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript check**

Run:

```powershell
npm run tsc:web
```

Expected: exit code 0.

- [ ] **Step 3: Inspect diff for scope**

Run: `git diff -- app/web/src/file app/web/src/app/WorkspaceApp.tsx app/web/src/registry/RegistryWorkspaceService.ts app/web/src/styles/file.css app/__tests__/web-chat-file-peek-viewer.test.ts app/__tests__/web-file-preview-workbench-state.test.ts docs`

Expected: only files tied to the workbench spec are changed.

- [ ] **Step 4: Final repository gate**

Run:

```powershell
git add -A
git commit -m "feat: add chat file preview workbench"
git push origin <current-branch>
```

Expected: commit and push succeed.
