import React, {type ReactNode} from 'react';
import {SessionIcon} from './SessionIcon';

export type RecentGroup = {
  projectId: string;
  projectName: string;
  hubLabel: string;
  hubVariantClass: string;
  hubAccentStyle: React.CSSProperties;
  /** Live sessions for this project; rows are rendered via the renderRow prop. */
  sessions: Array<{sessionId: string}>;
};

export type RecentSessionsSectionProps = {
  groups: RecentGroup[];
  collapsed: boolean;
  mobile: boolean;
  /** Defaults to true; floating Recent panel passes false (card title already says Recent). */
  showHeading?: boolean;
  onToggleCollapsed: () => void;
  onNewInProject: (projectId: string, event: React.MouseEvent<HTMLButtonElement>) => void;
  renderRow: (projectId: string, session: {sessionId: string}) => ReactNode;
};

export function RecentSessionsSection({
  groups,
  collapsed,
  mobile,
  showHeading = true,
  onToggleCollapsed,
  onNewInProject,
  renderRow,
}: RecentSessionsSectionProps) {
  return (
    <div
      className={`wide-project-section recent-sessions-section${mobile ? ' mobile-project-section' : ''}${collapsed ? ' collapsed' : ''}`}
    >
      {showHeading ? (
        <div className="wide-project-row">
          <button
            type="button"
            className="wide-project-toggle"
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expand Recent Sessions' : 'Collapse Recent Sessions'}
            aria-expanded={!collapsed}
          >
            <span className="wide-project-folder-wrap">
              <SessionIcon name="clock" size={15} className="recent-sessions-icon" />
            </span>
            <span className="wide-project-title-group">
              <span className="wide-project-name">Recent Sessions</span>
            </span>
          </button>
          <button
            type="button"
            className="wide-project-action-btn recent-sessions-collapse-btn"
            title={collapsed ? 'Expand Recent Sessions' : 'Collapse Recent Sessions'}
            aria-label={collapsed ? 'Expand Recent Sessions' : 'Collapse Recent Sessions'}
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
          >
            <SessionIcon name={collapsed ? 'chevronDown' : 'chevronUp'} />
          </button>
        </div>
      ) : null}
      {collapsed && showHeading ? null : (
        <div className={`wide-project-session-list recent-sessions-list${mobile ? ' mobile-project-session-list' : ''}`}>
          {groups.map(group => (
            <div
              key={`recent-project:${group.projectId}`}
              className="recent-project-session-group"
              role="group"
              aria-label={`${group.projectName} recent sessions`}
            >
              <div className="recent-project-divider">
                <SessionIcon name="folder" size={13} className="recent-project-divider-icon" />
                <span className="recent-project-divider-name" title={group.projectName}>
                  {group.projectName}
                </span>
                <span className={`wide-project-hub-tag recent-project-divider-hub ${group.hubVariantClass}`} style={group.hubAccentStyle}>
                  <span className="wide-project-hub-dot" aria-hidden="true" />
                  <span className="wide-project-hub-label">{group.hubLabel}</span>
                </span>
                <button
                  type="button"
                  className="recent-project-divider-create"
                  title={`New session in ${group.projectName}`}
                  aria-label={`New session in ${group.projectName}`}
                  onClick={event => onNewInProject(group.projectId, event)}
                >
                  <SessionIcon name="plus" size={13} />
                </button>
              </div>
              <div className="recent-project-session-list">{group.sessions.map(session => renderRow(group.projectId, session))}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
