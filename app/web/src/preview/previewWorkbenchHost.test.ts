import {
  PREVIEW_WORKBENCH_CHANNEL_VERSION,
  createPreviewWorkbenchChannel,
  type PreviewWorkbenchMessage,
  type PreviewWorkbenchMirrorState,
} from './previewWorkbenchChannel';
import {createPreviewWorkbenchHost} from './previewWorkbenchHost';

function createTransport() {
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

function stateFixture(): PreviewWorkbenchMirrorState {
  return {
    workbench: {
      activeProjectId: 'p1',
      tabsByProjectId: {p1: []},
      activeTabIdByProjectId: {},
      renderedTabIdsByProjectId: {},
      drawerMode: 'closed',
    },
    drawerPinned: true,
    search: {open: true, query: 'needle', activeIndex: 2, scrollTop: 88},
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
    codeFont: 'consolas',
    codeFontFamily: 'Consolas',
    codeFontSize: 13,
    codeLineHeight: 1.5,
    codeTabSize: 2,
    wrapLines: false,
    showLineNumbers: true,
    htmlPreviewEndpoint: '',
    htmlPreviewCSRFToken: '',
  };
}

test('host publishes the mirror on ready and routes intents to the main controller', () => {
  const transport = createTransport();
  const state = stateFixture();
  const onReady = jest.fn();
  const onIntent = jest.fn();
  const onClosed = jest.fn();
  const host = createPreviewWorkbenchHost({
    channel: transport.channel,
    getState: () => state,
    onReady,
    onIntent,
    onClosed,
  });

  transport.emit({
    kind: 'preview-ready',
    version: PREVIEW_WORKBENCH_CHANNEL_VERSION,
    instanceId: 'preview-1',
  });
  expect(onReady).toHaveBeenCalledTimes(1);
  expect(transport.posts).toContainEqual({
    kind: 'preview-state',
    version: PREVIEW_WORKBENCH_CHANNEL_VERSION,
    state,
  });

  transport.emit({
    kind: 'preview-intent',
    version: PREVIEW_WORKBENCH_CHANNEL_VERSION,
    intent: {kind: 'scroll', scrollTop: 144},
  });
  expect(onIntent).toHaveBeenCalledWith({kind: 'scroll', scrollTop: 144});

  transport.emit({kind: 'preview-window-closed', version: PREVIEW_WORKBENCH_CHANNEL_VERSION});
  expect(onClosed).toHaveBeenCalledTimes(1);

  transport.emit({kind: 'preview-window-closed', version: PREVIEW_WORKBENCH_CHANNEL_VERSION});
  expect(onClosed).toHaveBeenCalledTimes(1);

  host.close();
  transport.emit({kind: 'preview-window-closed', version: PREVIEW_WORKBENCH_CHANNEL_VERSION});
  expect(onClosed).toHaveBeenCalledTimes(1);
});
