import * as desktopRuntime from '../web/src/platform/desktop/desktopRuntime';

type DesktopProjectFileAction = 'vscode' | 'folder';

type TestDesktopBridge = {
  enabled: true;
  openFileInVSCode?: (absolutePath: string) => Promise<void> | void;
  showFileInFolder?: (absolutePath: string) => Promise<void> | void;
  openProjectFileInVSCode?: (projectRoot: string, relativePath: string) => Promise<void> | void;
  showProjectFileInFolder?: (projectRoot: string, relativePath: string) => Promise<void> | void;
};

type DesktopProjectFileActionInvoker = (
  bridge: TestDesktopBridge,
  action: DesktopProjectFileAction,
  projectRoot: string,
  relativePath: string,
) => Promise<void>;

type DesktopFileActionTarget = {
  absolutePath: string;
  projectRoot: string;
  relativePath: string | null;
};

type DesktopFileActionInvoker = (
  bridge: TestDesktopBridge,
  action: DesktopProjectFileAction,
  target: DesktopFileActionTarget,
) => Promise<void>;

const runtime = desktopRuntime as unknown as {
  invokeDesktopProjectFileAction?: DesktopProjectFileActionInvoker;
  invokeDesktopFileAction?: DesktopFileActionInvoker;
  canInvokeDesktopFileAction?: (
    bridge: TestDesktopBridge | null,
    action: DesktopProjectFileAction,
    target: DesktopFileActionTarget,
  ) => boolean;
};

function getInvoker(): DesktopProjectFileActionInvoker {
  const invoke = runtime.invokeDesktopProjectFileAction;
  if (!invoke) {
    throw new Error('invokeDesktopProjectFileAction export is missing');
  }
  return invoke;
}

describe('desktop project file actions', () => {
  test('exports the project file action helper', () => {
    expect(runtime.invokeDesktopProjectFileAction).toEqual(expect.any(Function));
  });

  test('forwards the exact project root and relative path to VS Code', async () => {
    const calls: Array<[string, string]> = [];
    let folderCalls = 0;
    const bridge: TestDesktopBridge = {
      enabled: true,
      openProjectFileInVSCode: (projectRoot, relativePath) => {
        calls.push([projectRoot, relativePath]);
      },
      showProjectFileInFolder: () => {
        folderCalls += 1;
      },
    };

    await getInvoker()(bridge, 'vscode', 'F:\\Wheel Maker\\repo', 'src/../src/file name.ts');

    expect(calls).toEqual([['F:\\Wheel Maker\\repo', 'src/../src/file name.ts']]);
    expect(folderCalls).toBe(0);
  });

  test('waits for the native VS Code action to settle', async () => {
    let releaseNativeAction: (() => void) | undefined;
    const nativeAction = new Promise<void>(resolve => {
      releaseNativeAction = resolve;
    });
    const bridge: TestDesktopBridge = {
      enabled: true,
      openProjectFileInVSCode: () => nativeAction,
      showProjectFileInFolder: () => undefined,
    };
    let helperSettled = false;

    const helperAction = getInvoker()(bridge, 'vscode', 'F:\\repo', 'src/file.ts').then(() => {
      helperSettled = true;
    });
    await Promise.resolve();

    expect(helperSettled).toBe(false);
    releaseNativeAction?.();
    await helperAction;
    expect(helperSettled).toBe(true);
  });

  test('routes folder actions to the matching method with exact arguments', async () => {
    let vscodeCalls = 0;
    const calls: Array<[string, string]> = [];
    const bridge: TestDesktopBridge = {
      enabled: true,
      openProjectFileInVSCode: () => {
        vscodeCalls += 1;
      },
      showProjectFileInFolder: (projectRoot, relativePath) => {
        calls.push([projectRoot, relativePath]);
      },
    };

    await getInvoker()(bridge, 'folder', 'F:\\Wheel Maker\\repo', 'src/../src/file name.ts');

    expect(calls).toEqual([['F:\\Wheel Maker\\repo', 'src/../src/file name.ts']]);
    expect(vscodeCalls).toBe(0);
  });

  test('rejects when the requested VS Code action is unavailable', async () => {
    const bridge: TestDesktopBridge = {
      enabled: true,
      showProjectFileInFolder: () => undefined,
    };

    await expect(getInvoker()(bridge, 'vscode', 'F:\\repo', 'src/file.ts')).rejects.toEqual(
      new Error('Desktop file action is unavailable.'),
    );
  });

  test('rejects when the requested folder action is unavailable', async () => {
    const bridge: TestDesktopBridge = {
      enabled: true,
      openProjectFileInVSCode: () => undefined,
    };

    await expect(getInvoker()(bridge, 'folder', 'F:\\repo', 'src/file.ts')).rejects.toEqual(
      new Error('Desktop file action is unavailable.'),
    );
  });
});

describe('desktop absolute file actions', () => {
  const externalTarget: DesktopFileActionTarget = {
    absolutePath: 'D:/outside/file.ts',
    projectRoot: '',
    relativePath: null,
  };
  const internalTarget: DesktopFileActionTarget = {
    absolutePath: 'D:/repo/src/file.ts',
    projectRoot: 'D:/repo',
    relativePath: 'src/file.ts',
  };

  test('prefers the absolute VS Code binding', async () => {
    const openFileInVSCode = jest.fn();
    const openProjectFileInVSCode = jest.fn();
    const bridge: TestDesktopBridge = {
      enabled: true,
      openFileInVSCode,
      openProjectFileInVSCode,
    };

    await runtime.invokeDesktopFileAction!(bridge, 'vscode', externalTarget);

    expect(openFileInVSCode).toHaveBeenCalledWith('D:/outside/file.ts');
    expect(openProjectFileInVSCode).not.toHaveBeenCalled();
  });

  test('falls back to the old project binding only for internal files', async () => {
    const openProjectFileInVSCode = jest.fn();
    const bridge: TestDesktopBridge = {
      enabled: true,
      openProjectFileInVSCode,
    };

    await runtime.invokeDesktopFileAction!(bridge, 'vscode', internalTarget);
    expect(openProjectFileInVSCode).toHaveBeenCalledWith('D:/repo', 'src/file.ts');

    await expect(
      runtime.invokeDesktopFileAction!(bridge, 'vscode', externalTarget),
    ).rejects.toEqual(new Error('Desktop file action is unavailable.'));
  });

  test('reports capabilities from absolute and compatible legacy bindings', () => {
    expect(runtime.canInvokeDesktopFileAction!(
      {enabled: true, showFileInFolder: () => undefined},
      'folder',
      externalTarget,
    )).toBe(true);
    expect(runtime.canInvokeDesktopFileAction!(
      {enabled: true, showProjectFileInFolder: () => undefined},
      'folder',
      internalTarget,
    )).toBe(true);
    expect(runtime.canInvokeDesktopFileAction!(
      {enabled: true, showProjectFileInFolder: () => undefined},
      'folder',
      externalTarget,
    )).toBe(false);
  });
});
