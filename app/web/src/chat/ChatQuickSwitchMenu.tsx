import React from 'react';
import type { RegistryChatSession } from '../registry/registryTypes';
import type { MobileChatQuickSwitchSection } from './mobileChatQuickSwitch';

export type ChatQuickSwitchMenuPlacement = 'mobile' | 'desktop';

type ChatQuickSwitchMenuProps = {
  sections: MobileChatQuickSwitchSection[];
  placement: ChatQuickSwitchMenuPlacement;
  style: React.CSSProperties;
  createProjectId: string;
  createPendingKey: string;
  isSessionSelected: (projectId: string, session: RegistryChatSession) => boolean;
  renderSessionStateMarker: (session: RegistryChatSession, projectId: string) => React.ReactNode;
  resolveSessionTitle: (session: RegistryChatSession) => string;
  formatSessionAge: (updatedAt: string) => string;
  getProjectAgents: (projectId: string) => string[];
  resolveProjectHubStyle: (hubId: string) => React.CSSProperties;
  onToggleCreateProject: (projectId: string) => void;
  onCreateSession: (projectId: string, agentType: string) => Promise<void> | void;
  onSelectSession: (projectId: string, session: RegistryChatSession) => Promise<void> | void;
};

export const ChatQuickSwitchMenu = React.forwardRef<HTMLDivElement, ChatQuickSwitchMenuProps>(
  function ChatQuickSwitchMenu({
    sections,
    placement,
    style,
    createProjectId,
    createPendingKey,
    isSessionSelected,
    renderSessionStateMarker,
    resolveSessionTitle,
    formatSessionAge,
    getProjectAgents,
    resolveProjectHubStyle,
    onToggleCreateProject,
    onCreateSession,
    onSelectSession,
  }, ref) {
    return (
      <div
        ref={ref}
        className="chat-quick-switch-menu"
        data-placement={placement}
        style={style}
        role="menu"
        aria-label="Recent chats"
        onPointerDown={event => event.stopPropagation()}
      >
        {sections.length === 0 ? (
          <div className="chat-quick-switch-empty">No chats</div>
        ) : (
          sections.map(section => {
            const projectAgents = getProjectAgents(section.projectId);
            return (
              <div key={`chat-quick-switch-project:${section.projectId}`} className="chat-quick-switch-project">
                <div className="chat-quick-switch-project-heading" title={`${section.projectName} - ${section.projectHubLabel}`}>
                  <span className="chat-quick-switch-project-name">
                    {section.projectName}
                  </span>
                  <span className="chat-quick-switch-project-hub" style={resolveProjectHubStyle(section.projectHubId)}>
                    <span className="chat-quick-switch-project-hub-dot" aria-hidden="true" />
                    {section.projectHubLabel}
                  </span>
                  <button
                    type="button"
                    className="chat-quick-switch-project-create"
                    title={`New session in ${section.projectName}`}
                    aria-label={`New session in ${section.projectName}`}
                    aria-expanded={createProjectId === section.projectId}
                    onPointerDown={event => event.stopPropagation()}
                    onClick={event => {
                      event.stopPropagation();
                      onToggleCreateProject(section.projectId);
                    }}
                  >
                    <span className="codicon codicon-add" aria-hidden="true" />
                  </button>
                </div>
                {createProjectId === section.projectId ? (
                  <div className="chat-quick-switch-create-menu" role="menu" aria-label={`Create session in ${section.projectName}`}>
                    {projectAgents.map(agentType => {
                      const pendingKey = `${section.projectId}:${agentType}`;
                      const pending = createPendingKey === pendingKey;
                      return (
                        <button
                          key={`chat-quick-switch-create:${section.projectId}:${agentType}`}
                          type="button"
                          className="chat-quick-switch-create-item"
                          disabled={!!createPendingKey}
                          role="menuitem"
                          onClick={() => {
                            Promise.resolve(onCreateSession(section.projectId, agentType)).catch(() => undefined);
                          }}
                        >
                          <span
                            className={`codicon ${pending ? 'codicon-loading codicon-modifier-spin' : 'codicon-sparkle'}`}
                            aria-hidden="true"
                          />
                          <span className="chat-quick-switch-create-agent">{agentType}</span>
                        </button>
                      );
                    })}
                    {projectAgents.length === 0 ? (
                      <div className="chat-quick-switch-create-empty">
                        <span className="codicon codicon-circle-slash" aria-hidden="true" />
                        <span>No agents available.</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="chat-quick-switch-session-list">
                  {section.sessions.map(session => {
                    const selected = isSessionSelected(section.projectId, session);
                    const unreadCount = session.unreadCount ?? 0;
                    return (
                      <button
                        key={`chat-quick-switch-session:${section.projectId}:${session.sessionId}`}
                        type="button"
                        className="chat-quick-switch-item"
                        data-selected={selected}
                        role="menuitem"
                        onClick={() => {
                          Promise.resolve(onSelectSession(section.projectId, session)).catch(() => undefined);
                        }}
                      >
                        {renderSessionStateMarker(session, section.projectId)}
                        <span className="chat-quick-switch-title">
                          {resolveSessionTitle(session) || session.sessionId}
                        </span>
                        <span className="chat-quick-switch-time" title={session.updatedAt || ''}>
                          {formatSessionAge(session.updatedAt)}
                        </span>
                        {unreadCount > 0 ? (
                          <span className="chat-quick-switch-unread">{Math.min(99, unreadCount)}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  },
);
