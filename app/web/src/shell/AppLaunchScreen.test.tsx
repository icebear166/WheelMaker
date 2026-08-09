import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {
  AppLaunchScreen,
  appLaunchStatus,
  resolveAppLaunchSurface,
} from './AppLaunchScreen';

describe('resolveAppLaunchSurface', () => {
  test('shows the launch screen while checking or logging in', () => {
    expect(resolveAppLaunchSurface('checking', false)).toBe('launch');
    expect(resolveAppLaunchSurface('logging-in', false)).toBe('launch');
  });

  test('keeps authenticated sessions on the launch screen until connected', () => {
    expect(resolveAppLaunchSurface('authenticated', false)).toBe('launch');
  });

  test('falls back to the manual connect surface after a connect failure', () => {
    expect(resolveAppLaunchSurface('authenticated', true)).toBe('connect-retry');
  });

  test('only shows the login form when genuinely unauthenticated', () => {
    expect(resolveAppLaunchSurface('unauthenticated', false)).toBe('login');
    expect(resolveAppLaunchSurface('error', false)).toBe('login');
  });
});

describe('appLaunchStatus', () => {
  test('maps auth states to launch screen status text', () => {
    expect(appLaunchStatus('checking')).toBe('Checking login…');
    expect(appLaunchStatus('logging-in')).toBe('Logging in…');
    expect(appLaunchStatus('authenticated')).toBe('Connecting…');
  });
});

describe('AppLaunchScreen', () => {
  function render(showIntro: boolean): TestRenderer.ReactTestRenderer {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <AppLaunchScreen status="Connecting…" showIntro={showIntro} />,
      );
    });
    return renderer;
  }

  test('renders the status text and all three logo pieces', () => {
    const renderer = render(true);
    const screen = renderer.root.findByProps({role: 'status'});
    expect(screen.findByProps({className: 'app-launch-status'}).children.join('')).toBe('Connecting…');
    expect(screen.findByProps({className: 'app-launch-piece app-launch-piece-left'})).toBeTruthy();
    expect(screen.findByProps({className: 'app-launch-piece app-launch-piece-right'})).toBeTruthy();
    expect(screen.findByProps({className: 'app-launch-piece app-launch-piece-slash'})).toBeTruthy();
    expect(screen.findByProps({className: 'app-launch-shine'})).toBeTruthy();
  });

  test('runs the piece fly-in intro only when showIntro is set', () => {
    expect(
      render(true).root.findByProps({role: 'status'}).props.className,
    ).toContain('app-launch-intro');
    expect(
      render(false).root.findByProps({role: 'status'}).props.className,
    ).not.toContain('app-launch-intro');
  });
});
