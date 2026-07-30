import {
  getAndroidNativeRpcFacade,
  type AndroidNativeMessageEnvironment,
} from './androidNativeMessageBridge';
import {wheelMakerReleaseUrl} from '../../settings/releaseChannel';
import {WHEELMAKER_STABLE_URL} from '../../settings/agentPackageUpdateView';
import type {ClientUpdateState} from '../clientUpdate';

export type AndroidApkLocalRelease = {
  supported: boolean;
  packageName: string;
  versionName: string;
  versionCode: number;
  apkSha256: string;
  buildSha: string;
  builtAt: string;
  canRequestPackageInstalls: boolean;
};

export type AndroidApkLatestRelease = {
  tagName: string;
  publishedAt: string;
  apk: {
    downloadUrl: string;
    sha256: string;
    size: number;
  };
};

export type AndroidApkUpdateStatus = 'up_to_date' | 'update_available' | 'unknown';

export type AndroidApkInstallRequest = {
  downloadUrl: string;
  expectedSha256?: string;
  expectedSize?: number;
  tagName?: string;
};

export type AndroidApkInstallResult = {
  ok: boolean;
  status: string;
  error?: string;
};

type AndroidApkUpdateEnv = AndroidNativeMessageEnvironment;

export type AndroidApkUpdateBridge = {
  isSupported(): boolean;
  getLocalRelease(): Promise<AndroidApkLocalRelease>;
  installLatest(request: AndroidApkInstallRequest): Promise<AndroidApkInstallResult>;
};

export type AndroidApkUpdateCheck = {
  state: ClientUpdateState;
  latest: AndroidApkLatestRelease | null;
};

export type AndroidApkUpdateEventDetail = {
  status?: string;
};

export const androidApkUpdateEvent = 'wheelmaker:android-apk-update';

export function androidApkUpdateEventState(
  detail: AndroidApkUpdateEventDetail,
): ClientUpdateState | null {
  switch (detail.status) {
    case 'downloading':
      return {status: 'updating', meta: 'Downloading…'};
    case 'downloaded':
      return {status: 'updating', meta: 'Downloaded'};
    case 'installing':
      return {status: 'updating', meta: 'Opening installer…'};
    case 'permission_required':
    case 'failed':
      return {status: 'failed'};
    default:
      return null;
  }
}

export function subscribeAndroidApkUpdateEvents(
  listener: (state: ClientUpdateState) => void,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  const handleUpdate = (event: Event) => {
    const state = androidApkUpdateEventState(
      (event as CustomEvent<AndroidApkUpdateEventDetail>).detail ?? {},
    );
    if (state) listener(state);
  };
  target.addEventListener(androidApkUpdateEvent, handleUpdate);
  return () => target.removeEventListener(androidApkUpdateEvent, handleUpdate);
}

export function normalizeSha256Digest(value: string | undefined): string {
  return (value || '')
    .replace(/^sha256:/i, '')
    .trim()
    .toLowerCase();
}

export function parseAndroidStableRelease(input: unknown): AndroidApkLatestRelease | null {
  const stable = input as Record<string, unknown>;
  const pointer = stable?.androidApk as Record<string, unknown> | undefined;
  if (
    stable?.schema !== 2 ||
    !pointer ||
    typeof pointer.version !== 'string' ||
    !/^v1\.([1-9]\d*)$/.test(pointer.version) ||
    pointer.versionName !== pointer.version.slice(1) ||
    pointer.versionCode !== Number(pointer.version.slice(3)) ||
    typeof pointer.publishedAt !== 'string' ||
    !Number.isFinite(Date.parse(pointer.publishedAt)) ||
    typeof pointer.sourceSha !== 'string' ||
    !/^[0-9a-f]{40}$/.test(pointer.sourceSha) ||
    typeof pointer.path !== 'string' ||
    typeof pointer.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(pointer.sha256) ||
    !Number.isSafeInteger(pointer.size) ||
    Number(pointer.size) <= 0
  ) {
    return null;
  }
  let downloadUrl: string;
  try {
    downloadUrl = wheelMakerReleaseUrl(pointer.path as string);
  } catch {
    return null;
  }
  return {
    tagName: pointer.version,
    publishedAt: pointer.publishedAt as string,
    apk: {
      downloadUrl,
      sha256: pointer.sha256 as string,
      size: pointer.size as number,
    },
  };
}

export function resolveAndroidApkUpdateStatus(
  local: AndroidApkLocalRelease | null,
  latest: AndroidApkLatestRelease | null,
): AndroidApkUpdateStatus {
  const localSha = normalizeSha256Digest(local?.apkSha256);
  const latestSha = normalizeSha256Digest(latest?.apk.sha256);
  if (!local?.supported || !localSha || !latest || !latestSha) {
    return 'unknown';
  }
  return localSha === latestSha ? 'up_to_date' : 'update_available';
}

export async function checkAndroidApkUpdate(
  bridge: AndroidApkUpdateBridge,
  request: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<AndroidApkUpdateCheck> {
  try {
    const [local, response] = await Promise.all([
      bridge.getLocalRelease(),
      request(WHEELMAKER_STABLE_URL, {cache: 'no-store'}),
    ]);
    const latest = response.ok
      ? parseAndroidStableRelease(await response.json())
      : null;
    const status = resolveAndroidApkUpdateStatus(local, latest);
    if (!latest || status === 'unknown') {
      return {state: {status: 'failed'}, latest: null};
    }
    const currentVersion = local.versionName ? `v${local.versionName}` : '';
    return {
      state: status === 'up_to_date'
        ? {status: 'current', currentVersion}
        : {
            status: 'available',
            currentVersion,
            latestVersion: latest.tagName,
          },
      latest,
    };
  } catch {
    return {state: {status: 'failed'}, latest: null};
  }
}

function parseJsonObject<T>(raw: string | undefined, fallback: T): T {
  try {
    return JSON.parse(raw || '{}') as T;
  } catch {
    return fallback;
  }
}

export function createAndroidApkUpdateBridge(
  env: AndroidApkUpdateEnv = globalThis as AndroidApkUpdateEnv,
): AndroidApkUpdateBridge {
  const native = getAndroidNativeRpcFacade(env);
  const supported = native !== null;
  return {
    isSupported: () => supported,
    getLocalRelease: async () => parseJsonObject<AndroidApkLocalRelease>(
      await native?.getAndroidReleaseState(),
      {
        supported: false,
        packageName: '',
        versionName: '',
        versionCode: 0,
        apkSha256: '',
        buildSha: '',
        builtAt: '',
        canRequestPackageInstalls: false,
      },
    ),
    installLatest: async request => parseJsonObject<AndroidApkInstallResult>(
      await native?.installAndroidRelease(JSON.stringify(request)),
      {ok: false, status: 'unsupported', error: 'unsupported'},
    ),
  };
}
