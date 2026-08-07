# Unified Preview Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current mixed right-preview behavior with one project-partitioned, typed tab workbench for file, prompt diff, attachment, and Port Relay previews.

**Architecture:** Add a pure typed preview workbench state module, then migrate each existing preview entry point to open/update tabs through that module. Keep Git's existing source-control diff page unchanged; only chat prompt diffs move into the unified workbench. Port Relay keeps its enable/disable service behavior, but every visible frame opens through a workbench `port-relay` tab instead of the old `main`/`chatPreview` placement split.

**Tech Stack:** React 19, TypeScript, Jest source-structure tests, existing Codicon icons, existing Port Relay URL helpers, existing Shiki code/diff renderers.

---

### Task 0: Branch and Baseline

**Files:**
- Read: `CLAUDE.md`
- Read: `app/CLAUDE.md`
- Read: `docs/scope/2026-06-24-unified-preview-workbench.md`

- [ ] **Step 1: Start from a clean, updated main**

Run:

```powershell
git status --short --branch
git checkout main
git pull --ff-only origin main
```

Expected: `main` is clean and up to date with `origin/main`.

- [ ] **Step 2: Create the implementation branch**

Run:

```powershell
git checkout -b feat/unified-preview-workbench
```

Expected: current branch is `feat/unified-preview-workbench`.

- [ ] **Step 3: Run current focused baseline tests**

Run:

```powershell
cd app
npm test -- web-file-preview-workbench-state.test.ts web-chat-file-peek-viewer.test.ts web-port-relay-settings.test.ts web-main-surface-boundary.test.ts --runInBand
```

Expected: PASS before changes.

---

### Task 1: Unified Preview Workbench State Module

**Files:**
- Create: `app/web/src/preview/previewWorkbenchState.ts`
- Test: `app/__tests__/web-preview-workbench-state.test.ts`
- Later delete: `app/web/src/file/filePreviewWorkbenchState.ts`
- Later replace: `app/__tests__/web-file-preview-workbench-state.test.ts`

- [ ] **Step 1: Write the failing state tests**

Create `app/__tests__/web-preview-workbench-state.test.ts`:

```typescript
import {
  activePreviewTab,
  beginPreviewTabLoad,
  closePreviewTab,
  createPreviewWorkbenchState,
  ensurePreviewProjectVisible,
  openPreviewTab,
  previewTabId,
  selectPreviewProject,
  updatePreviewTabAfterLoad,
} from '../web/src/preview/previewWorkbenchState';

describe('preview workbench state', () => {
  test('reuses the same file resource within a project and updates target line', () => {
    const initial = createPreviewWorkbenchState('p1');
    const first = openPreviewTab(initial, {
      type: 'file',
      projectId: 'p1',
      path: 'src/a.ts',
      targetLine: 4,
      title: 'a.ts',
    });
    const second = openPreviewTab(first, {
      type: 'file',
      projectId: 'p1',
      path: 'src/b.ts',
      targetLine: null,
      title: 'b.ts',
    });
    const reused = openPreviewTab(second, {
      type: 'file',
      projectId: 'p1',
      path: 'src/a.ts',
      targetLine: 9,
      title: 'a.ts',
    });

    expect(reused.tabsByProjectId.p1.map(tab => tab.id)).toEqual([
      'file:src/a.ts',
      'file:src/b.ts',
    ]);
    expect(activePreviewTab(reused)?.id).toBe('file:src/a.ts');
    expect(activePreviewTab(reused)).toMatchObject({type: 'file', targetLine: 9});
  });

  test('partitions tabs by project and restores the active tab per project', () => {
    const state = openPreviewTab(
      openPreviewTab(createPreviewWorkbenchState('p1'), {
        type: 'prompt-diff',
        projectId: 'p1',
        sessionId: 's1',
        artifactId: 'diff-1',
        title: 'Prompt diff',
        files: [],
      }),
      {
        type: 'port-relay',
        projectId: 'p2',
        hubId: 'hub-a',
        targetPort: 5173,
        framePath: '/app',
        title: 'hub-a:5173',
      },
    );

    const p1 = selectPreviewProject(state, 'p1');
    expect(activePreviewTab(p1)?.id).toBe('prompt-diff:s1:diff-1');
    const p2 = selectPreviewProject(p1, 'p2');
    expect(activePreviewTab(p2)?.id).toBe('port-relay:hub-a:5173:/app');
  });

  test('closes the active tab to a neighboring tab and keeps an empty project', () => {
    const state = openPreviewTab(
      openPreviewTab(createPreviewWorkbenchState('p1'), {
        type: 'attachment',
        projectId: 'p1',
        sessionId: 's1',
        attachmentKey: 'image-a',
        title: 'image-a.png',
        meta: '',
        mimeType: 'image/png',
        kind: 'image',
        src: '',
      }),
      {
        type: 'file',
        projectId: 'p1',
        path: 'src/a.ts',
        targetLine: null,
        title: 'a.ts',
      },
    );

    const afterClose = closePreviewTab(state, 'p1', 'file:src/a.ts');
    expect(activePreviewTab(afterClose)?.id).toBe('attachment:s1:image-a');
    const empty = closePreviewTab(afterClose, 'p1', 'attachment:s1:image-a');
    expect(empty.tabsByProjectId.p1).toEqual([]);
    expect(activePreviewTab(empty)).toBeNull();
    expect(empty.activeProjectId).toBe('p1');
  });

  test('switches to a visible preferred project when the active project is hidden', () => {
    const state = selectPreviewProject(createPreviewWorkbenchState('hidden'), 'hidden');
    const next = ensurePreviewProjectVisible(state, ['p2', 'p3'], 'p3');

    expect(next.activeProjectId).toBe('p3');
  });

  test('applies async load completion only to the matching request', () => {
    const state = openPreviewTab(createPreviewWorkbenchState('p1'), {
      type: 'file',
      projectId: 'p1',
      path: 'src/a.ts',
      targetLine: null,
      title: 'a.ts',
    });
    const loading = beginPreviewTabLoad(state, 'p1', 'file:src/a.ts', 7);
    const stale = updatePreviewTabAfterLoad(loading, 'p1', 'file:src/a.ts', 6, tab => ({
      ...tab,
      loading: false,
      error: 'stale',
    }));
    const fresh = updatePreviewTabAfterLoad(loading, 'p1', 'file:src/a.ts', 7, tab => ({
      ...tab,
      loading: false,
      error: '',
    }));

    expect(activePreviewTab(stale)).toMatchObject({loading: true, error: ''});
    expect(activePreviewTab(fresh)).toMatchObject({loading: false, error: ''});
  });

  test('builds stable resource ids for every supported tab type', () => {
    expect(previewTabId({type: 'file', path: 'src/a.ts'})).toBe('file:src/a.ts');
    expect(previewTabId({type: 'prompt-diff', sessionId: 's1', artifactId: 'd1'})).toBe('prompt-diff:s1:d1');
    expect(previewTabId({type: 'attachment', sessionId: 's1', attachmentKey: 'sha256-a'})).toBe('attachment:s1:sha256-a');
    expect(previewTabId({type: 'port-relay', hubId: 'hub-a', targetPort: 3000, framePath: '/x'})).toBe('port-relay:hub-a:3000:/x');
  });
});
```

- [ ] **Step 2: Run the state test and verify RED**

Run:

```powershell
cd app
npm test -- web-preview-workbench-state.test.ts --runInBand
```

Expected: FAIL because `../web/src/preview/previewWorkbenchState` does not exist.

- [ ] **Step 3: Implement the state module**

Create `app/web/src/preview/previewWorkbenchState.ts`:

```typescript
import type {RegistryFsInfo, RegistrySessionPromptArtifactFile} from '../registry/registryTypes';

export type PreviewWorkbenchTabType = 'file' | 'prompt-diff' | 'attachment' | 'port-relay';

export type PreviewWorkbenchTabBase = {
  id: string;
  type: PreviewWorkbenchTabType;
  projectId: string;
  title: string;
  loading: boolean;
  error: string;
  requestId: number;
};

export type FilePreviewTab = PreviewWorkbenchTabBase & {
  type: 'file';
  path: string;
  targetLine: number | null;
  content: string;
  info: RegistryFsInfo | null;
};

export type PromptDiffPreviewFile = RegistrySessionPromptArtifactFile & {
  diff: string;
  expanded: boolean;
};

export type PromptDiffPreviewTab = PreviewWorkbenchTabBase & {
  type: 'prompt-diff';
  sessionId: string;
  artifactId: string;
  files: PromptDiffPreviewFile[];
};

export type AttachmentPreviewTab = PreviewWorkbenchTabBase & {
  type: 'attachment';
  sessionId: string;
  attachmentKey: string;
  meta: string;
  mimeType: string;
  kind: 'image' | 'file';
  src: string;
};

export type PortRelayPreviewTab = PreviewWorkbenchTabBase & {
  type: 'port-relay';
  hubId: string;
  targetPort: number;
  framePath: string;
  url: string;
  reloadKey: number;
};

export type PreviewWorkbenchTab =
  | FilePreviewTab
  | PromptDiffPreviewTab
  | AttachmentPreviewTab
  | PortRelayPreviewTab;

export type PreviewWorkbenchOpenInput =
  | {
      type: 'file';
      projectId: string;
      path: string;
      targetLine: number | null;
      title: string;
    }
  | {
      type: 'prompt-diff';
      projectId: string;
      sessionId: string;
      artifactId: string;
      title: string;
      files: PromptDiffPreviewFile[];
    }
  | {
      type: 'attachment';
      projectId: string;
      sessionId: string;
      attachmentKey: string;
      title: string;
      meta: string;
      mimeType: string;
      kind: 'image' | 'file';
      src: string;
    }
  | {
      type: 'port-relay';
      projectId: string;
      hubId: string;
      targetPort: number;
      framePath: string;
      title: string;
      url?: string;
      reloadKey?: number;
    };

export type PreviewWorkbenchState = {
  activeProjectId: string;
  tabsByProjectId: Record<string, PreviewWorkbenchTab[]>;
  activeTabIdByProjectId: Record<string, string>;
  treeOpen: boolean;
};

const normalizeLine = (line: number | null): number | null =>
  typeof line === 'number' && Number.isFinite(line) && line > 0
    ? Math.trunc(line)
    : null;

const normalizeFramePath = (path: string): string => path || '';

export function previewTabId(input: Pick<PreviewWorkbenchOpenInput, 'type'> & Record<string, unknown>): string {
  if (input.type === 'file') {
    return `file:${String(input.path || '')}`;
  }
  if (input.type === 'prompt-diff') {
    return `prompt-diff:${String(input.sessionId || '')}:${String(input.artifactId || '')}`;
  }
  if (input.type === 'attachment') {
    return `attachment:${String(input.sessionId || '')}:${String(input.attachmentKey || '')}`;
  }
  return `port-relay:${String(input.hubId || '')}:${Number(input.targetPort || 0)}:${normalizeFramePath(String(input.framePath || ''))}`;
}

export function createPreviewWorkbenchState(activeProjectId = ''): PreviewWorkbenchState {
  return {
    activeProjectId,
    tabsByProjectId: activeProjectId ? {[activeProjectId]: []} : {},
    activeTabIdByProjectId: {},
    treeOpen: false,
  };
}

export function selectPreviewProject(state: PreviewWorkbenchState, projectId: string): PreviewWorkbenchState {
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

export function ensurePreviewProjectVisible(
  state: PreviewWorkbenchState,
  visibleProjectIds: string[],
  preferredProjectId = '',
): PreviewWorkbenchState {
  if (state.activeProjectId && visibleProjectIds.includes(state.activeProjectId)) {
    return state;
  }
  const nextProjectId =
    preferredProjectId && visibleProjectIds.includes(preferredProjectId)
      ? preferredProjectId
      : visibleProjectIds[0] ?? '';
  return nextProjectId ? selectPreviewProject(state, nextProjectId) : state;
}

function createTab(input: PreviewWorkbenchOpenInput): PreviewWorkbenchTab {
  const id = previewTabId(input as unknown as Record<string, unknown> & Pick<PreviewWorkbenchOpenInput, 'type'>);
  const base = {
    id,
    type: input.type,
    projectId: input.projectId,
    title: input.title,
    loading: false,
    error: '',
    requestId: 0,
  };
  if (input.type === 'file') {
    return {
      ...base,
      type: 'file',
      path: input.path,
      targetLine: normalizeLine(input.targetLine),
      content: '',
      info: null,
    };
  }
  if (input.type === 'prompt-diff') {
    return {...base, type: 'prompt-diff', sessionId: input.sessionId, artifactId: input.artifactId, files: input.files};
  }
  if (input.type === 'attachment') {
    return {
      ...base,
      type: 'attachment',
      sessionId: input.sessionId,
      attachmentKey: input.attachmentKey,
      meta: input.meta,
      mimeType: input.mimeType,
      kind: input.kind,
      src: input.src,
    };
  }
  return {
    ...base,
    type: 'port-relay',
    hubId: input.hubId,
    targetPort: input.targetPort,
    framePath: normalizeFramePath(input.framePath),
    url: input.url ?? '',
    reloadKey: input.reloadKey ?? 0,
  };
}

function mergeTab(existing: PreviewWorkbenchTab, input: PreviewWorkbenchOpenInput): PreviewWorkbenchTab {
  if (existing.type === 'file' && input.type === 'file') {
    return {...existing, title: input.title, targetLine: normalizeLine(input.targetLine)};
  }
  if (existing.type === 'prompt-diff' && input.type === 'prompt-diff') {
    return {...existing, title: input.title, files: input.files};
  }
  if (existing.type === 'attachment' && input.type === 'attachment') {
    return {...existing, title: input.title, meta: input.meta, mimeType: input.mimeType, kind: input.kind, src: input.src};
  }
  if (existing.type === 'port-relay' && input.type === 'port-relay') {
    return {...existing, title: input.title, framePath: normalizeFramePath(input.framePath), url: input.url ?? existing.url, reloadKey: input.reloadKey ?? existing.reloadKey};
  }
  return existing;
}

export function openPreviewTab(state: PreviewWorkbenchState, input: PreviewWorkbenchOpenInput): PreviewWorkbenchState {
  if (!input.projectId) {
    return state;
  }
  const id = previewTabId(input as unknown as Record<string, unknown> & Pick<PreviewWorkbenchOpenInput, 'type'>);
  if (!id || id.endsWith(':') || id.includes(':0:')) {
    return state;
  }
  const projectState = selectPreviewProject(state, input.projectId);
  const tabs = projectState.tabsByProjectId[input.projectId] ?? [];
  const existing = tabs.find(tab => tab.id === id);
  const nextTabs = existing
    ? tabs.map(tab => (tab.id === id ? mergeTab(tab, input) : tab))
    : [...tabs, createTab(input)];
  return {
    ...projectState,
    tabsByProjectId: {...projectState.tabsByProjectId, [input.projectId]: nextTabs},
    activeTabIdByProjectId: {...projectState.activeTabIdByProjectId, [input.projectId]: id},
  };
}

export function beginPreviewTabLoad(
  state: PreviewWorkbenchState,
  projectId: string,
  tabId: string,
  requestId: number,
): PreviewWorkbenchState {
  const tabs = state.tabsByProjectId[projectId] ?? [];
  return {
    ...state,
    tabsByProjectId: {
      ...state.tabsByProjectId,
      [projectId]: tabs.map(tab => (tab.id === tabId ? {...tab, loading: true, error: '', requestId} : tab)),
    },
  };
}

export function updatePreviewTab(
  state: PreviewWorkbenchState,
  projectId: string,
  tabId: string,
  updater: (tab: PreviewWorkbenchTab) => PreviewWorkbenchTab,
): PreviewWorkbenchState {
  const tabs = state.tabsByProjectId[projectId] ?? [];
  return {
    ...state,
    tabsByProjectId: {
      ...state.tabsByProjectId,
      [projectId]: tabs.map(tab => (tab.id === tabId ? updater(tab) : tab)),
    },
  };
}

export function updatePreviewTabAfterLoad(
  state: PreviewWorkbenchState,
  projectId: string,
  tabId: string,
  requestId: number,
  updater: (tab: PreviewWorkbenchTab) => PreviewWorkbenchTab,
): PreviewWorkbenchState {
  return updatePreviewTab(state, projectId, tabId, tab =>
    tab.requestId === requestId ? updater(tab) : tab,
  );
}

export function failPreviewTabLoad(
  state: PreviewWorkbenchState,
  projectId: string,
  tabId: string,
  requestId: number,
  error: string,
): PreviewWorkbenchState {
  return updatePreviewTabAfterLoad(state, projectId, tabId, requestId, tab => ({
    ...tab,
    loading: false,
    error,
  }));
}

export function closePreviewTab(state: PreviewWorkbenchState, projectId: string, tabId: string): PreviewWorkbenchState {
  const tabs = state.tabsByProjectId[projectId] ?? [];
  const closingIndex = tabs.findIndex(tab => tab.id === tabId);
  if (closingIndex < 0) {
    return state;
  }
  const nextTabs = tabs.filter(tab => tab.id !== tabId);
  const currentActiveId = state.activeTabIdByProjectId[projectId] ?? '';
  const nextActiveId =
    currentActiveId === tabId
      ? nextTabs[Math.min(closingIndex, Math.max(0, nextTabs.length - 1))]?.id ?? ''
      : currentActiveId;
  return {
    ...state,
    tabsByProjectId: {...state.tabsByProjectId, [projectId]: nextTabs},
    activeTabIdByProjectId: {...state.activeTabIdByProjectId, [projectId]: nextActiveId},
  };
}

export function activePreviewTab(state: PreviewWorkbenchState): PreviewWorkbenchTab | null {
  const projectId = state.activeProjectId;
  const activeTabId = state.activeTabIdByProjectId[projectId] ?? '';
  return (state.tabsByProjectId[projectId] ?? []).find(tab => tab.id === activeTabId) ?? null;
}

export const isFilePreviewTab = (tab: PreviewWorkbenchTab | null): tab is FilePreviewTab =>
  tab?.type === 'file';

export const isPromptDiffPreviewTab = (tab: PreviewWorkbenchTab | null): tab is PromptDiffPreviewTab =>
  tab?.type === 'prompt-diff';

export const isAttachmentPreviewTab = (tab: PreviewWorkbenchTab | null): tab is AttachmentPreviewTab =>
  tab?.type === 'attachment';

export const isPortRelayPreviewTab = (tab: PreviewWorkbenchTab | null): tab is PortRelayPreviewTab =>
  tab?.type === 'port-relay';
```

