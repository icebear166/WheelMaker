/**
 * @jest-environment jsdom
 */
import React from 'react';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

import {
  PREVIEW_WORKBENCH_CHANNEL_VERSION,
  createPreviewWorkbenchChannel,
  type PreviewWorkbenchChannel,
  type PreviewWorkbenchMessage,
  type PreviewWorkbenchMirrorState,
} from './previewWorkbenchChannel';

jest.mock('../code/markdownPreview', () => ({
  MarkdownPreview: ({content}: {content: string}) => <pre>{content}</pre>,
}));
jest.mock('../code/ShikiCodeBlock', () => ({
  ShikiCodeBlock: ({content}: {content: string}) => <pre>{content}</pre>,
  ShikiDiffPane: ({content}: {content: string}) => <pre>{content}</pre>,
}));
import {PreviewWindowApp} from './PreviewWindowApp';

(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as unknown as {ResizeObserver: typeof MockResizeObserver}).ResizeObserver = MockResizeObserver;

function createFakePreviewTransport() {
  const listeners = new Set<(event: {data: unknown}) => void>();
  const posts: unknown[] = [];
  const port = {
    addEventListener: (_type: 'message', listener: (event: {data: unknown}) => void) => listeners.add(listener),
    removeEventListener: (_type: 'message', listener: (event: {data: unknown}) => void) => listeners.delete(listener),
    postMessage: (message: unknown) => posts.push(message),
    close: () => listeners.clear(),
  };
  const channel = createPreviewWorkbenchChannel({channelFactory: () => port});
  return {
    channel,
    posts,
    emit: (message: PreviewWorkbenchMessage) => {
      for (const listener of [...listeners]) listener({data: message});
    },
  };
}

function singleFilePreviewState(): PreviewWorkbenchMirrorState {
  const tab = {
    id: 'file:README.md',
    type: 'file' as const,
    projectId: 'p1',
    title: 'README.md',
    loading: false,
    error: '',
    requestId: 1,
    path: 'README.md',
    targetLine: null,
    content: '# Preview content',
    info: null,
  };
  return {
    workbench: {
      activeProjectId: 'p1',
      tabsByProjectId: {p1: [tab]},
      activeTabIdByProjectId: {p1: tab.id},
      renderedTabIdsByProjectId: {p1: [tab.id]},
      drawerMode: 'closed',
    },
    drawerPinned: false,
    search: {open: false, query: '', activeIndex: 0, scrollTop: 0},
    fileTree: {
      dirEntries: {},
      loadingDirs: {},
      expandedDirs: {},
      searchQuery: '',
      searchResults: [],
      searchCollapsedDirs: [],
      searchLoading: false,
      searchError: '',
      searchIndexed: true,
      searchActiveIndex: 0,
      rootState: 'empty',
      rootError: '',
    },
    gitSnapshot: null,
    themeMode: 'dark',
    codeTheme: 'dark-plus',
    codeFont: 'jetbrains-mono',
    codeFontFamily: 'JetBrains Mono',
    codeFontSize: 13,
    codeLineHeight: 1.5,
    codeTabSize: 2,
    wrapLines: false,
    showLineNumbers: true,
    htmlPreviewEndpoint: '',
    htmlPreviewCSRFToken: '',
  };
}

