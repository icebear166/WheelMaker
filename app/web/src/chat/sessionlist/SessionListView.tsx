import React, {type ReactNode} from 'react';
import {SessionRow, DraftSessionRow, type SessionRowGestureHandlers} from './SessionRow';
import {ProjectSection} from './ProjectSection';
import {RecentSessionsSection, type RecentGroup} from './RecentSessionsSection';

export type SessionListMode = 'normal' | 'archived' | 'search';

export type SessionListProjectItem = {
  projectId: string;
  name: string;
  hubId?: string | null;
};

type AnySession = {sessionId: string; title?: string; agentType?: string; pinned?: boolean; updatedAt?: string};
type AnyDraft = {draftId: string; title: string; status: string; errorMessage?: string; createdAt?: string; agentType?: string};

export type SessionListViewProps = {
  mobile: boolean;
  mode: SessionListMode;
  hasProjects: boolean;
  // Recent block
  recentGroups: RecentGroup[];
  recentCollapsed: boolean;
  showRecentHeading: boolean;
  onToggleRecent: () => void;
  // Project sections
  projectItems: SessionListProjectItem[];
  activeProjectId: string;
  collapsedProjectIds: string[];
  pinnedProjectIds: string[];
  sessionsByProjectId: Record<string, AnySession[]>;
  draftSessionsByProjectId: Record<string, AnyDraft[]>;
  olderExpandedByProjectId: Record<string, boolean>;
  selectedChatEncodedKey: string;
  pinningSessionKey: string;
  mobileSessionErrors: Record<string, string>;
  onRetryMobileSessions: () => void;
  // helpers (WorkspaceApp closures, injected)
  resolveTitle: (session: AnySession) => string;
  agentLabel: (agentType: string) => string;
  sessionAgentClass: (agentType: string) => string;
  projectHubClass: (hubId: string) => string;
  hubAccentStyle: (hubId: string) => React.CSSProperties;
  formatAge: (iso: string) => string;
  runtimeKey: (projectId: string, sessionId: string) => string;
  sessionActionKey: (projectId: string, sessionId: string) => string;
  renderLeadingState: (session: AnySession, projectId: string) => ReactNode;
  splitOlder: (projectId: string, sessions: AnySession[]) => {
    visibleSessions: AnySession[];
    showToggle: boolean;
    hiddenOlderCount: number;
  };
  // callbacks
  onSelectSession: (projectId: string, sessionId: string, event: React.MouseEvent<HTMLButtonElement>) => void;
  onSelectDraft: (projectId: string, draftId: string) => void;
  onDismissDraft: (projectId: string, draftId: string) => void;
  onUnpinSession: (projectId: string, sessionId: string) => void;
  onToggleProjectCollapsed: (projectId: string) => void;
  onTogglePinnedProject: (projectId: string) => void;
  onToggleOlder: (projectId: string) => void;
  onOpenProjectMenu: (projectId: string, kind: 'new' | 'resume', anchor: HTMLElement | null) => void;
  onOpenSessionContextMenu: (projectId: string, sessionId: string, event: React.MouseEvent<HTMLButtonElement>) => void;
  sessionGestureHandlers: (projectId: string, sessionId: string) => Omit<SessionRowGestureHandlers, 'onContextMenu'>;
  consumeSessionLongPressClick: (projectId: string, sessionId: string, event: React.MouseEvent<HTMLButtonElement>) => boolean;
  projectGestureHandlers: (projectId: string) => SessionRowGestureHandlers;
  consumeProjectLongPressClick: (projectId: string, event: React.MouseEvent<HTMLButtonElement>) => boolean;
  // slots rendered outside the normal project list
  emptyProjectsHint: ReactNode;
  hiddenProjectRows: ReactNode;
  archivedRows: ReactNode;
  searchResults: ReactNode;
};