- [ ] **Step 4: Run the state test and verify GREEN**

Run:

```powershell
cd app
npm test -- web-preview-workbench-state.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add app/web/src/preview/previewWorkbenchState.ts app/__tests__/web-preview-workbench-state.test.ts
git commit -m "feat: add unified preview workbench state"
```

Expected: commit succeeds.

---

### Task 2: Migrate File Preview Tabs to the Unified State

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Delete: `app/web/src/file/filePreviewWorkbenchState.ts`
- Delete: `app/__tests__/web-file-preview-workbench-state.test.ts`

- [ ] **Step 1: Update the source-structure tests for the new state module**

In `app/__tests__/web-chat-file-peek-viewer.test.ts`, replace file-workbench-specific expectations with unified state expectations:

```typescript
test('chat file preview uses unified project-partitioned workbench tabs', () => {
  const mainTsx = readSourceText(mainPath);

  expect(mainTsx).toContain('const [previewWorkbench, setPreviewWorkbench] = useState');
  expect(mainTsx).toContain('openPreviewTab(current, {');
  expect(mainTsx).toContain("type: 'file'");
  expect(mainTsx).toContain('updatePreviewTabAfterLoad(');
  expect(mainTsx).toContain('const activeWorkbenchTab = activePreviewTab(previewWorkbench);');
  expect(mainTsx).toContain('const chatFilePeek = isFilePreviewTab(activeWorkbenchTab) ? activeWorkbenchTab : null;');
  expect(mainTsx).not.toContain('filePreviewWorkbenchState');
});
```

Remove the old `web-file-preview-workbench-state.test.ts` test file after `web-preview-workbench-state.test.ts` is green.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
cd app
npm test -- web-preview-workbench-state.test.ts web-chat-file-peek-viewer.test.ts --runInBand
```

Expected: FAIL because `WorkspaceApp.tsx` still imports and uses `filePreviewWorkbenchState`.

- [ ] **Step 3: Replace imports and derived selectors in `WorkspaceApp.tsx`**

Replace the old file state import with:

```typescript
import {
  activePreviewTab,
  beginPreviewTabLoad,
  closePreviewTab,
  createPreviewWorkbenchState,
  ensurePreviewProjectVisible,
  failPreviewTabLoad,
  isFilePreviewTab,
  openPreviewTab,
  previewTabId,
  selectPreviewProject,
  updatePreviewTabAfterLoad,
  updatePreviewTab,
  type FilePreviewTab,
  type PreviewWorkbenchTab,
} from '../preview/previewWorkbenchState';
```

Replace the file-only state declarations with:

```typescript
const [previewWorkbench, setPreviewWorkbench] = useState(() =>
  createPreviewWorkbenchState(projectIdRef.current),
);
const [chatFilePreviewDirEntriesByProject, setChatFilePreviewDirEntriesByProject] =
  useState<Record<string, Record<string, RegistryFsEntry[]>>>(() => ({}));
const [chatFilePreviewLoadingDirsByProject, setChatFilePreviewLoadingDirsByProject] =
  useState<Record<string, Record<string, boolean>>>(() => ({}));
const activeWorkbenchTab = activePreviewTab(previewWorkbench);
const chatFilePeek = isFilePreviewTab(activeWorkbenchTab) ? activeWorkbenchTab : null;
const chatFilePreviewHasTabs = Object.values(previewWorkbench.tabsByProjectId)
  .some(tabs => tabs.some(tab => tab.type === 'file'));
const previewWorkbenchHasTabs = Object.values(previewWorkbench.tabsByProjectId)
  .some(tabs => tabs.length > 0);
```

Update `chatFilePeekRef` to use `FilePreviewTab | null`:

```typescript
const chatFilePeekRef = useRef<FilePreviewTab | null>(null);
```

- [ ] **Step 4: Port file open/load/close handlers to generic tab ids**

In `readChatFilePeek`, compute a stable tab id and use generic load helpers:

```typescript
const tabId = previewTabId({type: 'file', path});
setPreviewWorkbench(current =>
  beginPreviewTabLoad(
    openPreviewTab(current, {
      type: 'file',
      projectId: targetProjectId,
      path,
      targetLine,
      title: path.split('/').pop() || path,
    }),
    targetProjectId,
    tabId,
    requestSeq,
  ),
);
```

On successful file read, update only a matching file tab:

```typescript
setPreviewWorkbench(current =>
  updatePreviewTabAfterLoad(current, targetProjectId, tabId, requestSeq, tab =>
    tab.type === 'file'
      ? {
          ...tab,
          info,
          content,
          loading: false,
          error: '',
        }
      : tab,
  ),
);
```

On failure:

```typescript
setPreviewWorkbench(current =>
  failPreviewTabLoad(
    updatePreviewTabAfterLoad(current, targetProjectId, tabId, requestSeq, tab =>
      tab.type === 'file' ? {...tab, content: '', info: null} : tab,
    ),
    targetProjectId,
    tabId,
    requestSeq,
    err instanceof Error ? err.message : String(err),
  ),
);
```

Replace file tab selection and close helpers:

```typescript
const selectChatFilePreviewTab = (tabId: string) => {
  setPreviewWorkbench(current => ({
    ...selectPreviewProject(current, current.activeProjectId),
    activeTabIdByProjectId: {
      ...current.activeTabIdByProjectId,
      [current.activeProjectId]: tabId,
    },
  }));
};

const closeWorkbenchTab = (tabId: string) => {
  const projectId = previewWorkbench.activeProjectId;
  const tabs = previewWorkbench.tabsByProjectId[projectId] ?? [];
  const closingLastTab = tabs.length === 1 && tabs[0]?.id === tabId;
  setPreviewWorkbench(current => closePreviewTab(current, projectId, tabId));
  if (closingLastTab) {
    setChatPreviewManualOpen(true);
    setChatPreviewManualCollapsed(false);
  }
};
```

- [ ] **Step 5: Keep existing file UI working against generic tabs**

Where the old code used `chatFilePreviewWorkbench`, use `previewWorkbench`:

```typescript
const previewProjectId = previewWorkbench.activeProjectId;
const chatFilePreviewTabs =
  (previewWorkbench.tabsByProjectId[previewProjectId] ?? []).filter(isFilePreviewTab);
const chatFilePreviewDirEntries =
  chatFilePreviewDirEntriesByProject[previewProjectId] ?? {'.': []};
const chatFilePreviewLoadingDirs =
  chatFilePreviewLoadingDirsByProject[previewProjectId] ?? {};
```

When rendering file tabs, select by `tab.id` and close by `tab.id`:

```tsx
<button
  type="button"
  className="chat-file-workbench-tab-open"
  onClick={() => onTabSelect(tab.id)}
>
  {tab.path.split('/').pop() || tab.path}
</button>
<button
  type="button"
  className="chat-file-workbench-tab-close"
  onClick={() => onTabClose(tab.id)}
  aria-label={`Close ${tab.path}`}
  title="Close"
>
  <span className="codicon codicon-close" />
</button>
```

- [ ] **Step 6: Delete the old file-only state module and old state test**

Run:

```powershell
Remove-Item app\web\src\file\filePreviewWorkbenchState.ts
Remove-Item app\__tests__\web-file-preview-workbench-state.test.ts
```

Expected: files are removed after imports have moved to `previewWorkbenchState.ts`.

- [ ] **Step 7: Run focused tests**

Run:

```powershell
cd app
npm test -- web-preview-workbench-state.test.ts web-chat-file-peek-viewer.test.ts --runInBand
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/web/src/preview/previewWorkbenchState.ts app/__tests__/web-preview-workbench-state.test.ts app/__tests__/web-chat-file-peek-viewer.test.ts app/web/src/file/filePreviewWorkbenchState.ts app/__tests__/web-file-preview-workbench-state.test.ts
git commit -m "refactor: migrate file preview to unified workbench state"
```

Expected: commit succeeds.

---

### Task 3: Convert Prompt Diff and Attachments into Typed Tabs

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [ ] **Step 1: Write failing tests for prompt diff and attachment tabs**

In `app/__tests__/web-chat-file-peek-viewer.test.ts`, replace old single-instance preview assertions with:

```typescript
test('prompt diff artifacts open unified prompt-diff tabs without switching to Git', () => {
  const mainTsx = readSourceText(mainPath);
  const openStart = mainTsx.indexOf('const openPromptArtifactDiff = useCallback(');
  const openEnd = mainTsx.indexOf('const selectedChatHasOpenPromptTurn', openStart);
  const openBody = mainTsx.slice(openStart, openEnd);

  expect(openBody).toContain("type: 'prompt-diff'");
  expect(openBody).toContain('artifactId');
  expect(openBody).toContain('updatePreviewTabAfterLoad(');
  expect(openBody).not.toContain("setTab('git')");
  expect(openBody).not.toContain('setChatPromptArtifactPreview({');
  expect(mainTsx).toContain('isPromptDiffPreviewTab(activeWorkbenchTab)');
});

