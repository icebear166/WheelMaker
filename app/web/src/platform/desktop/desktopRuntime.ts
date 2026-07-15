export type DesktopWindowBridge = {
  enabled: true;
  getDeviceName?: () => Promise<string> | string;
  startDrag?: () => Promise<void> | void;
  minimize?: () => Promise<void> | void;
  toggleMaximize?: () => Promise<void> | void;
  close?: () => Promise<void> | void;
  openProjectFileInVSCode?: (projectRoot: string, relativePath: string) => Promise<void> | void;
  showProjectFileInFolder?: (projectRoot: string, relativePath: string) => Promise<void> | void;
};

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