export function SessionListView(props: SessionListViewProps) {
  const {
    mobile,
    mode,
    hasProjects,
    recentGroups,
    recentCollapsed,
    showRecentHeading,
    onToggleRecent,
    projectItems,
    emptyProjectsHint,
    hiddenProjectRows,
    archivedRows,
    searchResults,
  } = props;

  if (mode === 'archived') {
    return <>{archivedRows}</>;
  }
  if (mode === 'search') {
    return <>{searchResults}</>;
  }

  const renderRow = (projectId: string, session: AnySession, recent: boolean) => {
    const title = props.resolveTitle(session) || session.sessionId;
    const agent = (session.agentType || '').trim();
    return (
      <SessionRow
        key={`${projectId}:${recent ? 'recent' : mobile ? 'mobile-session' : 'wide-session'}:${session.sessionId}`}
        title={title}
        rowTitleAttr={recent ? title : undefined}
        agentLabel={agent ? props.agentLabel(agent) : undefined}
        agentClassName={agent ? props.sessionAgentClass(agent) : undefined}
        timeLabel={props.formatAge(session.updatedAt ?? '')}
        timeTitle={session.updatedAt ?? ''}
        selected={props.selectedChatEncodedKey === props.runtimeKey(projectId, session.sessionId)}
        pinned={session.pinned === true}
        pinning={props.pinningSessionKey === props.sessionActionKey(projectId, session.sessionId)}
        mobile={mobile}
        recent={recent}
        leadingState={props.renderLeadingState(session, projectId)}
        gestureHandlers={{
          ...props.sessionGestureHandlers(projectId, session.sessionId),
          onContextMenu: event => props.onOpenSessionContextMenu(projectId, session.sessionId, event),
        }}
        onClick={event => {
          if (props.consumeSessionLongPressClick(projectId, session.sessionId, event)) {
            return;
          }
          props.onSelectSession(projectId, session.sessionId, event);
        }}
        onUnpin={() => props.onUnpinSession(projectId, session.sessionId)}
        unpinLabel={`Unpin session ${title}`}
      />
    );
  };

  return (
    <>
      {!hasProjects ? emptyProjectsHint : null}
      {recentGroups.length > 0 ? (
        <RecentSessionsSection
          groups={recentGroups}
          collapsed={recentCollapsed}
          mobile={mobile}
          showHeading={showRecentHeading}
          onToggleCollapsed={onToggleRecent}
          onNewInProject={(projectId, event) => props.onOpenProjectMenu(projectId, 'new', event.currentTarget)}
          renderRow={(projectId, session) => renderRow(projectId, session as AnySession, true)}
        />
      ) : null}
      {projectItems.map(item => {
        const projectId = item.projectId;
        const collapsed = props.collapsedProjectIds.includes(projectId);
        const sessions = props.sessionsByProjectId[projectId] ?? [];
        const drafts = props.draftSessionsByProjectId[projectId] ?? [];
        const split = props.splitOlder(projectId, sessions);
        const hubId = item.hubId || 'local';
        return (
          <ProjectSection
            key={`${mobile ? 'mobile-project' : 'wide-project'}:${projectId}`}
            name={item.name}
            hubLabel={hubId}
            hubVariantClass={props.projectHubClass(hubId)}
            hubAccentStyle={props.hubAccentStyle(hubId)}
            collapsed={collapsed}
            pinned={props.pinnedProjectIds.includes(projectId)}
            active={projectId === props.activeProjectId}
            mobile={mobile}
            projectGestureHandlers={props.projectGestureHandlers(projectId)}
            onToggleCollapsed={event => {
              if (props.consumeProjectLongPressClick(projectId, event)) {
                return;
              }
              props.onToggleProjectCollapsed(projectId);
            }}
            onNew={event => {
              event.stopPropagation();
              props.onOpenProjectMenu(projectId, 'new', event.currentTarget);
            }}
            onResume={event => {
              event.stopPropagation();
              props.onOpenProjectMenu(projectId, 'resume', event.currentTarget);
            }}
            onTogglePin={() => props.onTogglePinnedProject(projectId)}
            error={mobile ? props.mobileSessionErrors[projectId] ?? '' : ''}
            onRetryError={props.onRetryMobileSessions}
          >
            {drafts.map(draft => (
              <DraftSessionRow
                key={`${projectId}:${mobile ? 'mobile-draft' : 'wide-draft'}:${draft.draftId}`}
                title={draft.title}
                statusLabel={draft.status === 'sendingFirstPrompt' ? 'Sending...' : draft.status === 'failed' ? 'Failed' : 'Creating...'}
                failed={draft.status === 'failed'}
                errorMessage={draft.errorMessage}
                createdAtTitle={draft.createdAt}
                agentLabel={draft.agentType ? props.agentLabel(draft.agentType) : undefined}
                agentClassName={draft.agentType ? props.sessionAgentClass(draft.agentType) : undefined}
                statusClassName={draft.status}
                selected={props.selectedChatEncodedKey === props.runtimeKey(projectId, draft.draftId)}
                mobile={mobile}
                onClick={() => props.onSelectDraft(projectId, draft.draftId)}
                onDismiss={draft.status === 'failed' ? () => props.onDismissDraft(projectId, draft.draftId) : undefined}
              />
            ))}
            {split.visibleSessions.map(session => renderRow(projectId, session, false))}
            {split.showToggle ? (
              <button
                type="button"
                className={`wide-session-row session-older-toggle${mobile ? ' mobile-session-row' : ''}`}
                onClick={() => props.onToggleOlder(projectId)}
              >
                <span className="wide-session-title">
                  {props.olderExpandedByProjectId[projectId]
                    ? 'Show less'
                    : `Show ${split.hiddenOlderCount} old sessions...`}
                </span>
              </button>
            ) : null}
            {sessions.length === 0 ? <div className="wide-project-empty">No sessions yet.</div> : null}
          </ProjectSection>
        );
      })}
      {hiddenProjectRows}
    </>
  );
}