test('prompt attachments open unified attachment tabs', () => {
  const mainTsx = readSourceText(mainPath);
  const openStart = mainTsx.indexOf('const openChatAttachmentPreview = useCallback');
  const openEnd = mainTsx.indexOf('const buildLineRange', openStart);
  const openBody = mainTsx.slice(openStart, openEnd);

  expect(openBody).toContain("type: 'attachment'");
  expect(openBody).toContain('attachmentKey');
  expect(openBody).toContain('chatAttachmentBlockCacheKey(');
  expect(openBody).toContain('updatePreviewTabAfterLoad(');
  expect(mainTsx).not.toContain('const [chatAttachmentPreview, setChatAttachmentPreview]');
  expect(mainTsx).not.toContain('const [chatPromptArtifactPreview, setChatPromptArtifactPreview]');
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
cd app
npm test -- web-chat-file-peek-viewer.test.ts --runInBand
```

Expected: FAIL because prompt diff and attachment still use `chatPromptArtifactPreview` and `chatAttachmentPreview`.

- [ ] **Step 3: Import type guards for prompt diff and attachment tabs**

Add these to the `previewWorkbenchState` import in `WorkspaceApp.tsx`:

```typescript
isAttachmentPreviewTab,
isPromptDiffPreviewTab,
type AttachmentPreviewTab,
type PromptDiffPreviewTab,
```

Add derived active-tab aliases:

```typescript
const activePromptDiffPreview = isPromptDiffPreviewTab(activeWorkbenchTab) ? activeWorkbenchTab : null;
const activeAttachmentPreview = isAttachmentPreviewTab(activeWorkbenchTab) ? activeWorkbenchTab : null;
```

- [ ] **Step 4: Replace prompt diff single state with prompt-diff tabs**

Remove the `chatPromptArtifactPreview` state declaration. In `openPromptArtifactDiff`, replace the initial preview set with:

```typescript
const tabId = previewTabId({
  type: 'prompt-diff',
  sessionId,
  artifactId,
});
setPreviewWorkbench(current =>
  beginPreviewTabLoad(
    openPreviewTab(current, {
      type: 'prompt-diff',
      projectId: artifactProjectId,
      sessionId,
      artifactId,
      title: promptArtifactPreviewTitle(initialFileCount),
      files: initialFiles,
    }),
    artifactProjectId,
    tabId,
    requestSeq,
  ),
);
setChatPreviewManualOpen(false);
setChatPreviewManualCollapsed(false);
```

On success, update the tab:

```typescript
setPreviewWorkbench(current =>
  updatePreviewTabAfterLoad(current, artifactProjectId, tabId, requestSeq, tab =>
    tab.type === 'prompt-diff'
      ? {
          ...tab,
          title: promptArtifactPreviewTitle(fileCount),
          files,
          loading: false,
          error: '',
        }
      : tab,
  ),
);
```

On failure, update the matching tab:

```typescript
setPreviewWorkbench(current =>
  failPreviewTabLoad(current, artifactProjectId, tabId, requestSeq, messageText),
);
```

Update `togglePromptArtifactPreviewFile`:

```typescript
const togglePromptArtifactPreviewFile = useCallback((path: string) => {
  const tab = activePreviewTab(previewWorkbenchRef.current);
  if (!tab || tab.type !== 'prompt-diff') {
    return;
  }
  setPreviewWorkbench(current =>
    updatePreviewTab(current, tab.projectId, tab.id, item =>
      item.type === 'prompt-diff'
        ? {
            ...item,
            files: item.files.map(file =>
              file.path === path ? {...file, expanded: !file.expanded} : file,
            ),
          }
        : item,
    ),
  );
}, []);
```

Add `previewWorkbenchRef` next to other refs:

```typescript
const previewWorkbenchRef = useRef(previewWorkbench);
useEffect(() => {
  previewWorkbenchRef.current = previewWorkbench;
}, [previewWorkbench]);
```

- [ ] **Step 5: Replace attachment single state with attachment tabs**

Remove the `chatAttachmentPreview` state declaration. In `openChatAttachmentPreview`, compute a stable key and open a tab:

```typescript
const attachmentProjectId = selectedArchivedKey?.projectId || selectedChatKey?.projectId || projectId;
const sessionId = message.sessionId;
const attachmentKey = chatAttachmentBlockCacheKey(attachmentProjectId, sessionId, block);
const tabId = previewTabId({type: 'attachment', sessionId, attachmentKey});
const title = block.name || block.uri?.split('/').pop() || 'Attachment';
const meta = [block.mimeType, formatChatAttachmentSize(block.size ?? 0)].filter(Boolean).join(' - ');
const kind = String(block.mimeType || '').startsWith('image/') ? 'image' : 'file';
const requestSeq = chatAttachmentReadSeqRef.current + 1;
chatAttachmentReadSeqRef.current = requestSeq;

setPreviewWorkbench(current =>
  beginPreviewTabLoad(
    openPreviewTab(current, {
      type: 'attachment',
      projectId: attachmentProjectId,
      sessionId,
      attachmentKey,
      title,
      meta,
      mimeType: block.mimeType || '',
      kind,
      src: '',
    }),
    attachmentProjectId,
    tabId,
    requestSeq,
  ),
);
```

When `service.readProjectSessionAttachment(...)` succeeds:

```typescript
const src = kind === 'image'
  ? attachmentBase64DataUrl(result.content || '', result.mimeType || block.mimeType)
  : '';
setPreviewWorkbench(current =>
  updatePreviewTabAfterLoad(current, attachmentProjectId, tabId, requestSeq, tab =>
    tab.type === 'attachment'
      ? {
          ...tab,
          mimeType: result.mimeType || tab.mimeType,
          src,
          loading: false,
          error: '',
        }
      : tab,
  ),
);
```

On failure:

```typescript
setPreviewWorkbench(current =>
  failPreviewTabLoad(
    current,
    attachmentProjectId,
    tabId,
    requestSeq,
    err instanceof Error ? err.message : String(err),
  ),
);
```

- [ ] **Step 6: Render prompt diff and attachment bodies from active typed tabs**

Change `ChatPromptArtifactPreviewViewerProps` so `preview` is `PromptDiffPreviewTab`:

```typescript
type ChatPromptArtifactPreviewViewerProps = {
  preview: PromptDiffPreviewTab;
  mode: 'desktop' | 'mobile';
  themeMode: 'dark' | 'light';
  codeTheme: CodeThemeId;
  codeFont: CodeFontId;
  codeFontFamily: string;
  codeFontSize: number;
  codeLineHeight: number;
  codeTabSize: number;
  onClose: () => void;
  onToggleFile: (path: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
};
```

Change `ChatAttachmentPreviewViewerProps` so `preview` is `AttachmentPreviewTab`:

```typescript
type ChatAttachmentPreviewViewerProps = {
  preview: AttachmentPreviewTab;
  mode: 'desktop' | 'mobile';
  onClose: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
};
```

The renderer branches should use `activePromptDiffPreview` and `activeAttachmentPreview` instead of removed single states:

```tsx
{activePromptDiffPreview ? (
  <ChatPromptArtifactPreviewViewer
    preview={activePromptDiffPreview}
    mode="desktop"
    themeMode={themeMode}
    codeTheme={codeTheme}
    codeFont={codeFont}
    codeFontFamily={codeFontFamily}
    codeFontSize={codeFontSize}
    codeLineHeight={codeLineHeight}
    codeTabSize={codeTabSize}
    onClose={closeChatFilePeekFromChrome}
    onToggleFile={togglePromptArtifactPreviewFile}
    scrollRef={chatFilePeekScrollRef}
  />
) : activeAttachmentPreview ? (
  <ChatAttachmentPreviewViewer
    preview={activeAttachmentPreview}
    mode="desktop"
    onClose={closeChatFilePeekFromChrome}
    scrollRef={chatFilePeekScrollRef}
  />
) : null}
```

- [ ] **Step 7: Run focused tests**

Run:

```powershell
cd app
npm test -- web-chat-file-peek-viewer.test.ts web-preview-workbench-state.test.ts --runInBand
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/__tests__/web-chat-file-peek-viewer.test.ts
git commit -m "refactor: make prompt and attachment previews typed tabs"
```

Expected: commit succeeds.

---

### Task 4: Move Port Relay Frames into Workbench Tabs

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/portRelay/PortRelayFrameSurface.tsx`
- Modify: `app/__tests__/web-port-relay-settings.test.ts`
- Modify: `app/__tests__/web-port-relay-frame-surface-boundary.test.ts`
- Modify: `app/__tests__/web-main-surface-boundary.test.ts`

- [ ] **Step 1: Write failing tests for unified Port Relay tab opening**

In `app/__tests__/web-port-relay-settings.test.ts`, update the old placement assertions:

```typescript
test('opens every visible Port Relay frame through unified preview tabs', () => {
  expect(mainTsx).toContain('const openPortRelayWorkbenchTab = useCallback(async (');
  expect(mainTsx).toContain("type: 'port-relay'");
  expect(mainTsx).toContain('previewTabId({type: \'port-relay\'');
  expect(mainTsx).toContain('openChatPortRelayLink(relayLocalUrl).catch(() => undefined);');
  expect(mainTsx).toContain('onToggle={handlePortRelayFloatingToggle}');
  expect(mainTsx).toContain('onClick={handleDesktopPortRelaySelect}');
  expect(mainTsx).not.toContain("type PortRelayFramePlacement = 'main' | 'chatPreview';");
  expect(mainTsx).not.toContain('setPortRelayFramePlacement(');
  expect(mainTsx).not.toContain('const portRelayMobileFrameOverlay = mobilePortRelayFrameOpen');
});
```

In `app/__tests__/web-main-surface-boundary.test.ts`, preserve the delegation boundary while allowing Port Relay frames only through the external surface component:

```typescript
expect(workspaceApp).toContain("import { PortRelayFloatingButton, PortRelayFrameSurface } from '../portRelay/PortRelayFrameSurface';");
expect(workspaceApp).not.toContain('const portRelayMobileFrameOverlay = mobilePortRelayFrameOpen');
expect(workspaceApp).not.toContain("portRelayFramePlacement === 'main'");
expect(workspaceApp).not.toContain("portRelayFramePlacement === 'chatPreview'");
expect(workspaceApp).not.toContain('className="port-relay-frame"');
```

- [ ] **Step 2: Run Port Relay tests and verify RED**

Run:

```powershell
cd app
npm test -- web-port-relay-settings.test.ts web-port-relay-frame-surface-boundary.test.ts web-main-surface-boundary.test.ts --runInBand
```

Expected: FAIL because `WorkspaceApp.tsx` still uses `PortRelayFramePlacement` and the main/mobile frame overlay.

- [ ] **Step 3: Remove placement state and derive active Port Relay tab**

In `WorkspaceApp.tsx`, remove:

```typescript
type PortRelayFramePlacement = 'main' | 'chatPreview';
const [portRelayFrameOpen, setPortRelayFrameOpen] = useState(false);
const [portRelayFramePlacement, setPortRelayFramePlacement] = useState<PortRelayFramePlacement>('main');
```

Keep `portRelayFramePath`, `portRelayFrameReloadKey`, and `portRelayFrameAutoOpenPending` for service status and iframe reload behavior. Add:

```typescript
const activePortRelayPreview = isPortRelayPreviewTab(activeWorkbenchTab) ? activeWorkbenchTab : null;
const portRelayWorkbenchOpen = !!activePortRelayPreview && chatPreviewOpen;
const mobilePortRelayFrameOpen = !isWide && portRelayWorkbenchOpen;
```

Use `mobilePortRelayFrameOpen` only for existing floating-button target-menu behavior, not for a separate overlay component.

- [ ] **Step 4: Make `enablePortRelayForTarget` return the enabled snapshot**

Change the callback signature:

```typescript
const enablePortRelayForTarget = useCallback(async (
  target: PortRelayTarget | null,
  listenPortValue = portRelayListenPort,
  options: {framePath?: string; openFrame?: boolean} = {},
): Promise<RegistryPortRelaySnapshot | null> => {
```

On validation failures, return `null`:

```typescript
if (portRelayAccessCodeUnknown) {
  setPortRelayError('Access code is unknown on this device. Generate a new code before switching target.');
  return null;
}
```

On success, return the snapshot:

```typescript
const snapshot = await service.enablePortRelay({
  listenPort,
  hubId: normalizedTarget.hubId,
  targetHost: '127.0.0.1',
  targetPort: normalizedTarget.targetPort,
  accessCode,
});
setPortRelayKnownAccessCodeGeneration(typeof snapshot.accessCodeGeneration === 'number' ? snapshot.accessCodeGeneration : null);
setPortRelayFrameAutoOpenPending((options.openFrame ?? isWide) && snapshot.enabled);
applyPortRelaySnapshot(snapshot);
return snapshot;
```

In the `catch` block, return `null` after setting `portRelayError`.

- [ ] **Step 5: Add the unified Port Relay tab opener**

Add a helper near `openChatPortRelayLink`:

```typescript
const openPortRelayWorkbenchTab = useCallback(async (
  target: PortRelayTarget | null,
  framePath = '',
  _options: {source?: 'chat' | 'settings' | 'floating'} = {},
) => {
  const normalizedTarget = normalizePortRelayTarget(target);
  if (!normalizedTarget) {
    setPortRelayError('Target is required.');
    return;
  }
  if (portRelayAccessCodeUnknown) {
    setPortRelayError('Access code is unknown on this device. Generate a new code before opening relay pages.');
    setSidebarSettingsOpen(true);
    setSidebarCollapsed(false);
    setSettingsDetailView('portRelay');
    return;
  }
  const targetProjectId =
    selectedChatKeyRef.current?.projectId ||
    previewWorkbenchRef.current.activeProjectId ||
    projectIdRef.current;
  if (!targetProjectId) {
    setPortRelayError('Project is required to open Port Relay.');
    return;
  }
  const listenPort = Number(portRelayListenPort);
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
    setPortRelayError('Listen port must be in 1..65535.');
    setSidebarSettingsOpen(true);
    setSidebarCollapsed(false);
    setSettingsDetailView('portRelay');
    return;
  }
  const tabId = previewTabId({
    type: 'port-relay',
    hubId: normalizedTarget.hubId,
    targetPort: normalizedTarget.targetPort,
    framePath,
  });
  setPreviewWorkbench(current =>
    openPreviewTab(current, {
      type: 'port-relay',
      projectId: targetProjectId,
      hubId: normalizedTarget.hubId,
      targetPort: normalizedTarget.targetPort,
      framePath,
      title: `${normalizedTarget.hubId}:${normalizedTarget.targetPort}`,
      reloadKey: portRelayFrameReloadKey,
    }),
  );
  setChatPreviewManualOpen(false);
  setChatPreviewManualCollapsed(false);
  setPortRelayFramePath(framePath);
  if (!isWide) {
    setDrawerOpen(false);
    setSidebarSettingsOpen(false);
    setChatQuickSwitchMenuOpen(false);
    if (!chatFilePeekHistoryActiveRef.current) {
      window.history.pushState(createChatFilePeekHistoryState(), '', window.location.href);
      chatFilePeekHistoryActiveRef.current = true;
    }
  }
  const activeTarget = normalizePortRelayTarget({
    hubId: portRelaySnapshot.hubId,
    targetPort: portRelaySnapshot.targetPort,
  });
  const activeRelayMatches =
    portRelaySnapshot.enabled &&
    portRelaySnapshot.status !== 'Error' &&
    portRelaySnapshot.listenPort === listenPort &&
    samePortRelayTarget(activeTarget, normalizedTarget);
  if (!activeRelayMatches) {
    await enablePortRelayForTarget(normalizedTarget, portRelayListenPort, {
      framePath,
      openFrame: true,
    });
  }
  setPreviewWorkbench(current =>
    updatePreviewTab(current, targetProjectId, tabId, tab =>
      tab.type === 'port-relay'
        ? {...tab, url: portRelayFrameUrl || tab.url, reloadKey: portRelayFrameReloadKey}
        : tab,
    ),
  );
}, [
  enablePortRelayForTarget,
  isWide,
  portRelayAccessCodeUnknown,
  portRelayFrameReloadKey,
  portRelayFrameUrl,
  portRelayListenPort,
  portRelaySnapshot.enabled,
  portRelaySnapshot.hubId,
  portRelaySnapshot.listenPort,
  portRelaySnapshot.status,
  portRelaySnapshot.targetPort,
  setDrawerOpen,
  setSidebarCollapsed,
  setSidebarSettingsOpen,
]);
```

- [ ] **Step 6: Keep the active Port Relay tab URL in sync with relay status**

Add an effect after `openPortRelayWorkbenchTab`:

```typescript
useEffect(() => {
  const tab = activePreviewTab(previewWorkbenchRef.current);
  if (!tab || tab.type !== 'port-relay' || !portRelayFrameUrl) {
    return;
  }
  setPreviewWorkbench(current =>
    updatePreviewTab(current, tab.projectId, tab.id, item =>
      item.type === 'port-relay'
        ? {...item, url: portRelayFrameUrl, reloadKey: portRelayFrameReloadKey}
        : item,
    ),
  );
}, [portRelayFrameReloadKey, portRelayFrameUrl]);
```

This covers the render after `service.enablePortRelay(...)` updates `portRelaySnapshot`, because the synchronous opener can only see the previous `portRelayFrameUrl`.

- [ ] **Step 7: Route all Port Relay open entry points through the helper**

Replace `openChatPortRelayLink` frame-placement logic with:

```typescript
const openChatPortRelayLink = useCallback(async (localUrl: PortRelayLocalHttpUrl) => {
  const hubId = currentProject?.hubId || '';
  if (!hubId) {
    setError('Current project has no hub for Port Relay.');
    return;
  }
  const target: PortRelayTarget = {
    hubId,
    targetPort: localUrl.targetPort,
  };
  const nextTargets = upsertPortRelayTarget(portRelayTargets, target);
  setPortRelayTargets(nextTargets);
  setSelectedPortRelayTarget(target);
  persistPortRelaySettings({
    targets: nextTargets,
    selectedTarget: target,
    listenPort: Number(portRelayListenPort),
  });
  await openPortRelayWorkbenchTab(target, localUrl.path, {source: 'chat'});
}, [
  currentProject?.hubId,
  openPortRelayWorkbenchTab,
  persistPortRelaySettings,
  portRelayListenPort,
  portRelayTargets,
]);
```

Replace `handleDesktopPortRelaySelect`:

```typescript
const handleDesktopPortRelaySelect = useCallback(() => {
  if (sidebarSettingsOpen && settingsDetailView === 'portRelay') {
    closeSettingsPanel();
    return;
  }
  openSettingsPeer('portRelay');
  const target = activePortRelayTarget ?? selectedPortRelayTarget;
  if (target) {
    openPortRelayWorkbenchTab(target, portRelayFramePath, {source: 'settings'}).catch(() => undefined);
  }
}, [
  activePortRelayTarget,
  closeSettingsPanel,
  openPortRelayWorkbenchTab,
  openSettingsPeer,
  portRelayFramePath,
  selectedPortRelayTarget,
  settingsDetailView,
  sidebarSettingsOpen,
]);
```

Replace `handlePortRelayFloatingToggle`:

```typescript
const handlePortRelayFloatingToggle = useCallback(() => {
  if (floatingClickCooldownUntilRef.current > Date.now()) {
    return;
  }
  setPortRelayTargetMenuOpen(false);
  const target = activePortRelayTarget ?? selectedPortRelayTarget;
  if (!target) {
    openSettingsDetail('portRelay');
    return;
  }
  openPortRelayWorkbenchTab(target, portRelayFramePath, {source: 'floating'}).catch(() => undefined);
}, [activePortRelayTarget, openPortRelayWorkbenchTab, openSettingsDetail, portRelayFramePath, selectedPortRelayTarget]);
```

Replace `handleMobilePortRelayTargetMenuSelect`:

```typescript
const handleMobilePortRelayTargetMenuSelect = useCallback(async (target: PortRelayTarget) => {
  setPortRelayTargetMenuOpen(false);
  if (samePortRelayTarget(activePortRelayTarget, target)) {
    return;
  }
  setPortRelayMenuSwitchingTarget(target);
  try {
    await openPortRelayWorkbenchTab(target, '', {source: 'floating'});
  } finally {
    setPortRelayMenuSwitchingTarget(null);
  }
}, [activePortRelayTarget, openPortRelayWorkbenchTab]);
```

Update `enablePortRelay` so the settings Enable button opens the selected target in the workbench after enabling:

```typescript
const enablePortRelay = useCallback(async () => {
  const target = selectedPortRelayTarget ?? commitPortRelayDraftTarget();
  const snapshot = await enablePortRelayForTarget(target, portRelayListenPort, {framePath: '', openFrame: true});
  if (snapshot && target) {
    await openPortRelayWorkbenchTab(target, '', {source: 'settings'});
  }
}, [commitPortRelayDraftTarget, enablePortRelayForTarget, openPortRelayWorkbenchTab, portRelayListenPort, selectedPortRelayTarget]);
```

In `clearPortRelaySiteData`, replace the old frame-open call after reload:

```typescript
setPortRelayFrameReloadKey(key => key + 1);
const target = activePortRelayTarget ?? selectedPortRelayTarget;
if (target) {
  openPortRelayWorkbenchTab(target, portRelayFramePath, {source: 'settings'}).catch(() => undefined);
}
```

- [ ] **Step 8: Render Port Relay only as the active workbench body**

Remove `portRelayMobileFrameOverlay` and `renderChatPortRelayPreviewSurface`. In the active-body renderer, use:

```tsx
{activePortRelayPreview ? (
  <PortRelayFrameSurface
    key={`workbench:${activePortRelayPreview.id}:${activePortRelayPreview.reloadKey}:${portRelayFrameUrl}`}
    mode={mode}
    url={portRelayFrameUrl || activePortRelayPreview.url}
    chrome={false}
    onCloseChrome={closeChatFilePeekFromChrome}
    onOpenInBrowser={openPortRelayPreviewInBrowser}
  />
) : null}
```

Keep `portRelayClearSiteDataFrame` hidden iframe unchanged.

- [ ] **Step 9: Update close/back and open-in-browser behavior**

Replace `closePortRelayFrameFromChrome` with tab-close semantics:

```typescript
const closePortRelayFrameFromChrome = useCallback(() => {
  const tab = activePreviewTab(previewWorkbenchRef.current);
  if (!tab || tab.type !== 'port-relay') {
    return;
  }
  if (!isWide && chatFilePeekHistoryActiveRef.current) {
    window.history.back();
    return;
  }
  setPreviewWorkbench(current => closePreviewTab(current, tab.projectId, tab.id));
}, [isWide]);
```

Update `openPortRelayPreviewInBrowser`:

```typescript
const openPortRelayPreviewInBrowser = useCallback(() => {
  const tab = activePreviewTab(previewWorkbenchRef.current);
  const url = tab?.type === 'port-relay' ? portRelayFrameUrl || tab.url : portRelayFrameUrl;
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}, [portRelayFrameUrl]);
```

- [ ] **Step 10: Run Port Relay tests**

Run:

```powershell
cd app
npm test -- web-port-relay-settings.test.ts web-port-relay-frame-surface-boundary.test.ts web-main-surface-boundary.test.ts web-chat-file-peek-viewer.test.ts --runInBand
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 11: Commit**

Run:

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/web/src/portRelay/PortRelayFrameSurface.tsx app/__tests__/web-port-relay-settings.test.ts app/__tests__/web-port-relay-frame-surface-boundary.test.ts app/__tests__/web-main-surface-boundary.test.ts app/__tests__/web-chat-file-peek-viewer.test.ts
git commit -m "refactor: open port relay in preview workbench tabs"
```

Expected: commit succeeds.

---

### Task 5: Build the Unified Workbench Chrome and Project Pill

**Files:**
- Create: `app/web/src/preview/PreviewWorkbenchChrome.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/file.css`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [ ] **Step 1: Write failing UI structure tests**

Add these tests to `app/__tests__/web-chat-file-peek-viewer.test.ts`:

```typescript
test('preview workbench chrome renders a project pill, active title, and typed tabs', () => {
  const mainTsx = readSourceText(mainPath);
  const chromeTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'preview', 'PreviewWorkbenchChrome.tsx'));
  const stylesCss = readWebStyles(projectRoot);

  expect(mainTsx).toContain('<PreviewWorkbenchChrome');
  expect(chromeTsx).toContain('className="preview-workbench-project-pill"');
  expect(chromeTsx).toContain('className="preview-workbench-title"');
  expect(chromeTsx).toContain('className="preview-workbench-actions"');
  expect(chromeTsx).toContain('previewWorkbenchTabIcon(');
  expect(chromeTsx).toContain('className="preview-workbench-tab-icon"');
  expect(chromeTsx).not.toContain('<select');
  expect(stylesCss).toContain('.preview-workbench-project-pill');
  expect(stylesCss).toContain('.preview-workbench-project-menu');
  expect(stylesCss).toContain('.preview-workbench-tab-icon');
});

test('desktop file tree toggle is a floating body button and mobile hides it', () => {
  const chromeTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'preview', 'PreviewWorkbenchChrome.tsx'));
  const stylesCss = readWebStyles(projectRoot);

  expect(chromeTsx).toContain('className="preview-workbench-tree-fab"');
  expect(chromeTsx).toContain("mode === 'desktop' && fileTree");
  expect(chromeTsx).not.toContain('chat-file-workbench-tree-toggle');
  expect(stylesCss).toContain('.preview-workbench-body-tools');
  expect(stylesCss).toContain('.preview-workbench-tree-panel');
});
```

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```powershell
cd app
npm test -- web-chat-file-peek-viewer.test.ts --runInBand
```

Expected: FAIL because `PreviewWorkbenchChrome.tsx` does not exist.

- [ ] **Step 3: Create `PreviewWorkbenchChrome.tsx`**

Create `app/web/src/preview/PreviewWorkbenchChrome.tsx`:

```tsx
import React from 'react';
import type {RegistryProject} from '../registry/registryTypes';
import type {PreviewWorkbenchTab, PreviewWorkbenchTabType} from './previewWorkbenchState';

export type PreviewWorkbenchChromeMode = 'desktop' | 'mobile';

type PreviewWorkbenchChromeProps = {
  mode: PreviewWorkbenchChromeMode;
  projects: RegistryProject[];
  activeProjectId: string;
  projectMenuOpen: boolean;
  activeTab: PreviewWorkbenchTab | null;
  tabs: PreviewWorkbenchTab[];
  fileTreeOpen: boolean;
  fileTree: React.ReactNode;
  actions?: React.ReactNode;
  onClose: () => void;
  onProjectMenuToggle: () => void;
  onProjectSelect: (projectId: string) => void;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onFileTreeToggle: () => void;
  children: React.ReactNode;
};

function previewWorkbenchTabIcon(type: PreviewWorkbenchTabType): string {
  if (type === 'file') return 'codicon-file-code';
  if (type === 'prompt-diff') return 'codicon-diff';
  if (type === 'attachment') return 'codicon-paperclip';
  return 'codicon-radio-tower';
}

export function PreviewWorkbenchChrome({
  mode,
  projects,
  activeProjectId,
  projectMenuOpen,
  activeTab,
  tabs,
  fileTreeOpen,
  fileTree,
  actions,
  onClose,
  onProjectMenuToggle,
  onProjectSelect,
  onTabSelect,
  onTabClose,
  onFileTreeToggle,
  children,
}: PreviewWorkbenchChromeProps) {
  const activeProject = projects.find(project => project.projectId === activeProjectId) ?? null;
  const activeTitle = activeTab?.title || 'Preview';
  return (
    <section className={`preview-workbench-surface chat-file-peek-surface ${mode}`} aria-label="Preview workbench">
      <div className="chat-preview-toolbar preview-workbench-toolbar">
        <button
          type="button"
          className="chat-preview-icon-button"
          onClick={onClose}
          title={mode === 'mobile' ? 'Back' : 'Close preview'}
          aria-label={mode === 'mobile' ? 'Back' : 'Close preview'}
        >
          <span className={`codicon ${mode === 'mobile' ? 'codicon-arrow-left' : 'codicon-close'}`} />
        </button>
        <div className="preview-workbench-project-wrap">
          <button
            type="button"
            className="preview-workbench-project-pill"
            onClick={onProjectMenuToggle}
            aria-expanded={projectMenuOpen}
            title={activeProject?.name || activeProjectId || 'Project'}
          >
            <span className="codicon codicon-chevron-down" aria-hidden="true" />
            <span className="preview-workbench-project-name">
              {activeProject?.name || activeProjectId || 'Project'}
            </span>
          </button>
          {projectMenuOpen ? (
            <div className="preview-workbench-project-menu" role="menu" aria-label="Preview projects">
              {projects.map(project => {
                const selected = project.projectId === activeProjectId;
                return (
                  <button
                    key={`preview-project:${project.projectId}`}
                    type="button"
                    className={`preview-workbench-project-item${selected ? ' selected' : ''}`}
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => onProjectSelect(project.projectId)}
                    title={project.name || project.projectId}
                  >
                    <span className="preview-workbench-project-check" aria-hidden="true">
                      {selected ? <span className="codicon codicon-check" /> : null}
                    </span>
                    <span className="preview-workbench-project-label">{project.name || project.projectId}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="preview-workbench-title" title={activeTitle}>{activeTitle}</div>
        {actions ? <div className="preview-workbench-actions">{actions}</div> : null}
      </div>
      <div className="chat-file-workbench-tabs preview-workbench-tabs" role="tablist" aria-label="Open preview tabs">
        {tabs.map(tab => {
          const active = activeTab?.id === tab.id;
          return (
            <div
              key={`preview-tab:${tab.projectId}:${tab.id}`}
              className={`chat-file-workbench-tab preview-workbench-tab${active ? ' active' : ''}`}
              role="tab"
              aria-selected={active}
              title={tab.title}
            >
              <button type="button" className="chat-file-workbench-tab-open" onClick={() => onTabSelect(tab.id)}>
                <span className={`codicon ${previewWorkbenchTabIcon(tab.type)} preview-workbench-tab-icon`} aria-hidden="true" />
                <span className="preview-workbench-tab-label">{tab.title}</span>
              </button>
              <button
                type="button"
                className="chat-file-workbench-tab-close"
                onClick={() => onTabClose(tab.id)}
                aria-label={`Close ${tab.title}`}
                title="Close"
              >
                <span className="codicon codicon-close" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="preview-workbench-body">
        {mode === 'desktop' && fileTree ? (
          <div className="preview-workbench-body-tools">
            <button
              type="button"
              className={`preview-workbench-tree-fab${fileTreeOpen ? ' active' : ''}`}
              onClick={onFileTreeToggle}
              aria-label="Toggle file tree"
              title="Toggle file tree"
              aria-pressed={fileTreeOpen}
            >
              <span className="codicon codicon-files" />
            </button>
          </div>
        ) : null}
        {mode === 'desktop' && fileTreeOpen && fileTree ? (
          <div className="preview-workbench-tree-panel">
            {fileTree}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Wire chrome into `WorkspaceApp.tsx`**

Import the component:

```typescript
import {PreviewWorkbenchChrome} from '../preview/PreviewWorkbenchChrome';
```

Add local state for the project menu:

```typescript
const [previewProjectMenuOpen, setPreviewProjectMenuOpen] = useState(false);
```

Use generic current project tabs:

```typescript
const previewWorkbenchProjects = visibleProjectItems;
const previewWorkbenchTabs =
  previewWorkbench.tabsByProjectId[previewWorkbench.activeProjectId] ?? [];
const previewWorkbenchActiveTab = activeWorkbenchTab;
```

Add project-menu handlers:

```typescript
const togglePreviewProjectMenu = () => {
  setPreviewProjectMenuOpen(open => !open);
};
const selectPreviewProjectFromMenu = (nextProjectId: string) => {
  setPreviewProjectMenuOpen(false);
  setPreviewWorkbench(current => selectPreviewProject(current, nextProjectId));
};
```

Add active-tab actions:

```typescript
const renderPreviewWorkbenchActions = () => {
  const tab = activeWorkbenchTab;
  if (!tab) {
    return null;
  }
  if (tab.type === 'file') {
    return (
      <>
        <button
          type="button"
          className="chat-preview-icon-button"
          onClick={copyChatFilePreviewPath}
          title="Copy absolute path"
          aria-label="Copy absolute path"
        >
          <span className="codicon codicon-clippy" />
        </button>
        <button
          type="button"
          className="chat-preview-icon-button"
          onClick={openPeekFileInFullFileTab}
          title="Open in File tab"
          aria-label="Open in File tab"
        >
          <span className="codicon codicon-go-to-file" />
        </button>
      </>
    );
  }
  if (tab.type === 'port-relay') {
    return (
      <button
        type="button"
        className="chat-preview-icon-button"
        onClick={openPortRelayPreviewInBrowser}
        title="Open relay page in browser"
        aria-label="Open relay page in browser"
      >
        <span className="codicon codicon-link-external" />
      </button>
    );
  }
  return null;
};
```

Wrap the active body:

```tsx
<PreviewWorkbenchChrome
  mode={mode}
  projects={previewWorkbenchProjects}
  activeProjectId={previewWorkbench.activeProjectId}
  projectMenuOpen={previewProjectMenuOpen}
  activeTab={previewWorkbenchActiveTab}
  tabs={previewWorkbenchTabs}
  fileTreeOpen={previewWorkbench.treeOpen}
  fileTree={mode === 'desktop' && activeWorkbenchTab?.type === 'file' ? chatFilePreviewTreeContent : null}
  actions={renderPreviewWorkbenchActions()}
  onClose={closeChatFilePeekFromChrome}
  onProjectMenuToggle={togglePreviewProjectMenu}
  onProjectSelect={selectPreviewProjectFromMenu}
  onTabSelect={selectWorkbenchTab}
  onTabClose={closeWorkbenchTab}
  onFileTreeToggle={toggleChatFilePreviewTree}
>
  <div ref={chatFilePeekScrollRef} className="chat-file-peek-scroll">
    {renderPreviewWorkbenchBody(mode)}
  </div>
</PreviewWorkbenchChrome>
```

- [ ] **Step 5: Add body renderer and empty state**

Create `renderPreviewWorkbenchBody` near the preview pane render block:

```typescript
const renderPreviewWorkbenchBody = (mode: 'desktop' | 'mobile') => {
  const tab = activeWorkbenchTab;
  if (!tab) {
    return (
      <div className="chat-file-workbench-empty">
        <span className="codicon codicon-layout-sidebar-right" aria-hidden="true" />
        <span>No preview selected</span>
      </div>
    );
  }
  if (tab.type === 'file') {
    return renderFilePreviewBody(tab);
  }
  if (tab.type === 'prompt-diff') {
    return renderPromptDiffPreviewBody(tab, mode);
  }
  if (tab.type === 'attachment') {
    return renderAttachmentPreviewBody(tab, mode);
  }
  return renderPortRelayPreviewBody(tab, mode);
};
```

Keep existing body logic from `ChatFilePeekViewer`, `ChatPromptArtifactPreviewViewer`, and `ChatAttachmentPreviewViewer`, but remove their duplicated toolbar/tab chrome.

- [ ] **Step 6: Update styles**

Append to `app/web/src/styles/file.css`:

```css
.preview-workbench-toolbar {
  gap: 6px;
}

.preview-workbench-project-wrap {
  position: relative;
  flex: 0 1 auto;
  min-width: 0;
}

.preview-workbench-project-pill {
  height: 24px;
  max-width: 160px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 14%, var(--panel));
  color: var(--text);
  padding: 0 8px;
  font-size: 11px;
  font-weight: 700;
}

.preview-workbench-project-name,
.preview-workbench-title,
.preview-workbench-tab-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-workbench-title {
  flex: 1 1 auto;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.preview-workbench-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.preview-workbench-project-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  width: min(280px, calc(100vw - 24px));
  max-height: min(360px, calc(100vh - 96px));
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--panel) 86%, var(--panel-2));
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
  padding: 6px;
}

