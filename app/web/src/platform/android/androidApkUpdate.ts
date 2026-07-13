export const GITHUB_ANDROID_LATEST_RELEASE_API =
  'https://api.github.com/repos/swm8023/WheelMaker/releases/latest';

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
  targetCommitish: string;
  publishedAt: string;
  releaseUrl: string;
  manifestUrl: string;
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

type GitHubReleaseAsset = {
  name?: string;
  browser_download_url?: string;
  digest?: string;
  size?: number;
};

type GitHubReleaseResponse = {
  tag_name?: string;
  target_commitish?: string;
  published_at?: string;
  html_url?: string;
  assets?: GitHubReleaseAsset[];
};

export function normalizeSha256Digest(value: string | undefined): string {
  return (value || '')
    .replace(/^sha256:/i, '')
    .trim()
    .toLowerCase();
}

export function parseAndroidLatestRelease(input: unknown): AndroidApkLatestRelease | null {
  const release = input as GitHubReleaseResponse;
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const apk = assets.find(asset => asset.name === 'WheelMakerAndroid.apk');
  if (!apk?.browser_download_url) {
    return null;
  }
  const manifest = assets.find(asset => asset.name === 'android-release.json');
  return {
    tagName: release.tag_name || '',
    targetCommitish: release.target_commitish || '',
    publishedAt: release.published_at || '',
    releaseUrl: release.html_url || '',
    manifestUrl: manifest?.browser_download_url || '',
    apk: {
      downloadUrl: apk.browser_download_url,
      sha256: normalizeSha256Digest(apk.digest),
      size: typeof apk.size === 'number' ? apk.size : 0,
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
import {
  getAndroidNativeRpcFacade,
  type AndroidNativeMessageEnvironment,
} from './androidNativeMessageBridge';
