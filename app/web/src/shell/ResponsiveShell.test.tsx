// @ts-nocheck
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {MobileShell} from './ResponsiveShell';

function renderMobileShell(overrides = {}) {
  let renderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <MobileShell
        themeMode="dark"
        floatingControlStack={null}
        floatingControlSide="right"
        mobileSettingsScreen={null}
        mobileOverlay={null}
        sidebar={<div>drawer content</div>}
        main={<div>chat content</div>}
        drawerOpen
        onCloseDrawer={jest.fn()}
        {...overrides}
      />,
    );
  });
  return renderer;
}

test('hides the mobile drawer while a standalone destination is open', () => {
  const renderer = renderMobileShell({mobileStandaloneSurfaceOpen: true});
  const drawer = renderer.root.findByType('aside');
  const overlay = renderer.root.findAll(
    node => node.props.className?.startsWith('drawer-overlay'),
  )[0];

  expect(drawer.props.className.trim()).toBe('drawer');
  expect(overlay.props.className.trim()).toBe('drawer-overlay');
});

test('keeps the mobile drawer visible on chat', () => {
  const renderer = renderMobileShell({mobileStandaloneSurfaceOpen: false});
  const drawer = renderer.root.findByType('aside');
  const overlay = renderer.root.findAll(
    node => node.props.className?.startsWith('drawer-overlay'),
  )[0];

  expect(drawer.props.className.trim()).toBe('drawer show');
  expect(overlay.props.className.trim()).toBe('drawer-overlay show');
});
