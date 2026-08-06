/**
 * @jest-environment jsdom
 */
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

import {PreviewWorkbenchChrome} from './PreviewWorkbenchChrome';
import type {PreviewWorkbenchTab} from './previewWorkbenchState';

(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const fileTab: PreviewWorkbenchTab = {
  id: 'file:src/a.ts',
  type: 'file',
  projectId: 'p1',
  title: 'a.ts',
  loading: false,
  error: '',
  requestId: 0,
  path: 'src/a.ts',
  targetLine: null,
  content: '',
  info: null,
};

const secondTab: PreviewWorkbenchTab = {
  ...fileTab,
  id: 'file:src/b.ts',
  title: 'b.ts',
  path: 'src/b.ts',
};

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  private callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function createProps(overrides: Partial<React.ComponentProps<typeof PreviewWorkbenchChrome>> = {}) {
  return {
    mode: 'desktop' as const,
    activeTab: null,
    tabs: [],
    drawerMode: 'closed' as const,
    fileDrawer: <div data-testid="file-drawer">files</div>,
    fileDrawerSearch: <input aria-label="Search files" />,
    gitDrawer: <div data-testid="git-drawer">git</div>,
    onDrawerModeChange: jest.fn(),
    actionsMenuOpen: false,
    onClose: jest.fn(),
    onTabSelect: jest.fn(),
    onTabClose: jest.fn(),
    onActionsMenuToggle: jest.fn(),
    onActionsMenuClose: jest.fn(),
    children: <div data-testid="preview-body">body</div>,
    ...overrides,
  };
}

describe('PreviewWorkbenchChrome drawer', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    MockResizeObserver.instances = [];
    (globalThis as unknown as {ResizeObserver: typeof MockResizeObserver}).ResizeObserver = MockResizeObserver;
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
    }
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = '';
  });

  const render = (props: ReturnType<typeof createProps>) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<PreviewWorkbenchChrome {...props} />));
  };

  const pointerDown = (target: Element) => {
    act(() => {
      target.dispatchEvent(new window.MouseEvent('pointerdown', {bubbles: true, cancelable: true}));
    });
  };

  const escape = () => {
    act(() => {
      document.body.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
    });
  };

  const overflowTabsBar = () => {
    const bar = document.querySelector('.workbench-chrome-tabs') as HTMLElement;
    expect(bar).toBeTruthy();
    Object.defineProperty(bar, 'scrollWidth', {configurable: true, value: 800});
    Object.defineProperty(bar, 'clientWidth', {configurable: true, value: 300});
    act(() => {
      MockResizeObserver.instances.forEach(instance => instance.trigger());
    });
  };

  test('shows the overflow button only when the tabs bar overflows', () => {
    render(createProps({tabs: [fileTab, secondTab], activeTab: fileTab}));
    expect(document.querySelector('[aria-label="Show all open tabs"]')).toBeNull();

    overflowTabsBar();

    expect(document.querySelector('[aria-label="Show all open tabs"]')).toBeTruthy();
  });

  test('overflow list selects a tab and closes; row close keeps the list open', () => {
    const props = createProps({tabs: [fileTab, secondTab], activeTab: fileTab});
    render(props);
    overflowTabsBar();

    act(() => (document.querySelector('[aria-label="Show all open tabs"]') as HTMLButtonElement).click());
    expect(document.querySelectorAll('.preview-workbench-tabs-overflow-row').length).toBe(2);

    const openButtons = document.querySelectorAll('.preview-workbench-tabs-overflow-open');
    act(() => (openButtons[1] as HTMLButtonElement).click());
    expect(props.onTabSelect).toHaveBeenCalledWith('file:src/b.ts');
    expect(document.querySelector('.preview-workbench-tabs-overflow-list')).toBeNull();

    act(() => (document.querySelector('[aria-label="Show all open tabs"]') as HTMLButtonElement).click());
    const closeButtons = document.querySelectorAll('.preview-workbench-tabs-overflow-close');
    act(() => (closeButtons[1] as HTMLButtonElement).click());
    expect(props.onTabClose).toHaveBeenCalledWith('file:src/b.ts');
    expect(document.querySelector('.preview-workbench-tabs-overflow-list')).toBeTruthy();

    escape();
    expect(document.querySelector('.preview-workbench-tabs-overflow-list')).toBeNull();
  });

  test('tool buttons toggle files and git drawer modes', () => {
    const props = createProps();
    render(props);
    const filesButton = document.querySelector('[aria-label="Toggle files"]') as HTMLButtonElement;
    const gitButton = document.querySelector('[aria-label="Toggle Git history"]') as HTMLButtonElement;
    expect(filesButton.className).toContain('preview-workbench-drawer-tool');

    act(() => filesButton.click());
    expect(props.onDrawerModeChange).toHaveBeenLastCalledWith('files');
    act(() => gitButton.click());
    expect(props.onDrawerModeChange).toHaveBeenLastCalledWith('git');
  });

  test('clicking the active tool button closes the drawer', () => {
    const props = createProps({drawerMode: 'files'});
    render(props);
    const filesButton = document.querySelector('[aria-label="Toggle files"]') as HTMLButtonElement;
    act(() => filesButton.click());
    expect(props.onDrawerModeChange).toHaveBeenLastCalledWith('closed');
  });

  test('files drawer renders the search header inside the panel', () => {
    render(createProps({drawerMode: 'files'}));
    const panel = document.querySelector('.preview-workbench-drawer-panel') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.querySelector('.preview-workbench-drawer-search')).toBeTruthy();
    expect(panel.querySelector('[data-testid="file-drawer"]')).toBeTruthy();
  });

  test('git drawer renders without the search header', () => {
    render(createProps({drawerMode: 'git'}));
    const panel = document.querySelector('.preview-workbench-drawer-panel') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.querySelector('.preview-workbench-drawer-search')).toBeNull();
    expect(panel.querySelector('[data-testid="git-drawer"]')).toBeTruthy();
  });

  test('outside pointerdown closes the drawer; pointerdown inside panel or tools does not', () => {
    const props = createProps({drawerMode: 'files'});
    render(props);
    const panel = document.querySelector('.preview-workbench-drawer-panel') as HTMLElement;
    const tools = document.querySelector('.preview-workbench-body-tools') as HTMLElement;

    pointerDown(panel);
    pointerDown(tools);
    expect(props.onDrawerModeChange).not.toHaveBeenCalled();

    pointerDown(document.body);
    expect(props.onDrawerModeChange).toHaveBeenCalledWith('closed');
  });

  test('Escape closes the drawer', () => {
    const props = createProps({drawerMode: 'git'});
    render(props);
    escape();
    expect(props.onDrawerModeChange).toHaveBeenCalledWith('closed');
  });

  test('desktop right-click on a tab reports onTabContextMenu with id and position', () => {
    const props = createProps({tabs: [fileTab], activeTab: fileTab, onTabContextMenu: jest.fn()});
    render(props);
    const tab = document.querySelector('.preview-workbench-tab') as HTMLElement;
    expect(tab).toBeTruthy();

    const event = new window.MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 12,
    });
    act(() => {
      tab.dispatchEvent(event);
    });

    expect(props.onTabContextMenu).toHaveBeenCalledWith('file:src/a.ts', {x: 40, y: 12});
    expect(event.defaultPrevented).toBe(true);
  });

  test('mobile right-click on a tab does not report onTabContextMenu', () => {
    const props = createProps({mode: 'mobile', tabs: [fileTab], activeTab: fileTab, onTabContextMenu: jest.fn()});
    render(props);
    const tab = document.querySelector('.preview-workbench-tab') as HTMLElement;
    act(() => {
      tab.dispatchEvent(new window.MouseEvent('contextmenu', {bubbles: true, cancelable: true}));
    });
    expect(props.onTabContextMenu).not.toHaveBeenCalled();
  });

  test('desktop portals the panel into drawerPortalTarget with the external class', () => {
    const host = document.createElement('div');
    host.className = 'chat-preview-drawer-host';
    document.body.appendChild(host);
    render(createProps({drawerMode: 'files', drawerPortalTarget: host}));

    const external = host.querySelector('.preview-workbench-drawer-panel.external');
    expect(external).toBeTruthy();
    expect((external as HTMLElement).querySelector('[data-testid="file-drawer"]')).toBeTruthy();
    expect(container!.querySelector('.preview-workbench-drawer-panel')).toBeNull();
  });

  test('mobile keeps the drawer panel inline without the external class', () => {
    render(createProps({mode: 'mobile', drawerMode: 'files'}));
    const panel = container!.querySelector('.preview-workbench-drawer-panel');
    expect(panel).toBeTruthy();
    expect((panel as HTMLElement).className).not.toContain('external');
  });
});
