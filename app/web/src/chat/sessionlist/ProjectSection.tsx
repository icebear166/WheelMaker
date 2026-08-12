import React, {type ReactNode} from 'react';
import {SessionIcon} from './SessionIcon';
import type {SessionRowGestureHandlers} from './SessionRow';
import {useContextMenuActionGesture} from '../../common/useContextMenuGesture';

export type ProjectSectionProps = {
  name: string;
  hubLabel: string;
  hubVariantClass: string;
  hubAccentStyle: React.CSSProperties;
  collapsed: boolean;
  pinned: boolean;
  active: boolean;
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
  projectGestureHandlers,
  onToggleCollapsed,
  onNew,
  onResume,
  onTogglePin,
  error,
  onRetryError,
  children,
}: ProjectSectionProps) {
  const projectActionGesture = useContextMenuActionGesture();
  return (
    <div
      className={`wide-project-section${active ? ' active' : ''}${pinned ? ' pinned' : ''}${collapsed ? ' collapsed' : ''}`}
    >
      <div className="wide-project-row">
        <button
          type="button"
          className="wide-project-toggle"
          {...projectGestureHandlers}
          onClick={onToggleCollapsed}
          data-tooltip={collapsed ? 'Expand project' : 'Collapse project'}
          aria-expanded={!collapsed}
        >
          <span className="wide-project-folder-wrap">
            <SessionIcon
              name={collapsed ? 'folder' : 'folderOpen'}
              size={15}
              className={`wide-project-folder-icon ${hubVariantClass}`}
              style={hubAccentStyle}
            />
            {pinned ? (
              <SessionIcon name="pin" size={10} filled className="wide-project-pin-badge" />
            ) : null}
          </span>
          <span className="wide-project-title-group">
            <span className="wide-project-name" data-tooltip={name}>{name}</span>
            <span className={`wide-project-hub-tag ${hubVariantClass}`} style={hubAccentStyle}>
              <span className="wide-project-hub-dot" aria-hidden="true" />
              <span className="wide-project-hub-label">{hubLabel}</span>
            </span>
          </span>
        </button>
        <div className="wide-project-actions">
          <button
            type="button"
            className="wide-project-action-btn sl-action-secondary"
            data-tooltip="Resume session"
            aria-label={`Resume session in ${name}`}
            {...projectActionGesture}
            onClick={onResume}
          >
            <SessionIcon name="import" />
          </button>
          <button
            type="button"
            className={`wide-project-action-btn wide-project-pin-btn sl-action-secondary${pinned ? ' active' : ''}`}
            data-tooltip={pinned ? 'Unpin project' : 'Pin project to top'}
            aria-label={pinned ? `Unpin project ${name}` : `Pin project ${name}`}
            aria-pressed={pinned}
            {...projectActionGesture}
            onClick={event => {
              event.stopPropagation();
              onTogglePin();
            }}
          >
            <SessionIcon name="pin" />
          </button>
          <button
            type="button"
            className="wide-project-action-btn sl-action-primary"
            data-tooltip="New session"
            aria-label={`New session in ${name}`}
            {...projectActionGesture}
            onClick={onNew}
          >
            <SessionIcon name="plus" />
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
        <div className="wide-project-session-list">
          {children}
        </div>
      ) : null}
    </div>
  );
}
