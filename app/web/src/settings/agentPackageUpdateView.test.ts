// @ts-nocheck
import {
  androidApkStatusIcon,
  deriveGatewayHubStatus,
  deriveNpmUpdatableTargets,
  gatewayUpdateJobActive,
  hubStatusLabel,
  parseWheelMakerStable,
  projectIndexStatusIcon,
  shouldShowGatewayUpdateAction,
  updateStatusDotVariant,
  wheelMakerHubStatusIcon,
} from './agentPackageUpdateView';

const gatewayStableFixture = {
  schema: 2,
  version: 'v1.4',
  publishedAt: '2026-08-06T00:00:00.000Z',
  sourceSha: '0123456789abcdef0123456789abcdef01234567',
  gateway: {
    version: 'v1.3',
    sourceSha: '89abcdef0123456789abcdef0123456789abcdef',
    manifestPath: '/gateway/current/gateway-manifest.json',
    manifestSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
};

test('parseWheelMakerStable preserves a valid Gateway virtual pointer', () => {
  const stable = parseWheelMakerStable(gatewayStableFixture);
  expect(stable.gateway).toEqual(gatewayStableFixture.gateway);
});

test('parseWheelMakerStable rejects an invalid Gateway virtual pointer', () => {
  expect(() => parseWheelMakerStable({
    ...gatewayStableFixture,
    gateway: {...gatewayStableFixture.gateway, manifestPath: '/releases/v1.3/gateway-manifest.json'},
  })).toThrow('Gateway stable metadata');
});

test('deriveGatewayHubStatus compares the installed identity with the stable pointer', () => {
  const installed = {
    schemaVersion: 1,
    version: 'v1.3',
    sourceSha: gatewayStableFixture.gateway.sourceSha,
    manifestSha256: gatewayStableFixture.gateway.manifestSha256,
    installedAt: gatewayStableFixture.publishedAt,
  };
  expect(deriveGatewayHubStatus(installed, gatewayStableFixture.gateway)).toBe('up_to_date');
  expect(deriveGatewayHubStatus(installed, {
    ...gatewayStableFixture.gateway,
    version: 'v1.4',
    sourceSha: 'fedcba9876543210fedcba9876543210fedcba98',
    manifestSha256: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
  })).toBe('update_available');
});

test('Gateway update action is hidden when the Hub has no installed Gateway', () => {
  expect(deriveGatewayHubStatus(undefined, gatewayStableFixture.gateway)).toBe('not_installed');
  expect(shouldShowGatewayUpdateAction({
    data: {ok: true, status: 'not_installed', hubId: 'hub-a', canRequestUpdate: false},
    loading: false,
    pending: false,
  })).toBe(false);
});

test('Gateway update job activity makes its action visible and pending', () => {
  const data = {
    ok: true,
    status: 'update_pending',
    hubId: 'hub-a',
    canRequestUpdate: false,
    job: {
      schema: 1,
      jobId: 'job-1',
      state: 'downloading',
      startedAt: gatewayStableFixture.publishedAt,
      updatedAt: gatewayStableFixture.publishedAt,
    },
  };
  expect(gatewayUpdateJobActive(data.job)).toBe(true);
  expect(shouldShowGatewayUpdateAction({data, loading: false, pending: true})).toBe(true);
});

test('wheelMakerHubStatusIcon treats loading and job-active as checking', () => {
  expect(wheelMakerHubStatusIcon('up_to_date', true, false)).toBe('checking');
  expect(wheelMakerHubStatusIcon('update_available', false, true)).toBe('checking');
});

test('wheelMakerHubStatusIcon maps update / current / failed states', () => {
  expect(wheelMakerHubStatusIcon('update_available', false, false)).toBe('update');
  expect(wheelMakerHubStatusIcon('update_pending', false, false)).toBe('update');
  expect(wheelMakerHubStatusIcon('up_to_date', false, false)).toBe('current');
  expect(wheelMakerHubStatusIcon('local_newer', false, false)).toBe('current');
  expect(wheelMakerHubStatusIcon('not_installed', false, false)).toBe('failed');
  expect(wheelMakerHubStatusIcon('checking_failed', false, false)).toBe('failed');
});

test('androidApkStatusIcon maps the three apk states', () => {
  expect(androidApkStatusIcon('update_available', false)).toBe('update');
  expect(androidApkStatusIcon('up_to_date', false)).toBe('current');
  expect(androidApkStatusIcon('unknown', false)).toBe('failed');
  expect(androidApkStatusIcon('update_available', true)).toBe('checking');
});

test('projectIndexStatusIcon maps index lifecycle states', () => {
  expect(projectIndexStatusIcon('indexed', false)).toBe('current');
  expect(projectIndexStatusIcon('missing', false)).toBe('missing');
  expect(projectIndexStatusIcon('error', false)).toBe('failed');
  expect(projectIndexStatusIcon('scanning', false)).toBe('checking');
  expect(projectIndexStatusIcon('indexed', true)).toBe('checking');
});

test('deriveNpmUpdatableTargets keeps only packages with an update', () => {
  const targets = deriveNpmUpdatableTargets([
    {packageName: 'a', displayName: 'A', canUpdate: true, installedVersion: '1', latestVersion: '2'},
    {packageName: 'b', displayName: 'B', canUpdate: false, canInstall: true, installedVersion: '', latestVersion: '1'},
    {packageName: 'c', displayName: 'C', canUpdate: false, canUninstall: true, installedVersion: '1', latestVersion: '1'},
  ]);
  expect(targets.map(t => t.packageName)).toEqual(['a']);
  expect(targets[0].latestVersion).toBe('2');
});

test('hubStatusLabel covers pending / job / retry / restart / update branches', () => {
  expect(hubStatusLabel(true, false, false, false, false, '')).toBe('Requesting...');
  expect(hubStatusLabel(false, true, false, false, false, 'downloading')).toBe('Downloading');
  expect(hubStatusLabel(false, false, true, false, false, 'failed')).toBe('Retry');
  expect(hubStatusLabel(false, false, false, true, false, '')).toBe('Retry');
  expect(hubStatusLabel(false, false, false, false, true, '')).toBe('Restart');
  expect(hubStatusLabel(false, false, false, false, false, '')).toBe('Update Hub');
});

test('updateStatusDotVariant maps icon kinds to dot variants', () => {
  expect(updateStatusDotVariant('current')).toBe('is-ok');
  expect(updateStatusDotVariant('checking')).toBe('is-running');
  expect(updateStatusDotVariant('failed')).toBe('is-error');
  expect(updateStatusDotVariant('update')).toBe('is-warn');
  expect(updateStatusDotVariant('missing')).toBe('is-idle');
});
