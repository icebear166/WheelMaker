import React from 'react';

import {Icon} from '../common/Icon';
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

function updateStatusDotVariant(kind: 'update' | 'current' | 'checking' | 'failed' | 'missing'): string {
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
  androidApkUpdateStatusLabel,
  projectFileIndexStatusLabel,
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
        <div className="set-card set-card--tight update-apk-card">
          <div className="update-apk-row">
            <Icon name="smartphone" size={15} className="update-apk-icon" />
            <span className="update-apk-scope">Android APK</span>
            <span className="update-apk-versions set-mono set-num">
              {androidApkLocalRelease?.versionName ? `v${androidApkLocalRelease.versionName}` : '-'}
              {androidApkUpdateStatus === 'update_available' && androidApkLatestRelease?.tagName
                ? ` → ${androidApkLatestRelease.tagName}`
                : ''}
            </span>
            <span
              className={`set-status ${updateStatusDotVariant(androidApkIconKind)}`}
              title={androidApkUpdateStatusLabel(androidApkUpdateStatus)}
              aria-label={androidApkUpdateStatusLabel(androidApkUpdateStatus)}
            />
            <span className="set-card-spacer" />
            <div className="update-apk-actions">
              <button
                type="button"
                className="set-btn set-btn--primary"
                disabled={androidApkInstallDisabled}
                title={androidApkNoPermission ? 'Install permission needed' : undefined}
                onClick={() => requestAndroidApkInstall().catch(() => undefined)}
              >
                {androidApkInstallPending ? 'Preparing...' : 'Download & Install'}
              </button>
              <button
                type="button"
                className="set-btn"
                disabled={androidApkUpdateLoading}
                onClick={() => refreshAndroidApkUpdate().catch(() => undefined)}
              >
                {androidApkUpdateLoading ? <Icon name="loader" spin size={13} /> : null}
                {androidApkUpdateLoading ? 'Checking...' : 'Check'}
              </button>
            </div>
          </div>
          {androidApkUpdateError ? (
            <div className="set-error">{androidApkUpdateError}</div>
          ) : null}
        </div>
      ) : null}

      <div className="update-overview">
        <span className="update-overview-version">
          <span className="update-overview-label">Latest</span>
          <span className="update-overview-value set-mono set-num">{stableRelease?.version || '-'}</span>
        </span>
        <button
          type="button"
          className="set-btn set-btn--primary set-btn--lg"
          disabled={wheelMakerRequestableHubIds.length === 0 || wheelMakerUpdateAllPending}
          onClick={() => requestWheelMakerUpdateAll(wheelMakerRequestableHubIds)}
        >
          {wheelMakerUpdateAllPending ? <Icon name="loader" spin size={14} /> : <Icon name="cloudDownload" size={14} />}
          <span>{wheelMakerUpdateAllPending ? 'Updating all hubs...' : 'Update all hubs'}</span>
        </button>
      </div>

      {(wheelMakerUpdatesLoading || agentPackagesLoading || projectIndexLoading) && updateHubCards.length === 0 ? (
        <div className="set-muted">Scanning hubs...</div>
      ) : null}
      {wheelMakerUpdatesError || agentPackagesError || projectIndexError ? (
        <div className="set-error">{wheelMakerUpdatesError || agentPackagesError || projectIndexError}</div>
      ) : null}
      {!scanningHubs && updateHubCards.length === 0 && !wheelMakerUpdatesError && !agentPackagesError && !projectIndexError ? (
        <div className="set-muted">No hubs available.</div>
      ) : null}

      <div className="update-hub-list">
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
            <div key={`update-hub:${card.hubId}`} className="set-card update-hub-card">
              <div className="update-hub-row">
                <span
                  className={`wide-project-hub-tag ${tagVariantClass('wide-project-hub', card.hubId)}`}
                  style={hubAccentStyle(card.hubId)}
                >
                  <span className="wide-project-hub-dot" aria-hidden="true" />
                  <span className="wide-project-hub-label">{card.hubId}</span>
                </span>
                <span className="update-hub-current-version set-mono set-num">{wheelMakerVersions.current}</span>
                <span
                  className={`set-status ${updateStatusDotVariant(hubIconKind)}`}
                  title={wheelMakerUpdateStatusLabel(wheelMakerData?.job?.state || '') || wheelMakerStatus}
                  aria-label={wheelMakerStatus}
                />
                <span className="set-card-spacer" />
                {showWheelMakerUpdateAction ? (
                  <button
                    type="button"
                    className="set-btn set-btn--primary"
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
                <div className="set-error">
                  {wheelMaker?.error || wheelMakerUpdateErrorLabel(wheelMakerData?.job?.errorCode || wheelMakerData?.errorCode)}
                </div>
              ) : null}

              <section className="set-disclosure">
                <div className="set-disclosure-head">
                  <button
                    type="button"
                    className="set-disclosure-btn"
                    aria-expanded={npmExpanded}
                    onClick={() => setExpandedNpmUpdateHubIds(prev => ({...prev, [card.hubId]: !prev[card.hubId]}))}
                  >
                    <Icon name="chevronRight" size={13} />
                    <span className="update-disclosure-scope">NPM</span>
                    <span className="set-disclosure-count set-num">{npmUpdatable.length} updates</span>
                    <span className="update-disclosure-total set-num">{allPackages.length} packages</span>
                  </button>
                  <button
                    type="button"
                    className="set-btn"
                    disabled={npmUpdatable.length === 0 || npmActionDisabled}
                    onClick={() => requestAgentPackageHubUpdate(card.hubId, npmUpdatable)}
                  >
                    {npmHubUpdatePending ? 'Updating...' : 'Update NPM'}
                  </button>
                </div>
                {npmExpanded ? (
                  <div className="set-disclosure-body">
                    {hub?.warning ? (<div className="set-error">{hub.warning}</div>) : null}
                    {agentCard?.error || hub?.error ? (<div className="set-error">{agentCard?.error || hub?.error}</div>) : null}
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
                                <span className="agent-package-version-line set-mono">
                                  <span>{pkg.installedVersion || '-'}</span>
                                  <span className="agent-package-version-arrow" aria-hidden="true">→</span>
                                  <span>{pkg.latestVersion || '-'}</span>
                                </span>
                              ) : action === 'uninstall' ? (
                                <span className="agent-package-idle">Up to date</span>
                              ) : null}
                              {action === 'update' ? (
                                <button type="button" className="set-btn set-btn--primary" disabled={pending}
                                  onClick={() => requestAgentPackageAction('update', card.hubId, pkg)}>
                                  {pending ? 'Running...' : agentPackageActionLabel('update')}
                                </button>
                              ) : null}
                              {action === 'install' ? (
                                <button type="button" className="set-btn set-btn--primary" disabled={pending}
                                  onClick={() => requestAgentPackageAction('install', card.hubId, pkg)}>
                                  {pending ? 'Running...' : agentPackageActionLabel('install')}
                                </button>
                              ) : null}
                              {pkg.installed ? (
                                <button type="button" className="set-btn set-btn--icon" disabled={pending}
                                  title={agentPackageActionLabel('reinstall')}
                                  aria-label={agentPackageActionLabel('reinstall')}
                                  onClick={() => requestAgentPackageAction('reinstall', card.hubId, pkg)}>
                                  <Icon name="refreshCw" size={13} />
                                </button>
                              ) : null}
                              {pkg.canUninstall ? (
                                <button type="button" className="set-btn set-btn--icon set-btn--danger" disabled={pending}
                                  title={agentPackageActionLabel('uninstall')}
                                  aria-label={agentPackageActionLabel('uninstall')}
                                  onClick={() => requestAgentPackageAction('uninstall', card.hubId, pkg)}>
                                  <Icon name="trash" size={13} />
                                </button>
                              ) : null}
                            </div>
                            {pkg.error ? (<div className="set-error">{pkg.error}</div>) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="set-disclosure">
                <div className="set-disclosure-head">
                  <button
                    type="button"
                    className="set-disclosure-btn"
                    aria-expanded={projectIndexExpanded}
                    onClick={() => setExpandedProjectIndexHubIds(prev => ({...prev, [card.hubId]: !prev[card.hubId]}))}
                  >
                    <Icon name="chevronRight" size={13} />
                    <span className="update-disclosure-scope">Projects</span>
                    <span className="set-disclosure-count set-num">{projectIndexIndexedCount}/{projectIndexProjects.length} indexed</span>
                  </button>
                  <button
                    type="button"
                    className="set-btn"
                    disabled={projectIndexProjects.length === 0 || projectIndexScanAllPending}
                    onClick={() => handleScanAllProjectIndexes(card.hubId, projectIndexProjects)}
                  >
                    {projectIndexScanAllPending ? 'Scanning...' : 'Scan all'}
                  </button>
                </div>
                {projectIndexExpanded ? (
                  <div className="set-disclosure-body">
                    {projectIndexProjects.length === 0 ? (
                      <div className="set-muted">No projects</div>
                    ) : projectIndexProjects.map(project => {
                      const projectPending = projectIndexScanPendingByProjectId[project.projectId] === true ||
                        project.running === true ||
                        project.status === 'scanning';
                      const projectIconKind = projectIndexStatusIcon(project.status, projectPending);
                      return (
                        <div key={`${card.hubId}:project-index:${project.projectId}`} className="project-index-row">
                          <span className="settings-metadata-title" title={project.name}>{project.name}</span>
                          <span
                            className={`set-status ${updateStatusDotVariant(projectIconKind)}`}
                            title={projectFileIndexStatusLabel(project.status)}
                            aria-label={projectFileIndexStatusLabel(project.status)}
                          />
                          <button type="button" className="set-btn" disabled={projectPending}
                            onClick={() => handleScanProjectIndex(card.hubId, project.projectId)}>
                            {projectIndexScanPendingByProjectId[project.projectId] ? 'Scanning...' : 'Scan'}
                          </button>
                          {project.error ? (<div className="set-error">{project.error}</div>) : null}
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
