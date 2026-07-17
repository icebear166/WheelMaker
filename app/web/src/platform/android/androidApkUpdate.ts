import {
  getAndroidNativeRpcFacade,
  type AndroidNativeMessageEnvironment,
} from './androidNativeMessageBridge';
import {wheelMakerReleaseUrl} from '../../settings/releaseChannel';

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
