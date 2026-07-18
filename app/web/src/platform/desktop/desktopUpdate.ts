import {
  parseWheelMakerStable,
  WHEELMAKER_STABLE_URL,
} from '../../settings/agentPackageUpdateView';
import type {DesktopWindowBridge} from './desktopRuntime';

export type DesktopUpdateCheck =
  | {status: 'checking'}
  | {status: 'current'; version: string}
  | {status: 'available'; version: string}
  | {status: 'failed'};

export async function checkDesktopUpdate(
  bridge: DesktopWindowBridge,
  request: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<DesktopUpdateCheck> {
  if (!bridge.getDesktopUpdateInfo || !bridge.requestDesktopUpdate) {
    return {status: 'failed'};
  }
  try {
    const [info, response] = await Promise.all([
      bridge.getDesktopUpdateInfo(),
      request(WHEELMAKER_STABLE_URL, {cache: 'no-store'}),
    ]);
    if (!response.ok || !info.updaterReady || !/^[0-9a-f]{64}$/.test(info.sha256)) {
      return {status: 'failed'};
    }
    const pointer = parseWheelMakerStable(await response.json()).desktopExe;
    if (!pointer) {
      return {status: 'failed'};
    }
    return {
      status: info.sha256 === pointer.sha256 ? 'current' : 'available',
      version: pointer.version,
    };
  } catch {
    return {status: 'failed'};
  }
}
