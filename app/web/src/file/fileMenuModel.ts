import type {ChatIconName} from '../chat/ChatIcon';
import {shareKindForExternalPath, shareKindForPath} from '../shares/shareSnapshot';

export type FileMenuPlatform = 'desktop' | 'browser' | 'android';
export type ContextMenuSurface = 'file' | 'preview-tab' | 'selection';

export type FileMenuAction =
  | 'preview'
  | 'download'
  | 'vscode'
  | 'folder'
  | 'copy-file'
  | 'copy-relative'
  | 'copy-absolute'
  | 'share'
  | 'export-html'
  | 'refresh'
  | 'open-relay'
  | 'copy-selection';

export type ContextMenuGroupId =
  | 'open'
  | 'transfer-share-export'
  | 'path'
  | 'tab'
  | 'selection';

export type ContextMenuItem<Action extends string = FileMenuAction> = {
  action: Action;
  icon: ChatIconName;
  label: string;
  disabled?: boolean;
  busy?: boolean;
};

export type ContextMenuGroup<Action extends string = FileMenuAction> = {
  id: ContextMenuGroupId;
  items: Array<ContextMenuItem<Action>>;
};

export type ContextMenuModel<Action extends string = FileMenuAction> = {
  groups: Array<ContextMenuGroup<Action>>;
};

export type FileMenuCapabilities = {
  canOpenInVSCode?: boolean;
  canShowInExplorer?: boolean;
  canCopyFile?: boolean;
};

export type FileMenuFileTarget = {
  kind: 'project-file' | 'external-file' | 'attachment' | 'changed-file';
  path?: string;
  available: boolean;
  downloadAvailable?: boolean;
  previewAvailable?: boolean;
};

export type PreviewTabMenuTarget = {
  kind: 'preview-file' | 'preview-external-file' | 'preview-attachment' | 'prompt-diff' | 'git-diff' | 'history' | 'relay';
  path?: string;
  available?: boolean;
  downloadAvailable?: boolean;
  refreshAvailable?: boolean;
  refreshDisabled?: boolean;
};

export type ContextMenuOptions =
  | {
      surface: 'file';
      platform: FileMenuPlatform;
      target: FileMenuFileTarget;
      capabilities?: FileMenuCapabilities;
    }
  | {
      surface: 'preview-tab';
      platform: FileMenuPlatform;
      target: PreviewTabMenuTarget;
      capabilities?: FileMenuCapabilities;
    }
  | {
      surface: 'selection';
      platform: FileMenuPlatform;
      target: {kind: 'selection'};
    };

function isProjectPathTarget(kind: FileMenuFileTarget['kind'] | PreviewTabMenuTarget['kind']): boolean {
  return kind === 'project-file' || kind === 'changed-file' || kind === 'preview-file';
}

function canCopyFileTarget(kind: FileMenuFileTarget['kind'] | PreviewTabMenuTarget['kind']): boolean {
  return kind === 'project-file'
    || kind === 'external-file'
    || kind === 'changed-file'
    || kind === 'preview-file'
    || kind === 'preview-external-file';
}

function isMarkdownPath(path: string | undefined): boolean {
  if (!path) return false;
  const normalized = path.replaceAll('\\', '/');
  const extension = normalized.slice(normalized.lastIndexOf('.')).toLowerCase();
  return extension === '.md' || extension === '.markdown';
}

function addItem(
  items: Array<ContextMenuItem>,
  item: ContextMenuItem | null,
): void {
  if (item) items.push(item);
}

