import {
  getAndroidNativeMessageClient,
  type AndroidNativeMessageEnvironment,
} from '../platform/android/androidNativeMessageBridge';

type DesktopDeviceNameBridge = {
  enabled?: boolean;
  getDeviceName?: () => Promise<string> | string;
};

export type LoginDeviceNameEnvironment = AndroidNativeMessageEnvironment & {
  WheelMakerDesktop?: DesktopDeviceNameBridge;
};

function validDeviceName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 80) : '';
}

export async function resolveLoginDeviceName(
  environment: LoginDeviceNameEnvironment = globalThis as LoginDeviceNameEnvironment,
): Promise<string> {
  const desktop = environment.WheelMakerDesktop;
  if (desktop?.enabled && typeof desktop.getDeviceName === 'function') {
    try {
      const name = validDeviceName(await desktop.getDeviceName());
      if (name) return name;
    } catch {
      return 'Desktop';
    }
    return 'Desktop';
  }

  const android = getAndroidNativeMessageClient(environment);
  if (android) {
    try {
      const name = validDeviceName(await android.request('device.getName'));
      if (name) return name;
    } catch {
      return 'Android';
    }
    return 'Android';
  }

  return 'Browser';
}
