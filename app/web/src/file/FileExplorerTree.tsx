import React from 'react';
import type { RegistryFsEntry, RegistryProject } from '../registry/registryTypes';

type FileResolvedIcon = {
  glyph: string;
  color: string;
};

type WorkspaceProjectSelectorProps = {
  projects: RegistryProject[];
  projectId: string;
  currentProjectName: string;
  sortedProjectItems: RegistryProject[];
  workspaceProjectMenuOpen: boolean;
  setWorkspaceProjectMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  syncWorkspaceProject: (projectId: string, options: {reason: 'manual'}) => Promise<void>;
};

type FileExplorerTreeProps = WorkspaceProjectSelectorProps & {
  isWide: boolean;
  showSectionTitle?: boolean;
  dirEntries: Record<string, RegistryFsEntry[]>;
  loadingDirs: Record<string, boolean>;
  selectedFile: string;
  setSelectedFile: React.Dispatch<React.SetStateAction<string>>;
  setDrawerOpen: (next: boolean) => void;
  isExpanded: (path: string) => boolean;
  toggleDirectory: (path: string) => void;
  resolveFileIcon: (name: string) => FileResolvedIcon;
};

export function WorkspaceProjectSelector({
  projects,
  projectId,
  currentProjectName,
  sortedProjectItems,
  workspaceProjectMenuOpen,
  setWorkspaceProjectMenuOpen,
  syncWorkspaceProject,
}: WorkspaceProjectSelectorProps) {
  const currentWorkspaceProject = projects.find(item => item.projectId === projectId);

  return (
    <div className="workspace-project-selector">
      <div className="workspace-project-label">WORKSPACE</div>
      <div className="workspace-project-control">
        <button
          type="button"
          className="workspace-project-button"
          onClick={() => setWorkspaceProjectMenuOpen(prev => !prev)}
          title={currentWorkspaceProject?.path || currentProjectName}
        >
          <span className="workspace-project-name">
            {currentWorkspaceProject?.name || currentProjectName}
          </span>
          <span className="codicon codicon-chevron-down" />
        </button>
        {workspaceProjectMenuOpen ? (
          <div className="workspace-project-menu">
            {sortedProjectItems.map(projectItem => (
              <button
                key={`workspace:${projectItem.projectId}`}
                type="button"
                className={`workspace-project-menu-item ${
                  projectItem.projectId === projectId ? 'selected' : ''
                }`}
                onClick={() =>
                  syncWorkspaceProject(projectItem.projectId, {reason: 'manual'}).catch(() => undefined)
                }
                title={projectItem.path || projectItem.projectId}
              >
                <span className="workspace-project-menu-name">{projectItem.name}</span>
                <span className="workspace-project-menu-path">
                  {projectItem.path || projectItem.hubId || projectItem.projectId}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function FileExplorerTree({
  isWide,
  showSectionTitle = true,
  projects,
  projectId,
  currentProjectName,
  sortedProjectItems,
  workspaceProjectMenuOpen,
  setWorkspaceProjectMenuOpen,
  syncWorkspaceProject,
  dirEntries,
  loadingDirs,
  selectedFile,
  setSelectedFile,
  setDrawerOpen,
  isExpanded,
  toggleDirectory,
  resolveFileIcon,
}: FileExplorerTreeProps) {
  const renderFileTree = (path: string, depth: number): React.ReactNode => {
    const entries = dirEntries[path] ?? [];
    return entries.map(entry => {
      if (entry.kind === 'dir') {
        const expanded = isExpanded(entry.path);
        return (
          <div key={entry.path}>
            <div
              className="item"
              style={{ paddingLeft: 10 + depth * 14 }}
              onClick={() => {
                toggleDirectory(entry.path);
              }}
            >
              <span
                className={`caret codicon ${
                  expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'
                }`}
              />
              <span
                className={`node-icon codicon ${
                  expanded ? 'codicon-folder-opened' : 'codicon-folder'
                }`}
              />
              <span className="label">{entry.name}</span>
              {loadingDirs[entry.path] ? (
                <span className="muted">...</span>
              ) : null}
            </div>
            {expanded ? renderFileTree(entry.path, depth + 1) : null}
          </div>
        );
      }

      const fileIcon = resolveFileIcon(entry.name);
      return (
        <div
          key={entry.path}
          className={`item ${selectedFile === entry.path ? 'selected' : ''}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => {
            setSelectedFile(entry.path);
            if (!isWide) setDrawerOpen(false);
          }}
        >
          <span className="caret placeholder" aria-hidden="true" />
          <span
            className="node-icon seti-icon"
            style={{ color: fileIcon.color }}
          >
            <span className="seti-glyph">{fileIcon.glyph}</span>
          </span>
          <span className="label">{entry.name}</span>
        </div>
      );
    });
  };

  return (
    <>
      {isWide ? (
        <WorkspaceProjectSelector
          projects={projects}
          projectId={projectId}
          currentProjectName={currentProjectName}
          sortedProjectItems={sortedProjectItems}
          workspaceProjectMenuOpen={workspaceProjectMenuOpen}
          setWorkspaceProjectMenuOpen={setWorkspaceProjectMenuOpen}
          syncWorkspaceProject={syncWorkspaceProject}
        />
      ) : null}
      {showSectionTitle ? <div className="section-title">EXPLORER</div> : null}
      <div className="list">{renderFileTree('.', 0)}</div>
    </>
  );
}
