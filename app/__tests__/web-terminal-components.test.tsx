import React, {createRef} from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import type {RegistryTerminal} from '../web/src/registry/registryTypes';
import {TerminalView, type TerminalViewHandle} from '../web/src/terminal/TerminalView';
import {TerminalWorkbench} from '../web/src/terminal/TerminalWorkbench';

const mockTerminalInstances: any[] = [];
const mockFitInstances: any[] = [];

jest.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 100;
    rows = 30;
    loadAddon = jest.fn();
    open = jest.fn();
    reset = jest.fn();
    focus = jest.fn();
    dispose = jest.fn();
    resize = jest.fn();
    scrollLines = jest.fn();
    write = jest.fn((_data: Uint8Array, callback?: () => void) => callback?.());
    dataHandler?: (data: string) => void;
    binaryHandler?: (data: string) => void;
    options: unknown;
    constructor(options: unknown) { this.options = options; mockTerminalInstances.push(this); }
    onData(handler: (data: string) => void) { this.dataHandler = handler; return {dispose: jest.fn()}; }
    onBinary(handler: (data: string) => void) { this.binaryHandler = handler; return {dispose: jest.fn()}; }
  },
}));

jest.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = jest.fn();
    constructor() { mockFitInstances.push(this); }
  },
}));

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observe = jest.fn();
  disconnect = jest.fn();
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }
  fire() { this.callback([], this as unknown as ResizeObserver); }
}

function terminal(overrides: Partial<RegistryTerminal> = {}): RegistryTerminal {
  return {
    terminalId: 't1', runId: 'r1', hubId: 'hub-a', projectId: 'hub-a:p1', projectName: 'p1',
    initialCwd: 'C:\\src\\p1', shell: 'pwsh.exe', status: 'running', cols: 80, rows: 24,
    createdAt: '2026-07-12T00:00:00Z', ...overrides,
  };
}

