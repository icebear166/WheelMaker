import type {
  RegistryHub,
  RegistryNpmPackage,
  RegistryNpmPackageStatus,
  RegistryWheelMakerPublishStatus,
  RegistryWheelMakerInstalledRelease,
  RegistryWheelMakerStableRelease,
  RegistryWheelMakerUpdateJob,
  RegistryWheelMakerUpdateResponse,
} from '../registry/registryTypes';

export const AGENT_PACKAGE_SCAN_TIMEOUT_MS = 65000;
export const WHEELMAKER_RELEASE_HISTORY_URL =
  'https://api.github.com/repos/swm8023/wheelmaker-release/releases';
export const WHEELMAKER_STABLE_URL =
  'https://raw.githubusercontent.com/swm8023/wheelmaker-release/main/stable.json';
export const WHEELMAKER_PUBLISH_STATUS_URL =
  'https://raw.githubusercontent.com/swm8023/wheelmaker-release/main/publish-status.json';

const ACTIVE_WHEELMAKER_UPDATE_STATES = new Set([
  'queued',
  'downloading',
  'verifying',
  'applying',
  'restarting',
]);

export type WheelMakerReleaseHistoryEntry = {
  version: string;
  publishedAt: string;
  url: string;
};

export type WheelMakerAndroidApkPointer = {
  version: string;
  versionName: string;
  versionCode: number;
  publishedAt: string;
  sourceSha: string;
  url: string;
  sha256: string;
  size: number;
};

export type WheelMakerStableMetadata = RegistryWheelMakerStableRelease & {
  schema: 1;
  androidApk?: WheelMakerAndroidApkPointer;
};

export type WheelMakerPublicMetadata = {
  stable: WheelMakerStableMetadata;
  publishStatus: RegistryWheelMakerPublishStatus | null;
};

export type NpmPackageUpdateTarget = {
  packageName: string;
  displayName: string;
  installedVersion: string;
  latestVersion: string;
};

export function deriveRegistryHubIds(hubs: RegistryHub[]): string[] {
  const hubIds = new Set<string>();
  hubs.forEach(hub => {
    const hubId = (hub.hubId || '').trim();
    if (hubId) hubIds.add(hubId);
  });
  return Array.from(hubIds).sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
}

export function packageStatusLabel(status: RegistryNpmPackageStatus | string): string {
  switch (status) {
    case 'checking_latest':
      return 'Checking latest';
    case 'not_installed':
      return 'Not installed';
    case 'up_to_date':
      return 'Up to date';
    case 'update_available':
      return 'Update available';
    case 'latest_unknown':
      return 'Latest unknown';
    case 'checking_failed':
      return 'Checking failed';
    case 'deprecated':
      return 'Deprecated';
    case 'installing':
      return 'Installing';
    case 'updating':
      return 'Updating';
    case 'uninstalling':
      return 'Uninstalling';
    case 'running':
      return 'Running';
    case 'succeeded':
      return 'Succeeded';
    case 'failed':
      return 'Failed';
    default:
      return status || 'Unknown';
  }
}

export function deriveNpmPackageUpdateTargets(packages: RegistryNpmPackage[]): NpmPackageUpdateTarget[] {
  return packages
    .filter(pkg => pkg.canInstall || pkg.canUpdate)
    .map(pkg => ({
      packageName: pkg.packageName,
      displayName: pkg.displayName,
      installedVersion: pkg.installedVersion,
      latestVersion: pkg.latestVersion,
    }));
}

export function npmPackageUpdateSummary(count: number): string {
  if (count <= 0) return 'No npm updates';
  return `${count} npm ${count === 1 ? 'update' : 'updates'}`;
}

export function wheelMakerUpdateStatusLabel(status: string): string {
  switch (status) {
    case 'installed':
      return 'Installed';
    case 'up_to_date':
      return 'Up to date';
    case 'update_available':
      return 'Update available';
    case 'update_pending':
      return 'Update pending';
    case 'not_installed':
      return 'Not installed';
    case 'checking_failed':
      return 'Checking failed';
    case 'local_newer':
      return 'Local version is newer';
    case 'queued':
      return 'Queued';
    case 'downloading':
      return 'Downloading';
    case 'verifying':
      return 'Verifying';
    case 'applying':
      return 'Applying';
    case 'restarting':
      return 'Restarting';
    case 'succeeded':
      return 'Succeeded';
    case 'failed':
      return 'Failed';
    default:
      return status || 'Unknown';
  }
}

export function wheelMakerVersionCopy(
  data: RegistryWheelMakerUpdateResponse | null,
  stable?: RegistryWheelMakerStableRelease | null,
): {current: string; latest: string} {
  return {
    current: data?.installed?.version || '-',
    latest: stable?.version || '-',
  };
}

export function deriveWheelMakerHubStatus(
  installed: RegistryWheelMakerInstalledRelease | undefined,
  stable: RegistryWheelMakerStableRelease | null,
  job?: RegistryWheelMakerUpdateJob,
): string {
  if (wheelMakerUpdateJobActive(job)) return 'update_pending';
  if (!installed) return 'not_installed';
  if (!stable) return 'checking_failed';
  const installedMatch = /^v1\.(0|[1-9]\d*)$/.exec(installed.version);
  const stableMatch = /^v1\.(0|[1-9]\d*)$/.exec(stable.version);
  if (!installedMatch || !stableMatch) return 'checking_failed';
  const installedSequence = Number(installedMatch[1]);
  const stableSequence = Number(stableMatch[1]);
  if (stableSequence > installedSequence) return 'update_available';
  if (stableSequence < installedSequence) return 'local_newer';
  return 'up_to_date';
}

