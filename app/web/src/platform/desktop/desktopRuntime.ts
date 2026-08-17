export type DesktopUpdateInfo = {
  version?: string;
  sha256: string;
  updaterReady: boolean;
};

export type DesktopWindowBridge = {
  enabled: true;
  getDeviceName?: () => Promise<string> | string;
  startDrag?: () => Promise<void> | void;
  minimize?: () => Promise<void> | void;
  toggleMaximize?: () => Promise<void> | void;
  close?: () => Promise<void> | void;
  requestLocalDevMode?: (sourcePath: string) => Promise<void> | void;
  localDev?: DesktopLocalDevBridge;
  openFileInVSCode?: (absolutePath: string) => Promise<void> | void;
  showFileInFolder?: (absolutePath: string) => Promise<void> | void;
  copyFileToClipboard?: (absolutePath: string) => Promise<void> | void;
  openProjectFileInVSCode?: (projectRoot: string, relativePath: string) => Promise<void> | void;
  showProjectFileInFolder?: (projectRoot: string, relativePath: string) => Promise<void> | void;
  beginHtmlFileClipboard?: (fileName: string, size: number) => Promise<string> | string;
  appendHtmlFileClipboard?: (transferId: string, index: number, data: string) => Promise<string> | string;
  commitHtmlFileClipboard?: (transferId: string) => Promise<string> | string;
  cancelHtmlFileClipboard?: (transferId: string) => Promise<string> | string;
  getDesktopUpdateInfo?: () => Promise<DesktopUpdateInfo>;
  requestDesktopUpdate?: () => Promise<void>;
  showNotification?: (rawJson: string) => Promise<string> | string;
  openPreviewWindow?: () => Promise<void> | void;
  focusPreviewWindow?: () => Promise<void> | void;
  dockPreviewWindow?: () => Promise<void> | void;
};

export type DesktopLocalDevOperation = 'build' | 'start' | 'stop' | 'restart' | 'open-directory' | 'exit';

export type DesktopLocalDevState = {
  sourcePath: string;
  running: boolean;
  message?: string;
};

export type DesktopLocalDevBridge = {
  getState: () => Promise<DesktopLocalDevState>;
  saveSource: (sourcePath: string) => Promise<DesktopLocalDevState>;
  run: (operation: DesktopLocalDevOperation) => Promise<DesktopLocalDevState>;
};

export const openLocalDevPanelEvent = 'wheelmaker:open-local-dev';

export type DesktopProjectFileAction = 'vscode' | 'folder';

export type DesktopFileActionTarget = {
  absolutePath: string;
  projectRoot: string;
  relativePath: string | null;
};

declare global {
  interface Window {
    WheelMakerDesktop?: DesktopWindowBridge;
  }
}

export function getDesktopWindowBridge(): DesktopWindowBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const bridge = window.WheelMakerDesktop;
  return bridge?.enabled === true ? bridge : null;
}

export async function invokeDesktopProjectFileAction(
  bridge: DesktopWindowBridge,
  action: DesktopProjectFileAction,
  projectRoot: string,
  relativePath: string,
): Promise<void> {
  const method =
    action === 'vscode' ? bridge.openProjectFileInVSCode : bridge.showProjectFileInFolder;
  if (!method) {
    throw new Error('Desktop file action is unavailable.');
  }
  await method(projectRoot, relativePath);
}

export function canInvokeDesktopFileAction(
  bridge: DesktopWindowBridge | null,
  action: DesktopProjectFileAction,
  target: DesktopFileActionTarget,
): boolean {
  if (!bridge) return false;
  const absoluteMethod =
    action === 'vscode' ? bridge.openFileInVSCode : bridge.showFileInFolder;
  if (absoluteMethod && target.absolutePath) return true;
  const projectMethod =
    action === 'vscode' ? bridge.openProjectFileInVSCode : bridge.showProjectFileInFolder;
  return Boolean(
    projectMethod
    && target.projectRoot
    && target.relativePath,
  );
}

export async function invokeDesktopFileAction(
  bridge: DesktopWindowBridge,
  action: DesktopProjectFileAction,
  target: DesktopFileActionTarget,
): Promise<void> {
  const absoluteMethod =
    action === 'vscode' ? bridge.openFileInVSCode : bridge.showFileInFolder;
  if (absoluteMethod && target.absolutePath) {
    await absoluteMethod(target.absolutePath);
    return;
  }

  const projectMethod =
    action === 'vscode' ? bridge.openProjectFileInVSCode : bridge.showProjectFileInFolder;
  if (projectMethod && target.projectRoot && target.relativePath) {
    await projectMethod(target.projectRoot, target.relativePath);
    return;
  }
  throw new Error('Desktop file action is unavailable.');
}

export function canCopyDesktopFile(
  bridge: DesktopWindowBridge | null,
  absolutePath: string,
): boolean {
  return Boolean(bridge?.copyFileToClipboard && absolutePath);
}

export async function copyDesktopFile(
  bridge: DesktopWindowBridge,
  absolutePath: string,
): Promise<void> {
  if (!bridge.copyFileToClipboard || !absolutePath) {
    throw new Error('Desktop file clipboard is unavailable.');
  }
  await bridge.copyFileToClipboard(absolutePath);
}
