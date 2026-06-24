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
