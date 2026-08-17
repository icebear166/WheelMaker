import React from 'react';

import {Icon} from '../common/Icon';
import {FileExplorerTree} from '../file/FileExplorerTree';
import {GitHistoryPanel} from '../git/GitHistoryPanel';
import {PortRelayFrameSurface} from '../portRelay/PortRelayFrameSurface';
import {applyDocumentTheme} from '../theme/documentTheme';
import {UnifiedDiffPreview} from './UnifiedDiffPreview';
import {
  PREVIEW_WORKBENCH_CHANNEL_VERSION,
  createPreviewWorkbenchChannel,
  type PreviewWorkbenchChannel,
  type PreviewWorkbenchIntent,
  type PreviewWorkbenchMirrorState,
} from './previewWorkbenchChannel';
import {PreviewWorkbenchView} from './PreviewWorkbenchView';
import {
  activePreviewTab,
  previewRenderedTabs,
  type FilePreviewTab,
  type PreviewWorkbenchTab,
} from './previewWorkbenchState';
import {
  ChatAttachmentPreviewViewer,
  ChatFilePeekViewer,
  ChatPromptArtifactPreviewViewer,
} from './PreviewWorkbenchViewers';

type PreviewWindowAppProps = {
  channel?: PreviewWorkbenchChannel;
};

const EMPTY_HIGHLIGHTED_LINES = new Set<number>();
const EMPTY_FILE_TABS: FilePreviewTab[] = [];
const FALLBACK_FILE_ICON = {glyph: '?', color: '#d4d7d6'};

function resolvePreviewFileIcon(_name: string) {
  return FALLBACK_FILE_ICON;
}

