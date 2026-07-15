import * as desktopRuntime from '../web/src/platform/desktop/desktopRuntime';

type DesktopProjectFileAction = 'vscode' | 'folder';

type TestDesktopBridge = {
  enabled: true;
  openProjectFileInVSCode?: (projectRoot: string, relativePath: string) => Promise<void> | void;
  showProjectFileInFolder?: (projectRoot: string, relativePath: string) => Promise<void> | void;
};

type DesktopProjectFileActionInvoker = (
  bridge: TestDesktopBridge,
  action: DesktopProjectFileAction,
  projectRoot: string,
  relativePath: string,
) => Promise<void>;

const runtime = desktopRuntime as unknown as {
  invokeDesktopProjectFileAction?: DesktopProjectFileActionInvoker;
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
