// @ts-nocheck
import {
  androidApkStatusIcon,
  deriveNpmUpdatableTargets,
  hubStatusLabel,
  projectIndexStatusIcon,
  updateStatusDotVariant,
  wheelMakerHubStatusIcon,
} from './agentPackageUpdateView';

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
