import React, {useEffect, useRef} from 'react';
import {focusFirstMenuItem, handleMenuKeyDown} from '../common/menuKeyboardNavigation';
import type {PreviewFileLink} from '../preview/previewFileLink';
import {ChatIcon, type ChatIconName} from './ChatIcon';

export type ChatFileLinkMenuAction =
  | 'preview'
  | 'download'
  | 'vscode'
  | 'folder'
  | 'copy-file'
  | 'copy-relative'
  | 'copy-absolute'
  | 'share'
  | 'export-html';

export type ChatFileLinkHtmlActionLabel =
  | 'Copy file as HTML'
  | 'Export as HTML';

export type ChatFileLinkContextMenuProps = {
  x: number;
  y: number;
  link: PreviewFileLink | null;
  canOpenInVSCode: boolean;
  canShowInFolder: boolean;
  canCopyFile: boolean;
  canDownload: boolean;
  canShare?: boolean;
  htmlActionLabel: ChatFileLinkHtmlActionLabel | null;
  onAction: (action: ChatFileLinkMenuAction) => void;
  onClose: () => void;
  exiting?: boolean;
};

type MenuEntry = {
  action: ChatFileLinkMenuAction;
  icon: ChatIconName;
  label: string;
};

function isMenuEntry(entry: MenuEntry | null): entry is MenuEntry {
  return entry !== null;
}

function menuGroup(...entries: Array<MenuEntry | null>): MenuEntry[] {
  return entries.filter(isMenuEntry);
}

export function ChatFileLinkContextMenu({
  x,
  y,
  link,
  canOpenInVSCode,
  canShowInFolder,
  canCopyFile,
  canDownload,
  canShare = false,
  htmlActionLabel,
  onAction,
  onClose,
  exiting = false,
}: ChatFileLinkContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = typeof document !== 'undefined' && typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    focusFirstMenuItem(menuRef.current);
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        previouslyFocusedRef.current?.focus();
        onClose();
      }
    };
    const handleClose = () => onClose();
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('resize', handleClose);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('resize', handleClose);
    };
  }, [onClose]);

  const item = (
    action: ChatFileLinkMenuAction,
    icon: ChatIconName,
    label: string,
  ) => (
    <button key={action} type="button" role="menuitem" onClick={() => onAction(action)}>
      <ChatIcon name={icon} />
      <span>{label}</span>
    </button>
  );

  const actionGroups: MenuEntry[][] = [
    menuGroup(
      {action: 'preview', icon: 'eye', label: 'Preview file'},
      canDownload
        ? {action: 'download', icon: 'arrowDown', label: 'Download'}
        : null,
      canOpenInVSCode
        ? {action: 'vscode', icon: 'code', label: 'Open with VS Code'}
        : null,
      canShowInFolder
        ? {action: 'folder', icon: 'folderOpen', label: 'Show in File Explorer'}
        : null,
    ),
    menuGroup(
      canCopyFile
        ? {action: 'copy-file', icon: 'copy', label: 'Copy file'}
        : null,
      htmlActionLabel
        ? {action: 'export-html', icon: 'fileCode', label: htmlActionLabel}
        : null,
      canShare
        ? {action: 'share', icon: 'share', label: 'Create public share'}
        : null,
    ),
    menuGroup(
      link?.relativePath !== null && link
        ? {action: 'copy-relative', icon: 'fileSymlink', label: 'Copy relative path'}
        : null,
      link
        ? {action: 'copy-absolute', icon: 'clipboard', label: 'Copy absolute path'}
        : null,
    ),
  ].filter(group => group.length > 0);

  return (
    <div
      ref={menuRef}
      className={`chat-file-link-context-menu${exiting ? ' sl-menu-exit' : ''}`}
      style={{left: x, top: y}}
      role="menu"
      onKeyDown={event => handleMenuKeyDown(event, menuRef.current)}
    >
      {actionGroups.map((group, groupIndex) => (
        <React.Fragment key={group[0].action}>
          {groupIndex > 0 ? (
            <div
              className="chat-file-link-context-menu-separator"
              role="separator"
            />
          ) : null}
          {group.map(entry => item(entry.action, entry.icon, entry.label))}
        </React.Fragment>
      ))}
    </div>
  );
}
