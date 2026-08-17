import type {CodeFontId, CodeThemeId} from '../code/shikiSettings';
import type {RegistryFsEntry} from '../registry/registryTypes';
import type {GitBrowserProjectSnapshot} from '../git/gitBrowserStore';
import type {
  GitDiffFileMeta,
  GitDiffSource,
  PreviewWorkbenchState,
} from './previewWorkbenchState';

export const PREVIEW_WORKBENCH_CHANNEL_NAME = 'wheelmaker.preview-workbench.v1';
export const PREVIEW_WORKBENCH_CHANNEL_VERSION = 1 as const;

export type PreviewWorkbenchSearchState = {
  open: boolean;
  query: string;
  activeIndex: number;
  scrollTop: number;
};

export type PreviewWorkbenchFileTreeState = {
  dirEntries: Record<string, RegistryFsEntry[]>;
  loadingDirs: Record<string, boolean>;
  expandedDirs: Record<string, string[]>;
  searchQuery: string;
  rootState: 'ready' | 'loading' | 'error' | 'empty';
  rootError: string;
};

export type PreviewWorkbenchMirrorState = {
  workbench: PreviewWorkbenchState;
  drawerPinned: boolean;
  search: PreviewWorkbenchSearchState;
  fileTree: PreviewWorkbenchFileTreeState;
  gitSnapshot: GitBrowserProjectSnapshot | null;
  themeMode: 'dark' | 'light';
  codeTheme: CodeThemeId;
  codeFont: CodeFontId;
  codeFontFamily: string;
  codeFontSize: number;
  codeLineHeight: number;
  codeTabSize: number;
  wrapLines: boolean;
  showLineNumbers: boolean;
  htmlPreviewEndpoint: string;
  htmlPreviewCSRFToken: string;
};

export type PreviewWorkbenchIntent =
  | {kind: 'select-tab'; projectId: string; tabId: string}
  | {kind: 'close-tab'; projectId: string; tabId: string}
  | {kind: 'drawer-mode'; mode: 'closed' | 'files' | 'git'}
  | {kind: 'toggle-drawer-pin'}
  | {kind: 'search'; open: boolean; query: string; activeIndex: number}
  | {kind: 'file-tree-search'; query: string}
  | {kind: 'scroll'; scrollTop: number}
  | {kind: 'toggle-directory'; projectId: string; path: string}
  | {kind: 'open-file'; projectId: string; path: string; targetLine: number | null}
  | {kind: 'open-git'; projectId: string; source: GitDiffSource; file: GitDiffFileMeta}
  | {kind: 'git-selected-refs'; projectId: string; refs: string[]}
  | {kind: 'git-toggle-commit'; projectId: string; sha: string}
  | {kind: 'git-refresh'; projectId: string}
  | {kind: 'git-load-more'; projectId: string}
  | {kind: 'git-retry'; projectId: string}
  | {kind: 'copy-commit-sha'; sha: string}
  | {kind: 'focus'}
  | {kind: 'dock'};

export type PreviewWorkbenchMessage =
  | {
      kind: 'preview-ready';
      version: typeof PREVIEW_WORKBENCH_CHANNEL_VERSION;
      instanceId: string;
    }
  | {
      kind: 'preview-state';
      version: typeof PREVIEW_WORKBENCH_CHANNEL_VERSION;
      state: PreviewWorkbenchMirrorState;
    }
  | {
      kind: 'preview-intent';
      version: typeof PREVIEW_WORKBENCH_CHANNEL_VERSION;
      intent: PreviewWorkbenchIntent;
    }
  | {
      kind: 'preview-host-status';
      version: typeof PREVIEW_WORKBENCH_CHANNEL_VERSION;
      detached: boolean;
    }
  | {
      kind: 'preview-window-closed';
      version: typeof PREVIEW_WORKBENCH_CHANNEL_VERSION;
    };

export type PreviewWorkbenchChannelPort = {
  addEventListener: (type: 'message', listener: (event: {data: unknown}) => void) => void;
  removeEventListener: (type: 'message', listener: (event: {data: unknown}) => void) => void;
  postMessage: (message: unknown) => void;
  close: () => void;
};

export type PreviewWorkbenchChannelFactory = (name: string) => PreviewWorkbenchChannelPort;

export type PreviewWorkbenchChannel = {
  post: (message: PreviewWorkbenchMessage) => void;
  subscribe: (listener: (message: PreviewWorkbenchMessage) => void) => () => void;
  close: () => void;
};

type PreviewWorkbenchChannelOptions = {
  channelFactory?: PreviewWorkbenchChannelFactory;
  name?: string;
};

const MESSAGE_KINDS = new Set<PreviewWorkbenchMessage['kind']>([
  'preview-ready',
  'preview-state',
  'preview-intent',
  'preview-host-status',
  'preview-window-closed',
]);

function defaultChannelFactory(name: string): PreviewWorkbenchChannelPort {
  if (typeof BroadcastChannel === 'undefined') {
    return {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      postMessage: () => undefined,
      close: () => undefined,
    };
  }
  return new BroadcastChannel(name) as unknown as PreviewWorkbenchChannelPort;
}

function isPreviewWorkbenchMessage(value: unknown): value is PreviewWorkbenchMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as {kind?: unknown; version?: unknown};
  return message.version === PREVIEW_WORKBENCH_CHANNEL_VERSION
    && typeof message.kind === 'string'
    && MESSAGE_KINDS.has(message.kind as PreviewWorkbenchMessage['kind']);
}

export function createPreviewWorkbenchChannel(
  options: PreviewWorkbenchChannelOptions = {},
): PreviewWorkbenchChannel {
  const port = (options.channelFactory ?? defaultChannelFactory)(
    options.name ?? PREVIEW_WORKBENCH_CHANNEL_NAME,
  );
  const listeners = new Set<(message: PreviewWorkbenchMessage) => void>();
  let closed = false;
  const handleMessage = (event: {data: unknown}) => {
    if (closed || !isPreviewWorkbenchMessage(event.data)) return;
    for (const listener of [...listeners]) listener(event.data);
  };
  port.addEventListener('message', handleMessage);

  return {
    post: message => {
      if (!closed) port.postMessage(message);
    },
    subscribe: listener => {
      if (closed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => {
      if (closed) return;
      closed = true;
      listeners.clear();
      port.removeEventListener('message', handleMessage);
      port.close();
    },
  };
}
