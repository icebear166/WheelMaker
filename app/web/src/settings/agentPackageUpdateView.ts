import type {
  RegistryHub,
  RegistryNpmPackage,
  RegistryNpmPackageStatus,
  RegistryProject,
  RegistryWheelMakerPublishStatus,
  RegistryWheelMakerInstalledRelease,
  RegistryWheelMakerStableRelease,
  RegistryWheelMakerGatewayPointer,
  RegistryWheelMakerUpdateJob,
  RegistryWheelMakerUpdateResponse,
} from '../registry/registryTypes';
import {wheelMakerReleaseUrl} from './releaseChannel';

export const AGENT_PACKAGE_SCAN_TIMEOUT_MS = 65000;
export const WHEELMAKER_RESTART_RECONNECT_TIMEOUT_MS = 60000;
export const WHEELMAKER_RELEASE_HISTORY_URL =
  wheelMakerReleaseUrl('/releases.json');
export const WHEELMAKER_STABLE_URL =
  wheelMakerReleaseUrl('/stable.json');
export const WHEELMAKER_PUBLISH_STATUS_URL =
  wheelMakerReleaseUrl('/publish-status.json');

const ACTIVE_WHEELMAKER_UPDATE_STATES = new Set([
  'queued',
  'downloading',
  'verifying',
  'applying',
  'restarting',
]);

export function resolveWheelMakerRestartPending(input: {
  previousInstanceId: string;
  currentInstanceId: string;
  startedAtMs: number;
  nowMs: number;
}): 'waiting' | 'reconnected' | 'timed_out' {
  if (input.currentInstanceId && input.currentInstanceId !== input.previousInstanceId) {
    return 'reconnected';
  }
  if (input.nowMs - input.startedAtMs >= WHEELMAKER_RESTART_RECONNECT_TIMEOUT_MS) {
    return 'timed_out';
  }
  return 'waiting';
}

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
  path: string;
  sha256: string;
  size: number;
};

export type WheelMakerDesktopPointer = {
  version: string;
  path: string;
  sha256: string;
};

export type WheelMakerGatewayPointer = RegistryWheelMakerGatewayPointer;

