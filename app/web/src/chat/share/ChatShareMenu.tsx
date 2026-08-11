import React, {useCallback, useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

import {focusFirstMenuItem, handleMenuKeyDown} from '../../common/menuKeyboardNavigation';
import {resolveWideProjectActionPopoverPlacement} from '../layout/wideProjectActionPopover';
import {useSheetDragToDismiss} from '../sessionlist/sheetDragDismiss';
import {ChatIcon, type ChatIconName} from '../ChatIcon';

export type ChatShareScope = 'response' | 'session';
export type ChatShareFormat = 'image' | 'html' | 'public_url';
export type ChatShareAction = Readonly<{
  scope: ChatShareScope;
  format: ChatShareFormat;
  includeWorkDetails: boolean;
}>;

export type ChatShareMenuProps = {
  mode: 'popover' | 'sheet';
  responseDisabled: boolean;
  sessionDisabled: boolean;
  workDetailsAvailable?: boolean;
  busyAction?: ChatShareAction | null;
  onSelect: (action: ChatShareAction) => void;
  onOpenChange?: (open: boolean) => void;
  portal?: boolean;
};

type ShareFormatItem = {
  format: ChatShareFormat;
  label: string;
  accessibleLabel: string;
  icon: ChatIconName;
};

const SHARE_FORMATS: ShareFormatItem[] = [
  {format: 'image', label: 'Image', accessibleLabel: 'image', icon: 'image'},
  {format: 'html', label: 'HTML file', accessibleLabel: 'HTML file', icon: 'fileCode'},
  {format: 'public_url', label: 'Public URL', accessibleLabel: 'public URL', icon: 'externalLink'},
];

function actionsEqual(left: ChatShareAction | null | undefined, right: ChatShareAction): boolean {
  return left?.scope === right.scope && left.format === right.format;
}

export function ChatShareMenu({
  mode,
  responseDisabled,
  sessionDisabled,
  workDetailsAvailable = false,
  busyAction = null,
  onSelect,
  onOpenChange,
  portal = true,
}: ChatShareMenuProps) {
  const [open, setOpen] = useState(false);
  const [includeWorkDetails, setIncludeWorkDetails] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    onOpenChange?.(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, [onOpenChange]);
  const {dragOffset, dragging, releaseDurationMs, handleProps} = useSheetDragToDismiss(() => close());

  const openMenu = useCallback(() => {
    setIncludeWorkDetails(false);
    if (mode === 'popover' && typeof window !== 'undefined') {
      const placement = resolveWideProjectActionPopoverPlacement({
        anchorRect: triggerRef.current?.getBoundingClientRect() ?? null,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        preferredWidth: 260,
        preferredMaxHeight: 360,
        align: 'end',
      });
      setPopoverStyle(placement ? {
        top: placement.top,
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
        '--sl-popover-origin': placement.placement === 'above' ? 'bottom right' : 'top right',
        ...(placement.placement === 'above' ? {'--sl-popover-shift': 'translateY(-100%)'} : {}),
      } as React.CSSProperties : undefined);
    }
    setOpen(true);
    onOpenChange?.(true);
  }, [mode, onOpenChange]);

  useEffect(() => {
    if (!open) return undefined;
    focusFirstMenuItem(menuRef.current);
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        close(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    const handleViewportChange = () => close(false);
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    if (mode === 'popover') {
      window.addEventListener('scroll', handleViewportChange, true);
      window.addEventListener('resize', handleViewportChange);
    }
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [close, mode, open]);

  const dragHandleProps = {
    ...handleProps,
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if ((event.target as HTMLElement | null)?.closest('button')) return;
      handleProps.onPointerDown(event);
    },
  };

  const renderGroup = (
    scope: ChatShareScope,
    label: string,
    disabled: boolean,
  ) => (
    <div className={`chat-share-menu-group ${scope}`} role="group" aria-label={label}>
      <div className="chat-share-menu-group-label">{label}</div>
      <div className="chat-share-menu-group-actions">
        {SHARE_FORMATS.map(item => {
          const action = {
            scope,
            format: item.format,
            includeWorkDetails: workDetailsAvailable && includeWorkDetails,
          } as const;
          const busy = actionsEqual(busyAction, action);
          const scopeLabel = scope === 'response' ? 'current response' : 'full session';
          return (
            <button
              type="button"
              role="menuitem"
              className="chat-share-menu-action"
              aria-label={`Share ${scopeLabel} as ${item.accessibleLabel}`}
              aria-busy={busy || undefined}
              disabled={disabled}
              key={item.format}
              onClick={() => {
                if (disabled) return;
                onSelect(action);
                close();
              }}
            >
              <ChatIcon name={busy ? 'loader' : item.icon} spin={busy} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const panel = open ? (
    <>
      {mode === 'sheet' ? (
        <div
          className="sl-sheet-overlay chat-share-sheet-overlay"
          role="presentation"
          onPointerDown={() => close()}
        />
      ) : null}
      <div
        ref={menuRef}
        className={`project-session-action-menu sl-session-list-popover chat-share-menu${mode === 'sheet' ? ' sl-sheet' : ''}${dragging ? ' dragging' : ''}`}
        role="menu"
        aria-label="Share response or session"
        style={mode === 'sheet' ? {
          '--sl-sheet-release-duration': `${releaseDurationMs}ms`,
          ...(dragOffset > 0 ? {transform: `translateY(${dragOffset}px)`} : {}),
        } as React.CSSProperties : popoverStyle}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
          }
          handleMenuKeyDown(event, menuRef.current);
        }}
      >
        {mode === 'sheet' ? <div className="mobile-project-sheet-grip" aria-hidden="true" {...dragHandleProps} /> : null}
        {mode === 'sheet' ? (
          <div className="session-menu-header wide-project-action-title" {...dragHandleProps}>
            <ChatIcon name="share2" className="session-menu-header-icon" />
            <span className="wide-project-action-title-copy">
              <span className="wide-project-action-title-main">Share</span>
              <span className="wide-project-action-title-sub">Choose content and format</span>
            </span>
            <button
              type="button"
              className="session-menu-close"
              data-menu-close="true"
              aria-label="Close share menu"
              onClick={() => close()}
            >
              <ChatIcon name="x" />
            </button>
          </div>
        ) : null}
        <div className="chat-share-menu-body">
          {workDetailsAvailable ? (
            <button
              type="button"
              role="menuitemcheckbox"
              className="chat-share-menu-work-details"
              aria-label="Include work details"
              aria-checked={includeWorkDetails}
              onClick={() => setIncludeWorkDetails(value => !value)}
            >
              <span className="chat-share-menu-work-details-check" aria-hidden="true">
                {includeWorkDetails ? <ChatIcon name="check" size={11} /> : null}
              </span>
              <span className="chat-share-menu-work-details-copy">
                <span>Include work details</span>
                <span>Commentary + final answer</span>
              </span>
            </button>
          ) : null}
          {renderGroup('response', 'Current response', responseDisabled)}
          {renderGroup('session', 'Full session', sessionDisabled)}
        </div>
      </div>
    </>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="chat-prompt-action-button chat-share-trigger"
        aria-label="Share response or session"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip="Share response or session"
        onClick={() => open ? close() : openMenu()}
      >
        <ChatIcon name={busyAction ? 'loader' : 'share2'} size={13} spin={!!busyAction} />
      </button>
      {panel && portal && typeof document !== 'undefined'
        ? createPortal(panel, document.body)
        : panel}
    </>
  );
}
