export type DesktopUpdateInfo = {
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
  openProjectFileInVSCode?: (projectRoot: string, relativePath: string) => Promise<void> | void;
  showProjectFileInFolder?: (projectRoot: string, relativePath: string) => Promise<void> | void;
  getDesktopUpdateInfo?: () => Promise<DesktopUpdateInfo>;
  requestDesktopUpdate?: () => Promise<void>;
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
