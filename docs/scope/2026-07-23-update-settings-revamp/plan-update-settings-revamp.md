# Update Settings Page Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the Workspace "Update" settings page — drop redundant stats/history, collapse each hub into a compact card with a unified status icon, and keep every update action (hub runtime / NPM packages / project file index / Android APK).

**Architecture:** Rewrite only the presentation layer of `UpdateSettingsDetail.tsx` (props type and the parent `WorkspaceApp.tsx` call site stay untouched — unused props are simply not destructured, so no TS breakage). Add pure status→icon + npm-target helpers to `agentPackageUpdateView.ts`. Clean up dead CSS blocks in `settings.css` and add compact-layout classes. TDD: pure helpers and a component render test come first, then the rewrite makes them pass.

**Tech Stack:** React + TypeScript + webpack; tests via `react-test-renderer` + jest (existing settings test style, e.g. `ReleasePublishSettings.test.tsx`); CSS variables + `codicon` icons.

**Spec:** [spec-update-settings-revamp.md](spec-update-settings-revamp.md)

---

## File layout

- **Modify** `app/web/src/settings/agentPackageUpdateView.ts` — add `UpdateStatusIconKind`, `UPDATE_STATUS_ICON_CODICON`, `wheelMakerHubStatusIcon`, `androidApkStatusIcon`, `projectIndexStatusIcon`, `deriveNpmUpdatableTargets`.
- **Create** `app/web/src/settings/agentPackageUpdateView.test.ts` — unit tests for the new pure helpers (no existing test file covers this module).
- **Create** `app/web/src/settings/UpdateSettingsDetail.test.tsx` — render tests for the rewritten component (no existing test file covers it; `ReleasePublishSettings.test.tsx` is the wrong subject).
- **Modify** `app/web/src/settings/UpdateSettingsDetail.tsx` — full JSX rewrite (props type unchanged).
- **Modify** `app/web/src/styles/settings.css` — delete dead blocks (`update-summary-*`, `wheelmaker-release-history*`, `android-apk-update-meta-*` / heading / subtitle, `wheelmaker-update-panel*`, `wheelmaker-public-release`), add compact classes.

`app/web/src/app/WorkspaceApp.tsx` is **not** modified — it keeps passing all props; the component just stops destructuring the ones it no longer renders.

---

## Task 1: Add status→icon and npm-target pure helpers

