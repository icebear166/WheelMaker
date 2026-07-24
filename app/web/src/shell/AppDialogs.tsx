import React from 'react';
import type { ArchiveCandidate } from '../chat/session/sessionArchiveState';
import { npmPackageUpdateSummary, type NpmPackageUpdateTarget } from '../settings/agentPackageUpdateView';
import { skillScopeLabel } from '../settings/skillManagementView';
import type {
  RegistrySessionStatusResult,
  RegistrySessionUsage,
  RegistrySkillScope,
} from '../registry/registryTypes';

export type RenameSessionTarget = {
  projectId: string;
  sessionId: string;
  title: string;
};

export type ConfirmTarget =
  | {
      kind: 'archive';
      projectId: string;
      sessionId: string;
      title: string;
    }
  | {
      kind: 'archiveBatch';
      days: number;
      candidates: ArchiveCandidate[];
    }
  | {
      kind: 'restoreArchived';
      projectId: string;
      sessionId: string;
      title: string;
    }
  | {
      kind: 'delete';
      projectId: string;
      sessionId: string;
      title: string;
    }
  | {kind: 'clearCache'}
  | {
      kind: 'npmPackage';
      action: 'install' | 'update' | 'uninstall' | 'reinstall';
      hubId: string;
      packageName: string;
      displayName: string;
      installedVersion: string;
      latestVersion: string;
    }
  | {
      kind: 'npmPackageHubUpdate';
      hubId: string;
      packages: NpmPackageUpdateTarget[];
    }
  | {
      kind: 'wheelMakerUpdate';
      hubId: string;
      currentVersion: string;
      latestVersion: string;
    }
  | {
      kind: 'wheelMakerUpdateAll';
      hubIds: string[];
    }
  | {
      kind: 'skillInstall';
      hubId: string;
      scope: RegistrySkillScope;
      projectName?: string;
      source: string;
      skills: string[];
    }
  | {
      kind: 'skillUninstall';
      hubId: string;
      scope: RegistrySkillScope;
      projectName?: string;
      skillName: string;
    }
  | {
      kind: 'skillBatchUninstall';
      hubId: string;
      scope: RegistrySkillScope;
      projectName?: string;
      skillNames: string[];
    }
  | {
      kind: 'skillUpdate';
      hubId: string;
      scope: RegistrySkillScope;
      projectName?: string;
      includeProjects?: boolean;
    }
  | {
      kind: 'terminalClose';
      hubId: string;
      terminalId: string;
      label: string;
    }
  | {kind: 'hideMonitor'};

type AppConfirmDialogProps = {
  target: ConfirmTarget | null;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onPrimary: () => void;
};

