import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {DeviceSessionsSettingsDetail} from '../web/src/settings/DeviceSessionsSettingsDetail';

describe('device session settings', () => {
  test('renders public device metadata and confirms revoke actions', async () => {
    const revoke = jest.fn().mockResolvedValue(undefined);
    const revokeAll = jest.fn().mockResolvedValue(undefined);
    const currentRevoked = jest.fn();
    const confirm = jest.fn().mockReturnValue(true);
    Object.defineProperty(window, 'confirm', {configurable: true, value: confirm});
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <DeviceSessionsSettingsDetail
          sessions={[{
            deviceId: 'device-1',
            deviceName: 'Chrome',
            basePath: '/',
            createdAt: '2026-07-01T00:00:00Z',
            lastSeenAt: '2026-07-13T00:00:00Z',
            expiresAt: '2027-01-01T00:00:00Z',
            current: true,
          }]}
          loading={false}
          error=""
          onRevoke={revoke}
          onRevokeAll={revokeAll}
          onCurrentRevoked={currentRevoked}
        />,
      );
    });
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('Chrome');
    expect(text).toContain('Created');
    expect(text).toContain('Last seen');
    expect(text).not.toMatch(/digest|cookie|csrf|token/i);

    const buttons = renderer.root.findAllByType('button');
    const revokeButton = buttons.find(button => button.props['aria-label'] === 'Revoke Chrome');
    const revokeAllButton = buttons.find(button => button.props['aria-label'] === 'Revoke all device sessions');
    expect(revokeButton).toBeDefined();
    expect(revokeAllButton).toBeDefined();
    await act(async () => { await revokeButton!.props.onClick(); });
    await act(async () => { await revokeAllButton!.props.onClick(); });
    expect(revoke).toHaveBeenCalledWith('device-1');
    expect(revokeAll).toHaveBeenCalled();
    expect(currentRevoked).toHaveBeenCalledTimes(2);
    delete (window as {confirm?: typeof confirm}).confirm;
  });

  test('renders an empty state with a refresh action', async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <DeviceSessionsSettingsDetail
          sessions={[]}
          loading={false}
          error=""
          onRevoke={jest.fn()}
          onRevokeAll={jest.fn()}
          onCurrentRevoked={jest.fn()}
          onRefresh={refresh}
        />,
      );
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('No device sessions');
    const refreshButton = renderer.root.findAllByType('button').find(
      button => button.props['aria-label'] === 'Refresh device sessions',
    );
    expect(refreshButton).toBeDefined();
    await act(async () => { await refreshButton!.props.onClick(); });
    expect(refresh).toHaveBeenCalled();
  });
});
