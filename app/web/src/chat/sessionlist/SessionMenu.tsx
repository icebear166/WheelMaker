import React from 'react';
import {SessionIcon, type SessionIconName} from './SessionIcon';

export type SessionMenuProps = {
  pinned: boolean;
  pinning: boolean;
  renaming: boolean;
  /** Disables archive/reload/delete (session running or another destructive op in flight). */
  actionDisabled: boolean;
  archiving: boolean;
  reloading: boolean;
  deleting: boolean;
  onTogglePin: () => void;
  onRename: () => void;
  onArchive: () => void;
  onReload: () => void;
  onDelete: () => void;
  /** Popover positioning style computed by the caller. */
  popoverStyle?: React.CSSProperties;
  /** When true, plays the exit animation (wired by the caller's close helper). */
  exiting?: boolean;
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
  renaming,
  actionDisabled,
  archiving,
  reloading,
  deleting,
  onTogglePin,
  onRename,
  onArchive,
  onReload,
  onDelete,
  popoverStyle,
  exiting = false,
}: SessionMenuProps) {
  const items: Array<MenuItem | 'separator'> = [
    {key: 'pin', className: 'pin', icon: 'pin', label: pinned ? 'Unpin' : 'Pin', disabled: pinning, busy: pinning, onSelect: onTogglePin},
    {key: 'rename', className: 'rename', icon: 'pencil', label: 'Rename', disabled: renaming, busy: renaming, onSelect: onRename},
    {key: 'archive', className: 'archive', icon: 'archive', label: 'Archive', disabled: actionDisabled, busy: archiving, onSelect: onArchive},
    'separator',
    {key: 'reload', className: 'reload', icon: 'refreshCw', label: 'Reload', disabled: actionDisabled, busy: reloading, onSelect: onReload},
    {key: 'delete', className: 'delete', icon: 'trash', label: 'Delete', disabled: actionDisabled, busy: deleting, onSelect: onDelete},
  ];
  return (
    <div
      className={`project-session-action-menu${exiting ? ' sl-menu-exit' : ''}`}
      role="menu"
      style={popoverStyle}
    >
      {items.map(item =>
        item === 'separator' ? (
          <div key="separator" className="project-session-menu-separator" aria-hidden="true" />
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
