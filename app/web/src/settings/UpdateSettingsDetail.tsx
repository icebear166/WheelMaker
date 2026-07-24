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

type PackageAction = 'install' | 'update' | 'uninstall' | 'reinstall';

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
  projectIndexScanAllPendingByHubId: Record<string,boolean>;
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
  restart: boolean,
  jobState: string,
): string {
  if (pending) return 'Requesting...';
  if (jobActive) return wheelMakerUpdateStatusLabel(jobState);
  if (jobFailed || statusFailed) return 'Retry';
  if (restart) return 'Restart';
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
            canRequestUpdate: wheelMakerData.canRequestUpdate === true &&
              (wheelMakerStatus === 'update_available' || wheelMakerStatus === 'up_to_date' || wheelMakerStatus === 'local_newer'),
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
                      wheelMakerStatus === 'up_to_date' || wheelMakerStatus === 'local_newer',
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
                              {pkg.installed ? (
                                <button type="button" className="agent-package-action-btn npm-row-reinstall-btn" disabled={pending}
                                  title={agentPackageActionLabel('reinstall')}
                                  aria-label={agentPackageActionLabel('reinstall')}
                                  onClick={() => requestAgentPackageAction('reinstall', card.hubId, pkg)}>
                                  <span className="codicon codicon-sync" aria-hidden="true" />
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
