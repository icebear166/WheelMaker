import React, {useEffect, useRef} from 'react';
import type {PreviewFileLink} from '../preview/previewFileLink';

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

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
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
    icon: string,
    label: string,
  ) => (
    <button type="button" role="menuitem" onClick={() => onAction(action)}>
      <span className={`codicon ${icon}`} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );

  return (
    <div
      ref={menuRef}
      className="chat-file-link-context-menu"
      style={{left: x, top: y}}
      role="menu"
    >
      {canOpenInVSCode
        ? item('vscode', 'codicon-code', 'Open with VS Code')
        : null}
      {canShowInFolder
        ? item('folder', 'codicon-folder-opened', 'Show in File Explorer')
        : null}
      {canExportHtml
        ? item('export-html', 'codicon-export', 'Export as HTML')
        : null}
      {link.relativePath !== null
        ? item('copy-relative', 'codicon-copy', 'Copy relative path')
        : null}
      {item('copy-absolute', 'codicon-clippy', 'Copy absolute path')}
    </div>
  );
}
