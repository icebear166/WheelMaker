import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {
  AppLaunchScreen,
  resolveAppLaunchView,
} from './AppLaunchScreen';

describe('resolveAppLaunchView', () => {
  test('checking shows only the status', () => {
    expect(resolveAppLaunchView('checking', false)).toEqual({
      content: 'status',
      status: 'Checking login…',
      formDisabled: false,
    });
  });

  test('authenticated sessions stay on the status until connected', () => {
    expect(resolveAppLaunchView('authenticated', false)).toEqual({
      content: 'status',
      status: 'Connecting…',
      formDisabled: false,
    });
  });

  test('logging-in keeps the disabled form with a connecting status below', () => {
    expect(resolveAppLaunchView('logging-in', false)).toEqual({
      content: 'login',
      status: 'Connecting…',
      formDisabled: true,
    });
  });

  test('unauthenticated and error states show the editable form', () => {
    expect(resolveAppLaunchView('unauthenticated', false).content).toBe('login');
    expect(resolveAppLaunchView('unauthenticated', false).formDisabled).toBe(false);
    expect(resolveAppLaunchView('error', false).content).toBe('login');
  });

  test('a failed auto-connect falls back to the manual connect surface', () => {
    expect(resolveAppLaunchView('authenticated', true)).toEqual({
      content: 'connect-retry',
      status: '',
      formDisabled: false,
    });
  });
});

describe('AppLaunchScreen', () => {
  function render(props: {status: string; exiting?: boolean}, children?: React.ReactNode) {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <AppLaunchScreen status={props.status} exiting={props.exiting}>
          {children}
        </AppLaunchScreen>,
      );
    });
    return renderer;
  }

  test('renders the status text and the sweeping logo', () => {
    const renderer = render({status: 'Connecting…'});
    const screen = renderer.root.findByProps({role: 'status'});
    expect(screen.findByProps({className: 'app-launch-status'}).children.join('')).toBe('Connecting…');
    expect(screen.findByProps({className: 'app-launch-shine'})).toBeTruthy();
    expect(screen.findByProps({className: 'app-launch-logo'})).toBeTruthy();
  });

  test('keeps the logo mounted while rendering the embedded form content', () => {
    const renderer = render({status: ''}, <div className="app-launch-form">form-body</div>);
    const screen = renderer.root.findByProps({role: 'status'});
    expect(screen.findByProps({className: 'app-launch-form'})).toBeTruthy();
    expect(screen.findByProps({className: 'app-launch-logo'})).toBeTruthy();
  });

  test('exiting applies the fade-out variant', () => {
    expect(
      render({status: '', exiting: true}).root.findByProps({role: 'status'}).props.className,
    ).toContain('exiting');
    expect(
      render({status: ''}).root.findByProps({role: 'status'}).props.className,
    ).not.toContain('exiting');
  });
});
