import React, {type ReactNode} from 'react';
import type {RegistrySessionMarkColor} from '../../registry/registryTypes';
import {AgentTag} from '../AgentTag';
import {SessionIcon} from './SessionIcon';
import {sessionMarkColorClass} from './sessionMark';
import {
  useContextMenuActionGesture,
  type ContextMenuGestureHandlers,
} from '../../common/useContextMenuGesture';

export type SessionRowGestureHandlers = ContextMenuGestureHandlers;

export type SessionRowProps = {
  title: string;
  agentType?: string;
  timeLabel?: string;
  timeTitle?: string;
  selected: boolean;
  forked?: boolean;
  pinned?: boolean;
  pinning?: boolean;
  markColor?: RegistrySessionMarkColor;
  recent?: boolean;
  leadingState?: ReactNode;
  rowTitleAttr?: string;
  gestureHandlers?: SessionRowGestureHandlers;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onUnpin?: () => void;
  unpinLabel?: string;
};

/** Presentational session row; keeps the legacy class hooks so the pre-upgrade CSS still applies. */
export function SessionRow({
  title,
  agentType,
  timeLabel,
  timeTitle,
  selected,
  forked = false,
  pinned = false,
  pinning = false,
  markColor,
  recent = false,
  leadingState,
  rowTitleAttr,
  gestureHandlers,
  onClick,
  onUnpin,
  unpinLabel,
}: SessionRowProps) {
  const unpinGesture = useContextMenuActionGesture();
  return (
    <div className={`project-session-row-wrap${recent ? ' recent-session-row-wrap' : ''}${pinned && onUnpin ? ' has-pin-action' : ''}`}>
      {leadingState}
      <button
        type="button"
        className={`wide-session-row${recent ? ' recent-session-row' : ''}${selected ? ' selected' : ''}`}
        data-tooltip={rowTitleAttr}
        {...gestureHandlers}
        onClick={onClick}
      >
        {forked ? (
          <span className="wide-session-title forked">
            <SessionIcon name="gitBranch" size={11} className="wide-session-fork-marker" />
            <span className="wide-session-title-text">{title}</span>
          </span>
        ) : (
          <span className="wide-session-title">{title}</span>
        )}
        <AgentTag agentType={agentType} />
        {!pinned ? (
          <span className="wide-session-time compact-age" data-tooltip={timeTitle ?? ''}>{timeLabel}</span>
        ) : null}
      </button>
      {pinned && onUnpin ? (
        <button
          type="button"
          className="wide-session-pin-btn"
          data-tooltip="Unpin session"
          aria-label={unpinLabel ?? `Unpin session ${title}`}
          aria-pressed={true}
          disabled={pinning}
          {...unpinGesture}
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            onUnpin();
          }}
        >
          {pinning ? <SessionIcon name="loader" spin /> : <SessionIcon name="pin" />}
        </button>
      ) : null}
      {markColor ? (
        <span
          className={`wide-session-mark ${sessionMarkColorClass(markColor)}`}
          role="img"
          aria-label={`${markColor[0].toUpperCase()}${markColor.slice(1)} mark`}
        />
      ) : null}
    </div>
  );
}

export type DraftSessionRowProps = {
  title: string;
  statusLabel: string;
  failed: boolean;
  errorMessage?: string;
  createdAtTitle?: string;
  agentType?: string;
  selected: boolean;
  /** Extra status class appended to the row button (legacy `draft.status` hook). */
  statusClassName?: string;
  onClick: () => void;
  onDismiss?: () => void;
};

export function DraftSessionRow({
  title,
  statusLabel,
  failed,
  errorMessage,
  createdAtTitle,
  agentType,
  selected,
  statusClassName,
  onClick,
  onDismiss,
}: DraftSessionRowProps) {
  return (
    <div className={`project-session-row-wrap draft-session-row-wrap${failed ? ' failed has-dismiss' : ''}`}>
      <button
        type="button"
        className={`wide-session-row draft-session-row${statusClassName ? ` ${statusClassName}` : ''}${selected ? ' selected' : ''}`}
        data-tooltip={failed ? errorMessage : title}
        onClick={onClick}
      >
        <span className="wide-session-title">{title}</span>
        <AgentTag agentType={agentType} />
        <span className="wide-session-time" data-tooltip={failed ? errorMessage : createdAtTitle ?? ''}>
          {statusLabel}
        </span>
      </button>
      {failed && onDismiss ? (
        <button
          type="button"
          className="draft-session-dismiss"
          aria-label="Dismiss draft session"
          onClick={onDismiss}
        >
          <SessionIcon name="x" />
        </button>
      ) : null}
    </div>
  );
}
