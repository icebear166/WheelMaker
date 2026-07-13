import {createAndroidNativeMessageTestHost} from '../testUtils/androidNativeMessageTestHost';
import {resolveLoginDeviceName} from '../web/src/registry/deviceName';

describe('login device name', () => {
  test('uses the desktop hostname when the desktop bridge provides it', async () => {
    await expect(resolveLoginDeviceName({
      WheelMakerDesktop: {enabled: true, getDeviceName: () => 'WORKSTATION-01'},
    })).resolves.toBe('WORKSTATION-01');
  });

  test('uses the Android native device bridge', async () => {
    const {target, requests} = createAndroidNativeMessageTestHost({
      'device.getName': () => 'Pixel 9',
    });
    await expect(resolveLoginDeviceName({
      WheelMakerAndroidNative: target,
      addEventListener: () => undefined,
      performance: {now: () => 1},
      crypto: {randomUUID: () => 'test-request'},
    })).resolves.toBe('Pixel 9');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({action: 'device.getName'});
  });

  test('uses Browser outside native shells', async () => {
    await expect(resolveLoginDeviceName({})).resolves.toBe('Browser');
  });
});
