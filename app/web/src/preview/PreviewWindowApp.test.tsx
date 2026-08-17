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
});