function previewWindowInstanceId(): string {
  return `preview-window-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function postIntent(channel: PreviewWorkbenchChannel, intent: PreviewWorkbenchIntent): void {
  channel.post({
    kind: 'preview-intent',
    version: PREVIEW_WORKBENCH_CHANNEL_VERSION,
    intent,
  });
}

function filterDirectoryEntries(
  entries: PreviewWorkbenchMirrorState['fileTree']['dirEntries'],
  query: string,
): PreviewWorkbenchMirrorState['fileTree']['dirEntries'] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return entries;
  const visiblePaths = new Set<string>();
  for (const [parent, parentEntries] of Object.entries(entries)) {
    for (const entry of parentEntries) {
      if (entry.kind === 'file' && entry.name.toLowerCase().includes(normalizedQuery)) {
        visiblePaths.add(entry.path);
        visiblePaths.add(parent);
      }
    }
  }
  if (visiblePaths.size === 0) return {'.': []};
  return Object.fromEntries(
    Object.entries(entries).map(([parent, parentEntries]) => [
      parent,
      parentEntries.filter(entry => entry.kind === 'dir'
        ? [...visiblePaths].some(path => path.startsWith(`${entry.path}/`))
        : visiblePaths.has(entry.path)),
    ]),
  );
}

function PreviewWindowSearchBar({
  state,
  channel,
}: {
  state: PreviewWorkbenchMirrorState;
  channel: PreviewWorkbenchChannel;
}) {
  if (!state.search.open) return null;
  const updateSearch = (query: string) => postIntent(channel, {
    kind: 'search',
    open: true,
    query,
    activeIndex: 0,
  });
  return (
    <div className="preview-workbench-search-hud">
      <div className="preview-workbench-search-bar">
        <Icon name="search" />
        <input
          className="preview-workbench-search-input"
          value={state.search.query}
          onChange={event => updateSearch(event.target.value)}
          placeholder="Search"
          aria-label="Search current preview"
        />
        <button
          type="button"
          className="chat-preview-icon-button"
          onClick={() => postIntent(channel, {
            kind: 'search',
            open: false,
            query: '',
            activeIndex: 0,
          })}
          aria-label="Close search"
        >
          <Icon name="x" />
        </button>
      </div>
    </div>
  );
}

export function PreviewWindowApp({channel: providedChannel}: PreviewWindowAppProps) {
  const ownedChannelRef = React.useRef<PreviewWorkbenchChannel | null>(null);
  const channel = React.useMemo(() => {
    if (providedChannel) return providedChannel;
    const created = createPreviewWorkbenchChannel();
    ownedChannelRef.current = created;
    return created;
  }, [providedChannel]);
  const [mirrorState, setMirrorState] = React.useState<PreviewWorkbenchMirrorState | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const unsubscribe = channel.subscribe(message => {
      if (message.kind === 'preview-state') {
        setMirrorState(message.state);
      }
    });
    channel.post({
      kind: 'preview-ready',
      version: PREVIEW_WORKBENCH_CHANNEL_VERSION,
      instanceId: previewWindowInstanceId(),
    });
    return () => {
      unsubscribe();
      if (ownedChannelRef.current === channel) {
        channel.post({
          kind: 'preview-window-closed',
          version: PREVIEW_WORKBENCH_CHANNEL_VERSION,
        });
        channel.close();
        ownedChannelRef.current = null;
      }
    };
  }, [channel]);

  React.useEffect(() => {
    if (scrollRef.current && mirrorState) {
      scrollRef.current.scrollTop = mirrorState.search.scrollTop;
    }
  }, [mirrorState]);

  React.useEffect(() => {
    if (!mirrorState) return undefined;
    return applyDocumentTheme(document.documentElement, mirrorState.themeMode);
  }, [mirrorState?.themeMode]);

  if (!mirrorState) {
    return (
      <div className="page preview-window-loading" role="status">
        Waiting for Preview...
      </div>
    );
  }

  const workbench = mirrorState.workbench;
  const activeTab = activePreviewTab(workbench);
  const tabs = workbench.tabsByProjectId[workbench.activeProjectId] ?? [];
  const renderedTabs = previewRenderedTabs(workbench).filter(tab =>
    tab.type !== 'port-relay' || tab.id === activeTab?.id,
  );
  const projectId = workbench.activeProjectId;
  const expandedDirs = new Set(mirrorState.fileTree.expandedDirs[projectId] ?? ['.']);
  const fileEntries = filterDirectoryEntries(
    mirrorState.fileTree.dirEntries,
    mirrorState.fileTree.searchQuery,
  );
  const selectedFile = activeTab?.type === 'file' ? activeTab.path : '';

  const drawerSearch = (
    <>
      <Icon name="search" className="preview-workbench-tree-search-icon" />
      <input
        className="preview-workbench-tree-search-input preview-workbench-drawer-primary-control"
        value={mirrorState.fileTree.searchQuery}
        onChange={event => postIntent(channel, {kind: 'file-tree-search', query: event.target.value})}
        placeholder="Search files"
        aria-label="Search files"
      />
      <button
        type="button"
        className={`preview-workbench-tree-tool-button preview-workbench-drawer-icon-button${mirrorState.drawerPinned ? ' active' : ''}`}
        onClick={() => postIntent(channel, {kind: 'toggle-drawer-pin'})}
        data-tooltip={mirrorState.drawerPinned ? 'Unpin drawer' : 'Pin drawer open'}
        aria-label={mirrorState.drawerPinned ? 'Unpin drawer' : 'Pin drawer open'}
        aria-pressed={mirrorState.drawerPinned}
      >
        <Icon name="pin" />
      </button>
    </>
  );

  const fileDrawer = (
    <div className="preview-workbench-file-tree-content">
      <FileExplorerTree
        showSectionTitle={false}
        dirEntries={fileEntries}
        loadingDirs={mirrorState.fileTree.loadingDirs}
        selectedFile={selectedFile}
        isExpanded={path => expandedDirs.has(path)}
        toggleDirectory={path => postIntent(channel, {kind: 'toggle-directory', projectId, path})}
        resolveFileIcon={resolvePreviewFileIcon}
        onFileSelect={path => postIntent(channel, {
          kind: 'open-file',
          projectId,
          path,
          targetLine: null,
        })}
        depthIndent={14}
        rootState={mirrorState.fileTree.rootState}
        rootError={mirrorState.fileTree.rootError}
      />
    </div>
  );

  const gitDrawer = mirrorState.gitSnapshot ? (
    <GitHistoryPanel
      snapshot={mirrorState.gitSnapshot}
      onSelectedRefsChange={refs => postIntent(channel, {kind: 'git-selected-refs', projectId, refs})}
      onToggleCommit={sha => postIntent(channel, {kind: 'git-toggle-commit', projectId, sha})}
      onFileOpen={(source, file) => postIntent(channel, {kind: 'open-git', projectId, source, file})}
      onRefresh={() => postIntent(channel, {kind: 'git-refresh', projectId})}
      onLoadMore={() => postIntent(channel, {kind: 'git-load-more', projectId})}
      onRetry={() => postIntent(channel, {kind: 'git-retry', projectId})}
      onCopyCommitSha={sha => postIntent(channel, {kind: 'copy-commit-sha', sha})}
      resolveFileIcon={resolvePreviewFileIcon}
      drawerPinned={mirrorState.drawerPinned}
      onToggleDrawerPin={() => postIntent(channel, {kind: 'toggle-drawer-pin'})}
    />
  ) : <div className="git-history-empty">Git is not available for this project.</div>;

  const post = (intent: PreviewWorkbenchIntent) => postIntent(channel, intent);
  const renderTabBody = (tab: PreviewWorkbenchTab, active: boolean): React.ReactNode => {
    if (tab.type === 'file') {
      return (
        <ChatFilePeekViewer
          peek={tab}
          mode="desktop"
          tabs={EMPTY_FILE_TABS}
          treeOpen={workbench.drawerMode === 'files'}
          themeMode={mirrorState.themeMode}
          codeTheme={mirrorState.codeTheme}
          codeFont={mirrorState.codeFont}
          codeFontSize={mirrorState.codeFontSize}
          codeLineHeight={mirrorState.codeLineHeight}
          codeTabSize={mirrorState.codeTabSize}
          wrapLines={mirrorState.wrapLines}
          showLineNumbers={mirrorState.showLineNumbers}
          highlightedLines={active ? EMPTY_HIGHLIGHTED_LINES : EMPTY_HIGHLIGHTED_LINES}
          onClose={() => post({kind: 'dock'})}
          onCopyPath={() => undefined}
          onTabSelect={() => undefined}
          onTabClose={() => undefined}
          onToggleTree={() => post({
            kind: 'drawer-mode',
            mode: workbench.drawerMode === 'files' ? 'closed' : 'files',
          })}
          treeContent={null}
          scrollRef={scrollRef}
          htmlPreviewEndpoint={mirrorState.htmlPreviewEndpoint}
          htmlPreviewCSRFToken={mirrorState.htmlPreviewCSRFToken}
        />
      );
    }
    if (tab.type === 'prompt-diff') {
      return (
        <ChatPromptArtifactPreviewViewer
          preview={tab}
          mode="desktop"
          themeMode={mirrorState.themeMode}
          codeTheme={mirrorState.codeTheme}
          codeFont={mirrorState.codeFont}
          codeFontFamily={mirrorState.codeFontFamily}
          codeFontSize={mirrorState.codeFontSize}
          codeLineHeight={mirrorState.codeLineHeight}
          codeTabSize={mirrorState.codeTabSize}
          onClose={() => post({kind: 'dock'})}
          onToggleFile={() => undefined}
          scrollRef={scrollRef}
        />
      );
    }
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
          onToggleFile={() => undefined}
          themeMode={mirrorState.themeMode}
          codeTheme={mirrorState.codeTheme}
          codeFont={mirrorState.codeFont}
          codeFontFamily={mirrorState.codeFontFamily}
          codeFontSize={mirrorState.codeFontSize}
          codeLineHeight={mirrorState.codeLineHeight}
          codeTabSize={mirrorState.codeTabSize}
        />
      );
    }
    if (tab.type === 'attachment') {
      return (
        <ChatAttachmentPreviewViewer
          preview={tab}
          mode="desktop"
          onClose={() => post({kind: 'dock'})}
          scrollRef={scrollRef}
          themeMode={mirrorState.themeMode}
          codeTheme={mirrorState.codeTheme}
          codeFont={mirrorState.codeFont}
          codeFontSize={mirrorState.codeFontSize}
          codeLineHeight={mirrorState.codeLineHeight}
          codeTabSize={mirrorState.codeTabSize}
          wrapLines={mirrorState.wrapLines}
          showLineNumbers={mirrorState.showLineNumbers}
          highlightedLines={EMPTY_HIGHLIGHTED_LINES}
          htmlPreviewEndpoint={mirrorState.htmlPreviewEndpoint}
          htmlPreviewCSRFToken={mirrorState.htmlPreviewCSRFToken}
        />
      );
    }
    return (
      <PortRelayFrameSurface
        mode="desktop"
        url={tab.url}
        onCloseChrome={() => post({kind: 'dock'})}
        onOpenInBrowser={() => window.open(tab.url, '_blank', 'noopener,noreferrer')}
      />
    );
  };

  return (
    <div className={`page theme-${mirrorState.themeMode}`}>
      <PreviewWorkbenchView
      mode="desktop"
      activeTab={activeTab}
      tabs={tabs}
      drawerMode={workbench.drawerMode}
      drawerPinned={mirrorState.drawerPinned}
      fileDrawer={fileDrawer}
      fileDrawerSearch={drawerSearch}
      gitDrawer={gitDrawer}
      actionsMenuOpen={false}
      onClose={() => post({kind: 'dock'})}
      onTabSelect={(nextProjectId, tabId) => post({kind: 'select-tab', projectId: nextProjectId, tabId})}
      onTabClose={(nextProjectId, tabId) => post({kind: 'close-tab', projectId: nextProjectId, tabId})}
      onDrawerModeChange={mode => post({kind: 'drawer-mode', mode})}
      onActionsMenuToggle={() => undefined}
      onActionsMenuClose={() => undefined}
      onSearch={() => post({
        kind: 'search',
        open: !mirrorState.search.open,
        query: mirrorState.search.query,
        activeIndex: mirrorState.search.activeIndex,
      })}
      searchActive={mirrorState.search.open}
      searchDisabled={!activeTab}
      onFloat={undefined}
      onDock={() => post({kind: 'dock'})}
      onWorkbenchKeyDown={event => {
        if (event.key === 'Escape') post({kind: 'focus'});
      }}
      >
        <PreviewWindowSearchBar state={mirrorState} channel={channel} />
        <div
          ref={scrollRef}
          className="chat-file-peek-scroll"
          onScroll={event => post({kind: 'scroll', scrollTop: event.currentTarget.scrollTop})}
        >
          <div className="preview-workbench-render-cache">
            {renderedTabs.map(tab => {
              const active = tab.id === activeTab?.id;
              return (
                <div
                  key={`${tab.projectId}:${tab.id}`}
                  className={`preview-workbench-rendered-tab${active ? ' active' : ''}`}
                  hidden={!active}
                  aria-hidden={active ? undefined : true}
                >
                  {renderTabBody(tab, active)}
                </div>
              );
            })}
            {!activeTab ? (
              <div className="chat-file-workbench-empty">
                <Icon name="appWindow" size={16} />
                <span>No preview selected</span>
              </div>
            ) : null}
          </div>
        </div>
      </PreviewWorkbenchView>
    </div>
  );
}
