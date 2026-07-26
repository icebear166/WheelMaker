import React, {type ReactNode} from 'react';
import {SessionIcon} from './SessionIcon';

export type SessionRowGestureHandlers = {
  onPointerDown: React.PointerEventHandler<HTMLButtonElement>;
  onPointerUp: React.PointerEventHandler<HTMLButtonElement>;
  onPointerCancel: React.PointerEventHandler<HTMLButtonElement>;
  onPointerLeave: React.PointerEventHandler<HTMLButtonElement>;
  onContextMenu: React.MouseEventHandler<HTMLButtonElement>;
};

export type SessionRowProps = {
  title: string;
  agentLabel?: string;
  /** Full class string for the agent pill (base + variant), e.g. from tagVariantClass. */
  agentClassName?: string;
  timeLabel?: string;
  timeTitle?: string;
  selected: boolean;
  pinned?: boolean;
  pinning?: boolean;
  recent?: boolean;
  leadingState?: ReactNode;
  rowTitleAttr?: string;
  gestureHandlers: SessionRowGestureHandlers;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onUnpin?: () => void;
  unpinLabel?: string;
};

/** Presentational session row; keeps the legacy class hooks so the pre-upgrade CSS still applies. */
export function SessionRow({
  title,
  agentLabel,
  agentClassName,
  timeLabel,
  timeTitle,
  selected,
  pinned = false,
  pinning = false,
  recent = false,
  leadingState,
  rowTitleAttr,
  gestureHandlers,
  onClick,
  onUnpin,
  unpinLabel,
}: SessionRowProps) {
  return (
    <div className={`project-session-row-wrap${recent ? ' recent-session-row-wrap' : ''}${pinned ? ' has-pin-action' : ''}`}>
      {leadingState}
      <button
        type="button"
        className={`wide-session-row${recent ? ' recent-session-row' : ''}${selected ? ' selected' : ''}`}
        title={rowTitleAttr}
        {...gestureHandlers}
        onClick={onClick}
      >
        <span className="wide-session-title">{title}</span>
        {agentLabel ? (
          <span className={`wide-session-agent-tag ${agentClassName ?? ''}`}>{agentLabel}</span>
        ) : null}
        {!pinned ? (
          <span className="wide-session-time compact-age" title={timeTitle ?? ''}>{timeLabel}</span>
        ) : null}
      </button>
      {pinned && onUnpin ? (
        <button
          type="button"
          className="wide-session-pin-btn"
          title="Unpin session"
          aria-label={unpinLabel ?? `Unpin session ${title}`}
          aria-pressed={true}
          disabled={pinning}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            onUnpin();
          }}
        >
          {pinning ? <SessionIcon name="loader" spin /> : <SessionIcon name="pin" />}
        </button>
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
  agentLabel?: string;
  agentClassName?: string;
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
  agentLabel,
  agentClassName,
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
        title={failed ? errorMessage : title}
        onClick={onClick}
      >
        <span className="wide-session-title">{title}</span>
        {agentLabel ? (
          <span className={`wide-session-agent-tag ${agentClassName ?? ''}`}>{agentLabel}</span>
        ) : null}
        <span className="wide-session-time" title={failed ? errorMessage : createdAtTitle ?? ''}>
          {statusLabel}
        </span>
      </button>
      {failed && onDismiss ? (
        <button
          type="button"
          className="draft-session-dismiss"
          title="Dismiss"
          aria-label="Dismiss draft session"
          onClick={onDismiss}
        >
          <SessionIcon name="x" />
        </button>
      ) : null}
    </div>
  );
}
