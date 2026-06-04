import React from 'react';
import {
  portRelayTargetKey,
  samePortRelayTarget,
  type PortRelayTarget,
} from './portRelayTargets';

type PortRelayFrameMode = 'desktop' | 'mobile';

type PortRelayFrameSurfaceProps = {
  mode: PortRelayFrameMode;
  url: string;
  chrome?: boolean;
  onCloseChrome: () => void;
  onOpenInBrowser: () => void;
};

type PortRelayFloatingButtonProps = {
  ready: boolean;
  frameUrl: string;
  frameOpen: boolean;
  mobileFrameOpen: boolean;
  targetMenuOpen: boolean;
  targetMenuRef: React.RefObject<HTMLDivElement | null>;
  targets: PortRelayTarget[];
  activeTarget: PortRelayTarget | null;
  switchingTarget: PortRelayTarget | null;
  onTargetSelect: (target: PortRelayTarget) => void;
  onPointerDown: React.PointerEventHandler<HTMLButtonElement>;
  onPointerMove: React.PointerEventHandler<HTMLButtonElement>;
  onPointerUp: React.PointerEventHandler<HTMLButtonElement>;
  onPointerCancel: React.PointerEventHandler<HTMLButtonElement>;
  onToggle: () => void;
};

export function PortRelayFrameSurface({
  mode,
  url,
  chrome = false,
  onCloseChrome,
  onOpenInBrowser,
}: PortRelayFrameSurfaceProps) {
  return (
    <div className={`port-relay-frame-surface ${mode}`}>
      {chrome ? (
        <div className="chat-preview-toolbar">
          <button
            type="button"
            className="chat-preview-icon-button"
            onClick={onCloseChrome}
            title={mode === 'mobile' ? 'Back' : 'Close preview'}
            aria-label={mode === 'mobile' ? 'Back' : 'Close preview'}
          >
            <span className={`codicon ${mode === 'mobile' ? 'codicon-arrow-left' : 'codicon-close'}`} />
          </button>
          <div className="chat-preview-title" title={url}>{url}</div>
          <button
            type="button"
            className="chat-preview-icon-button"
            onClick={onOpenInBrowser}
            title="Open relay page in browser"
            aria-label="Open relay page in browser"
          >
            <span className="codicon codicon-link-external" />
          </button>
        </div>
      ) : null}
      <iframe
        title="Port Relay"
        src={url}
        className="port-relay-frame"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}

export function PortRelayFloatingButton({
  ready,
  frameUrl,
  frameOpen,
  mobileFrameOpen,
  targetMenuOpen,
  targetMenuRef,
  targets,
  activeTarget,
  switchingTarget,
  onTargetSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onToggle,
}: PortRelayFloatingButtonProps) {
  if (!ready || !frameUrl) {
    return null;
  }

  const targetMenu = targetMenuOpen && mobileFrameOpen ? (
    <div
      ref={targetMenuRef}
      className="port-relay-target-switch-menu"
      role="menu"
      aria-label="Port Relay targets"
      onPointerDown={event => event.stopPropagation()}
    >
      {targets.map(target => {
        const selected = samePortRelayTarget(activeTarget, target);
        const switching = samePortRelayTarget(switchingTarget, target);
        return (
          <button
            key={portRelayTargetKey(target)}
            type="button"
            className="port-relay-target-switch-item"
            data-selected={selected}
            data-loading={switching}
            role="menuitemradio"
            aria-checked={selected}
            onClick={() => onTargetSelect(target)}
          >
            <span className="port-relay-target-switch-check" aria-hidden="true">
              {switching ? (
                <span className="codicon codicon-loading codicon-modifier-spin" />
              ) : selected ? (
                <span className="codicon codicon-check" />
              ) : null}
            </span>
            <span className="port-relay-target-switch-label">{`${target.hubId}:${target.targetPort}`}</span>
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        className="drawer-toggle-bubble port-relay-floating-bubble"
        data-active={frameOpen}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={event => event.preventDefault()}
        onClick={onToggle}
        title={frameOpen ? 'Close relay page' : 'Open relay page'}
        aria-label={frameOpen ? 'Close relay page' : 'Open relay page'}
        aria-pressed={frameOpen}
      >
        <span className="codicon codicon-radio-tower" />
      </button>
      {targetMenu}
    </>
  );
}