function terminalHost() {
  return {
    clientHeight: 300,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
}

describe('terminal components', () => {
  beforeEach(() => {
    mockTerminalInstances.length = 0;
    mockFitInstances.length = 0;
    MockResizeObserver.instances.length = 0;
    (globalThis as typeof globalThis & {ResizeObserver: typeof ResizeObserver}).ResizeObserver = MockResizeObserver as never;
  });

  test('opens xterm, sends bytes, resets snapshots, fits, and disposes', async () => {
    const ref = createRef<TerminalViewHandle>();
    const onInput = jest.fn();
    const onResize = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TerminalView ref={ref} active resizeEnabled cols={80} rows={24} onInput={onInput} onResize={onResize} />,
        {createNodeMock: terminalHost},
      );
    });
    const xterm = mockTerminalInstances[0];
    expect(xterm.open).toHaveBeenCalledTimes(1);
    expect(mockFitInstances[0].fit).toHaveBeenCalled();

    act(() => xterm.dataHandler?.('界'));
    expect(Array.from(onInput.mock.calls[0][0] as Uint8Array)).toEqual(Array.from(new TextEncoder().encode('界')));
    act(() => xterm.binaryHandler?.('\x00\xff'));
    expect(Array.from(onInput.mock.calls[1][0] as Uint8Array)).toEqual([0, 255]);

    await act(async () => {
      await ref.current?.resetAndWrite(new Uint8Array([65, 66]));
    });
    expect(xterm.reset).toHaveBeenCalled();
    expect(xterm.write).toHaveBeenCalledWith(new Uint8Array([65, 66]), expect.any(Function));

    act(() => MockResizeObserver.instances[0].fire());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(onResize).toHaveBeenCalledWith(100, 30);

    act(() => renderer!.unmount());
    expect(xterm.dispose).toHaveBeenCalled();
    expect(MockResizeObserver.instances[0].disconnect).toHaveBeenCalled();
  });

  test('keeps the Hub dimensions when this page does not own resize', async () => {
    await act(async () => {
      TestRenderer.create(
        <TerminalView active resizeEnabled={false} cols={132} rows={44} onInput={jest.fn()} onResize={jest.fn()} />,
        {createNodeMock: terminalHost},
      );
    });
    expect(mockTerminalInstances[0].options).toMatchObject({cols: 132, rows: 44});
    expect(mockFitInstances[0].fit).not.toHaveBeenCalled();
  });

  test('scrolls terminal history from a one-finger vertical drag', async () => {
    const listeners = new Map<string, (event: any) => void>();
    const host = {
      clientHeight: 300,
      addEventListener: jest.fn((type: string, listener: (event: any) => void) => listeners.set(type, listener)),
      removeEventListener: jest.fn((type: string) => listeners.delete(type)),
    };
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TerminalView active resizeEnabled={false} cols={80} rows={30} onInput={jest.fn()} onResize={jest.fn()} />,
        {createNodeMock: () => host},
      );
    });
    const preventDefault = jest.fn();
    const stopPropagation = jest.fn();

    expect(listeners.get('touchstart')).toBeDefined();
    expect(listeners.get('touchmove')).toBeDefined();
    act(() => {
      listeners.get('touchstart')?.({touches: [{clientX: 40, clientY: 100}]});
      listeners.get('touchmove')?.({
        touches: [{clientX: 42, clientY: 70}],
        preventDefault,
        stopPropagation,
      });
      listeners.get('touchmove')?.({
        touches: [{clientX: 41, clientY: 100}],
        preventDefault,
        stopPropagation,
      });
    });

    expect(mockTerminalInstances[0].scrollLines.mock.calls).toEqual([[3], [-3]]);
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(stopPropagation).toHaveBeenCalledTimes(2);
    act(() => renderer!.unmount());
    expect(host.removeEventListener).toHaveBeenCalledWith('touchmove', expect.any(Function));
  });

  test('leaves horizontal and multi-touch gestures alone', async () => {
    const listeners = new Map<string, (event: any) => void>();
    const host = {
      clientHeight: 300,
      addEventListener: jest.fn((type: string, listener: (event: any) => void) => listeners.set(type, listener)),
      removeEventListener: jest.fn(),
    };
    await act(async () => {
      TestRenderer.create(
        <TerminalView active resizeEnabled={false} cols={80} rows={30} onInput={jest.fn()} onResize={jest.fn()} />,
        {createNodeMock: () => host},
      );
    });
    const preventDefault = jest.fn();

    expect(listeners.get('touchstart')).toBeDefined();
    expect(listeners.get('touchmove')).toBeDefined();
    act(() => {
      listeners.get('touchstart')?.({touches: [{clientX: 20, clientY: 100}]});
      listeners.get('touchmove')?.({
        touches: [{clientX: 60, clientY: 104}],
        preventDefault,
        stopPropagation: jest.fn(),
      });
      listeners.get('touchstart')?.({touches: [{clientX: 20, clientY: 100}, {clientX: 30, clientY: 100}]});
      listeners.get('touchmove')?.({
        touches: [{clientX: 20, clientY: 50}, {clientX: 30, clientY: 50}],
        preventDefault,
        stopPropagation: jest.fn(),
      });
    });

    expect(mockTerminalInstances[0].scrollLines).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  test('renders tabs and sends standard mobile key sequences with one-shot modifiers', () => {
    const onSendBytes = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <TerminalWorkbench
          mode="mobile"
          terminals={[terminal(), terminal({terminalId: 't2', status: 'exited', exitCode: 3})]}
          activeKey="hub-a:t1"
          unavailableHubIds={{}}
          onSelect={jest.fn()}
          onCreate={jest.fn()}
          onRequestClose={jest.fn()}
          onRestart={jest.fn()}
          onClaimResize={jest.fn()}
          onSendBytes={onSendBytes}
          onCloseSurface={jest.fn()}
        >
          <div>terminal</div>
        </TerminalWorkbench>,
      );
    });
    const root = renderer!.root;
    const press = (label: string) => root.findByProps({'aria-label': label}).props.onClick();
    act(() => press('Terminal Escape'));
    act(() => press('Terminal Enter'));
    act(() => press('Terminal Ctrl+C'));
    act(() => press('Terminal Ctrl modifier'));
    act(() => press('Terminal Arrow Up'));
    expect(onSendBytes.mock.calls.map(([bytes]) => Array.from(bytes as Uint8Array))).toEqual([
      [27], [13], [3], Array.from(new TextEncoder().encode('\x1b[1;5A')),
    ]);
  });

  test('keeps the Fit action visible and usable in mobile chrome', () => {
    const onClaimResize = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <TerminalWorkbench
          mode="mobile"
          terminals={[terminal()]}
          activeKey="hub-a:t1"
          unavailableHubIds={{}}
          onSelect={jest.fn()}
          onCreate={jest.fn()}
          onRequestClose={jest.fn()}
          onRestart={jest.fn()}
          onClaimResize={onClaimResize}
          onSendBytes={jest.fn()}
          onCloseSurface={jest.fn()}
        />,
      );
    });

    const fit = renderer!.root.findByProps({'aria-label': 'Fit terminal to this screen'});
    expect(fit.children).toEqual(['Fit']);
    act(() => fit.props.onClick());
    expect(onClaimResize).toHaveBeenCalledTimes(1);
  });

  test('mobile surface provides a way back to Chat without closing a terminal', () => {
    const onCloseSurface = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <TerminalWorkbench
          mode="mobile"
          terminals={[]}
          activeKey=""
          unavailableHubIds={{}}
          onSelect={jest.fn()}
          onCreate={jest.fn()}
          onRequestClose={jest.fn()}
          onRestart={jest.fn()}
          onClaimResize={jest.fn()}
          onSendBytes={jest.fn()}
          onCloseSurface={onCloseSurface}
        />,
      );
    });

    act(() => renderer!.root.findByProps({'aria-label': 'Back to Chat'}).props.onClick());
    expect(onCloseSurface).toHaveBeenCalledTimes(1);
  });
});
