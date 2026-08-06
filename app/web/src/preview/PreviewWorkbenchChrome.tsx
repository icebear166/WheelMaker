import React from 'react';
import {createPortal} from 'react-dom';
import {
  previewWorkbenchHeaderTitle,
  previewWorkbenchTabTooltip,
  type PreviewWorkbenchDrawerMode,
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
  drawerMode: PreviewWorkbenchDrawerMode;
  fileDrawer: React.ReactNode;
  fileDrawerSearch?: React.ReactNode;
  gitDrawer: React.ReactNode;
  drawerPortalTarget?: HTMLElement | null;
  onDrawerModeChange: (mode: PreviewWorkbenchDrawerMode) => void;
  actions?: React.ReactNode;
  actionsMenuOpen: boolean;
  onClose: () => void;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabContextMenu?: (tabId: string, position: {x: number; y: number}) => void;
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
  if (type === 'prompt-diff' || type === 'git-diff') return 'fileDiff';
  if (type === 'attachment') return 'paperclip';
  return 'radioTower';
}

export function PreviewWorkbenchChrome({
  mode,
  activeTab,
  tabs,
  drawerMode,
  fileDrawer,
  fileDrawerSearch,
  gitDrawer,
  drawerPortalTarget = null,
  onDrawerModeChange,
  actions,
  actionsMenuOpen,
  onClose,
  onTabSelect,
  onTabClose,
  onTabContextMenu,
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
  const drawerToolsRef = React.useRef<HTMLDivElement | null>(null);
  const drawerPanelRef = React.useRef<HTMLDivElement | null>(null);
  const actionsMenuRef = React.useRef<HTMLDivElement | null>(null);
  const activeTitle = previewWorkbenchHeaderTitle(activeTab);
  const drawerOpen = drawerMode !== 'closed';
  const drawerContent = drawerMode === 'files'
    ? fileDrawer
    : drawerMode === 'git'
      ? gitDrawer
      : null;
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
  const toolbarActions = (
    <>
      {onSearch ? (
        <button
          type="button"
          className={`chat-preview-icon-button${searchActive ? ' active' : ''}`}
          onClick={onSearch}
          disabled={searchDisabled}
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
    if (!drawerOpen && !actionsMenuOpen) {
      return undefined;
    }
    const containsTarget = (node: HTMLElement | null, target: Node | null) =>
      !!node && !!target && node.contains(target);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (drawerOpen &&
        !containsTarget(drawerToolsRef.current, target) &&
        !containsTarget(drawerPanelRef.current, target)
      ) {
        onDrawerModeChange('closed');
      }
      if (actionsMenuOpen && !containsTarget(actionsMenuRef.current, target)) {
        onActionsMenuClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (drawerOpen) {
          onDrawerModeChange('closed');
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
  }, [actionsMenuOpen, drawerOpen, onActionsMenuClose, onDrawerModeChange]);

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
            data-tooltip={tooltip}
            onContextMenu={mode === 'desktop' && onTabContextMenu ? event => {
              event.preventDefault();
              onTabContextMenu(tab.id, {x: event.clientX, y: event.clientY});
            } : undefined}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="chat-file-workbench-tab-open"
              onClick={() => onTabSelect(tab.id)}
            >
              <Icon name={previewWorkbenchTabIcon(tab.type)} className="preview-workbench-tab-icon" />
              <span className="preview-workbench-tab-label">{tab.title}</span>
            </button>
            <button
              type="button"
              className="chat-file-workbench-tab-close"
              onClick={() => onTabClose(tab.id)}
              aria-label={`Close ${tab.title}`}
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
      {mode === 'mobile' && activeTab?.type === 'port-relay' && onMobilePortRelayRefresh ? (
        <button
          type="button"
          className="preview-workbench-mobile-port-relay-refresh"
          onClick={onMobilePortRelayRefresh}
          aria-label="Refresh relay page"
        >
          <Icon name="refreshCw" />
        </button>
      ) : null}
      {children}
    </WorkbenchChrome>
  );
}
