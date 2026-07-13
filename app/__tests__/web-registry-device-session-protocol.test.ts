import {RegistryMethods} from '../web/src/registry/registryMethods';
import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import type {RegistryDeviceSession} from '../web/src/registry/registryTypes';

describe('registry device session protocol', () => {
  test('uses the fixed security session method names', () => {
    expect(RegistryMethods.SecuritySessionList).toBe('security.session.list');
    expect(RegistryMethods.SecuritySessionRevoke).toBe('security.session.revoke');
    expect(RegistryMethods.SecuritySessionRevokeAll).toBe('security.session.revokeAll');
  });

  test('lists only public metadata and revokes by public device id', async () => {
    const request = jest.fn(async ({method}: {method: string}) => {
      if (method === RegistryMethods.SecuritySessionList) {
        return {
          payload: {
            sessions: [{
              deviceId: 'device-1',
              deviceName: 'Work Laptop',
              basePath: '/wheelmaker/',
              createdAt: '2026-07-13T12:00:00Z',
              lastSeenAt: '2026-07-13T12:01:00Z',
              expiresAt: '2027-01-09T12:01:00Z',
              current: true,
              token: 'must-not-escape',
              cookie: 'must-not-escape',
              digest: 'must-not-escape',
              csrf: 'must-not-escape',
              fingerprint: 'must-not-escape',
            }],
          },
        };
      }
      return {payload: {ok: true}};
    });
    const repository = new RegistryRepository({request} as never);

    const sessions: RegistryDeviceSession[] = await repository.listDeviceSessions();
    expect(sessions).toEqual([{
      deviceId: 'device-1',
      deviceName: 'Work Laptop',
      basePath: '/wheelmaker/',
      createdAt: '2026-07-13T12:00:00Z',
      lastSeenAt: '2026-07-13T12:01:00Z',
      expiresAt: '2027-01-09T12:01:00Z',
      current: true,
    }]);
    expect(JSON.stringify(sessions)).not.toMatch(/token|cookie|digest|csrf|fingerprint/i);

    await repository.revokeDeviceSession('device-1');
    await repository.revokeAllDeviceSessions();

    expect(request).toHaveBeenNthCalledWith(1, {
      method: RegistryMethods.SecuritySessionList,
      payload: {},
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      method: RegistryMethods.SecuritySessionRevoke,
      payload: {deviceId: 'device-1'},
    });
    expect(request).toHaveBeenNthCalledWith(3, {
      method: RegistryMethods.SecuritySessionRevokeAll,
      payload: {},
    });
  });
});
