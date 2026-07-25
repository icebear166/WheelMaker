import React, {useEffect, useRef} from 'react';
import {focusFirstMenuItem, handleMenuKeyDown} from '../common/menuKeyboardNavigation';
import type {PreviewFileLink} from '../preview/previewFileLink';
import {ChatIcon, type ChatIconName} from './ChatIcon';

export type ChatFileLinkMenuAction =
  | 'vscode'
  | 'folder'
  | 'copy-relative'
  | 'copy-absolute'
  | 'export-html';

export type ChatFileLinkContextMenuProps = {
  x: number;
  y: number;
  link: PreviewFileLink;
  canOpenInVSCode: boolean;
  canShowInFolder: boolean;
  canExportHtml: boolean;
  onAction: (action: ChatFileLinkMenuAction) => void;
  onClose: () => void;
};

export function ChatFileLinkContextMenu({
  x,
  y,
  link,
  canOpenInVSCode,
  canShowInFolder,
  canExportHtml,
  onAction,
  onClose,
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
    <button type="button" role="menuitem" onClick={() => onAction(action)}>
      <ChatIcon name={icon} />
      <span>{label}</span>
    </button>
  );

  return (
    <div
      ref={menuRef}
      className="chat-file-link-context-menu"
      style={{left: x, top: y}}
      role="menu"
      onKeyDown={event => handleMenuKeyDown(event, menuRef.current)}
    >
      {canOpenInVSCode
        ? item('vscode', 'code', 'Open with VS Code')
        : null}
      {canShowInFolder
        ? item('folder', 'folderOpen', 'Show in File Explorer')
        : null}
      {canExportHtml
        ? item('export-html', 'share', 'Export as HTML')
        : null}
      {link.relativePath !== null
        ? item('copy-relative', 'copy', 'Copy relative path')
        : null}
      {item('copy-absolute', 'clipboard', 'Copy absolute path')}
    </div>
  );
}
