import React, {type ReactNode} from 'react';
import type {RegistrySessionMarkColor} from '../../registry/registryTypes';
import {SessionIcon} from './SessionIcon';
import {sessionMarkColorClass} from './sessionMark';

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
  forked?: boolean;
  pinned?: boolean;
  pinning?: boolean;
  markColor?: RegistrySessionMarkColor;
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
  return (
    <div className={`project-session-row-wrap${recent ? ' recent-session-row-wrap' : ''}${pinned ? ' has-pin-action' : ''}`}>
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
        {agentLabel ? (
          <span className={`wide-session-agent-tag ${agentClassName ?? ''}`}>{agentLabel}</span>
        ) : null}
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
        data-tooltip={failed ? errorMessage : title}
        onClick={onClick}
      >
        <span className="wide-session-title">{title}</span>
        {agentLabel ? (
          <span className={`wide-session-agent-tag ${agentClassName ?? ''}`}>{agentLabel}</span>
        ) : null}
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
