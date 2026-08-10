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
import {MENU_EXIT_MS} from '../chat/sessionlist/menuExit';
import {useContextMenuTargetGesture} from '../common/useContextMenuGesture';

export type PreviewWorkbenchChromeMode = 'desktop' | 'mobile';

type PreviewWorkbenchChromeProps = {
  mode: PreviewWorkbenchChromeMode;
  activeTab: PreviewWorkbenchTab | null;
  tabs: PreviewWorkbenchTab[];
  drawerMode: PreviewWorkbenchDrawerMode;
  /** Pinned drawers ignore outside pointerdown dismissal (Escape/toggles still close). */
  drawerPinned?: boolean;
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
  drawerPinned = false,
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
  const bindTabContextMenu = useContextMenuTargetGesture<string>((tabId, position) => {
    onTabContextMenu?.(tabId, position);
  });
  const drawerToolsRef = React.useRef<HTMLDivElement | null>(null);
  const drawerPanelRef = React.useRef<HTMLDivElement | null>(null);
  const actionsMenuRef = React.useRef<HTMLDivElement | null>(null);
  const tabsBarRef = React.useRef<HTMLDivElement | null>(null);
  const overflowRef = React.useRef<HTMLDivElement | null>(null);
  const [tabsOverflowing, setTabsOverflowing] = React.useState(false);
  const [tabListOpen, setTabListOpen] = React.useState(false);
  const activeTitle = previewWorkbenchHeaderTitle(activeTab);
  const drawerOpen = drawerMode !== 'closed';
  // Keep the last open mode mounted briefly after close so the panel can play
  // its exit animation; reopening within the window cancels the exit.
  const [exitMode, setExitMode] = React.useState<PreviewWorkbenchDrawerMode | null>(null);
  const prevDrawerModeRef = React.useRef(drawerMode);
  React.useEffect(() => {
    const prev = prevDrawerModeRef.current;
    prevDrawerModeRef.current = drawerMode;
    if (drawerMode !== 'closed') {
      setExitMode(null);
      return undefined;
    }
    if (prev === 'closed') {
      return undefined;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }
    setExitMode(prev);
    const timer = window.setTimeout(() => setExitMode(null), MENU_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [drawerMode]);
  const renderedMode = drawerOpen ? drawerMode : exitMode;
  const drawerContent = renderedMode === 'files'
    ? fileDrawer
    : renderedMode === 'git'
      ? gitDrawer
      : null;
  const drawerExiting = !drawerOpen && exitMode !== null;
  const useDrawerPortal = mode === 'desktop' && !!drawerPortalTarget;
  const drawerPanel = renderedMode && drawerContent ? (
    <div
      ref={drawerPanelRef}
      className={`preview-workbench-drawer-panel${useDrawerPortal ? ' external' : ''}${drawerExiting ? ' exiting' : ''}`}
    >
      {renderedMode === 'files' && fileDrawerSearch ? (
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
      {mode === 'mobile' && actions ? (
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
        !drawerPinned &&
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
  }, [actionsMenuOpen, drawerOpen, drawerPinned, onActionsMenuClose, onDrawerModeChange]);

  React.useEffect(() => {
    const node = tabsBarRef.current;
    if (!node) {
      return undefined;
    }
    const update = () => {
      const overflowing = node.scrollWidth > node.clientWidth + 1;
      setTabsOverflowing(overflowing);
      if (!overflowing) {
        setTabListOpen(false);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [tabs.length]);

  React.useEffect(() => {
    if (!tabListOpen) {
      return undefined;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && !overflowRef.current?.contains(target)) {
        setTabListOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTabListOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [tabListOpen]);

  const tabsAccessory = (
    <div ref={overflowRef} className="preview-workbench-tabs-overflow">
      {tabsOverflowing ? (
        <button
          type="button"
          className={`preview-workbench-tabs-overflow-button${tabListOpen ? ' active' : ''}`}
          aria-label="Show all open tabs"
          aria-haspopup="menu"
          aria-expanded={tabListOpen}
          data-tooltip="Show all open tabs"
          onClick={() => setTabListOpen(open => !open)}
        >
          <Icon name="listCollapse" />
        </button>
      ) : null}
      {tabsOverflowing && tabListOpen ? (
        <div className="preview-workbench-tabs-overflow-list" role="menu" aria-label="Open tabs">
          {tabs.map(tab => {
            const active = activeTab?.id === tab.id;
            return (
              <div
                key={`overflow-tab:${tab.projectId}:${tab.id}`}
                className={`preview-workbench-tabs-overflow-row${active ? ' active' : ''}`}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="preview-workbench-tabs-overflow-open"
                  data-tooltip={previewWorkbenchTabTooltip(tab)}
                  onClick={() => {
                    onTabSelect(tab.id);
                    setTabListOpen(false);
                  }}
                >
                  <Icon name={previewWorkbenchTabIcon(tab.type)} className="preview-workbench-tab-icon" />
                  <span className="preview-workbench-tab-label">{tab.title}</span>
                </button>
                <button
                  type="button"
                  className="preview-workbench-tabs-overflow-close"
                  aria-label={`Close ${tab.title}`}
                  onClick={() => onTabClose(tab.id)}
                >
                  <Icon name="x" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  return (
    <WorkbenchChrome
      mode={mode}
      surfaceClassName="preview-workbench-surface chat-file-peek-surface"
      ariaLabel="Preview workbench"
      title={activeTitle}
      closeLabel={mode === 'mobile' ? 'Back to Chat' : 'Close preview'}
      onClose={onClose}
      hideClose={mode === 'desktop'}
      actions={toolbarActions}
      tabsAriaLabel="Open preview tabs"
      tabsClassName="chat-file-workbench-tabs preview-workbench-tabs"
      tabsAccessory={tabsAccessory}
      tabsListRef={tabsBarRef}
      tabs={tabs.map(tab => {
        const active = activeTab?.id === tab.id;
        const tooltip = previewWorkbenchTabTooltip(tab);
        return (
          <div
            key={`preview-tab:${tab.projectId}:${tab.id}`}
            className={`chat-file-workbench-tab preview-workbench-tab${active ? ' active' : ''}`}
            data-tooltip={tooltip}
            {...(onTabContextMenu ? bindTabContextMenu(tab.id) : {})}
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
      {mode === 'mobile' && (fileDrawer || gitDrawer) ? (
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