describe('PreviewWindowApp', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let transport: ReturnType<typeof createFakePreviewTransport>;

  beforeEach(() => {
    transport = createFakePreviewTransport();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    container?.remove();
    container = null;
    transport.channel.close();
  });

  test('renders the received workbench and sends tab and dock intents', () => {
    act(() => root!.render(<PreviewWindowApp channel={transport.channel} />));
    act(() => transport.emit({
      kind: 'preview-state',
      version: PREVIEW_WORKBENCH_CHANNEL_VERSION,
      state: singleFilePreviewState(),
    }));

    expect(container!.querySelector('[role="tab"]')?.textContent).toContain('README.md');
    expect(container!.textContent).toContain('Preview content');

    act(() => transport.emit({
      kind: 'preview-scroll',
      version: PREVIEW_WORKBENCH_CHANNEL_VERSION,
      scrollTop: 144,
    }));
    expect(container!.querySelector('.chat-file-peek-scroll')).toHaveProperty('scrollTop', 144);

    act(() => (container!.querySelector('[aria-label="Dock preview"]') as HTMLButtonElement).click());
    expect(transport.posts).toContainEqual({
      kind: 'preview-intent',
      version: PREVIEW_WORKBENCH_CHANNEL_VERSION,
      intent: {kind: 'dock'},
    });

    act(() => (container!.querySelector('[role="tab"]') as HTMLButtonElement).click());
    expect(transport.posts).toContainEqual({
      kind: 'preview-intent',
      version: PREVIEW_WORKBENCH_CHANNEL_VERSION,
      intent: {kind: 'select-tab', projectId: 'p1', tabId: 'file:README.md'},
    });
  });

  test('companion exposes drawer and diff-file intents', () => {
    const state = singleFilePreviewState();
    const diffTab = {
      id: 'git-diff:working-tree',
      type: 'git-diff' as const,
      projectId: 'p1',
      title: 'Working Tree',
      loading: false,
      error: '',
      requestId: 1,
      source: {kind: 'worktree' as const, scope: 'unstaged' as const, path: 'src/a.ts'},
      files: [{
        path: 'src/a.ts',
        status: 'M',
        additions: 1,
        deletions: 0,
        diff: '+const answer = 42;',
        expanded: false,
        isBinary: false,
        truncated: false,
      }],
      activeFilePath: 'src/a.ts',
      loadedWorktreeRev: '',
    };
    state.workbench.tabsByProjectId.p1 = [diffTab];
    state.workbench.activeTabIdByProjectId.p1 = diffTab.id;
    state.workbench.renderedTabIdsByProjectId.p1 = [diffTab.id];

    act(() => root!.render(<PreviewWindowApp channel={transport.channel} />));
    act(() => transport.emit({
      kind: 'preview-state',
      version: PREVIEW_WORKBENCH_CHANNEL_VERSION,
      state,
    }));

    const filesButton = container!.querySelector('[aria-label="Toggle files"]') as HTMLButtonElement;
    expect(filesButton).toBeTruthy();
    act(() => filesButton.click());
    expect(transport.posts).toContainEqual(expect.objectContaining({
      kind: 'preview-intent',
      intent: {kind: 'drawer-mode', mode: 'files'},
    }));

    const diffHeader = container!.querySelector('[data-preview-diff-path="src/a.ts"]')
      ?.querySelector('button') as HTMLButtonElement;
    act(() => diffHeader.click());
    expect(transport.posts).toContainEqual(expect.objectContaining({
      kind: 'preview-intent',
      intent: {kind: 'toggle-diff-file', projectId: 'p1', tabId: diffTab.id, path: 'src/a.ts'},
    }));
  });

  test('companion renders indexed file search results and routes directory toggles', () => {
    const state = singleFilePreviewState();
    state.workbench.drawerMode = 'files';
    state.fileTree.searchQuery = 'needle';
    state.fileTree.searchResults = [{path: 'src/needle.ts', name: 'needle.ts'}];
    act(() => root!.render(<PreviewWindowApp channel={transport.channel} />));
    act(() => transport.emit({
      kind: 'preview-state',
      version: PREVIEW_WORKBENCH_CHANNEL_VERSION,
      state,
    }));

    expect(container!.querySelector('[role="tree"]')?.textContent).toContain('needle.ts');
    const directory = container!.querySelector('[data-preview-search-directory="src"]') as HTMLButtonElement;
    expect(directory).toBeTruthy();
    act(() => directory.click());
    expect(transport.posts).toContainEqual(expect.objectContaining({
      kind: 'preview-intent',
      intent: {kind: 'toggle-search-directory', path: 'src'},
    }));
  });

  test('companion exposes active preview search navigation', () => {
    const state = singleFilePreviewState();
    const fileTab = state.workbench.tabsByProjectId.p1[0];
    if (fileTab?.type === 'file') {
      fileTab.content = 'const first = 1;\nconst second = 2;';
    }
    state.search = {open: true, query: 'const', activeIndex: 0, scrollTop: 0};
    act(() => root!.render(<PreviewWindowApp channel={transport.channel} />));
    act(() => transport.emit({
      kind: 'preview-state',
      version: PREVIEW_WORKBENCH_CHANNEL_VERSION,
      state,
    }));

    expect(container!.querySelector('[aria-label="Next match"]')).toBeTruthy();
    expect(container!.textContent).toContain('1/2');
    act(() => (container!.querySelector('[aria-label="Next match"]') as HTMLButtonElement).click());
    expect(transport.posts).toContainEqual(expect.objectContaining({
      kind: 'preview-intent',
      intent: {kind: 'search', open: true, query: 'const', activeIndex: 1},
    }));
  });
});