type AppRenameDialogProps = {
  target: RenameSessionTarget | null;
  titleDraft: string;
  error: string;
  busy: boolean;
  onTitleDraftChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

export type AppSessionStatusDialogProps = {
  sessionId: string;
  cachedUsage?: RegistrySessionUsage;
  status: RegistrySessionStatusResult | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRefresh: () => void;
};

function formatStatusPlan(value: string | undefined): string {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatStatusReset(value: string | undefined): string {
  if (!value) return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

function agentPackageActionLabel(action: 'install' | 'update' | 'uninstall' | 'reinstall'): string {
  switch (action) {
    case 'update':
      return 'Update';
    case 'uninstall':
      return 'Uninstall';
    case 'reinstall':
      return 'Reinstall';
    default:
      return 'Install';
  }
}

function resolveConfirmTitle(target: ConfirmTarget): string {
  if (target.kind === 'hideMonitor') return 'Hide monitor?';
  if (target.kind === 'terminalClose') return 'Close running terminal?';
  if (target.kind === 'clearCache') return 'Clear local cache?';
  if (target.kind === 'archiveBatch') return `Archive sessions older than ${target.days} days?`;
  if (target.kind === 'restoreArchived') return 'Restore archived session?';
  if (target.kind === 'delete') return 'Delete session?';
  if (target.kind === 'npmPackage') return `${agentPackageActionLabel(target.action)} package?`;
  if (target.kind === 'npmPackageHubUpdate') return 'Update npm packages?';
  if (target.kind === 'wheelMakerUpdate') return 'Update WheelMaker?';
  if (target.kind === 'wheelMakerUpdateAll') return 'Update all hubs?';
  if (target.kind === 'skillInstall') return 'Install skills?';
  if (target.kind === 'skillUninstall') return 'Uninstall skill?';
  if (target.kind === 'skillBatchUninstall') return 'Uninstall skills?';
  if (target.kind === 'skillUpdate') return 'Update skills?';
  return 'Archive session?';
}

function resolveConfirmName(target: ConfirmTarget): string {
  if (target.kind === 'hideMonitor') return 'Monitor';
  if (target.kind === 'terminalClose') return target.label;
  if (target.kind === 'clearCache') return 'Settings will be preserved.';
  if (target.kind === 'archiveBatch') return `${target.candidates.length} sessions`;
  if (target.kind === 'restoreArchived') return target.title || 'Untitled session';
  if (target.kind === 'delete') return target.title || 'Untitled session';
  if (target.kind === 'npmPackage') return target.displayName || target.packageName;
  if (target.kind === 'npmPackageHubUpdate') {
    return `${target.hubId} - ${npmPackageUpdateSummary(target.packages.length)}`;
  }
  if (target.kind === 'wheelMakerUpdate') return `Hub: ${target.hubId}`;
  if (target.kind === 'wheelMakerUpdateAll') return `${target.hubIds.length} hubs`;
  if (target.kind === 'skillInstall') return skillScopeLabel(target);
  if (target.kind === 'skillUninstall') return target.skillName;
  if (target.kind === 'skillBatchUninstall') return `${target.skillNames.length} skills`;
  if (target.kind === 'skillUpdate') return skillScopeLabel(target);
  return target.title || 'Untitled session';
}

function resolveConfirmCopy(target: ConfirmTarget): string {
  if (target.kind === 'hideMonitor') {
    return 'This hides Monitor from the chat workspace. You can show it again from Settings > Chat.';
  }
  if (target.kind === 'terminalClose') {
    return 'This terminates the terminal process tree and removes the terminal from every connected device.';
  }
  if (target.kind === 'clearCache') {
    return 'The app will reload after local cached workspace data is cleared.';
  }
  if (target.kind === 'archiveBatch') {
    return 'Runs one archive call at a time across all known projects. Running sessions are skipped.';
  }
  if (target.kind === 'restoreArchived') {
    return 'The session returns to its project and opens after restore.';
  }
  if (target.kind === 'delete') {
    return 'This permanently deletes the session data from the Hub.';
  }
  if (target.kind === 'npmPackage') {
    return `Hub: ${target.hubId}. Package: ${target.packageName}. Installed: ${target.installedVersion || '-'}. Target: ${target.action === 'uninstall' ? 'remove deprecated package' : target.latestVersion || 'latest'}. Restart WheelMaker or start a new agent session for changes to take effect.`;
  }
  if (target.kind === 'npmPackageHubUpdate') {
    return `Runs latest install/update for ${target.packages.map(pkg => pkg.displayName || pkg.packageName).join(', ')}. Restart WheelMaker or start a new agent session for changes to take effect.`;
  }
  if (target.kind === 'wheelMakerUpdate') {
    return `Current: ${target.currentVersion || '-'}. Latest: ${target.latestVersion || '-'}. The current-user updater will download and verify the stable release, deploy it, and restart Hub.`;
  }
  if (target.kind === 'wheelMakerUpdateAll') {
    return `This requests the verified stable release on ${target.hubIds.length} hubs. Each current-user updater deploys and restarts its Hub independently.`;
  }
  if (target.kind === 'skillInstall') {
    return `Source: ${target.source}. Skills: ${target.skills.join(', ')}.`;
  }
  if (target.kind === 'skillUninstall') {
    return `Remove from ${skillScopeLabel(target)}.`;
  }
  if (target.kind === 'skillBatchUninstall') {
    return `Remove from ${skillScopeLabel(target)}: ${target.skillNames.join(', ')}.`;
  }
  if (target.kind === 'skillUpdate') {
    return target.includeProjects
      ? 'Updates Hub Skills and online Project Skills on this Hub.'
      : `Updates installed skills in ${skillScopeLabel(target)}.`;
  }
  return 'Archived sessions leave the chat list.';
}

function resolveConfirmIcon(target: ConfirmTarget): string {
  if (target.kind === 'hideMonitor') return 'codicon-eye-closed';
  if (target.kind === 'terminalClose') return 'codicon-debug-stop';
  if (target.kind === 'clearCache') return 'codicon-trash';
  if (target.kind === 'restoreArchived') return 'codicon-debug-restart';
  if (target.kind === 'delete') return 'codicon-trash';
  if (target.kind === 'npmPackage') {
    return target.action === 'uninstall' ? 'codicon-trash' : 'codicon-cloud-download';
  }
  if (target.kind === 'npmPackageHubUpdate') return 'codicon-cloud-download';
  if (target.kind === 'wheelMakerUpdate') return 'codicon-cloud-download';
  if (target.kind === 'wheelMakerUpdateAll') return 'codicon-cloud-download';
  if (target.kind === 'skillInstall') return 'codicon-cloud-download';
  if (target.kind === 'skillUninstall') return 'codicon-trash';
  if (target.kind === 'skillBatchUninstall') return 'codicon-trash';
  if (target.kind === 'skillUpdate') return 'codicon-sync';
  return 'codicon-archive';
}

function resolveConfirmPrimaryLabel(target: ConfirmTarget): string {
  if (target.kind === 'hideMonitor') return 'Hide';
  if (target.kind === 'terminalClose') return 'Close Terminal';
  if (target.kind === 'clearCache') return 'Clear Cache';
  if (target.kind === 'restoreArchived') return 'Restore';
  if (target.kind === 'delete') return 'Delete';
  if (target.kind === 'npmPackage') return agentPackageActionLabel(target.action);
  if (target.kind === 'npmPackageHubUpdate') return 'Update';
  if (target.kind === 'wheelMakerUpdate') return 'Update';
  if (target.kind === 'wheelMakerUpdateAll') return 'Update';
  if (target.kind === 'skillInstall') return 'Install';
  if (target.kind === 'skillUninstall') return 'Uninstall';
  if (target.kind === 'skillBatchUninstall') return 'Uninstall';
  if (target.kind === 'skillUpdate') return 'Update';
  return 'Archive';
}

function isDangerConfirmTarget(target: ConfirmTarget): boolean {
  return (
    target.kind === 'clearCache' ||
    target.kind === 'delete' ||
    target.kind === 'terminalClose' ||
    (target.kind === 'npmPackage' && target.action === 'uninstall') ||
    target.kind === 'skillUninstall' ||
    target.kind === 'skillBatchUninstall'
  );
}

export function AppConfirmDialog({
  target,
  busy,
  error,
  onCancel,
  onPrimary,
}: AppConfirmDialogProps) {
  if (!target) return null;

  const confirmTitle = resolveConfirmTitle(target);
  const confirmName = resolveConfirmName(target);
  const confirmCopy = resolveConfirmCopy(target);
  const confirmIcon = resolveConfirmIcon(target);
  const confirmPrimaryLabel = resolveConfirmPrimaryLabel(target);
  const confirmPrimaryClassName = isDangerConfirmTarget(target)
    ? 'app-confirm-btn primary danger'
    : 'app-confirm-btn primary';
  const confirmIconClassName = isDangerConfirmTarget(target)
    ? 'app-confirm-icon danger'
    : 'app-confirm-icon';

  return (
    <div
      className="app-confirm-backdrop"
      role="presentation"
      onPointerDown={() => {
        if (!busy) {
          onCancel();
        }
      }}
    >
      <div
        className="app-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-confirm-title"
        onPointerDown={event => event.stopPropagation()}
      >
        <div className={confirmIconClassName}>
          <span className={`codicon ${confirmIcon}`} />
        </div>
        <div className="app-confirm-content">
          <div id="app-confirm-title" className="app-confirm-title">
            {confirmTitle}
          </div>
          <div className="app-confirm-name">{confirmName}</div>
          <div className="app-confirm-copy">{confirmCopy}</div>
          {error ? (
            <div className="app-confirm-error">{error}</div>
          ) : null}
        </div>
        <div className="app-confirm-actions">
          <button
            type="button"
            className="app-confirm-btn secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={confirmPrimaryClassName}
            disabled={busy}
            onClick={onPrimary}
          >
            <span
              className={`codicon ${
                busy
                  ? 'codicon-loading codicon-modifier-spin'
                  : confirmIcon
              }`}
            />
            {confirmPrimaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppRenameDialog({
  target,
  titleDraft,
  error,
  busy,
  onTitleDraftChange,
  onCancel,
  onSubmit,
}: AppRenameDialogProps) {
  if (!target) return null;

  return (
    <div
      className="app-confirm-backdrop"
      role="presentation"
      onPointerDown={() => {
        if (!busy) {
          onCancel();
        }
      }}
    >
      <div
        className="app-confirm-dialog app-rename-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-rename-title"
        onPointerDown={event => event.stopPropagation()}
      >
        <div className="app-confirm-icon">
          <span className="codicon codicon-edit" />
        </div>
        <div className="app-confirm-content">
          <div id="app-rename-title" className="app-confirm-title">
            Rename session
          </div>
          <div className="app-confirm-name">{target.title || target.sessionId}</div>
          <input
            className="app-rename-input"
            type="text"
            value={titleDraft}
            maxLength={200}
            autoFocus
            disabled={busy}
            onChange={event => onTitleDraftChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSubmit();
              }
              if (event.key === 'Escape' && !busy) {
                onCancel();
              }
            }}
          />
          <div className="app-confirm-copy">Saving an empty title restores the automatic first prompt title.</div>
          {error ? (
            <div className="app-confirm-error">{error}</div>
          ) : null}
        </div>
        <div className="app-confirm-actions">
          <button
            type="button"
            className="app-confirm-btn secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="app-confirm-btn primary"
            disabled={busy}
            onClick={onSubmit}
          >
            <span
              className={`codicon ${
                busy
                  ? 'codicon-loading codicon-modifier-spin'
                  : 'codicon-check'
              }`}
            />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppSessionStatusDialog({
  sessionId,
  cachedUsage,
  status,
  loading,
  error,
  onClose,
  onRefresh,
}: AppSessionStatusDialogProps) {
  React.useEffect(() => {
    if (!sessionId) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, sessionId]);

  if (!sessionId) return null;
  const context = status?.context ?? cachedUsage;
  const account = status?.account;
  const plan = formatStatusPlan(account?.planType);

  return (
    <div className="app-confirm-backdrop" role="presentation" onPointerDown={onClose}>
      <div
        className="app-session-status-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-session-status-title"
        onPointerDown={event => event.stopPropagation()}
      >
        <div className="app-session-status-header">
          <div>
            <div id="app-session-status-title" className="app-session-status-title">Session status</div>
            <div className="app-session-status-id" data-testid="session-status-id">
              <span>Session ID</span>
              <code>{sessionId}</code>
            </div>
          </div>
          <button type="button" className="app-session-status-close" onClick={onClose} aria-label="Close session status">
            <span className="codicon codicon-close" aria-hidden="true" />
          </button>
        </div>

        <div className="app-session-status-body">
          <section className="app-session-status-section" data-testid="session-status-context">
            <div className="app-session-status-section-title">Context</div>
            {context ? (
              <div className="app-session-status-context-value">
                <strong>{context.used.toLocaleString('en-US')}</strong>
                {typeof context.size === 'number' ? <span> / {context.size.toLocaleString('en-US')} tokens</span> : <span> tokens used</span>}
              </div>
            ) : <div className="app-session-status-muted">Context usage is not available yet.</div>}
          </section>

          {status?.limits.length ? (
            <section className="app-session-status-section">
              <div className="app-session-status-section-title">Rate limits</div>
              <div className="app-session-status-limits">
                {status.limits.map(limit => (
                  <div key={limit.id} className="app-session-status-limit">
                    <div className="app-session-status-limit-heading">
                      <span>{limit.name}</span>
                      <strong>{limit.remainingPercent}% remaining</strong>
                    </div>
                    <div className="app-session-status-limit-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={limit.remainingPercent}>
                      <span className="app-session-status-limit-fill" style={{width: `${limit.remainingPercent}%`}} />
                    </div>
                    {limit.resetsAt ? <div className="app-session-status-muted">Resets {formatStatusReset(limit.resetsAt)}</div> : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {account ? (
            <section className="app-session-status-section">
              <div className="app-session-status-section-title">Account</div>
              <dl className="app-session-status-account">
                {plan ? <><dt>Plan</dt><dd>{plan}</dd></> : null}
                {account.credits ? <><dt>Credits</dt><dd>{account.credits.unlimited ? 'Unlimited' : account.credits.balance ?? (account.credits.hasCredits ? 'Available' : 'None')}</dd></> : null}
                {account.individualLimit ? <><dt>Individual limit</dt><dd>{account.individualLimit.used} / {account.individualLimit.limit} ({account.individualLimit.remainingPercent}% remaining)</dd></> : null}
                {account.rateLimitResetCredits ? <><dt>Reset credits</dt><dd>{account.rateLimitResetCredits.availableCount}</dd></> : null}
              </dl>
            </section>
          ) : null}

          {loading ? (
            <div className="app-session-status-loading" aria-label="Refreshing session status">
              <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
              Refreshing limits…
            </div>
          ) : null}
          {error ? <div className="app-confirm-error" role="alert">{error}</div> : null}
        </div>

        <div className="app-session-status-actions">
          <button type="button" className="app-confirm-btn secondary" onClick={onRefresh} disabled={loading}>
            <span className={`codicon ${loading ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh'}`} aria-hidden="true" />
            Refresh
          </button>
          <button type="button" className="app-confirm-btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