export function parseWheelMakerStable(input: unknown): WheelMakerStableMetadata {
  const stable = input as Record<string, unknown>;
  if (
    !stable ||
    typeof stable !== 'object' ||
    stable.schema !== 1 ||
    typeof stable.version !== 'string' ||
    !/^v1\.(0|[1-9]\d*)$/.test(stable.version) ||
    typeof stable.publishedAt !== 'string' ||
    !Number.isFinite(Date.parse(stable.publishedAt)) ||
    typeof stable.sourceSha !== 'string' ||
    !/^[0-9a-f]{40}$/.test(stable.sourceSha)
  ) {
    throw new Error('WheelMaker stable metadata is invalid.');
  }
  if (stable.androidApk !== undefined && !validAndroidPointer(stable.androidApk)) {
    throw new Error('WheelMaker stable metadata has an invalid Android pointer.');
  }
  return stable as WheelMakerStableMetadata;
}

export function parseWheelMakerPublishStatus(
  input: unknown,
): RegistryWheelMakerPublishStatus {
  const status = input as Record<string, unknown>;
  if (
    !status ||
    typeof status !== 'object' ||
    status.schema !== 1 ||
    typeof status.state !== 'string' ||
    !status.state ||
    typeof status.phase !== 'string' ||
    !status.phase
  ) {
    throw new Error('WheelMaker publish status is invalid.');
  }
  return status as unknown as RegistryWheelMakerPublishStatus;
}

export async function fetchWheelMakerPublicMetadata(
  request: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<WheelMakerPublicMetadata> {
  const [stableResponse, publishStatusResponse] = await Promise.all([
    request(WHEELMAKER_STABLE_URL, {cache: 'no-store'}),
    request(WHEELMAKER_PUBLISH_STATUS_URL, {cache: 'no-store'}),
  ]);
  if (!stableResponse.ok) {
    throw new Error(`Stable metadata request failed (${stableResponse.status}).`);
  }
  const stable = parseWheelMakerStable(await stableResponse.json());
  const publishStatus = publishStatusResponse.ok
    ? parseWheelMakerPublishStatus(await publishStatusResponse.json())
    : null;
  return {publishStatus, stable};
}

function validAndroidPointer(input: unknown): input is WheelMakerAndroidApkPointer {
  const pointer = input as Record<string, unknown>;
  if (!pointer || typeof pointer !== 'object') return false;
  if (
    typeof pointer.version !== 'string' ||
    !/^v1\.([1-9]\d*)$/.test(pointer.version) ||
    pointer.versionName !== pointer.version.slice(1) ||
    pointer.versionCode !== Number(pointer.version.slice(3)) ||
    typeof pointer.publishedAt !== 'string' ||
    !Number.isFinite(Date.parse(pointer.publishedAt)) ||
    typeof pointer.sourceSha !== 'string' ||
    !/^[0-9a-f]{40}$/.test(pointer.sourceSha) ||
    typeof pointer.url !== 'string' ||
    !pointer.url.startsWith('https://') ||
    typeof pointer.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(pointer.sha256) ||
    !Number.isSafeInteger(pointer.size) ||
    Number(pointer.size) <= 0
  ) {
    return false;
  }
  return true;
}

export function wheelMakerUpdateJobActive(
  job: RegistryWheelMakerUpdateJob | null | undefined,
): boolean {
  return ACTIVE_WHEELMAKER_UPDATE_STATES.has(job?.state || '');
}

export function wheelMakerUpdateErrorLabel(errorCode: string | undefined): string {
  return errorCode ? `Update error: ${errorCode}` : '';
}

export function wheelMakerPublishStatusLabel(
  status: RegistryWheelMakerPublishStatus | null | undefined,
): string {
  if (!status) return '';
  const humanize = (value: string) => {
    const normalized = value.replaceAll('-', ' ').replaceAll('_', ' ');
    return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : '';
  };
  const phase = humanize(status.phase);
  const state = humanize(status.state);
  return [state, phase].filter(Boolean).join(' / ');
}

export function shouldShowWheelMakerUpdateAction(input: {
  data: RegistryWheelMakerUpdateResponse | null;
  loading: boolean;
  pending: boolean;
}): boolean {
  if (input.pending || wheelMakerUpdateJobActive(input.data?.job)) {
    return true;
  }
  if (input.loading || !input.data) {
    return false;
  }
  return input.data.canRequestUpdate === true;
}

export async function fetchWheelMakerReleaseHistory(
  request: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<WheelMakerReleaseHistoryEntry[]> {
  const response = await request(WHEELMAKER_RELEASE_HISTORY_URL, {
    headers: {Accept: 'application/vnd.github+json'},
  });
  if (!response.ok) {
    throw new Error(`Release history request failed (${response.status}).`);
  }
  const payload = await response.json() as unknown;
  if (!Array.isArray(payload)) {
    throw new Error('Release history response is invalid.');
  }
  return payload
    .filter((entry): entry is Record<string, unknown> => {
      return !!entry && typeof entry === 'object' &&
        entry.draft !== true && entry.prerelease !== true &&
        typeof entry.tag_name === 'string' && /^v1\.\d+$/.test(entry.tag_name) &&
        typeof entry.published_at === 'string';
    })
    .map(entry => ({
      version: entry.tag_name as string,
      publishedAt: entry.published_at as string,
      url: typeof entry.html_url === 'string' ? entry.html_url : '',
    }))
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
    .slice(0, 10);
}

export function withAgentPackageTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
    promise.then(
      value => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      error => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