.preview-workbench-project-item {
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  padding: 6px;
  text-align: left;
}

.preview-workbench-project-item:hover,
.preview-workbench-project-item.selected {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.preview-workbench-tab .chat-file-workbench-tab-open {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.preview-workbench-tab-icon {
  flex: 0 0 auto;
  font-size: 13px;
  opacity: 0.86;
}

.preview-workbench-body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.preview-workbench-body-tools {
  position: absolute;
  top: 8px;
  right: 10px;
  z-index: 9;
}

.preview-workbench-tree-fab {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel) 86%, transparent);
  color: var(--text);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.24);
}

.preview-workbench-tree-fab.active {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 46%, transparent);
  background: color-mix(in srgb, var(--accent) 16%, var(--panel));
}

.preview-workbench-tree-panel {
  position: absolute;
  top: 46px;
  right: 10px;
  z-index: 8;
  width: min(340px, calc(100% - 20px));
  max-height: min(560px, calc(100% - 64px));
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: 0 18px 48px color-mix(in srgb, #000 36%, transparent);
}
```

Remove obsolete `.chat-file-workbench-project-select`, `.chat-file-workbench-tree-toggle`, and `.chat-file-workbench-tree-popover` styles after tests pass.

- [ ] **Step 7: Run UI tests and typecheck**

Run:

```powershell
cd app
npm test -- web-chat-file-peek-viewer.test.ts --runInBand
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```powershell
git add app/web/src/preview/PreviewWorkbenchChrome.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/file.css app/__tests__/web-chat-file-peek-viewer.test.ts
git commit -m "feat: add unified preview workbench chrome"
```

Expected: commit succeeds.

---

### Task 6: Clean Up Old Preview Priority Logic and Preserve Git Boundary

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Modify: `app/__tests__/web-git-surface-boundary.test.ts`
- Modify: `app/__tests__/web-main-surface-boundary.test.ts`

- [ ] **Step 1: Write boundary tests for removed priority logic and unchanged Git**

Add or update tests:

```typescript
test('preview pane renders one active typed workbench body instead of preview priority branches', () => {
  const mainTsx = readSourceText(mainPath);

  expect(mainTsx).toContain('const previewWorkbenchHasTabs = Object.values(previewWorkbench.tabsByProjectId)');
  expect(mainTsx).toContain('const renderPreviewWorkbenchBody = (mode:');
  expect(mainTsx).not.toContain('chatPreviewHasContent = chatFilePreviewHasTabs || !!chatPromptArtifactPreview || !!chatAttachmentPreview || chatPortRelayPreviewOpen');
  expect(mainTsx).not.toContain('chatPromptArtifactPreview ? (');
  expect(mainTsx).not.toContain('chatAttachmentPreview ? (');
  expect(mainTsx).not.toContain('chatPortRelayPreviewOpen ?');
});

test('git surface keeps its existing diff rendering path outside preview workbench', () => {
  const mainTsx = readSourceText(mainPath);
  const renderMainStart = mainTsx.indexOf('const renderMain = () => {');
  const gitBranchStart = mainTsx.indexOf("if (tab === 'git')", renderMainStart);
  const gitBranchEnd = mainTsx.indexOf('};', gitBranchStart);
  const gitBranch = mainTsx.slice(gitBranchStart, gitBranchEnd);

  expect(gitBranch).toContain('<GitSurface>');
  expect(gitBranch).toContain('renderDiffPane(diffText, selectedDiff)');
  expect(gitBranch).toContain('selectedDiff || \\'Select a changed file\\'');
  expect(gitBranch).not.toContain('openPreviewTab(');
  expect(gitBranch).not.toContain("type: 'prompt-diff'");
});
```

- [ ] **Step 2: Run boundary tests and verify RED where old priority remains**

Run:

```powershell
cd app
npm test -- web-chat-file-peek-viewer.test.ts web-git-surface-boundary.test.ts web-main-surface-boundary.test.ts --runInBand
```

Expected: FAIL until the old priority branches are removed.

- [ ] **Step 3: Replace `chatPreviewHasContent` with generic workbench content**

Use:

```typescript
const previewWorkbenchHasTabs = Object.values(previewWorkbench.tabsByProjectId)
  .some(tabs => tabs.length > 0);
const chatPreviewHasContent = previewWorkbenchHasTabs;
const chatPreviewOpen = chatPreviewManualOpen || (chatPreviewHasContent && !chatPreviewManualCollapsed);
```

Remove `chatPortRelayPreviewOpen`, `activePromptDiffPreview` priority branches, and separate empty viewer branches. The active workbench body decides what to show.

- [ ] **Step 4: Simplify close/back behavior**

Use one close path for desktop and mobile:

```typescript
const closeChatPreview = useCallback(() => {
  setChatPreviewManualOpen(false);
  setChatPreviewManualCollapsed(true);
  setChatPeekSelectedLines(new Set());
  chatPeekAnchorRef.current = null;
}, []);

const closeChatFilePeekFromChrome = useCallback(() => {
  if (!isWide && chatFilePeekHistoryActiveRef.current) {
    window.history.back();
    return;
  }
  closeChatPreview();
}, [closeChatPreview, isWide]);
```

Tab close remains separate through `closeWorkbenchTab`.

- [ ] **Step 5: Verify Git code is unchanged**

Run:

```powershell
git diff -- app/web/src/app/WorkspaceApp.tsx | Select-String -Pattern "selectedDiff|renderDiffPane|readGitFileDiff|GitSurface|GitSidebar"
```

Expected: diff contains no changes to `selectedDiff`, `renderDiffPane(diffText, selectedDiff)`, `readGitFileDiff`, `GitSurface`, or `GitSidebar` logic except test-only import/context movement if needed.

- [ ] **Step 6: Run boundary tests**

Run:

```powershell
cd app
npm test -- web-chat-file-peek-viewer.test.ts web-git-surface-boundary.test.ts web-main-surface-boundary.test.ts --runInBand
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/__tests__/web-chat-file-peek-viewer.test.ts app/__tests__/web-git-surface-boundary.test.ts app/__tests__/web-main-surface-boundary.test.ts
git commit -m "refactor: remove preview priority branches"
```

Expected: commit succeeds.

---

### Task 7: Full Verification and Push

**Files:**
- Verify: whole repo

- [ ] **Step 1: Run focused test set**

Run:

```powershell
cd app
npm test -- web-preview-workbench-state.test.ts web-chat-file-peek-viewer.test.ts web-port-relay-settings.test.ts web-port-relay-frame-surface-boundary.test.ts web-main-surface-boundary.test.ts web-git-surface-boundary.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run all Jest tests**

Run:

```powershell
cd app
npm test -- --runInBand
```

Expected: all suites pass.

- [ ] **Step 3: Run TypeScript**

Run:

```powershell
cd app
npm run tsc:web
```

Expected: exit code 0.

- [ ] **Step 4: Check whitespace**

Run:

```powershell
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 5: Inspect changed files**

Run:

```powershell
git status --short
git diff --stat
```

Expected: only implementation, tests, and this plan/spec docs are changed.

- [ ] **Step 6: Final commit if verification required changes**

If verification required fixes after the last task commit, run:

```powershell
git add -A
git commit -m "fix: stabilize unified preview workbench"
```

Expected: commit succeeds or Git reports nothing to commit.

- [ ] **Step 7: Push the branch**

Run:

```powershell
git push origin feat/unified-preview-workbench
```

Expected: branch is pushed successfully.

- [ ] **Step 8: Report verification evidence**

Final implementation response must include:

```text
Branch: feat/unified-preview-workbench
Verification:
- npm test -- --runInBand
- npm run tsc:web
- git diff --check
```

Do not claim completion unless those commands have been run in this implementation session and their outputs confirm success.
