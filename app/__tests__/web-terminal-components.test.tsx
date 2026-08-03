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
    clearSelection = jest.fn();
    hasSelection = jest.fn(() => false);
    getSelection = jest.fn(() => '');
    keyEventHandler?: (event: KeyboardEvent) => boolean;
    attachCustomKeyEventHandler = jest.fn((handler: (event: KeyboardEvent) => boolean) => {
      this.keyEventHandler = handler;
    });
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
    proposeDimensions = jest.fn(() => ({cols: 120, rows: 40}));
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

class MockVisualViewport {
  private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  addEventListener = jest.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  });
  removeEventListener = jest.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    this.listeners.get(type)?.delete(listener);
  });
  fire(type: string) {
    const event = new Event(type);
    this.listeners.get(type)?.forEach(listener => {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    });
  }
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

function interactiveTerminalHost() {
  const listeners = new Map<string, (event: any) => void>();
  return {
    host: {
      clientHeight: 300,
      addEventListener: jest.fn((type: string, listener: (event: any) => void) => listeners.set(type, listener)),
      removeEventListener: jest.fn((type: string) => listeners.delete(type)),
    },
    fire(type: string, event: any = {}) { listeners.get(type)?.(event); },
  };
}

describe('terminal components', () => {
  let visualViewport: MockVisualViewport;

  beforeEach(() => {
    mockTerminalInstances.length = 0;
    mockFitInstances.length = 0;
    MockResizeObserver.instances.length = 0;
    (globalThis as typeof globalThis & {ResizeObserver: typeof ResizeObserver}).ResizeObserver = MockResizeObserver as never;
    visualViewport = new MockVisualViewport();
    Object.defineProperty(window, 'visualViewport', {configurable: true, value: visualViewport});
  });

  test('opens xterm, sends bytes, resets snapshots, fits, and disposes', async () => {
    const ref = createRef<TerminalViewHandle>();
    const onInput = jest.fn();
    const onResize = jest.fn();
    const host = interactiveTerminalHost();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TerminalView ref={ref} active resizeEnabled cols={80} rows={24} onInput={onInput} onResize={onResize} />,
        {createNodeMock: () => host.host},
      );
    });
    const xterm = mockTerminalInstances[0];
    expect(xterm.open).toHaveBeenCalledTimes(1);
    expect(mockFitInstances[0].fit).not.toHaveBeenCalled();

    act(() => host.fire('focusin'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
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

  test('starts xterm with the light terminal palette in light mode', async () => {
    await act(async () => {
      TestRenderer.create(
        <TerminalView themeMode="light" active resizeEnabled cols={80} rows={24}
          onInput={jest.fn()} onResize={jest.fn()} />,
        {createNodeMock: terminalHost},
      );
    });

    expect(mockTerminalInstances[0].options).toMatchObject({
      theme: {
        background: '#ffffff',
        foreground: '#242424',
        cursor: '#242424',
      },
    });
  });

  test('updates the xterm palette when the app theme changes', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TerminalView themeMode="dark" active resizeEnabled cols={80} rows={24}
          onInput={jest.fn()} onResize={jest.fn()} />,
        {createNodeMock: terminalHost},
      );
    });
    const xterm = mockTerminalInstances[0];

    await act(async () => {
      renderer!.update(
        <TerminalView themeMode="light" active resizeEnabled cols={80} rows={24}
          onInput={jest.fn()} onResize={jest.fn()} />,
      );
    });

    expect(mockTerminalInstances).toHaveLength(1);
    expect(xterm.options).toMatchObject({
      theme: {
        background: '#ffffff',
        foreground: '#242424',
        cursor: '#242424',
      },
    });
  });

  test('lets the browser copy Ctrl+C when terminal text is selected', async () => {
    const onCopy = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TerminalView active resizeEnabled cols={80} rows={24} onInput={jest.fn()} onResize={jest.fn()}
          onCopy={onCopy} />,
        {createNodeMock: terminalHost},
      );
    });
    const xterm = mockTerminalInstances[0];
    const ctrlC = {type: 'keydown', key: 'c', ctrlKey: true, metaKey: false, altKey: false} as KeyboardEvent;
    const ctrlShiftC = {...ctrlC, shiftKey: true} as KeyboardEvent;
    const commandC = {...ctrlC, ctrlKey: false, metaKey: true} as KeyboardEvent;

    expect(xterm.attachCustomKeyEventHandler).toHaveBeenCalledTimes(1);
    xterm.hasSelection.mockReturnValue(true);
    expect(xterm.keyEventHandler?.(ctrlC)).toBe(false);
    expect(xterm.keyEventHandler?.(ctrlShiftC)).toBe(false);
    expect(xterm.keyEventHandler?.(commandC)).toBe(false);
    const surface = renderer!.root.findByProps({className: 'terminal-xterm-surface'});
    expect(surface.props.onCopy).toEqual(expect.any(Function));
    act(() => surface.props.onCopy());
    expect(onCopy).toHaveBeenCalledTimes(1);
    xterm.hasSelection.mockReturnValue(false);
    expect(xterm.keyEventHandler?.(ctrlC)).toBe(true);
    act(() => surface.props.onCopy());
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  test('lets the browser paste Ctrl+V and Command+V into the terminal', async () => {
    await act(async () => {
      TestRenderer.create(
        <TerminalView active resizeEnabled cols={80} rows={24} onInput={jest.fn()} onResize={jest.fn()} />,
        {createNodeMock: terminalHost},
      );
    });
    const xterm = mockTerminalInstances[0];
    const ctrlV = {
      type: 'keydown',
      key: 'v',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
    } as KeyboardEvent;
    const commandV = {...ctrlV, ctrlKey: false, metaKey: true} as KeyboardEvent;

    expect(xterm.keyEventHandler?.(ctrlV)).toBe(false);
    expect(xterm.keyEventHandler?.(commandV)).toBe(false);
  });

  test('shows Copy on right click when terminal text is selected', async () => {
    const writeText = jest.fn(() => Promise.resolve());
    const onCopy = jest.fn();
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {writeText},
    });
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TerminalView active resizeEnabled cols={80} rows={24} onInput={jest.fn()} onResize={jest.fn()}
          onCopy={onCopy} />,
        {createNodeMock: terminalHost},
      );
    });
    const xterm = mockTerminalInstances[0];
    xterm.hasSelection.mockReturnValue(true);
    xterm.getSelection.mockReturnValue('selected output');
    const preventDefault = jest.fn();
    const surface = renderer!.root.findByProps({className: 'terminal-xterm-surface'});

    act(() => surface.props.onContextMenu({clientX: 24, clientY: 36, preventDefault}));

    expect(preventDefault).toHaveBeenCalledTimes(1);
    const copy = renderer!.root.findByProps({role: 'menuitem'});
    expect(copy.findByProps({'data-icon-name': 'copy'})).toBeTruthy();
    await act(async () => copy.props.onClick());
    expect(writeText).toHaveBeenCalledWith('selected output');
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  test('does not report a successful right-click copy when clipboard writing fails', async () => {
    const writeError = new Error('clipboard unavailable');
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {writeText: jest.fn(() => Promise.reject(writeError))},
    });
    const onCopy = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TerminalView active resizeEnabled cols={80} rows={24} onInput={jest.fn()} onResize={jest.fn()}
          onCopy={onCopy} />,
        {createNodeMock: terminalHost},
      );
    });
    const xterm = mockTerminalInstances[0];
    xterm.hasSelection.mockReturnValue(true);
    xterm.getSelection.mockReturnValue('selected output');
    const surface = renderer!.root.findByProps({className: 'terminal-xterm-surface'});
    act(() => surface.props.onContextMenu({clientX: 24, clientY: 36, preventDefault: jest.fn()}));

    let copyError: unknown;
    await act(async () => {
      try {
        await renderer!.root.findByProps({role: 'menuitem'}).props.onClick();
      } catch (error) {
        copyError = error;
      }
    });

    expect(copyError).toBeUndefined();
    expect(onCopy).not.toHaveBeenCalled();
  });

  test('keeps the native terminal context menu when there is no selection', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TerminalView active resizeEnabled cols={80} rows={24} onInput={jest.fn()} onResize={jest.fn()} />,
        {createNodeMock: terminalHost},
      );
    });
    const preventDefault = jest.fn();
    const surface = renderer!.root.findByProps({className: 'terminal-xterm-surface'});

    act(() => surface.props.onContextMenu({clientX: 24, clientY: 36, preventDefault}));

    expect(preventDefault).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByProps({role: 'menuitem'})).toHaveLength(0);
  });

  test('fits an active terminal when its container resizes after focus moves to the splitter', async () => {
    const onResize = jest.fn();
    const host = interactiveTerminalHost();
    await act(async () => {
      TestRenderer.create(
        <TerminalView active resizeEnabled cols={80} rows={24} onInput={jest.fn()} onResize={onResize} />,
        {createNodeMock: () => host.host},
      );
    });
    const xterm = mockTerminalInstances[0];
    const fitAddon = mockFitInstances[0];

    act(() => host.fire('focusin'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    onResize.mockClear();
    fitAddon.fit.mockClear();
    fitAddon.proposeDimensions.mockReturnValue({cols: 92, rows: 18});
    fitAddon.fit.mockImplementation(() => {
      xterm.cols = 92;
      xterm.rows = 18;
    });

    act(() => {
      host.fire('focusout', {relatedTarget: null});
      MockResizeObserver.instances[0].fire();
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });

    expect(fitAddon.fit).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith(92, 18);
  });

  test('fits an active terminal when the mobile visual viewport changes', async () => {
    const onResize = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TerminalView active resizeEnabled cols={80} rows={40} onInput={jest.fn()} onResize={onResize} />,
        {createNodeMock: terminalHost},
      );
    });
    const xterm = mockTerminalInstances[0];
    const fitAddon = mockFitInstances[0];
    fitAddon.proposeDimensions.mockReturnValue({cols: 80, rows: 20});
    fitAddon.fit.mockImplementation(() => {
      xterm.cols = 80;
      xterm.rows = 20;
    });

    act(() => visualViewport.fire('resize'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });

    expect(fitAddon.fit).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith(80, 20);

    act(() => renderer!.unmount());
    expect(visualViewport.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(visualViewport.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  test('restores local rows when the keyboard closes before the shrink resize is acknowledged', async () => {
    const onResize = jest.fn();
    await act(async () => {
      TestRenderer.create(
        <TerminalView active resizeEnabled cols={80} rows={40} onInput={jest.fn()} onResize={onResize} />,
        {createNodeMock: terminalHost},
      );
    });
    const xterm = mockTerminalInstances[0];
    const fitAddon = mockFitInstances[0];
    let proposed = {cols: 80, rows: 20};
    xterm.cols = 80;
    xterm.rows = 40;
    fitAddon.proposeDimensions.mockImplementation(() => proposed);
    fitAddon.fit.mockImplementation(() => {
      xterm.cols = proposed.cols;
      xterm.rows = proposed.rows;
    });

    act(() => MockResizeObserver.instances[0].fire());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    proposed = {cols: 80, rows: 40};
    act(() => MockResizeObserver.instances[0].fire());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });

    expect(fitAddon.fit).toHaveBeenCalledTimes(2);
    expect(onResize.mock.calls).toEqual([[80, 20], [80, 40]]);
  });

  test('sends the restored viewport after a keyboard resize claim completes', async () => {
    const onResize = jest.fn();
    const onAutoResize = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TerminalView active resizeEnabled={false} cols={80} rows={40} onInput={jest.fn()}
          onResize={onResize} onAutoResize={onAutoResize} />,
        {createNodeMock: terminalHost},
      );
    });
    const xterm = mockTerminalInstances[0];
    const fitAddon = mockFitInstances[0];
    let proposed = {cols: 80, rows: 20};
    xterm.cols = 80;
    xterm.rows = 40;
    xterm.resize.mockImplementation((nextCols: number, nextRows: number) => {
      xterm.cols = nextCols;
      xterm.rows = nextRows;
    });
    fitAddon.proposeDimensions.mockImplementation(() => proposed);
    fitAddon.fit.mockImplementation(() => {
      xterm.cols = proposed.cols;
      xterm.rows = proposed.rows;
    });

    act(() => visualViewport.fire('resize'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(onAutoResize).toHaveBeenCalledWith(80, 20);

    proposed = {cols: 80, rows: 40};
    act(() => visualViewport.fire('resize'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    await act(async () => {
      renderer!.update(
        <TerminalView active resizeEnabled cols={80} rows={20} onInput={jest.fn()}
          onResize={onResize} onAutoResize={onAutoResize} />,
      );
    });

    expect(onResize).toHaveBeenCalledWith(80, 40);
    expect({cols: xterm.cols, rows: xterm.rows}).toEqual({cols: 80, rows: 40});
  });

  test('enables ConPTY compatibility for a Windows terminal', async () => {
    await act(async () => {
      TestRenderer.create(
        <TerminalView active resizeEnabled={false} cols={80} rows={24}
          shell="C:\\Program Files\\PowerShell\\7\\pwsh.exe" initialCwd="D:\\Code\\WheelMaker"
          onInput={jest.fn()} onResize={jest.fn()} />,
        {createNodeMock: terminalHost},
      );
    });

    expect(mockTerminalInstances[0].options).toMatchObject({windowsPty: {backend: 'conpty'}});
  });

  test('keeps the Hub dimensions when this page does not own resize', async () => {
    const host = interactiveTerminalHost();
    const onAutoResize = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TerminalView active resizeEnabled={false} cols={132} rows={44} onInput={jest.fn()} onResize={jest.fn()}
          onAutoResize={onAutoResize} />,
        {createNodeMock: () => host.host},
      );
    });
    expect(mockTerminalInstances[0].options).toMatchObject({cols: 132, rows: 44});
    expect(mockFitInstances[0].fit).not.toHaveBeenCalled();

    act(() => {
      host.fire('focusin');
      MockResizeObserver.instances[0].fire();
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });

    expect(mockFitInstances[0].proposeDimensions).toHaveBeenCalled();
    expect(mockFitInstances[0].fit).not.toHaveBeenCalled();
    expect(onAutoResize).toHaveBeenCalledWith(120, 40);

    await act(async () => {
      renderer!.update(
        <TerminalView active resizeEnabled cols={120} rows={40} onInput={jest.fn()} onResize={jest.fn()}
          onAutoResize={onAutoResize} />,
      );
    });
    expect(mockFitInstances[0].fit).toHaveBeenCalledTimes(1);
  });

  test('does not request resize ownership for the Hub size or a background terminal', async () => {
    const sameSizeHost = interactiveTerminalHost();
    const sameSizeAutoResize = jest.fn();
    mockFitInstances.length = 0;
    await act(async () => {
      TestRenderer.create(
        <TerminalView active resizeEnabled={false} cols={120} rows={40} onInput={jest.fn()} onResize={jest.fn()}
          onAutoResize={sameSizeAutoResize} />,
        {createNodeMock: () => sameSizeHost.host},
      );
    });
    act(() => sameSizeHost.fire('focusin'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(sameSizeAutoResize).not.toHaveBeenCalled();

    const backgroundHost = interactiveTerminalHost();
    const backgroundAutoResize = jest.fn();
    await act(async () => {
      TestRenderer.create(
        <TerminalView active={false} resizeEnabled={false} cols={80} rows={24} onInput={jest.fn()} onResize={jest.fn()}
          onAutoResize={backgroundAutoResize} />,
        {createNodeMock: () => backgroundHost.host},
      );
    });
    act(() => backgroundHost.fire('focusin'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(backgroundAutoResize).not.toHaveBeenCalled();
  });

  test('applies Hub dimensions when another page resizes an owned terminal', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TerminalView active resizeEnabled cols={80} rows={24} onInput={jest.fn()} onResize={jest.fn()} />,
        {createNodeMock: terminalHost},
      );
    });
    const xterm = mockTerminalInstances[0];
    xterm.resize.mockClear();

    await act(async () => {
      renderer!.update(
        <TerminalView active resizeEnabled cols={50} rows={30} onInput={jest.fn()} onResize={jest.fn()} />,
      );
    });

    expect(xterm.resize).toHaveBeenCalledWith(50, 30);
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

  test('uses the rendered xterm cell height when Hub rows exceed the local viewport', async () => {
    const listeners = new Map<string, (event: any) => void>();
    const host = {
      clientHeight: 300,
      querySelector: jest.fn(() => ({getBoundingClientRect: () => ({height: 600})})),
      addEventListener: jest.fn((type: string, listener: (event: any) => void) => listeners.set(type, listener)),
      removeEventListener: jest.fn(),
    };
    await act(async () => {
      TestRenderer.create(
        <TerminalView active resizeEnabled={false} cols={80} rows={30} onInput={jest.fn()} onResize={jest.fn()} />,
        {createNodeMock: () => host},
      );
    });

    act(() => {
      listeners.get('touchstart')?.({touches: [{clientX: 40, clientY: 100}]});
      listeners.get('touchmove')?.({
        touches: [{clientX: 41, clientY: 60}],
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      });
    });

    expect(mockTerminalInstances[0].scrollLines.mock.calls).toEqual([[2]]);
  });

  test('clears accidental text selection when a gesture becomes vertical scrolling', async () => {
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

    act(() => {
      listeners.get('touchstart')?.({touches: [{clientX: 40, clientY: 100}]});
      listeners.get('touchmove')?.({
        touches: [{clientX: 42, clientY: 70}],
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      });
    });

    expect(mockTerminalInstances[0].clearSelection).toHaveBeenCalledTimes(1);
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
    expect(root.findByProps({className: 'workbench-chrome-toolbar'})).toBeTruthy();
    expect(root.findByProps({className: 'workbench-chrome-title'}).children).toEqual(['p1']);
    expect(root.findByProps({className: 'workbench-chrome-title'}).props['data-tooltip']).toBe('hub-a · C:\\src\\p1');
    expect(root.findByProps({role: 'tablist'}).props['aria-label']).toBe('Terminals');
    expect(root.findAllByProps({className: 'terminal-tab-hub'})).toHaveLength(0);
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

  test('keeps New and Fit visible and usable in mobile chrome', () => {
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
    expect(fit.props['data-tooltip']).toBe('Fit terminal to this screen');
    expect(fit.findByProps({'data-icon-name': 'maximize'})).toBeTruthy();
    expect(fit.findByType('span').children).toEqual(['Fit']);
    expect(renderer!.root.findByProps({'aria-label': 'Create terminal'}).findByType('span').children).toEqual(['New']);
    act(() => fit.props.onClick());
    expect(onClaimResize).toHaveBeenCalledTimes(1);
  });

  test('uses separate tab controls and puts Restart in the stopped-terminal menu', () => {
    const onRequestClose = jest.fn();
    const onRestart = jest.fn();
    const stopped = terminal({status: 'exited'});
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <TerminalWorkbench
          mode="desktop"
          terminals={[stopped]}
          activeKey="hub-a:t1"
          unavailableHubIds={{}}
          onSelect={jest.fn()}
          onCreate={jest.fn()}
          onRequestClose={onRequestClose}
          onRestart={onRestart}
          onClaimResize={jest.fn()}
          onSendBytes={jest.fn()}
          onCloseSurface={jest.fn()}
        />,
      );
    });

    const close = renderer!.root.findByProps({'aria-label': 'Close terminal p1'});
    expect(close.type).toBe('button');
    act(() => close.props.onClick({stopPropagation: jest.fn()}));
    expect(onRequestClose).toHaveBeenCalledWith(stopped);

    const more = renderer!.root.findByProps({'aria-label': 'Terminal actions'});
    act(() => more.props.onClick());
    const restart = renderer!.root.findByProps({role: 'menuitem'});
    expect(restart.children).toContain('Restart');
    act(() => restart.props.onClick());
    expect(onRestart).toHaveBeenCalledWith(stopped);
  });

  test('keeps the mobile keybar while controlled fullscreen hides top chrome', () => {
    const onMobileFullscreenChange = jest.fn();
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
          onClaimResize={jest.fn()}
          onSendBytes={jest.fn()}
          onCloseSurface={jest.fn()}
          mobileFullscreen
          onMobileFullscreenChange={onMobileFullscreenChange}
        />,
      );
    });

    const frame = renderer!.root.findByProps({'data-mobile-fullscreen': true});
    expect(frame.findByProps({'aria-label': 'Terminal shortcuts'})).toBeTruthy();
    act(() => frame.findByProps({'aria-label': 'Exit workbench fullscreen'}).props.onClick());
    expect(onMobileFullscreenChange).toHaveBeenCalledWith(false);
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

    const back = renderer!.root.findByProps({'aria-label': 'Back to Chat'});
    expect(back.findByProps({'data-icon-name': 'arrowLeft'})).toBeTruthy();
    act(() => back.props.onClick());
    expect(onCloseSurface).toHaveBeenCalledTimes(1);
  });
});