**Files:**
- Modify: `app/web/src/settings/agentPackageUpdateView.ts` (append near the existing `deriveNpmPackageUpdateTargets`)
- Test: `app/web/src/settings/agentPackageUpdateView.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `app/web/src/settings/agentPackageUpdateView.test.ts`:

```ts
// @ts-nocheck
import {
  androidApkStatusIcon,
  deriveNpmUpdatableTargets,
  projectIndexStatusIcon,
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/web && npx jest src/settings/agentPackageUpdateView.test.ts`
Expected: FAIL — the imported helpers do not exist yet.

- [ ] **Step 3: Add the helpers**

Append to `app/web/src/settings/agentPackageUpdateView.ts` (right after the existing `deriveNpmPackageUpdateTargets` function):

```ts
export type UpdateStatusIconKind = 'update' | 'current' | 'checking' | 'failed' | 'missing';

export const UPDATE_STATUS_ICON_CODICON: Record<UpdateStatusIconKind, string> = {
  update: 'codicon-arrow-up',
  current: 'codicon-check',
  checking: 'codicon-loading codicon-modifier-spin',
  failed: 'codicon-error',
  missing: 'codicon-circle-outline',
};

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
```

`RegistryNpmPackage` and `NpmPackageUpdateTarget` are already imported in this file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/web && npx jest src/settings/agentPackageUpdateView.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/web/src/settings/agentPackageUpdateView.ts app/web/src/settings/agentPackageUpdateView.test.ts
git commit -m "feat(app): add update status icon and npm updatable target helpers"
```

---

## Task 2: Write the component render tests (TDD — will fail against old JSX)

**Files:**
- Test: `app/web/src/settings/UpdateSettingsDetail.test.tsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `app/web/src/settings/UpdateSettingsDetail.test.tsx`:

```tsx
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
    agentPackageActionKey: () => '',
    agentPackageActionLabel: action => action,
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
  expect(json).toContain('Update All Hubs');
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
  expect(json).toContain('is-update');
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
  expect(json).toContain('codicon-trash');
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
  expect(json).toContain('Download and Install');
  expect(json).toContain('Check');
  expect(json).not.toContain('android-apk-update-meta-grid');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/web && npx jest src/settings/UpdateSettingsDetail.test.tsx`
Expected: FAIL — old component still renders `update-summary-bar` / `wheelmaker-release-history` / `android-apk-update-meta-grid` and lacks the new strings.

---

## Task 3: Rewrite `UpdateSettingsDetail.tsx`

**Files:**
- Modify: `app/web/src/settings/UpdateSettingsDetail.tsx` (full body rewrite; keep the `UpdateSettingsDetailProps` type block exactly as-is)

- [ ] **Step 1: Replace the imports and function body**

Replace the entire file content (the `UpdateSettingsDetailProps` type block — lines 1–109 in the current file — stays identical; only the import block and the `UpdateSettingsDetail` function body change). Use this as the new file content:

```tsx
import React from 'react';

import {
  resolveAndroidApkUpdateStatus,
  type AndroidApkLatestRelease,
  type AndroidApkLocalRelease,
  type AndroidApkUpdateStatus,
} from '../platform/android/androidApkUpdate';
import {
  androidApkStatusIcon,
  deriveNpmUpdatableTargets,
  deriveWheelMakerHubStatus,
  packageStatusLabel,
  projectIndexStatusIcon,
  shouldShowWheelMakerUpdateAction,
  UPDATE_STATUS_ICON_CODICON,
  wheelMakerHubStatusIcon,
  wheelMakerUpdateErrorLabel,
  wheelMakerUpdateJobActive,
  wheelMakerUpdateStatusLabel,
  wheelMakerVersionCopy,
  type NpmPackageUpdateTarget,
  type WheelMakerPublicMetadata,
} from './agentPackageUpdateView';
import type {
  RegistryFileIndexStatus,
  RegistryFileIndexStatusResponse,
  RegistryNpmHubSnapshot,
  RegistryNpmOperation,
  RegistryNpmPackage,
  RegistryProject,
  RegistryWheelMakerUpdateResponse,
} from '../registry/registryTypes';

type PackageAction = 'install' | 'update' | 'uninstall';

type WheelMakerUpdateHubView = {
  hubId: string;
  loading: boolean;
  error: string;
  data: RegistryWheelMakerUpdateResponse | null;
};

type AgentPackageHubView = {
  hubId: string;
  loading: boolean;
  error: string;
  updatedAt: string;
  hub: RegistryNpmHubSnapshot | null;
  operation: RegistryNpmOperation | null;
};

type UpdateHubCardView = {
  hubId: string;
  wheelMaker: WheelMakerUpdateHubView | null;
  agentPackage: AgentPackageHubView | null;
  projectIndex: RegistryFileIndexStatusResponse | null;
};

type UpdateSettingsDetailProps = {
  androidApkUpdateSupported: boolean;
  androidApkLocalRelease: AndroidApkLocalRelease | null;
  androidApkLatestRelease: AndroidApkLatestRelease | null;
  androidApkUpdateLoading: boolean;
  androidApkUpdateError: string;
  androidApkInstallStatus: string;
  androidApkInstallPending: boolean;
  refreshAndroidApkUpdate: () => Promise<void>;
  requestAndroidApkInstall: () => Promise<void>;
  updateHubCards: UpdateHubCardView[];
  projectIndexByHubId: Record<string, RegistryFileIndexStatusResponse>;
  projects: RegistryProject[];
  wheelMakerUpdatesLoading: boolean;
  wheelMakerUpdatesError: string;
  wheelMakerPublicMetadata: WheelMakerPublicMetadata | null;
  wheelMakerUpdatePendingHubId: string;
  wheelMakerUpdateAllPending: boolean;
  wheelMakerReleaseHistory: WheelMakerReleaseHistoryEntry[];
  wheelMakerReleaseHistoryLoading: boolean;
  wheelMakerReleaseHistoryError: string;
  requestWheelMakerUpdate: (hubId: string, data: RegistryWheelMakerUpdateResponse | null) => void;
  requestWheelMakerUpdateAll: (hubIds: string[]) => void;
  agentPackagesLoading: boolean;
  agentPackagesError: string;
  agentPackageActionPendingKey: string;
  agentPackageHubUpdatePendingId: string;
  expandedNpmUpdateHubIds: Record<string, boolean>;
  setExpandedNpmUpdateHubIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  requestAgentPackageAction: (action: PackageAction, hubId: string, pkg: RegistryNpmPackage) => void;
  requestAgentPackageHubUpdate: (hubId: string, packages: NpmPackageUpdateTarget[]) => void;
  projectIndexLoading: boolean;
  projectIndexError: string;
  projectIndexScanPendingByProjectId: Record<string, boolean>;
  projectIndexScanAllPendingByHubId: Record<string, boolean>;
  expandedProjectIndexHubIds: Record<string, boolean>;
  setExpandedProjectIndexHubIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  handleScanProjectIndex: (hubId: string, projectId: string) => Promise<void>;
  handleScanAllProjectIndexes: (hubId: string, projectIndexProjects: RegistryFileIndexStatus[]) => Promise<void>;
  tagVariantClass: (prefix: string, value: string) => string;
  hubAccentStyle: (hubId: string) => React.CSSProperties;
  shortDigest: (value: string) => string;
  formatWheelMakerDateTime: (value: string) => string;
  formatChatAttachmentSize: (size: number) => string;
  androidApkUpdateStatusLabel: (status: AndroidApkUpdateStatus) => string;
  androidApkInstallStatusLabel: (status: string) => string;
  agentPackageActionForPackage: (pkg: RegistryNpmPackage) => PackageAction | null;
  agentPackageActionKey: (hubId: string, packageName: string) => string;
  agentPackageActionLabel: (action: PackageAction) => string;
  projectFileIndexStatusLabel: (status: string) => string;
};

function hubStatusLabel(
  pending: boolean,
  jobActive: boolean,
  jobFailed: boolean,
  statusFailed: boolean,
  jobState: string,
): string {
  if (pending) return 'Requesting...';
  if (jobActive) return wheelMakerUpdateStatusLabel(jobState);
  if (jobFailed || statusFailed) return 'Retry';
  return 'Update Hub';
}

export function UpdateSettingsDetail({
  androidApkUpdateSupported,
  androidApkLocalRelease,
  androidApkLatestRelease,
  androidApkUpdateLoading,
  androidApkUpdateError,
  androidApkInstallPending,
  refreshAndroidApkUpdate,
  requestAndroidApkInstall,
  updateHubCards,
  projects,
  wheelMakerUpdatesLoading,
  wheelMakerUpdatesError,
  wheelMakerPublicMetadata,
  wheelMakerUpdatePendingHubId,
  wheelMakerUpdateAllPending,
  requestWheelMakerUpdate,
  requestWheelMakerUpdateAll,
  agentPackagesLoading,
  agentPackagesError,
  agentPackageActionPendingKey,
  agentPackageHubUpdatePendingId,
  expandedNpmUpdateHubIds,
  setExpandedNpmUpdateHubIds,
  requestAgentPackageAction,
  requestAgentPackageHubUpdate,
  projectIndexLoading,
  projectIndexError,
  projectIndexScanPendingByProjectId,
  projectIndexScanAllPendingByHubId,
  expandedProjectIndexHubIds,
  setExpandedProjectIndexHubIds,
  handleScanProjectIndex,
  handleScanAllProjectIndexes,
  tagVariantClass,
  hubAccentStyle,
  agentPackageActionForPackage,
  agentPackageActionKey,
  agentPackageActionLabel,
}: UpdateSettingsDetailProps) {
  const stableRelease = wheelMakerPublicMetadata?.stable ?? null;
  const androidApkUpdateStatus = resolveAndroidApkUpdateStatus(androidApkLocalRelease, androidApkLatestRelease);
  const androidApkIconKind = androidApkStatusIcon(androidApkUpdateStatus, androidApkUpdateLoading);
  const androidApkNoPermission = androidApkLocalRelease?.canRequestPackageInstalls === false;
  const androidApkInstallDisabled =
    androidApkInstallPending ||
    androidApkUpdateLoading ||
    !androidApkLatestRelease?.apk.downloadUrl ||
    !androidApkLatestRelease?.apk.sha256 ||
    androidApkUpdateStatus !== 'update_available' ||
    androidApkNoPermission;
  const wheelMakerRequestableHubIds = updateHubCards
    .filter(card => {
      const data = card.wheelMaker?.data;
      return data?.canRequestUpdate === true &&
        deriveWheelMakerHubStatus(data.installed, stableRelease, data.job) === 'update_available';
    })
    .map(card => card.hubId);
  const scanningHubs =
    wheelMakerUpdatesLoading ||
    agentPackagesLoading ||
    projectIndexLoading ||
    updateHubCards.some(card => card.wheelMaker?.loading === true || card.agentPackage?.loading === true);

  return (
    <>
      {androidApkUpdateSupported ? (
        <div className="settings-metadata-card android-apk-update-card">
          <div className="android-apk-update-row">
            <span className="codicon codicon-device-mobile" aria-hidden="true" />
            <span className="wheelmaker-update-scope">Android APK</span>
            <span className="android-apk-update-versions">
              {androidApkLocalRelease?.versionName ? `v${androidApkLocalRelease.versionName}` : '-'}
              {androidApkUpdateStatus === 'update_available' && androidApkLatestRelease?.tagName
                ? ` → ${androidApkLatestRelease.tagName}`
                : ''}
            </span>
            <span className={`update-status-icon is-${androidApkIconKind}`} aria-hidden="true">
              <span className={`codicon ${UPDATE_STATUS_ICON_CODICON[androidApkIconKind]}`} />
            </span>
            <div className="android-apk-update-actions">
              <button
                type="button"
                className="wheelmaker-update-action-btn android-apk-update-action-btn primary"
                disabled={androidApkInstallDisabled}
                title={androidApkNoPermission ? 'Install permission needed' : undefined}
                onClick={() => requestAndroidApkInstall().catch(() => undefined)}
              >
                {androidApkInstallPending ? 'Preparing...' : 'Download and Install'}
              </button>
              <button
                type="button"
                className="wheelmaker-update-action-btn android-apk-update-action-btn"
                disabled={androidApkUpdateLoading}
                onClick={() => refreshAndroidApkUpdate().catch(() => undefined)}
              >
                {androidApkUpdateLoading ? 'Checking...' : 'Check'}
              </button>
            </div>
          </div>
          {androidApkUpdateError ? (
            <div className="settings-metadata-error">{androidApkUpdateError}</div>
          ) : null}
        </div>
      ) : null}

      <div className="update-overview-bar">
        <span className="update-overview-version">
          <span className="update-overview-label">Latest</span>
          <span className="update-overview-value">{stableRelease?.version || '-'}</span>
        </span>
        <button
          type="button"
          className="wheelmaker-update-all-btn"
          disabled={wheelMakerRequestableHubIds.length === 0 || wheelMakerUpdateAllPending}
          onClick={() => requestWheelMakerUpdateAll(wheelMakerRequestableHubIds)}
        >
          <span className={`codicon ${wheelMakerUpdateAllPending ? 'codicon-loading codicon-modifier-spin' : 'codicon-cloud-download'}`} />
          <span>{wheelMakerUpdateAllPending ? 'Updating All Hubs...' : 'Update All Hubs'}</span>
        </button>
      </div>

      {(wheelMakerUpdatesLoading || agentPackagesLoading || projectIndexLoading) && updateHubCards.length === 0 ? (
        <div className="muted block">Scanning hubs...</div>
      ) : null}
      {wheelMakerUpdatesError || agentPackagesError || projectIndexError ? (
        <div className="muted block settings-metadata-error">{wheelMakerUpdatesError || agentPackagesError || projectIndexError}</div>
      ) : null}
      {!scanningHubs && updateHubCards.length === 0 && !wheelMakerUpdatesError && !agentPackagesError && !projectIndexError ? (
        <div className="muted block">No hubs available.</div>
      ) : null}

      <div className="settings-metadata-list agent-package-hub-list">
        {updateHubCards.map(card => {
          const wheelMaker = card.wheelMaker;
          const wheelMakerData = wheelMaker?.data ?? null;
          const wheelMakerStatus = deriveWheelMakerHubStatus(
            wheelMakerData?.installed,
            stableRelease,
            wheelMakerData?.job,
          );
          const wheelMakerJobActive = wheelMakerUpdateJobActive(wheelMakerData?.job);
          const wheelMakerJobFailed = wheelMakerData?.job?.state === 'failed';
          const wheelMakerViewData = wheelMakerData ? {
            ...wheelMakerData,
            status: wheelMakerStatus,
            canRequestUpdate: wheelMakerData.canRequestUpdate === true && wheelMakerStatus === 'update_available',
          } : null;
          const wheelMakerPending = wheelMakerUpdatePendingHubId === card.hubId;
          const showWheelMakerUpdateAction = shouldShowWheelMakerUpdateAction({
            data: wheelMakerViewData,
            loading: wheelMaker?.loading === true,
            pending: wheelMakerPending || wheelMakerUpdateAllPending,
          });
          const wheelMakerVersions = wheelMakerVersionCopy(wheelMakerData, stableRelease);
          const hubIconKind = wheelMakerHubStatusIcon(wheelMakerStatus, wheelMaker?.loading === true, wheelMakerJobActive);

          const agentCard = card.agentPackage;
          const hub = agentCard?.hub;
          const operation = agentCard?.operation;
          const allPackages = hub?.packages ?? [];
          const npmUpdatable = deriveNpmUpdatableTargets(allPackages);
          const npmExpanded = expandedNpmUpdateHubIds[card.hubId] === true;
          const npmHubUpdatePending = agentPackageHubUpdatePendingId === card.hubId;
          const npmActionDisabled = npmHubUpdatePending || operation?.running === true || agentCard?.loading === true || agentPackagesLoading;

          const projectIndexFallbackProjects: RegistryFileIndexStatus[] = projects
            .filter(project => (project.hubId || '').trim() === card.hubId)
            .map(project => ({
              projectId: project.projectId,
              name: project.name,
              path: project.path,
              status: 'missing',
              fileCount: 0,
            }));
          const projectIndexProjects = card.projectIndex?.projects?.length
            ? card.projectIndex.projects
            : projectIndexFallbackProjects;
          const projectIndexIndexedCount = projectIndexProjects.filter(project => project.status === 'indexed').length;
          const projectIndexExpanded = expandedProjectIndexHubIds[card.hubId] === true;
          const projectIndexScanAllPending = projectIndexScanAllPendingByHubId[card.hubId] === true;

          return (
            <div key={`update-hub:${card.hubId}`} className="settings-metadata-card agent-package-hub-card">
              <div className="update-hub-row">
                <span
                  className={`wide-project-hub-tag ${tagVariantClass('wide-project-hub', card.hubId)}`}
                  style={hubAccentStyle(card.hubId)}
                >
                  <span className="wide-project-hub-dot" aria-hidden="true" />
                  <span className="wide-project-hub-label">{card.hubId}</span>
                </span>
                <span className="update-hub-current-version">{wheelMakerVersions.current}</span>
                <span className={`update-status-icon is-${hubIconKind}`} aria-hidden="true">
                  <span className={`codicon ${UPDATE_STATUS_ICON_CODICON[hubIconKind]}`} />
                </span>
                {showWheelMakerUpdateAction ? (
                  <button
                    type="button"
                    className="wheelmaker-update-action-btn update-hub-action-btn"
                    disabled={wheelMakerUpdateAllPending || wheelMakerPending || wheelMakerJobActive}
                    onClick={() => requestWheelMakerUpdate(card.hubId, wheelMakerData)}
                  >
                    {hubStatusLabel(
                      wheelMakerPending,
                      wheelMakerJobActive,
                      wheelMakerJobFailed,
                      wheelMakerStatus === 'checking_failed',
                      wheelMakerData?.job?.state || '',
                    )}
                  </button>
                ) : null}
              </div>
              {wheelMaker?.error || wheelMakerData?.errorCode || wheelMakerData?.job?.errorCode ? (
                <div className="settings-metadata-error">
                  {wheelMaker?.error || wheelMakerUpdateErrorLabel(wheelMakerData?.job?.errorCode || wheelMakerData?.errorCode)}
                </div>
              ) : null}

              <section className="npm-update-section">
                <div className="npm-update-disclosure">
                  <button
                    type="button"
                    className="npm-update-disclosure-btn"
                    aria-expanded={npmExpanded}
                    onClick={() => setExpandedNpmUpdateHubIds(prev => ({...prev, [card.hubId]: !prev[card.hubId]}))}
                  >
                    <span className={`codicon ${npmExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} aria-hidden="true" />
                    <span className="npm-update-scope">NPM</span>
                    <span className="npm-update-count">{npmUpdatable.length} updates</span>
                    <span className="npm-update-total">{allPackages.length} packages</span>
                  </button>
                  <button
                    type="button"
                    className="npm-update-action-btn"
                    disabled={npmUpdatable.length === 0 || npmActionDisabled}
                    onClick={() => requestAgentPackageHubUpdate(card.hubId, npmUpdatable)}
                  >
                    {npmHubUpdatePending ? 'Updating...' : 'Update NPM'}
                  </button>
                </div>
                {npmExpanded ? (
                  <div className="npm-update-body">
                    {hub?.warning ? (<div className="settings-metadata-error">{hub.warning}</div>) : null}
                    {agentCard?.error || hub?.error ? (<div className="settings-metadata-error">{agentCard?.error || hub?.error}</div>) : null}
                    {operation ? (
                      <div className={`agent-package-task ${operation.status === 'failed' ? 'failed' : ''}`}>
                        <span>{packageStatusLabel(operation.status)}</span>
                        {operation.packageName ? <span>{operation.packageName}</span> : null}
                        {operation.message ? <span>{operation.message}</span> : null}
                        {operation.errorSummary ? <span>{operation.errorSummary}</span> : null}
                      </div>
                    ) : null}
                    <div className="agent-package-row-list">
                      {allPackages.map(pkg => {
                        const action = agentPackageActionForPackage(pkg);
                        const pendingKey = agentPackageActionKey(card.hubId, pkg.packageName);
                        const pending = agentPackageActionPendingKey === pendingKey || operation?.running === true || npmHubUpdatePending;
                        return (
                          <div key={`${card.hubId}:${pkg.packageName}`} className="agent-package-row">
                            <div className="agent-package-title-line">
                              <span className="settings-metadata-title" title={pkg.packageName}>{pkg.displayName}</span>
                            </div>
                            <div className="agent-package-action-line">
                              {action === 'update' ? (
                                <span className="agent-package-version-line">
                                  <span>{pkg.installedVersion || '-'}</span>
                                  <span className="agent-package-version-arrow" aria-hidden="true">→</span>
                                  <span>{pkg.latestVersion || '-'}</span>
                                </span>
                              ) : action === 'uninstall' ? (
                                <span className="agent-package-idle">Up to date</span>
                              ) : null}
                              {action === 'update' ? (
                                <button type="button" className="agent-package-action-btn" disabled={pending}
                                  onClick={() => requestAgentPackageAction('update', card.hubId, pkg)}>
                                  {pending ? 'Running...' : agentPackageActionLabel('update')}
                                </button>
                              ) : null}
                              {action === 'install' ? (
                                <button type="button" className="agent-package-action-btn" disabled={pending}
                                  onClick={() => requestAgentPackageAction('install', card.hubId, pkg)}>
                                  {pending ? 'Running...' : agentPackageActionLabel('install')}
                                </button>
                              ) : null}
                              {pkg.canUninstall ? (
                                <button type="button" className="agent-package-action-btn npm-row-uninstall-btn" disabled={pending}
                                  title={agentPackageActionLabel('uninstall')}
                                  aria-label={agentPackageActionLabel('uninstall')}
                                  onClick={() => requestAgentPackageAction('uninstall', card.hubId, pkg)}>
                                  <span className="codicon codicon-trash" aria-hidden="true" />
                                </button>
                              ) : null}
                            </div>
                            {pkg.error ? (<div className="settings-metadata-error">{pkg.error}</div>) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="project-index-section">
                <div className="project-index-disclosure">
                  <button
                    type="button"
                    className="npm-update-disclosure-btn project-index-disclosure-btn"
                    aria-expanded={projectIndexExpanded}
                    onClick={() => setExpandedProjectIndexHubIds(prev => ({...prev, [card.hubId]: !prev[card.hubId]}))}
                  >
                    <span className={`codicon ${projectIndexExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} aria-hidden="true" />
                    <span className="project-index-scope">Projects</span>
                    <span className="project-index-count">{projectIndexIndexedCount}/{projectIndexProjects.length} indexed</span>
                  </button>
                  <button
                    type="button"
                    className="project-index-action-btn"
                    disabled={projectIndexProjects.length === 0 || projectIndexScanAllPending}
                    onClick={() => handleScanAllProjectIndexes(card.hubId, projectIndexProjects)}
                  >
                    {projectIndexScanAllPending ? 'Scanning...' : 'Scan All'}
                  </button>
                </div>
                {projectIndexExpanded ? (
                  <div className="project-index-body">
                    {projectIndexProjects.length === 0 ? (
                      <div className="project-index-empty">No projects</div>
                    ) : projectIndexProjects.map(project => {
                      const projectPending = projectIndexScanPendingByProjectId[project.projectId] === true ||
                        project.running === true ||
                        project.status === 'scanning';
                      const projectIconKind = projectIndexStatusIcon(project.status, projectPending);
                      return (
                        <div key={`${card.hubId}:project-index:${project.projectId}`} className="project-index-row">
                          <span className="settings-metadata-title" title={project.name}>{project.name}</span>
                          <span className={`update-status-icon is-${projectIconKind}`} aria-hidden="true">
                            <span className={`codicon ${UPDATE_STATUS_ICON_CODICON[projectIconKind]}`} />
                          </span>
                          <button type="button" className="project-index-action-btn" disabled={projectPending}
                            onClick={() => handleScanProjectIndex(card.hubId, project.projectId)}>
                            {projectIndexScanPendingByProjectId[project.projectId] ? 'Scanning...' : 'Scan'}
                          </button>
                          {project.error ? (<div className="settings-metadata-error">{project.error}</div>) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            </div>
          );
        })}
      </div>
    </>
  );
}
```

Notes for the implementer:
- The `UpdateSettingsDetailProps` type is unchanged, so `WorkspaceApp.tsx` keeps compiling without edits.
- Props no longer rendered (`wheelMakerReleaseHistory*`, `projectIndexByHubId`, `shortDigest`, `formatWheelMakerDateTime`, `formatChatAttachmentSize`, `androidApkInstallStatus`, `androidApkUpdateStatusLabel`, `androidApkInstallStatusLabel`, `projectFileIndexStatusLabel`, `wheelMakerReleaseHistory*`) are simply removed from the destructure list — they remain declared on the type and passed by the parent, which is the agreed scope (spec: "父组件传入但本次不再使用的 prop 可保留不清理").
- Hub-level "Retry": the button label becomes `Retry` only when a job/state is failed **and** `shouldShowWheelMakerUpdateAction` still renders the button (i.e. the backend still reports `canRequestUpdate`). If a failed hub has no actionable request, only the error + failed icon show — consistent with today's behaviour.

- [ ] **Step 2: Run the component tests to verify they pass**

Run: `cd app/web && npx jest src/settings/UpdateSettingsDetail.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 3: Type-check the app**

Run: `cd app/web && npx tsc --noEmit`
Expected: no errors. (If the project's typecheck is exposed via a different script — check `app/web/package.json` `scripts` — run that instead.)

- [ ] **Step 4: Commit**

```bash
git add app/web/src/settings/UpdateSettingsDetail.tsx app/web/src/settings/UpdateSettingsDetail.test.tsx
git commit -m "feat(app): revamp update settings page with compact hub cards and unified status icons"
```

---

## Task 4: Clean up and add CSS

**Files:**
- Modify: `app/web/src/styles/settings.css`

- [ ] **Step 1: Delete dead selector blocks**

In `app/web/src/styles/settings.css`, remove these now-unused blocks (locate by selector name; keep `.settings-metadata-card`, `.settings-metadata-error`, `.wheelmaker-update-all-btn`, `.wheelmaker-update-action-btn`, `.agent-package-hub-card`, `.npm-update-section`, `.project-index-section`, `.npm-update-disclosure`, `.npm-update-disclosure-btn`, `.agent-package-row`, `.agent-package-action-btn`, `.project-index-action-btn`, `.agent-package-task`, `.settings-metadata-list`, `.settings-metadata-title`):

- `.android-apk-update-heading`, `.android-apk-update-title-stack`, `.android-apk-update-title-line` (+ its `.codicon` child), `.android-apk-update-subtitle`, `.android-apk-update-meta-grid`, `.android-apk-update-meta-item`, `.android-apk-update-meta-label` / `-subvalue`, `.android-apk-update-meta-value`, `.android-apk-update-install-state` (the whole 4-cell meta grid is gone).
- `.update-summary-bar`, `.update-summary-metrics`, `.update-summary-metric`, `.update-summary-value`, `.update-summary-label`, `.update-summary-state` (+ its `.codicon`), the `.update-summary-bar .wheelmaker-update-all-btn` rule, and the matching `.update-summary-*` entries inside the `@media (max-width: 640px)` block (keep the `.android-apk-update-*` mobile rules that still apply to the new single row, if any remain relevant — otherwise drop them too).
- `.wheelmaker-public-release` and its children (if present).
- `.wheelmaker-release-history`, `.wheelmaker-release-history-heading`, `.wheelmaker-release-history-list`, `.wheelmaker-release-history-item` (+ child rules).
- `.wheelmaker-update-panel` and all `.wheelmaker-update-panel > ...` / `.wheelmaker-update-title-line` / `.wheelmaker-update-version-line` / `.wheelmaker-update-ref-tag` / `.wheelmaker-update-behind` / `.wheelmaker-update-release-line(s)` / `-label` / `-value` / `-time` rules (the old per-hub Release panel).
- `.update-hub-header`, `.update-hub-title-stack`, `.update-hub-summary`, `.agent-package-hub-meta`, `.agent-package-name-line`, `.agent-package-name`, `.agent-package-agent-tags`, `.agent-package-version-status` (replaced by the new compact rows).

Also drop the `.update-summary-bar` entry in the shared responsive list near the end of the file (the one grouping `.settings-metadata-card, .update-summary-bar { ... }`) — keep `.settings-metadata-card` there, remove `.update-summary-bar`.

- [ ] **Step 2: Add the new compact-layout classes**

Append to `app/web/src/styles/settings.css`:

```css
.update-overview-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-raised) 86%, transparent);
}

.update-overview-version {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.update-overview-label {
  color: var(--text-secondary);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.update-overview-value {
  color: var(--text-primary);
  font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;
  font-size: 13px;
  font-weight: 700;
}

.update-status-icon {
  display: inline-flex;
  align-items: center;
  font-size: 13px;
  line-height: 1;
}

.update-status-icon .codicon {
  font-size: 13px;
}

.update-status-icon.is-update { color: var(--accent-primary); }
.update-status-icon.is-current { color: var(--state-success, #3fb950); }
.update-status-icon.is-checking { color: var(--text-secondary); }
.update-status-icon.is-failed { color: var(--state-danger); }
.update-status-icon.is-missing { color: var(--text-secondary); }

.android-apk-update-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.android-apk-update-row .wheelmaker-update-scope {
  font-size: 12px;
  font-weight: 700;
}

.android-apk-update-versions {
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;
  font-size: 11px;
}

.android-apk-update-actions {
  display: inline-flex;
  gap: 8px;
  margin-left: auto;
}

.update-hub-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.update-hub-current-version {
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;
  font-size: 11px;
}

.update-hub-action-btn {
  margin-left: auto;
}

.agent-package-action-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.agent-package-version-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;
  font-size: 11px;
}

.agent-package-version-arrow {
  color: var(--accent-primary);
}

.agent-package-idle {
  color: var(--text-secondary);
  font-size: 11px;
}

.npm-row-uninstall-btn {
  min-width: 0;
  padding: 0 8px;
  color: var(--text-secondary);
}

.npm-row-uninstall-btn:hover:not(:disabled) {
  color: var(--state-danger);
}

.npm-update-scope,
.project-index-scope {
  font-size: 12px;
  font-weight: 700;
}

@media (max-width: 640px) {
  .android-apk-update-actions {
    margin-left: 0;
    flex: 1 1 100%;
  }
  .update-hub-action-btn {
    margin-left: 0;
    flex: 1 1 100%;
  }
}
```

- [ ] **Step 3: Build to confirm CSS compiles**

Run: `cd app/web && npm run build` (or the project's build script — see `app/web/package.json`). The build output goes to `~/.wheelmaker/web` per repo convention.
Expected: build succeeds with no unresolved-class warnings.

- [ ] **Step 4: Commit**

```bash
git add app/web/src/styles/settings.css
git commit -m "style(app): replace update summary/history css with compact hub card layout"
```

---

## Task 5: Full verification

- [ ] **Step 1: Run the whole settings test suite**

Run: `cd app/web && npx jest src/settings`
Expected: PASS (includes the new `agentPackageUpdateView.test.ts` + `UpdateSettingsDetail.test.tsx` + existing `ReleasePublishSettings.test.tsx`).

- [ ] **Step 2: Run full type-check + build**

Run: `cd app/web && npx tsc --noEmit && npm run build`
Expected: no type errors, build succeeds.

- [ ] **Step 3: Final commit (if any stray cleanup remains)**

Only if steps 1–2 surfaced fixes not already committed:

```bash
git add -A
git commit -m "test(app): finalize update settings page revamp verification"
```

Otherwise skip — nothing to commit.

---

## Self-review

**1. Spec coverage** — checked against [spec-update-settings-revamp.md](spec-update-settings-revamp.md):
- 顶部瘦身（汇总条 / Release history / Stable published+publish 状态删除，留版本号 + Update All Hubs）→ Task 3 overview bar + Task 4 CSS delete. ✓
- 统一 icon 映射 → Task 1 + used in Task 3. ✓
- hub 当前版本 + icon + Update Hub，去重 → Task 3 `update-hub-row`. ✓
- NPM: Update NPM（只 canUpdate）+ 三态行（Install/Update/灰显 Up to date）+ 卸载 icon 按钮 + 未就绪禁用 → Task 3 NPM section + Task 1 `deriveNpmUpdatableTargets`. ✓
- Projects: Scan All + 每行（名+icon+Scan），去 path/fileCount/indexedAt → Task 3 Projects section. ✓
- Android 全砍 meta，单行 + Download/Check + 无权限禁用 → Task 3 Android card. ✓
- 功能保留（Update All Hubs / Update NPM / Scan All / 单包 install·update·uninstall / Android 下载安装 / Check / Retry）→ all callbacks reused in Task 3. ✓
- 失败场景（icon error、不阻塞、loading 禁用、空态）→ Task 3 error/loading/empty branches. ✓
- 旧 CSS 清理无大块残留 → Task 4 Step 1. ✓
- 测试切入点（顶部 / hub icon / NPM 三态 / Projects 精简 / Android 单行）→ Task 2. ✓

**2. Placeholder scan** — no TBD/TODO/“add error handling”/“similar to Task N”; every code step shows full code. ✓

**3. Type consistency** — `UpdateStatusIconKind` / `UPDATE_STATUS_ICON_CODICON` defined in Task 1, imported and indexed consistently in Task 3. `deriveNpmUpdatableTargets` returns `NpmPackageUpdateTarget[]`, passed to `requestAgentPackageHubUpdate(hubId, NpmPackageUpdateTarget[])` — matches the prop signature. `hubStatusLabel` args match its call site. Props type block copied verbatim from the current file, so all parent-passed props still typecheck. ✓

No spec gaps remain; the hub-level Retry nuance is documented inline in Task 3 rather than left ambiguous.
