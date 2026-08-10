import React from 'react';
import {ContextMenu} from '../common/ContextMenu';
import type {ContextMenuModel, FileMenuAction} from '../file/fileMenuModel';

export type ChatFileLinkMenuAction = FileMenuAction;

export type ChatFileLinkContextMenuProps = {
  x: number;
  y: number;
  model: ContextMenuModel;
  onAction: (action: ChatFileLinkMenuAction) => void;
  onClose: () => void;
  exiting?: boolean;
};

export function ChatFileLinkContextMenu({
  x,
  y,
  model,
  onAction,
  onClose,
  exiting = false,
}: ChatFileLinkContextMenuProps) {
  return (
    <ContextMenu
      x={x}
      y={y}
      model={model}
      onAction={onAction}
      onClose={onClose}
      className="chat-file-link-context-menu"
      exiting={exiting}
      ariaLabel="File actions"
    />
  );
}
