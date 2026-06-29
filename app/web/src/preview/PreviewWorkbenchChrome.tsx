import React from 'react';
import type {RegistryProject} from '../registry/registryTypes';
import {
  previewWorkbenchTabTooltip,
  type PreviewWorkbenchTab,
  type PreviewWorkbenchTabType,
} from './previewWorkbenchState';

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
  fileTreeSearch?: React.ReactNode;
  actions?: React.ReactNode;
  onClose: () => void;
  onProjectMenuToggle: () => void;
  onProjectSelect: (projectId: string) => void;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onFileTreeToggle: () => void;
  onProjectMenuClose: () => void;
  onFileTreeClose: () => void;
  onWorkbenchKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  onMobilePortRelayRefresh?: () => void;
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
  fileTreeSearch,
  actions,
  onClose,
  onProjectMenuToggle,
  onProjectSelect,
  onTabSelect,
  onTabClose,
  onFileTreeToggle,
  onProjectMenuClose,
  onFileTreeClose,
  onWorkbenchKeyDown,
  onMobilePortRelayRefresh,
  children,
}: PreviewWorkbenchChromeProps) {
  const [mobileHeaderHidden, setMobileHeaderHidden] = React.useState(false);
  const surfaceRef = React.useRef<HTMLElement | null>(null);
  const projectButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const projectMenuRef = React.useRef<HTMLDivElement | null>(null);
  const fileTreeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const fileTreeSearchRef = React.useRef<HTMLDivElement | null>(null);
  const fileTreePanelRef = React.useRef<HTMLDivElement | null>(null);
  const activeProject = projects.find(project => project.projectId === activeProjectId) ?? null;
  const activeTitle = activeTab?.title || 'Preview';

  React.useEffect(() => {
    if (!projectMenuOpen && !fileTreeOpen) {
      return undefined;
    }
    const containsTarget = (node: HTMLElement | null, target: Node | null) =>
      !!node && !!target && node.contains(target);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (projectMenuOpen &&
        !containsTarget(projectButtonRef.current, target) &&
        !containsTarget(projectMenuRef.current, target)
      ) {
        onProjectMenuClose();
      }
      if (fileTreeOpen &&
        !containsTarget(fileTreeButtonRef.current, target) &&
        !containsTarget(fileTreeSearchRef.current, target) &&
        !containsTarget(fileTreePanelRef.current, target)
      ) {
        onFileTreeClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (projectMenuOpen) {
          onProjectMenuClose();
        }
        if (fileTreeOpen) {
          onFileTreeClose();
        }
      }
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [fileTreeOpen, onFileTreeClose, onProjectMenuClose, projectMenuOpen]);

  return (
    <section
      ref={surfaceRef}
      className={`preview-workbench-surface chat-file-peek-surface ${mode}${mobileHeaderHidden ? ' mobile-header-hidden' : ''}`}
      aria-label="Preview workbench"
      onKeyDown={onWorkbenchKeyDown}
    >
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
            ref={projectButtonRef}
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
            <div ref={projectMenuRef} className="preview-workbench-project-menu" role="menu" aria-label="Preview projects">
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
              <span className="codicon codicon-files" />
            </button>
          </div>
        ) : null}
        {fileTreeOpen && fileTree ? (
          <div ref={fileTreePanelRef} className="preview-workbench-tree-panel">
            {fileTree}
          </div>
        ) : null}
        {mode === 'mobile' ? (
          <>
            {activeTab?.type === 'port-relay' && onMobilePortRelayRefresh ? (
              <button
                type="button"
                className="preview-workbench-mobile-port-relay-refresh"
                onClick={onMobilePortRelayRefresh}
                title="Refresh relay page"
                aria-label="Refresh relay page"
              >
                <span className="codicon codicon-refresh" />
              </button>
            ) : null}
            <button
              type="button"
              className={`preview-workbench-mobile-header-toggle${mobileHeaderHidden ? ' active' : ''}`}
              onClick={() => setMobileHeaderHidden(hidden => !hidden)}
              title={mobileHeaderHidden ? 'Show preview header' : 'Hide preview header'}
              aria-label={mobileHeaderHidden ? 'Show preview header' : 'Hide preview header'}
              aria-pressed={mobileHeaderHidden}
            >
              <span className={`codicon ${mobileHeaderHidden ? 'codicon-screen-normal' : 'codicon-screen-full'}`} />
            </button>
          </>
        ) : null}
        {children}
      </div>
    </section>
  );
}
