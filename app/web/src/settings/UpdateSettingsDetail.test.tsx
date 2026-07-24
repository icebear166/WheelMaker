// @ts-nocheck
import React from 'react';
import {act, create} from 'react-test-renderer';

import {UpdateSettingsDetail} from './UpdateSettingsDetail';

function baseProps(overrides = {}) {
  return {
    androidApkUpdateSupported: false,
    androidApkLocalRelease: null,
    androidApkLatestRelease: null,
    androidApkUpdateLoading: false,
    androidApkUpdateError: '',
    androidApkInstallStatus: '',
    androidApkInstallPending: false,
    refreshAndroidApkUpdate: async () => undefined,
    requestAndroidApkInstall: async () => undefined,
    updateHubCards: [],
    projectIndexByHubId: {},
    projects: [],
    wheelMakerUpdatesLoading: false,
    wheelMakerUpdatesError: '',
    wheelMakerPublicMetadata: null,
    wheelMakerUpdatePendingHubId: '',
    wheelMakerUpdateAllPending: false,
    wheelMakerReleaseHistory: [],
    wheelMakerReleaseHistoryLoading: false,
    wheelMakerReleaseHistoryError: '',
    requestWheelMakerUpdate: () => undefined,
    requestWheelMakerUpdateAll: () => undefined,
    agentPackagesLoading: false,
    agentPackagesError: '',
    agentPackageActionPendingKey: '',
    agentPackageHubUpdatePendingId: '',
    expandedNpmUpdateHubIds: {},
    setExpandedNpmUpdateHubIds: () => undefined,
    requestAgentPackageAction: () => undefined,
    requestAgentPackageHubUpdate: () => undefined,
    projectIndexLoading: false,
    projectIndexError: '',
    projectIndexScanPendingByProjectId: {},
    projectIndexScanAllPendingByHubId: {},
    expandedProjectIndexHubIds: {},
    setExpandedProjectIndexHubIds: () => undefined,
    handleScanProjectIndex: async () => undefined,
    handleScanAllProjectIndexes: async () => undefined,
    tagVariantClass: () => '',
    hubAccentStyle: () => ({}),
    shortDigest: () => '',
    formatWheelMakerDateTime: () => '',
    formatChatAttachmentSize: () => '',
    androidApkUpdateStatusLabel: () => '',
    androidApkInstallStatusLabel: () => '',
    agentPackageActionForPackage: () => null,
    agentPackageActionKey: (hubId, packageName) => `${hubId}:${packageName}`,
    agentPackageActionLabel: action => (action === 'update' ? 'Update' : action === 'uninstall' ? 'Uninstall' : 'Install'),
    projectFileIndexStatusLabel: () => '',
    ...overrides,
  };
}

function hubCard(hubId, overrides = {}) {
  return {
    hubId,
    wheelMaker: {hubId, loading: false, error: '', data: null},
    agentPackage: {hubId, loading: false, error: '', updatedAt: '', hub: null, operation: null},
    projectIndex: null,
    ...overrides,
  };
}

const stable = {version: 'v1.9', publishedAt: '2026-07-20T00:00:00Z', sourceSha: 'a'.repeat(40)};

test('overview bar shows latest version and Update All Hubs, drops summary metrics and release history', async () => {
  let tree;
  await act(async () => {
    tree = create(<UpdateSettingsDetail {...baseProps({
      wheelMakerPublicMetadata: {stable, publishStatus: null},
    })} />);
  });
  const json = JSON.stringify(tree!.toJSON());
  expect(json).toContain('v1.9');
  expect(json).toContain('Update all hubs');
  expect(json).not.toMatch(/update-summary-bar|update-summary-metric/);
  expect(json).not.toMatch(/wheelmaker-release-history|Release history/);
  expect(json).not.toContain('Indexed projects');
});

test('hub card renders current version, update icon, and Update Hub when an update is available', async () => {
  let tree;
  await act(async () => {
    tree = create(<UpdateSettingsDetail {...baseProps({
      wheelMakerPublicMetadata: {stable, publishStatus: null},
      updateHubCards: [hubCard('hub-1', {
        wheelMaker: {hubId: 'hub-1', loading: false, error: '', data: {
          ok: true, status: 'update_available', hubId: 'hub-1', canRequestUpdate: true,
          installed: {schemaVersion: 2, version: 'v1.5', publishedAt: '2026-06-01T00:00:00Z', sourceSha: 'b'.repeat(40), manifestSha256: 'c'.repeat(64), installedAt: '2026-06-02T00:00:00Z'},
        }},
      })],
    })} />);
  });
  const json = JSON.stringify(tree!.toJSON());
  expect(json).toContain('hub-1');
  expect(json).toContain('v1.5');
  expect(json).toContain('Update Hub');
  expect(json).toContain('is-warn');
});

test('npm rows render Install / Update / Up to date plus an uninstall icon button', async () => {
  const packages = [
    {packageName: 'fresh', displayName: 'Fresh', agentTypes: [], kind: 'runtime', installed: false, installedVersion: '', latestVersion: '1.0.0', status: 'not_installed', error: '', canInstall: true, canUpdate: false, canUninstall: false},
    {packageName: 'stale', displayName: 'Stale', agentTypes: [], kind: 'runtime', installed: true, installedVersion: '1.0.0', latestVersion: '2.0.0', status: 'update_available', error: '', canInstall: false, canUpdate: true, canUninstall: true},
    {packageName: 'cur', displayName: 'Cur', agentTypes: [], kind: 'runtime', installed: true, installedVersion: '2.0.0', latestVersion: '2.0.0', status: 'up_to_date', error: '', canInstall: false, canUpdate: false, canUninstall: true},
  ];
  let tree;
  await act(async () => {
    tree = create(<UpdateSettingsDetail {...baseProps({
      updateHubCards: [hubCard('hub-1', {
        agentPackage: {hubId: 'hub-1', loading: false, error: '', updatedAt: '', hub: {hubId: 'hub-1', nodeVersion: '', npmVersion: '', npmPrefix: '', warning: '', error: '', packages}, operation: null},
      })],
      expandedNpmUpdateHubIds: {'hub-1': true},
      agentPackageActionForPackage: pkg => (pkg.canInstall ? 'install' : pkg.canUpdate ? 'update' : pkg.canUninstall ? 'uninstall' : null),
    })} />);
  });
  const json = JSON.stringify(tree!.toJSON());
  expect(json).toContain('Install');
  expect(json).toContain('Update');
  expect(json).toContain('Up to date');
  expect(json).toContain('"data-icon-name":"trash"');
});