function buildFileModel(
  options: Extract<ContextMenuOptions, {surface: 'file'}>,
): ContextMenuModel {
  const {target, platform, capabilities = {}} = options;
  const itemsByGroup: Record<Extract<ContextMenuGroupId, 'open' | 'transfer-share-export' | 'path'>, Array<ContextMenuItem>> = {
    open: [],
    'transfer-share-export': [],
    path: [],
  };
  const hasPath = !!target.path;
  const projectPath = isProjectPathTarget(target.kind);
  const available = target.available;
  const canUseDesktop = platform === 'desktop' && hasPath && available;

  addItem(itemsByGroup.open, target.previewAvailable === false
    ? null
    : {action: 'preview', icon: 'eye', label: 'Preview'});
  addItem(itemsByGroup.open, canUseDesktop && capabilities.canOpenInVSCode
    ? {action: 'vscode', icon: 'code', label: 'Open in VS Code'}
    : null);
  addItem(itemsByGroup.open, canUseDesktop && capabilities.canShowInExplorer
    ? {action: 'folder', icon: 'folderOpen', label: 'Show in Explorer'}
    : null);

  addItem(itemsByGroup['transfer-share-export'], available && target.downloadAvailable
    ? {action: 'download', icon: 'arrowDown', label: 'Download'}
    : null);
  addItem(itemsByGroup['transfer-share-export'], canUseDesktop && capabilities.canCopyFile && canCopyFileTarget(target.kind)
    ? {action: 'copy-file', icon: 'copy', label: 'Copy file'}
    : null);
  const shareable = available && !!target.path && (
    (projectPath && !!shareKindForPath(target.path))
    || (target.kind === 'external-file' && !!shareKindForExternalPath(target.path))
  );
  addItem(itemsByGroup['transfer-share-export'], shareable
    ? {action: 'share', icon: 'share', label: 'Share MD/HTML'}
    : null);
  addItem(itemsByGroup['transfer-share-export'], (projectPath || target.kind === 'external-file') && available && isMarkdownPath(target.path)
    ? {action: 'export-html', icon: 'fileCode', label: 'Export as HTML'}
    : null);

  addItem(itemsByGroup.path, projectPath && hasPath
    ? {action: 'copy-relative', icon: 'fileSymlink', label: 'Copy relative path'}
    : null);
  addItem(itemsByGroup.path, hasPath
    ? {action: 'copy-absolute', icon: 'clipboard', label: 'Copy absolute path'}
    : null);

  return {
    groups: (Object.entries(itemsByGroup) as Array<[ContextMenuGroup['id'], Array<ContextMenuItem>]> )
      .filter(([, items]) => items.length > 0)
      .map(([id, items]) => ({id, items})),
  };
}

function buildPreviewTabModel(
  options: Extract<ContextMenuOptions, {surface: 'preview-tab'}>,
): ContextMenuModel {
  const {target, platform, capabilities = {}} = options;
  const groups: ContextMenuModel['groups'] = [];
  const open: Array<ContextMenuItem> = [];
  const transfer: Array<ContextMenuItem> = [];
  const path: Array<ContextMenuItem> = [];
  const tab: Array<ContextMenuItem> = [];
  const available = target.available !== false;
  const hasPath = !!target.path;
  const projectFile = target.kind === 'preview-file';
  const fileTarget = projectFile || target.kind === 'preview-external-file';
  const canUseDesktop = platform === 'desktop' && hasPath && available;

  addItem(open, canUseDesktop && capabilities.canOpenInVSCode
    ? {action: 'vscode', icon: 'code', label: 'Open in VS Code'}
    : null);
  addItem(open, canUseDesktop && capabilities.canShowInExplorer
    ? {action: 'folder', icon: 'folderOpen', label: 'Show in Explorer'}
    : null);

  addItem(transfer, available && target.downloadAvailable
    ? {action: 'download', icon: 'arrowDown', label: 'Download'}
    : null);
  addItem(transfer, canUseDesktop && capabilities.canCopyFile && fileTarget
    ? {action: 'copy-file', icon: 'copy', label: 'Copy file'}
    : null);
  const shareable = available && !!target.path && (
    (projectFile && !!shareKindForPath(target.path))
    || (target.kind === 'preview-external-file' && !!shareKindForExternalPath(target.path))
  );
  addItem(transfer, shareable
    ? {action: 'share', icon: 'share', label: 'Share MD/HTML'}
    : null);
  addItem(transfer, (projectFile || target.kind === 'preview-external-file') && available && isMarkdownPath(target.path)
    ? {action: 'export-html', icon: 'fileCode', label: 'Export as HTML'}
    : null);

  addItem(path, projectFile && hasPath
    ? {action: 'copy-relative', icon: 'fileSymlink', label: 'Copy relative path'}
    : null);
  addItem(path, hasPath
    ? {action: 'copy-absolute', icon: 'clipboard', label: 'Copy absolute path'}
    : null);

  addItem(tab, target.kind === 'preview-file' && target.refreshAvailable
    ? {
        action: 'refresh',
        icon: 'refreshCw',
        label: target.refreshDisabled ? 'Refreshing...' : 'Refresh',
        disabled: target.refreshDisabled,
        busy: target.refreshDisabled,
      }
    : null);
  addItem(tab, target.kind === 'relay'
    ? {action: 'open-relay', icon: 'externalLink', label: 'Open relay page in browser'}
    : null);

  for (const [id, items] of [
    ['open', open],
    ['transfer-share-export', transfer],
    ['path', path],
    ['tab', tab],
  ] as Array<[ContextMenuGroupId, Array<ContextMenuItem>]>) {
    if (items.length > 0) groups.push({id, items});
  }
  return {groups};
}

export function buildContextMenuModel(options: ContextMenuOptions): ContextMenuModel {
  if (options.surface === 'selection') {
    return {
      groups: [{
        id: 'selection',
        items: [{action: 'copy-selection', icon: 'copy', label: 'Copy'}],
      }],
    };
  }
  if (options.surface === 'file') {
    return buildFileModel(options);
  }
  return buildPreviewTabModel(options);
}
