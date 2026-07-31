import fs from 'fs';
import path from 'path';
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

const componentPath = path.join(
  __dirname,
  '..',
  'web',
  'src',
  'shell',
  'workbench',
  'WorkbenchChrome.tsx',
);

function loadWorkbenchChrome() {
  expect(fs.existsSync(componentPath)).toBe(true);
  return require(componentPath).WorkbenchChrome as React.ComponentType<any>;
}

function renderChrome(fullscreen = false) {
  const WorkbenchChrome = loadWorkbenchChrome();
  const onClose = jest.fn();
  const onFullscreenChange = jest.fn();
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(
      <WorkbenchChrome
        mode="mobile"
        surfaceClassName="test-workbench"
        ariaLabel="Test workbench"
        title="Active item"
        titleTooltip="Hub A · /repo"
        closeLabel="Back to Chat"
        onClose={onClose}
        actions={<button type="button">Action</button>}
        tabsAriaLabel="Open test tabs"
        tabs={<button type="button" role="tab">Tab A</button>}
        mobileFullscreen={fullscreen}
        onMobileFullscreenChange={onFullscreenChange}
        bodyClassName="test-workbench-body"
        footer={<div className="test-footer">Footer</div>}
      >
        <div>Body</div>
      </WorkbenchChrome>,
    );
  });
  return {tree: tree!, onClose, onFullscreenChange};
}

describe('WorkbenchChrome', () => {
  test('renders the shared two-row mobile chrome and footer', () => {
    const {tree} = renderChrome();

    expect(tree.root.findByProps({className: 'workbench-chrome-toolbar'})).toBeTruthy();
    expect(tree.root.findByProps({role: 'tablist'}).props['aria-label']).toBe('Open test tabs');
    expect(tree.root.findByProps({className: 'workbench-chrome-title'}).children).toEqual(['Active item']);
    expect(tree.root.findByProps({className: 'test-footer'})).toBeTruthy();
  });

  test('uses the platform close action and exposes its accessible label', () => {
    const {tree, onClose} = renderChrome();
    const close = tree.root.findByProps({'aria-label': 'Back to Chat'});

    expect(close.findByProps({'data-icon-name': 'arrowLeft'})).toBeTruthy();
    act(() => close.props.onClick());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('requests controlled fullscreen without hiding the footer', () => {
    const {tree, onFullscreenChange} = renderChrome(true);
    const frame = tree.root.findByProps({'data-mobile-fullscreen': true});
    const toggle = frame.findByProps({'aria-label': 'Exit workbench fullscreen'});

    expect(frame.findByProps({className: 'test-footer'})).toBeTruthy();
    expect(toggle.props['aria-pressed']).toBe(true);
    act(() => toggle.props.onClick());
    expect(onFullscreenChange).toHaveBeenCalledWith(false);
  });
});
