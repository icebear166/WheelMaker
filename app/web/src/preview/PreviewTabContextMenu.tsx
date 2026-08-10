import React from 'react';
import {ContextMenu} from '../common/ContextMenu';
import type {ContextMenuModel, FileMenuAction} from '../file/fileMenuModel';

type PreviewTabContextMenuProps = {
  x: number;
  y: number;
  model: ContextMenuModel;
  onAction: (action: FileMenuAction) => void;
  onClose: () => void;
  exiting?: boolean;
};

export function PreviewTabContextMenu({
  x,
  y,
  model,
  onAction,
  onClose,
  exiting = false,
}: PreviewTabContextMenuProps) {
  return (
    <ContextMenu
      x={x}
      y={y}
      model={model}
      onAction={onAction}
      onClose={onClose}
      className="preview-tab-context-menu"
      itemClassName="preview-workbench-action-menu-item"
      separatorClassName="preview-tab-context-menu-separator"
      ariaLabel="Preview tab actions"
      exiting={exiting}
    />
  );
}