test('project rows show Scan and omit path and fileCount', async () => {
  let tree;
  await act(async () => {
    tree = create(<UpdateSettingsDetail {...baseProps({
      updateHubCards: [hubCard('hub-1', {
        projectIndex: {hubId: 'hub-1', projects: [
          {projectId: 'p1', name: 'Project One', path: '/secret/path', status: 'indexed', fileCount: 42},
        ]},
      })],
      expandedProjectIndexHubIds: {'hub-1': true},
    })} />);
  });
  const json = JSON.stringify(tree!.toJSON());
  expect(json).toContain('Project One');
  expect(json).toContain('Scan');
  expect(json).not.toContain('/secret/path');
  expect(json).not.toContain('42 files');
});

test('android card renders a single row with Download and Check, no meta grid', async () => {
  let tree;
  await act(async () => {
    tree = create(<UpdateSettingsDetail {...baseProps({
      androidApkUpdateSupported: true,
      androidApkLocalRelease: {supported: true, packageName: 'app', versionName: '1.2.3', versionCode: 10203, apkSha256: 'd'.repeat(64), buildSha: '', builtAt: '', canRequestPackageInstalls: true},
      androidApkLatestRelease: {tagName: 'v1.3.0', publishedAt: '2026-07-19T00:00:00Z', apk: {downloadUrl: 'https://x/y.apk', sha256: 'e'.repeat(64), size: 1234}},
    })} />);
  });
  const json = JSON.stringify(tree!.toJSON());
  expect(json).toContain('Android APK');
  expect(json).toContain('Download & Install');
  expect(json).toContain('Check');
  expect(json).not.toContain('android-apk-update-meta-grid');
});

test('hub card shows Restart when already up to date', async () => {
  let tree;
  await act(async () => {
    tree = create(<UpdateSettingsDetail {...baseProps({
      wheelMakerPublicMetadata: {stable, publishStatus: null},
      updateHubCards: [hubCard('hub-1', {
        wheelMaker: {hubId: 'hub-1', loading: false, error: '', data: {
          ok: true, status: 'up_to_date', hubId: 'hub-1', canRequestUpdate: true,
          installed: {schemaVersion: 2, version: 'v1.9', publishedAt: '2026-07-20T00:00:00Z', sourceSha: 'b'.repeat(40), manifestSha256: 'c'.repeat(64), installedAt: '2026-07-20T00:00:00Z'},
        }},
      })],
    })} />);
  });
  const json = JSON.stringify(tree!.toJSON());
  expect(json).toContain('Restart');
  expect(json).not.toContain('Update Hub');
});

test('installed npm package shows reinstall and uninstall icon buttons', async () => {
  const packages = [
    {packageName: 'cur', displayName: 'Cur', agentTypes: [], kind: 'runtime', installed: true, installedVersion: '2.0.0', latestVersion: '2.0.0', status: 'up_to_date', error: '', canInstall: false, canUpdate: false, canUninstall: true},
  ];
  let tree;
  await act(async () => {
    tree = create(<UpdateSettingsDetail {...baseProps({
      updateHubCards: [hubCard('hub-1', {
        agentPackage: {hubId: 'hub-1', loading: false, error: '', updatedAt: '', hub: {hubId: 'hub-1', nodeVersion: '', npmVersion: '', npmPrefix: '', warning: '', error: '', packages}, operation: null},
      })],
      expandedNpmUpdateHubIds: {'hub-1': true},
      agentPackageActionForPackage: pkg => (pkg.canInstall ? 'install' : pkg.canUpdate ? 'update' : pkg.canUninstall ? 'uninstall' : null),
    })} />);
  });
  const json = JSON.stringify(tree!.toJSON());
  expect(json).toContain('"data-icon-name":"refreshCw"');
  expect(json).toContain('"data-icon-name":"trash"');
});

test('not-installed npm package has no reinstall or uninstall button', async () => {
  const packages = [
    {packageName: 'fresh', displayName: 'Fresh', agentTypes: [], kind: 'runtime', installed: false, installedVersion: '', latestVersion: '1.0.0', status: 'not_installed', error: '', canInstall: true, canUpdate: false, canUninstall: false},
  ];
  let tree;
  await act(async () => {
    tree = create(<UpdateSettingsDetail {...baseProps({
      updateHubCards: [hubCard('hub-1', {
        agentPackage: {hubId: 'hub-1', loading: false, error: '', updatedAt: '', hub: {hubId: 'hub-1', nodeVersion: '', npmVersion: '', npmPrefix: '', warning: '', error: '', packages}, operation: null},
      })],
      expandedNpmUpdateHubIds: {'hub-1': true},
      agentPackageActionForPackage: pkg => (pkg.canInstall ? 'install' : null),
    })} />);
  });
  const json = JSON.stringify(tree!.toJSON());
  expect(json).not.toContain('"data-icon-name":"refreshCw"');
  expect(json).not.toContain('"data-icon-name":"trash"');
});
