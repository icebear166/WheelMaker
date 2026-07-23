import React, {type ReactNode} from 'react';
import {SessionIcon} from './SessionIcon';
import type {SessionRowGestureHandlers} from './SessionRow';

export type ProjectSectionProps = {
  name: string;
  hubLabel: string;
  hubVariantClass: string;
  hubAccentStyle: React.CSSProperties;
  collapsed: boolean;
  pinned: boolean;
  active: boolean;
  mobile: boolean;
  projectGestureHandlers: SessionRowGestureHandlers;
  onToggleCollapsed: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onNew: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onResume: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onTogglePin: () => void;
  error?: string;
  onRetryError?: () => void;
  children?: ReactNode;
};

export function ProjectSection({
  name,
  hubLabel,
  hubVariantClass,
  hubAccentStyle,
  collapsed,
  pinned,
  active,
  mobile,
  projectGestureHandlers,
  onToggleCollapsed,
  onNew,
  onResume,
  onTogglePin,
  error,
  onRetryError,
  children,
}: ProjectSectionProps) {
  const sfx = (cls: string) => (mobile ? ` ${cls}` : '');
  return (
    <div
      className={`wide-project-section${sfx('mobile-project-section')}${active ? ' active' : ''}${pinned ? ' pinned' : ''}${collapsed ? ' collapsed' : ''}`}
    >
      <div className={`wide-project-row${sfx('mobile-project-row')}`}>
        <button
          type="button"
          className={`wide-project-toggle${sfx('mobile-project-toggle')}`}
          {...projectGestureHandlers}
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand project' : 'Collapse project'}
          aria-expanded={!collapsed}
        >
          <span className="wide-project-folder-wrap">
            <SessionIcon
              name={collapsed ? 'folder' : 'folderOpen'}
              size={15}
              className={`wide-project-folder-icon ${hubVariantClass}`}
            />
            {pinned ? (
              <SessionIcon name="pin" size={10} filled className="wide-project-pin-badge" />
            ) : null}
          </span>
          <span className="wide-project-title-group">
            <span className="wide-project-name" title={name}>{name}</span>
            <span className={`wide-project-hub-tag ${hubVariantClass}`} style={hubAccentStyle}>
              <span className="wide-project-hub-dot" aria-hidden="true" />
              <span className="wide-project-hub-label">{hubLabel}</span>
            </span>
          </span>
        </button>
        <div className={`wide-project-actions${sfx('mobile-project-actions')}`}>
          <button
            type="button"
            className="wide-project-action-btn sl-action-primary"
            title="New session"
            aria-label={`New session in ${name}`}
            onPointerDown={event => event.stopPropagation()}
            onClick={onNew}
          >
            <SessionIcon name="plus" />
          </button>
          <button
            type="button"
            className="wide-project-action-btn sl-action-secondary"
            title="Resume session"
            aria-label={`Resume session in ${name}`}
            onPointerDown={event => event.stopPropagation()}
            onClick={onResume}
          >
            <SessionIcon name="history" />
          </button>
          <button
            type="button"
            className={`wide-project-action-btn wide-project-pin-btn sl-action-secondary${pinned ? ' active' : ''}`}
            title={pinned ? 'Unpin project' : 'Pin project to top'}
            aria-label={pinned ? `Unpin project ${name}` : `Pin project ${name}`}
            aria-pressed={pinned}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              onTogglePin();
            }}
          >
            <SessionIcon name="pin" filled={pinned} />
          </button>
        </div>
      </div>
      {error ? (
        <div className="mobile-project-session-error">
          <span>Session refresh failed.</span>
          <button type="button" onClick={onRetryError}>Retry</button>
        </div>
      ) : null}
      {!collapsed ? (
        <div className={`wide-project-session-list${sfx('mobile-project-session-list')}`}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
