import React from 'react';
import {
  previewWorkbenchHeaderTitle,
  previewWorkbenchTabTooltip,
  type PreviewWorkbenchTab,
  type PreviewWorkbenchTabType,
} from './previewWorkbenchState';
import {Icon, type IconName} from '../common/Icon';
import {WorkbenchChrome} from '../shell/workbench/WorkbenchChrome';

export type PreviewWorkbenchChromeMode = 'desktop' | 'mobile';

type PreviewWorkbenchChromeProps = {
  mode: PreviewWorkbenchChromeMode;
  activeTab: PreviewWorkbenchTab | null;
  tabs: PreviewWorkbenchTab[];
  fileTreeOpen: boolean;
  fileTree: React.ReactNode;
  fileTreeSearch?: React.ReactNode;
  actions?: React.ReactNode;
  actionsMenuOpen: boolean;
  onClose: () => void;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onFileTreeToggle: () => void;
  onFileTreeClose: () => void;
  onActionsMenuToggle: () => void;
  onActionsMenuClose: () => void;
  onWorkbenchKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  onSearch?: () => void;
  searchActive?: boolean;
  searchDisabled?: boolean;
  onMobilePortRelayRefresh?: () => void;
  mobileFullscreen?: boolean;
  onMobileFullscreenChange?: (fullscreen: boolean) => void;
  children: React.ReactNode;
};

function previewWorkbenchTabIcon(type: PreviewWorkbenchTabType): IconName {
  if (type === 'file') return 'fileCode';
  if (type === 'prompt-diff') return 'fileDiff';
  if (type === 'attachment') return 'paperclip';
  return 'radioTower';
}

export function PreviewWorkbenchChrome({
  mode,
  activeTab,
  tabs,
  fileTreeOpen,
  fileTree,
  fileTreeSearch,
  actions,
  actionsMenuOpen,
  onClose,
  onTabSelect,
  onTabClose,
  onFileTreeToggle,
  onFileTreeClose,
  onActionsMenuToggle,
  onActionsMenuClose,
  onWorkbenchKeyDown,
  onSearch,
  searchActive = false,
  searchDisabled = false,
  onMobilePortRelayRefresh,
  mobileFullscreen = false,
  onMobileFullscreenChange,
  children,
}: PreviewWorkbenchChromeProps) {
  const fileTreeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const fileTreeSearchRef = React.useRef<HTMLDivElement | null>(null);
  const fileTreePanelRef = React.useRef<HTMLDivElement | null>(null);
  const actionsMenuRef = React.useRef<HTMLDivElement | null>(null);
  const activeTitle = previewWorkbenchHeaderTitle(activeTab);
  const toolbarActions = (
    <>
      {onSearch ? (
        <button
          type="button"
          className={`chat-preview-icon-button${searchActive ? ' active' : ''}`}
          onClick={onSearch}
          disabled={searchDisabled}
          title="Search in preview"
          aria-label="Search in preview"
          aria-pressed={searchActive}
        >
          <Icon name="search" />
        </button>
      ) : null}
      {actions ? (
        <div ref={actionsMenuRef} className="preview-workbench-actions">
          <button
            type="button"
            className="chat-preview-icon-button"
            onClick={onActionsMenuToggle}
            title="Preview actions"
            aria-label="Preview actions"
            aria-haspopup="menu"
            aria-expanded={actionsMenuOpen}
          >
            <Icon name="ellipsis" />
          </button>
          {actionsMenuOpen ? (
            <div className="preview-workbench-actions-menu" role="menu" aria-label="Preview actions">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );

  React.useEffect(() => {
    if (!fileTreeOpen && !actionsMenuOpen) {
      return undefined;
    }
    const containsTarget = (node: HTMLElement | null, target: Node | null) =>
      !!node && !!target && node.contains(target);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (fileTreeOpen &&
        !containsTarget(fileTreeButtonRef.current, target) &&
        !containsTarget(fileTreeSearchRef.current, target) &&
        !containsTarget(fileTreePanelRef.current, target)
      ) {
        onFileTreeClose();
      }
      if (actionsMenuOpen && !containsTarget(actionsMenuRef.current, target)) {
        onActionsMenuClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (fileTreeOpen) {
          onFileTreeClose();
        }
        if (actionsMenuOpen) {
          onActionsMenuClose();
        }
      }
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [actionsMenuOpen, fileTreeOpen, onActionsMenuClose, onFileTreeClose]);

  return (
    <WorkbenchChrome
      mode={mode}
      surfaceClassName="preview-workbench-surface chat-file-peek-surface"
      ariaLabel="Preview workbench"
      title={activeTitle}
      closeLabel={mode === 'mobile' ? 'Back to Chat' : 'Close preview'}
      onClose={onClose}
      actions={toolbarActions}
      tabsAriaLabel="Open preview tabs"
      tabsClassName="chat-file-workbench-tabs preview-workbench-tabs"
      tabs={tabs.map(tab => {
        const active = activeTab?.id === tab.id;
        const tooltip = previewWorkbenchTabTooltip(tab);
        return (
          <div
            key={`preview-tab:${tab.projectId}:${tab.id}`}
            className={`chat-file-workbench-tab preview-workbench-tab${active ? ' active' : ''}`}
            role="tab"
            aria-selected={active}
            title={tooltip}
          >
            <button type="button" className="chat-file-workbench-tab-open" onClick={() => onTabSelect(tab.id)}>
              <Icon name={previewWorkbenchTabIcon(tab.type)} className="preview-workbench-tab-icon" />
              <span className="preview-workbench-tab-label">{tab.title}</span>
            </button>
            <button
              type="button"
              className="chat-file-workbench-tab-close"
              onClick={() => onTabClose(tab.id)}
              aria-label={`Close ${tab.title}`}
              title="Close"
            >
              <Icon name="x" />
            </button>
          </div>
        );
      })}
      mobileFullscreen={mobileFullscreen}
      onMobileFullscreenChange={onMobileFullscreenChange}
      bodyClassName="preview-workbench-body"
      onKeyDown={onWorkbenchKeyDown}
    >
      {fileTree ? (
        <div className="preview-workbench-body-tools">
          {fileTreeSearch ? (
            <div
              ref={fileTreeSearchRef}
              className="preview-workbench-tree-search-shell"
              data-open={fileTreeOpen}
            >
              {fileTreeSearch}
            </div>
          ) : null}
          <button
            ref={fileTreeButtonRef}
            type="button"
            className={`preview-workbench-tree-fab${fileTreeOpen ? ' active' : ''}`}
            onClick={onFileTreeToggle}
            aria-label="Toggle file tree"
            title="Toggle file tree"
            aria-pressed={fileTreeOpen}
          >
            <Icon name="files" />
          </button>
        </div>
      ) : null}
      {fileTreeOpen && fileTree ? (
        <div ref={fileTreePanelRef} className="preview-workbench-tree-panel">
          {fileTree}
        </div>
      ) : null}
      {mode === 'mobile' && activeTab?.type === 'port-relay' && onMobilePortRelayRefresh ? (
        <button
          type="button"
          className="preview-workbench-mobile-port-relay-refresh"
          onClick={onMobilePortRelayRefresh}
          title="Refresh relay page"
          aria-label="Refresh relay page"
        >
          <Icon name="refreshCw" />
        </button>
      ) : null}
      {children}
    </WorkbenchChrome>
  );
}
