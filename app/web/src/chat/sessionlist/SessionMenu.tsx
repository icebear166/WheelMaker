import React, {useEffect, useRef} from 'react';
import {focusFirstMenuItem, handleMenuKeyDown} from '../../common/menuKeyboardNavigation';
import type {RegistrySessionMarkColor} from '../../registry/registryTypes';
import {SessionIcon, type SessionIconName} from './SessionIcon';
import {SESSION_MARK_OPTIONS, sessionMarkColorClass} from './sessionMark';

export type SessionMenuProps = {
  pinned: boolean;
  pinning: boolean;
  markColor?: RegistrySessionMarkColor;
  marking: boolean;
  renaming: boolean;
  /** Disables archive/reload/delete (session running or another destructive op in flight). */
  actionDisabled: boolean;
  archiving: boolean;
  reloading: boolean;
  deleting: boolean;
  onTogglePin: () => void;
  onSetMark: (markColor: RegistrySessionMarkColor | '') => void;
  onRename: () => void;
  onArchive: () => void;
  onReload: () => void;
  onDelete: () => void;
  onClose: () => void;
  /** Popover positioning style computed by the caller (ignored in sheet mode). */
  popoverStyle?: React.CSSProperties;
  /** When true, plays the exit animation (wired by the caller's close helper). */
  exiting?: boolean;
  /** When true, renders as a mobile bottom sheet instead of an anchored popover. */
  sheet?: boolean;
};

type MenuItem = {
  key: string;
  className: string;
  icon: SessionIconName;
  label: string;
  disabled: boolean;
  busy: boolean;
  onSelect: () => void;
};

export function SessionMenu({
  pinned,
  pinning,
  markColor,
  marking,
  renaming,
  actionDisabled,
  archiving,
  reloading,
  deleting,
  onTogglePin,
  onSetMark,
  onRename,
  onArchive,
  onReload,
  onDelete,
  onClose,
  popoverStyle,
  exiting = false,
  sheet = false,
}: SessionMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previouslyFocusedRef.current = typeof document !== 'undefined' && typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    focusFirstMenuItem(menuRef.current);
  }, []);
  const items: Array<MenuItem | 'mark' | 'mark-separator' | 'separator'> = [
    'mark',
    'mark-separator',
    {key: 'pin', className: 'pin', icon: 'pin', label: pinned ? 'Unpin' : 'Pin', disabled: pinning, busy: pinning, onSelect: onTogglePin},
    {key: 'rename', className: 'rename', icon: 'pencil', label: 'Rename', disabled: renaming, busy: renaming, onSelect: onRename},
    {key: 'archive', className: 'archive', icon: 'archive', label: 'Archive', disabled: actionDisabled, busy: archiving, onSelect: onArchive},
    'separator',
    {key: 'reload', className: 'reload', icon: 'refreshCw', label: 'Reload', disabled: actionDisabled, busy: reloading, onSelect: onReload},
    {key: 'delete', className: 'delete', icon: 'trash', label: 'Delete', disabled: actionDisabled, busy: deleting, onSelect: onDelete},
  ];
  return (
    <div
      ref={menuRef}
      className={`project-session-action-menu sl-session-list-popover${sheet ? ' sl-sheet' : ''}${exiting ? ' sl-menu-exit' : ''}`}
      role="menu"
      style={sheet ? undefined : popoverStyle}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          previouslyFocusedRef.current?.focus();
          onClose();
          return;
        }
        handleMenuKeyDown(event, menuRef.current);
      }}
    >
      {sheet ? <div className="mobile-project-sheet-grip" aria-hidden="true" /> : null}
      {items.map(item =>
        item === 'separator' || item === 'mark-separator' ? (
          <div key={item} className="project-session-menu-separator" aria-hidden="true" />
        ) : item === 'mark' ? (
          <div
            key="mark"
            className="project-session-mark-picker"
            role="group"
            aria-label="Mark session"
          >
            <span className="project-session-mark-options">
              {SESSION_MARK_OPTIONS.map(option => (
                <button
                  key={option.color}
                  type="button"
                  className={`project-session-mark-option ${sessionMarkColorClass(option.color)}`}
                  role="menuitemradio"
                  aria-label={`Mark ${option.color}`}
                  aria-checked={markColor === option.color}
                  title={`${option.label} mark`}
                  disabled={marking}
                  onClick={event => {
                    event.stopPropagation();
                    onSetMark(option.color);
                  }}
                />
              ))}
              <span className="project-session-mark-divider" aria-hidden="true" />
              <button
                type="button"
                className="project-session-mark-option project-session-mark-clear"
                role="menuitemradio"
                aria-label="Clear mark"
                aria-checked={!markColor}
                title="Clear mark"
                disabled={marking}
                onClick={event => {
                  event.stopPropagation();
                  onSetMark('');
                }}
              >
                <SessionIcon name="ban" size={12} />
              </button>
            </span>
          </div>
        ) : (
          <button
            key={item.key}
            type="button"
            className={`project-session-menu-btn ${item.className}`}
            role="menuitem"
            disabled={item.disabled}
            onClick={event => {
              event.stopPropagation();
              item.onSelect();
            }}
          >
            {item.busy ? <SessionIcon name="loader" spin /> : <SessionIcon name={item.icon} />}
            <span className="project-session-menu-label">{item.label}</span>
          </button>
        ),
      )}
    </div>
  );
}
