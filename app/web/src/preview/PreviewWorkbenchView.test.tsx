/**
 * @jest-environment jsdom
 */
import React from 'react';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {PreviewWorkbenchView} from './PreviewWorkbenchView';
import type {PreviewWorkbenchTab} from './previewWorkbenchState';

(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as unknown as {ResizeObserver: typeof MockResizeObserver}).ResizeObserver = MockResizeObserver;

const tab: PreviewWorkbenchTab = {
  id: 'file:src/a.ts',
  type: 'file',
  projectId: 'p1',
  title: 'a.ts',
  loading: false,
  error: '',
  requestId: 0,
  path: 'src/a.ts',
  targetLine: null,
  content: 'const answer = 42;',
  info: null,
};

describe('PreviewWorkbenchView', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test('renders shared Chrome and forwards tab selection and drawer intents', () => {
    const onTabSelect = jest.fn();
    const onDrawerModeChange = jest.fn();
    act(() => {
      root.render(
        <PreviewWorkbenchView
          mode="desktop"
          activeTab={tab}
          tabs={[tab]}
          drawerMode="closed"
          drawerPinned={false}
          fileDrawer={<div data-testid="files">Files</div>}
          gitDrawer={<div data-testid="git">Git</div>}
          actionsMenuOpen={false}
          onClose={jest.fn()}
          onTabSelect={onTabSelect}
          onTabClose={jest.fn()}
          onDrawerModeChange={onDrawerModeChange}
          onActionsMenuToggle={jest.fn()}
          onActionsMenuClose={jest.fn()}
          onFloat={jest.fn()}
          onDock={jest.fn()}
        >
          <div data-testid="body">Preview body</div>
        </PreviewWorkbenchView>,
      );
    });

    act(() => (container.querySelector('[role="tab"]') as HTMLButtonElement).click());
    expect(onTabSelect).toHaveBeenCalledWith('p1', 'file:src/a.ts');
    expect(container.querySelector('[data-testid="body"]')?.textContent).toBe('Preview body');
  });
});
