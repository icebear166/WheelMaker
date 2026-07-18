import React from 'react';

import {
  resolveAndroidApkUpdateStatus,
  type AndroidApkLatestRelease,
  type AndroidApkLocalRelease,
  type AndroidApkUpdateStatus,
} from '../platform/android/androidApkUpdate';
import {
  deriveNpmPackageUpdateTargets,
  deriveWheelMakerHubStatus,
  npmPackageUpdateSummary,
  packageStatusLabel,
  shouldShowWheelMakerUpdateAction,
  wheelMakerPublishStatusLabel,
  wheelMakerUpdateErrorLabel,
  wheelMakerUpdateJobActive,
  wheelMakerUpdateStatusLabel,
  wheelMakerVersionCopy,
  type NpmPackageUpdateTarget,
  type WheelMakerPublicMetadata,
  type WheelMakerReleaseHistoryEntry,
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

export function UpdateSettingsDetail({
  androidApkUpdateSupported,
  androidApkLocalRelease,
  androidApkLatestRelease,
  androidApkUpdateLoading,
  androidApkUpdateError,
  androidApkInstallStatus,
  androidApkInstallPending,
  refreshAndroidApkUpdate,
  requestAndroidApkInstall,
  updateHubCards,
  projectIndexByHubId,
  projects,
  wheelMakerUpdatesLoading,
  wheelMakerUpdatesError,
  wheelMakerPublicMetadata,
  wheelMakerUpdatePendingHubId,
  wheelMakerUpdateAllPending,
  wheelMakerReleaseHistory,
  wheelMakerReleaseHistoryLoading,
  wheelMakerReleaseHistoryError,
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
  shortDigest,
  formatWheelMakerDateTime,
  formatChatAttachmentSize,
  androidApkUpdateStatusLabel,
  androidApkInstallStatusLabel,
  agentPackageActionForPackage,
  agentPackageActionKey,
  agentPackageActionLabel,
  projectFileIndexStatusLabel,
}: UpdateSettingsDetailProps) {
  const androidApkUpdateStatus = resolveAndroidApkUpdateStatus(androidApkLocalRelease, androidApkLatestRelease);
  const androidApkCurrentSha = androidApkLocalRelease?.apkSha256 || '';
  const androidApkLatestSha = androidApkLatestRelease?.apk.sha256 || '';
  const stableRelease = wheelMakerPublicMetadata?.stable ?? null;
  const wheelMakerPublishCopy = wheelMakerPublishStatusLabel(
    wheelMakerPublicMetadata?.publishStatus,
  );
  const wheelMakerUpdateAvailableCount = updateHubCards.filter(card => {
    const data = card.wheelMaker?.data;
    const status = deriveWheelMakerHubStatus(data?.installed, stableRelease, data?.job);
    return status === 'update_available' || status === 'update_pending';
  }).length;
  const wheelMakerRequestableHubIds = updateHubCards
    .filter(card => {
      const data = card.wheelMaker?.data;
      return data?.canRequestUpdate === true &&
        deriveWheelMakerHubStatus(data.installed, stableRelease, data.job) === 'update_available';
    })
    .map(card => card.hubId);
  const npmUpdateAvailableCount = updateHubCards.reduce(
    (total, card) => total + deriveNpmPackageUpdateTargets(card.agentPackage?.hub?.packages ?? []).length,
    0,
  );
  const projectIndexedCount = Object.values(projectIndexByHubId).reduce(
    (total, hub) => total + (hub.projects ?? []).filter(project => project.status === 'indexed').length,
    0,
  );
  const updateSummaryScanning =
    wheelMakerUpdatesLoading ||
    agentPackagesLoading ||
    projectIndexLoading ||
    updateHubCards.some(card => card.wheelMaker?.loading === true || card.agentPackage?.loading === true);
  const androidApkInstallDisabled =
    androidApkInstallPending ||
    androidApkUpdateLoading ||
    !androidApkLatestRelease?.apk.downloadUrl ||
    !androidApkLatestSha ||
    androidApkUpdateStatus === 'up_to_date';

  return (
    <>
      {androidApkUpdateSupported ? (
        <div className="settings-metadata-card android-apk-update-card">
          <div className="android-apk-update-heading">
            <div className="android-apk-update-title-stack">
              <div className="android-apk-update-title-line">
                <span className="codicon codicon-device-mobile" aria-hidden="true" />
                <span className="wheelmaker-update-scope">Android APK</span>
              </div>
              <span className="android-apk-update-subtitle">Wheel Maker app package</span>
            </div>
            <span className={`agent-package-status status-${androidApkUpdateStatus}`}>
              {androidApkUpdateLoading ? 'Checking' : androidApkUpdateStatusLabel(androidApkUpdateStatus)}
            </span>
          </div>
          <div className="android-apk-update-meta-grid">
            <div className="android-apk-update-meta-item" title={`Current ${androidApkCurrentSha || '-'}`}>
              <span className="android-apk-update-meta-label">Current</span>
              <span className="android-apk-update-meta-value">
                {androidApkLocalRelease?.versionName
                  ? `v${androidApkLocalRelease.versionName} (${androidApkLocalRelease.versionCode || '-'})`
                  : '-'}
              </span>
              <span className="android-apk-update-meta-subvalue">{shortDigest(androidApkCurrentSha)}</span>
            </div>
            <div className="android-apk-update-meta-item" title={`Latest ${androidApkLatestSha || '-'}`}>
              <span className="android-apk-update-meta-label">Latest</span>
              <span className="android-apk-update-meta-value">{androidApkLatestRelease?.tagName || '-'}</span>
              <span className="android-apk-update-meta-subvalue">{shortDigest(androidApkLatestSha)}</span>
            </div>
            <div className="android-apk-update-meta-item">
              <span className="android-apk-update-meta-label">Published</span>
              <span className="android-apk-update-meta-value">{formatWheelMakerDateTime(androidApkLatestRelease?.publishedAt || '')}</span>
              <span className="android-apk-update-meta-subvalue">
                {androidApkLatestRelease?.apk.size ? formatChatAttachmentSize(androidApkLatestRelease.apk.size) : 'Size unknown'}
              </span>
            </div>
            <div className="android-apk-update-meta-item">
              <span className="android-apk-update-meta-label">Install</span>
              <span className="android-apk-update-meta-value">
                {androidApkLocalRelease
                  ? androidApkLocalRelease.canRequestPackageInstalls === false ? 'Permission needed' : 'Ready'
                  : '-'}
              </span>
              <span className="android-apk-update-meta-subvalue">{androidApkInstallStatus ? androidApkInstallStatusLabel(androidApkInstallStatus) : '-'}</span>
            </div>
          </div>
          {androidApkUpdateError ? (
            <div className="settings-metadata-error">{androidApkUpdateError}</div>
          ) : null}
          <div className="android-apk-update-actions">
            <button
              type="button"
              className="wheelmaker-update-action-btn android-apk-update-action-btn"
              disabled={androidApkUpdateLoading}
              onClick={() => refreshAndroidApkUpdate().catch(() => undefined)}
            >
              {androidApkUpdateLoading ? 'Checking...' : 'Check'}
            </button>
            <button
              type="button"
              className="wheelmaker-update-action-btn android-apk-update-action-btn primary"
              disabled={androidApkInstallDisabled}
              onClick={() => requestAndroidApkInstall().catch(() => undefined)}
            >
              {androidApkInstallPending ? 'Preparing...' : 'Download and Install'}
            </button>
          </div>
        </div>
      ) : null}
      <section className="settings-metadata-card wheelmaker-public-release">
        <div className="settings-metadata-line">
          <span className="wheelmaker-update-scope">Stable release</span>
          <span className="settings-metadata-title">
            {wheelMakerPublicMetadata?.stable.version || '-'}
          </span>
        </div>
        <div className="settings-metadata-line">
          <span>Published</span>
          <span>{formatWheelMakerDateTime(wheelMakerPublicMetadata?.stable.publishedAt || '')}</span>
        </div>
        {wheelMakerPublishCopy ? (
          <div className="wheelmaker-publish-status">
            Publish: {wheelMakerPublishCopy}
          </div>
        ) : null}
      </section>
      <div className="update-summary-bar">
        <div className="update-summary-metrics">
          <div className="update-summary-metric">
            <span className="update-summary-value">{updateHubCards.length}</span>
            <span className="update-summary-label">Hubs</span>
          </div>
          <div className="update-summary-metric">
            <span className="update-summary-value">{wheelMakerUpdateAvailableCount}</span>
            <span className="update-summary-label">Release updates</span>
          </div>
          <div className="update-summary-metric">
            <span className="update-summary-value">{npmUpdateAvailableCount}</span>
            <span className="update-summary-label">NPM updates</span>
          </div>
          <div className="update-summary-metric">
            <span className="update-summary-value">{projectIndexedCount}</span>
            <span className="update-summary-label">Indexed projects</span>
          </div>
          <div className="update-summary-metric update-summary-state">
            <span className={`codicon ${updateSummaryScanning ? 'codicon-loading codicon-modifier-spin' : 'codicon-check'}`} aria-hidden="true" />
            <span className="update-summary-label">{updateSummaryScanning ? 'Scanning' : 'Current scan idle'}</span>
          </div>
        </div>
        <button
          type="button"
          className="wheelmaker-update-all-btn"
          disabled={wheelMakerRequestableHubIds.length === 0 || wheelMakerUpdateAllPending}
          onClick={() => requestWheelMakerUpdateAll(wheelMakerRequestableHubIds)}
        >
          <span
            className={`codicon ${
              wheelMakerUpdateAllPending
                ? 'codicon-loading codicon-modifier-spin'
                : 'codicon-cloud-download'
            }`}
          />
          <span>{wheelMakerUpdateAllPending ? 'Updating All Hubs...' : 'Update All Hubs'}</span>
        </button>
      </div>
      <section className="settings-metadata-card wheelmaker-release-history">
        <div className="wheelmaker-release-history-heading">
          <span className="wheelmaker-update-scope">Release history</span>
          {wheelMakerReleaseHistoryLoading ? (
            <span className="muted">Loading...</span>
          ) : (
            <span className="muted">{wheelMakerReleaseHistory.length} releases</span>
          )}
        </div>
        {wheelMakerReleaseHistoryError ? (
          <div className="settings-metadata-error">{wheelMakerReleaseHistoryError}</div>
        ) : null}
        {wheelMakerReleaseHistory.length > 0 ? (
          <div className="wheelmaker-release-history-list">
            {wheelMakerReleaseHistory.map(release => (
              <a
                key={`${release.version}:${release.publishedAt}`}
                className="wheelmaker-release-history-item"
                href={release.url || undefined}
                target="_blank"
                rel="noreferrer"
              >
                <span>{release.version}</span>
                <span>{formatWheelMakerDateTime(release.publishedAt)}</span>
              </a>
            ))}
          </div>
        ) : !wheelMakerReleaseHistoryLoading && !wheelMakerReleaseHistoryError ? (
          <div className="muted">No releases.</div>
        ) : null}
      </section>
      {(wheelMakerUpdatesLoading || agentPackagesLoading || projectIndexLoading) && updateHubCards.length === 0 ? (
        <div className="muted block">Scanning hubs...</div>
      ) : null}
      {wheelMakerUpdatesError || agentPackagesError || projectIndexError ? (
        <div className="muted block settings-metadata-error">{wheelMakerUpdatesError || agentPackagesError || projectIndexError}</div>
      ) : null}
      {!wheelMakerUpdatesLoading && !agentPackagesLoading && !projectIndexLoading && updateHubCards.length === 0 && !wheelMakerUpdatesError && !agentPackagesError && !projectIndexError ? (
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
          const wheelMakerViewData = wheelMakerData ? {
            ...wheelMakerData,
            status: wheelMakerStatus,
            canRequestUpdate:
              wheelMakerData.canRequestUpdate === true &&
              wheelMakerStatus === 'update_available',
          } : null;
          const agentCard = card.agentPackage;
          const hub = agentCard?.hub;
          const operation = agentCard?.operation;
          const npmUpdateTargets = deriveNpmPackageUpdateTargets(hub?.packages ?? []);
          const npmExpanded = expandedNpmUpdateHubIds[card.hubId] === true;
          const npmHubUpdatePending = agentPackageHubUpdatePendingId === card.hubId;
          const npmActionDisabled = npmHubUpdatePending || operation?.running === true || agentCard?.loading === true;
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
          const wheelMakerPending = wheelMakerUpdatePendingHubId === card.hubId;
          const showWheelMakerUpdateAction = shouldShowWheelMakerUpdateAction({
            data: wheelMakerViewData,
            loading: wheelMaker?.loading === true,
            pending: wheelMakerPending || wheelMakerUpdateAllPending,
          });
          const wheelMakerVersions = wheelMakerVersionCopy(wheelMakerData, stableRelease);
          const wheelMakerCurrentTime = formatWheelMakerDateTime(
            wheelMakerData?.installed?.publishedAt || wheelMakerData?.installed?.installedAt || '',
          );
          const wheelMakerJobActive = wheelMakerUpdateJobActive(wheelMakerData?.job);
          return (
            <div key={`update-hub:${card.hubId}`} className="settings-metadata-card agent-package-hub-card">
              <div className="settings-metadata-line settings-metadata-line-tags update-hub-header">
                <div className="update-hub-title-stack">
                  <span
                    className={`wide-project-hub-tag ${tagVariantClass('wide-project-hub', card.hubId)}`}
                    style={hubAccentStyle(card.hubId)}
                  >
                    <span className="wide-project-hub-dot" aria-hidden="true" />
                    <span className="wide-project-hub-label">{card.hubId}</span>
                  </span>
                  <span className="update-hub-summary">
                    {wheelMaker?.loading ? 'Checking release' : wheelMakerUpdateStatusLabel(wheelMakerStatus)}
                    {' / '}
                    {npmPackageUpdateSummary(npmUpdateTargets.length)}
                    {' / '}
                    {projectIndexIndexedCount}/{projectIndexProjects.length} indexed
                  </span>
                </div>
                {wheelMaker?.loading || agentCard?.loading ? (
                  <span className="wide-session-agent-tag">Scanning</span>
                ) : null}
              </div>
              <div className="wheelmaker-update-panel">
                <div className="wheelmaker-update-title-line">
                  <span className="wheelmaker-update-scope">Release</span>
                  <span className={`agent-package-status status-${wheelMakerStatus}`}>
                    {wheelMaker?.loading ? 'Checking' : wheelMakerUpdateStatusLabel(wheelMakerStatus)}
                  </span>
                </div>
                <div className="wheelmaker-update-version-line">
                  <span className="wheelmaker-update-ref-tag">
                    {wheelMakerVersions.current}
                  </span>
                  {wheelMakerData?.job ? (
                    <span className="wheelmaker-update-behind">
                      {wheelMakerUpdateStatusLabel(wheelMakerData.job.state)}
                    </span>
                  ) : null}
                </div>
                <div className="wheelmaker-update-release-lines">
                  <div className="wheelmaker-update-release-line" title={`Current ${wheelMakerVersions.current} ${wheelMakerCurrentTime}`}>
                    <span className="wheelmaker-update-release-label">Current</span>
                    <span className="wheelmaker-update-release-value">{wheelMakerVersions.current}</span>
                    <span className="wheelmaker-update-release-time">{wheelMakerCurrentTime}</span>
                  </div>
                </div>
                {wheelMaker?.error || wheelMakerData?.errorCode || wheelMakerData?.job?.errorCode ? (
                  <div className="settings-metadata-error">
                    {wheelMaker?.error || wheelMakerUpdateErrorLabel(wheelMakerData?.job?.errorCode || wheelMakerData?.errorCode)}
                  </div>
                ) : null}
                {showWheelMakerUpdateAction ? (
                  <button
                    type="button"
                    className="wheelmaker-update-action-btn"
                    disabled={wheelMakerUpdateAllPending || wheelMakerPending || wheelMakerUpdateJobActive(wheelMakerData?.job)}
                    onClick={() => requestWheelMakerUpdate(card.hubId, wheelMakerData)}
                  >
                    {wheelMakerPending
                      ? 'Requesting...'
                      : wheelMakerJobActive
                        ? wheelMakerUpdateStatusLabel(wheelMakerData?.job?.state || '')
                        : 'Update'}
                  </button>
                ) : null}
              </div>
              <section className="npm-update-section">
                <div className="npm-update-disclosure">
                  <button
                    type="button"
                    className="npm-update-disclosure-btn"
                    aria-expanded={npmExpanded}
                    onClick={() => setExpandedNpmUpdateHubIds(prev => ({
                      ...prev,
                      [card.hubId]: !prev[card.hubId],
                    }))}
                  >
                    <span className={`codicon ${npmExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} aria-hidden="true" />
                    <span className="npm-update-count">{npmPackageUpdateSummary(npmUpdateTargets.length)}</span>
                    <span className="npm-update-total">{hub?.packages.length ?? 0} packages</span>
                  </button>
                  {npmExpanded ? (
                    <button
                      type="button"
                      className="npm-update-action-btn"
                      disabled={npmUpdateTargets.length === 0 || npmActionDisabled}
                      onClick={() => requestAgentPackageHubUpdate(card.hubId, npmUpdateTargets)}
                    >
                      {npmHubUpdatePending ? 'Updating...' : 'Update All'}
                    </button>
                  ) : null}
                </div>
                {npmExpanded ? (
                  <div className="npm-update-body">
                    {hub?.warning ? (
                      <div className="settings-metadata-line settings-metadata-error">{hub.warning}</div>
                    ) : null}
                    {agentCard?.error || hub?.error ? (
                      <div className="settings-metadata-line settings-metadata-error">{agentCard?.error || hub?.error}</div>
                    ) : null}
                    {operation ? (
                      <div className={`agent-package-task ${operation.status === 'failed' ? 'failed' : ''}`}>
                        <span>{packageStatusLabel(operation.status)}</span>
                        {operation.packageName ? <span>{operation.packageName}</span> : null}
                        {operation.message ? <span>{operation.message}</span> : null}
                        {operation.errorSummary ? <span>{operation.errorSummary}</span> : null}
                      </div>
                    ) : null}
                    <div className="agent-package-row-list">
                      {(hub?.packages ?? []).map(pkg => {
                        const action = agentPackageActionForPackage(pkg);
                        const pendingKey = agentPackageActionKey(card.hubId, pkg.packageName);
                        const pending = agentPackageActionPendingKey === pendingKey || operation?.running === true || npmHubUpdatePending;
                        return (
                          <div key={`${card.hubId}:${pkg.packageName}`} className="agent-package-row">
                            <div className="agent-package-title-line">
                              <span className="settings-metadata-title" title={pkg.displayName}>{pkg.displayName}</span>
                              {pkg.agentTypes.length > 0 ? (
                                <span className="agent-package-agent-tags">
                                  {pkg.agentTypes.map(agent => (
                                    <span key={`${pkg.packageName}:${agent}`} className={`wide-session-agent-tag ${tagVariantClass('wide-session-agent', agent)}`}>
                                      {agent}
                                    </span>
                                  ))}
                                </span>
                              ) : null}
                            </div>
                            <div className="agent-package-name-line">
                              <span className="agent-package-name" title={pkg.packageName}>{pkg.packageName}</span>
                            </div>
                            {action ? (
                              <button
                                type="button"
                                className={`agent-package-action-btn ${action === 'uninstall' ? 'danger' : ''}`}
                                disabled={pending}
                                onClick={() => requestAgentPackageAction(action, card.hubId, pkg)}
                              >
                                {pending ? 'Running...' : agentPackageActionLabel(action)}
                              </button>
                            ) : null}
                            <div className="agent-package-version-line">
                              <span>Installed: {pkg.installedVersion || '-'}</span>
                              <span>Latest: {pkg.latestVersion || '-'}</span>
                              <span className={`agent-package-status agent-package-version-status status-${pkg.status}`}>{packageStatusLabel(pkg.status)}</span>
                            </div>
                            {pkg.error ? (
                              <div className="settings-metadata-error">{pkg.error}</div>
                            ) : null}
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
                    onClick={() => setExpandedProjectIndexHubIds(prev => ({
                      ...prev,
                      [card.hubId]: !prev[card.hubId],
                    }))}
                  >
                    <span className={`codicon ${projectIndexExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} aria-hidden="true" />
                    <span className="project-index-count">Projects - {projectIndexProjects.length} projects - {projectIndexIndexedCount} indexed</span>
                    <span className="project-index-total">{projectIndexLoading ? 'Refreshing' : 'File index'}</span>
                  </button>
                  {projectIndexExpanded ? (
                    <button
                      type="button"
                      className="project-index-action-btn"
                      disabled={projectIndexProjects.length === 0 || projectIndexScanAllPending}
                      onClick={() => handleScanAllProjectIndexes(card.hubId, projectIndexProjects)}
                    >
                      {projectIndexScanAllPendingByHubId[card.hubId] ? 'Scanning...' : 'Scan All'}
                    </button>
                  ) : null}
                </div>
                {projectIndexExpanded ? (
                  <div className="project-index-body">
                    {projectIndexProjects.length === 0 ? (
                      <div className="project-index-empty">No projects</div>
                    ) : projectIndexProjects.map(project => {
                      const projectPending = projectIndexScanPendingByProjectId[project.projectId] === true ||
                        project.running === true ||
                        project.status === 'scanning';
                      return (
                        <div key={`${card.hubId}:project-index:${project.projectId}`} className="project-index-row">
                          <div className="project-index-main">
                            <span className="settings-metadata-title" title={project.name}>{project.name}</span>
                            <span className="project-index-path" title={project.path}>{project.path || '-'}</span>
                          </div>
                          <div className="project-index-meta">
                            <span className={`agent-package-status status-${project.status}`}>
                              {projectPending ? 'Scanning' : projectFileIndexStatusLabel(project.status)}
                            </span>
                            <span>{project.fileCount || 0} files</span>
                            {project.indexedAt ? <span>{formatWheelMakerDateTime(project.indexedAt)}</span> : null}
                          </div>
                          {project.error ? (
                            <div className="settings-metadata-error">{project.error}</div>
                          ) : null}
                          <button
                            type="button"
                            className="project-index-action-btn"
                            disabled={projectPending}
                            onClick={() => handleScanProjectIndex(card.hubId, project.projectId)}
                          >
                            {projectIndexScanPendingByProjectId[project.projectId] ? 'Scanning...' : 'Scan'}
                          </button>
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