export type WheelMakerStableMetadata = RegistryWheelMakerStableRelease & {
  schema: 2;
  androidApk?: WheelMakerAndroidApkPointer;
  desktopExe?: WheelMakerDesktopPointer;
  gateway?: WheelMakerGatewayPointer;
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

function compareHubIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function deriveRegistryHubIds(hubs: RegistryHub[]): string[] {
  const hubIds = new Set<string>();
  hubs.forEach(hub => {
    const hubId = (hub.hubId || '').trim();
    if (hubId) hubIds.add(hubId);
  });
  return Array.from(hubIds).sort(compareHubIds);
}

export function deriveOperationalHubIds(
  hubs: RegistryHub[],
  projects: Array<Pick<RegistryProject, 'hubId' | 'online'>>,
): string[] {
  const hubIds = new Set(deriveRegistryHubIds(hubs));
  projects.forEach(project => {
    const hubId = (project.hubId || '').trim();
    if (project.online === true && hubId) {
      hubIds.add(hubId);
    }
  });
  return Array.from(hubIds).sort(compareHubIds);
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

export type UpdateStatusIconKind = 'update' | 'current' | 'checking' | 'failed' | 'missing';

export function updateStatusDotVariant(kind: UpdateStatusIconKind): string {
  switch (kind) {
    case 'current':
      return 'is-ok';
    case 'checking':
      return 'is-running';
    case 'failed':
      return 'is-error';
    case 'update':
      return 'is-warn';
    default:
      return 'is-idle';
  }
}

export function hubStatusLabel(
  pending: boolean,
  jobActive: boolean,
  jobFailed: boolean,
  statusFailed: boolean,
  restart: boolean,
  jobState: string,
): string {
  if (pending) return 'Requesting...';
  if (jobActive) return wheelMakerUpdateStatusLabel(jobState);
  if (jobFailed || statusFailed) return 'Retry';
  if (restart) return 'Restart';
  return 'Update Hub';
}

export function wheelMakerHubStatusIcon(
  status: string,
  loading: boolean,
  jobActive: boolean,
): UpdateStatusIconKind {
  if (loading || jobActive) return 'checking';
  if (status === 'update_available' || status === 'update_pending') return 'update';
  if (status === 'up_to_date' || status === 'local_newer') return 'current';
  return 'failed';
}

export function androidApkStatusIcon(status: string, loading: boolean): UpdateStatusIconKind {
  if (loading) return 'checking';
  if (status === 'update_available') return 'update';
  if (status === 'up_to_date') return 'current';
  return 'failed';
}

export function projectIndexStatusIcon(status: string, pending: boolean): UpdateStatusIconKind {
  if (pending) return 'checking';
  if (status === 'indexed') return 'current';
  if (status === 'error' || status === 'failed') return 'failed';
  if (status === 'missing') return 'missing';
  return 'checking';
}

export function deriveNpmUpdatableTargets(packages: RegistryNpmPackage[]): NpmPackageUpdateTarget[] {
  return packages
    .filter(pkg => pkg.canUpdate)
    .map(pkg => ({
      packageName: pkg.packageName,
      displayName: pkg.displayName,
      installedVersion: pkg.installedVersion,
      latestVersion: pkg.latestVersion,
    }));
}

// agentPackageWriteOperationRunning reports whether a running npm hub operation
// is a write operation (install / install_many / uninstall / reinstall). A
// running scan_latest is a read-only latest-version refresh and must not block
// package installs or updates, so it returns false for that action.
export function agentPackageWriteOperationRunning(
  operation: {running: boolean; action: string} | null | undefined,
): boolean {
  if (!operation || operation.running !== true) {
    return false;
  }
  return operation.action !== 'scan_latest';
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
    stable.schema !== 2 ||
    typeof stable.version !== 'string' ||
    !/^v1\.(0|[1-9]\d*)$/.test(stable.version) ||
    typeof stable.publishedAt !== 'string' ||
    !Number.isFinite(Date.parse(stable.publishedAt)) ||
    typeof stable.sourceSha !== 'string' ||
    !/^[0-9a-f]{40}$/.test(stable.sourceSha)
  ) {
    throw new Error('WheelMaker stable metadata is invalid.');
  }
  let androidApk: WheelMakerAndroidApkPointer | undefined;
  if (stable.androidApk !== undefined) {
    if (!validAndroidPointer(stable.androidApk)) {
      throw new Error('WheelMaker stable metadata has an invalid Android pointer.');
    }
    androidApk = stable.androidApk;
  }
  let desktopExe: WheelMakerDesktopPointer | undefined;
  if (stable.desktopExe !== undefined) {
    if (!validDesktopPointer(stable.desktopExe)) {
      throw new Error('WheelMaker stable metadata has an invalid Desktop pointer.');
    }
    desktopExe = stable.desktopExe;
  }
  let gateway: WheelMakerGatewayPointer | undefined;
  if (stable.gateway !== undefined) {
    if (!validGatewayPointer(stable.gateway)) {
      throw new Error('Gateway stable metadata is invalid.');
    }
    gateway = stable.gateway;
  }
  return {
    schema: 2,
    version: stable.version,
    publishedAt: stable.publishedAt,
    sourceSha: stable.sourceSha,
    ...(androidApk ? {androidApk} : {}),
    ...(desktopExe ? {desktopExe} : {}),
    ...(gateway ? {gateway} : {}),
  };
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

function validDesktopPointer(input: unknown): input is WheelMakerDesktopPointer {
  const pointer = input as Record<string, unknown>;
  if (
    !pointer ||
    typeof pointer !== 'object' ||
    typeof pointer.version !== 'string' ||
    !/^v1\.([1-9]\d*)$/.test(pointer.version) ||
    typeof pointer.path !== 'string' ||
    typeof pointer.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(pointer.sha256)
  ) {
    return false;
  }
  try {
    wheelMakerReleaseUrl(pointer.path);
  } catch {
    return false;
  }
  return true;
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
    typeof pointer.path !== 'string' ||
    typeof pointer.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(pointer.sha256) ||
    !Number.isSafeInteger(pointer.size) ||
    Number(pointer.size) <= 0
  ) {
    return false;
  }
  try {
    wheelMakerReleaseUrl(pointer.path as string);
  } catch {
    return false;
  }
  return true;
}

function validGatewayPointer(input: unknown): input is WheelMakerGatewayPointer {
  const pointer = input as Record<string, unknown>;
  return Boolean(
    pointer &&
    typeof pointer === 'object' &&
    typeof pointer.version === 'string' &&
    /^v1\.(0|[1-9]\d*)$/.test(pointer.version) &&
    typeof pointer.sourceSha === 'string' &&
    /^[0-9a-f]{40}$/.test(pointer.sourceSha) &&
    pointer.manifestPath === '/gateway/current/gateway-manifest.json' &&
    typeof pointer.manifestSha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(pointer.manifestSha256),
  );
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
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Release history request failed (${response.status}).`);
  }
  const payload = await response.json() as Record<string, unknown>;
  if (
    !payload ||
    typeof payload !== 'object' ||
    payload.schema !== 1 ||
    !Array.isArray(payload.releases)
  ) {
    throw new Error('Release history response is invalid.');
  }
  return payload.releases
    .filter((entry): entry is Record<string, unknown> => {
      return !!entry && typeof entry === 'object' &&
        typeof entry.version === 'string' && /^v1\.([1-9]\d*)$/.test(entry.version) &&
        typeof entry.publishedAt === 'string' && Number.isFinite(Date.parse(entry.publishedAt)) &&
        typeof entry.sourceSha === 'string' && /^[0-9a-f]{40}$/.test(entry.sourceSha) &&
        typeof entry.manifestSha256 === 'string' && /^[0-9a-f]{64}$/.test(entry.manifestSha256) &&
        Array.isArray(entry.assets) && entry.assets.every((asset: unknown) => validHistoryAsset(asset));
    })
    .map(entry => ({
      version: entry.version as string,
      publishedAt: entry.publishedAt as string,
      url: wheelMakerReleaseUrl(`/releases/${entry.version}/release-manifest.json`),
    }))
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
    .slice(0, 10);
}

function validHistoryAsset(input: unknown): boolean {
  const asset = input as Record<string, unknown>;
  if (
    !asset ||
    typeof asset !== 'object' ||
    typeof asset.name !== 'string' ||
    !asset.name ||
    typeof asset.path !== 'string' ||
    typeof asset.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(asset.sha256) ||
    !Number.isSafeInteger(asset.size) ||
    Number(asset.size) < 1
  ) {
    return false;
  }
  try {
    wheelMakerReleaseUrl(asset.path as string);
    return true;
  } catch {
    return false;
  }
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
