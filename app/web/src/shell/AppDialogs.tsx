import React from 'react';
import type { ArchiveCandidate } from '../chat/session/sessionArchiveState';
import {Icon, type IconName} from '../common/Icon';
import {writeTextToClipboard} from '../platform/clipboard';
import { npmPackageUpdateSummary, type NpmPackageUpdateTarget } from '../settings/agentPackageUpdateView';
import { skillScopeLabel } from '../settings/skillManagementView';
import type {
  RegistrySessionGoal,
  RegistrySessionGoalPatch,
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
  | {
      kind: 'goalClear';
      projectId: string;
      sessionId: string;
      objective: string;
    }
  | {kind: 'clearDatabase'}
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
      action: 'update' | 'restart';
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
      skills?: string[];
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
  preserveChatHubMenu?: boolean;
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

type AppHtmlExportNameDialogProps = {
  open: boolean;
  nameStem: string;
  error: string;
  onNameStemChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

type AppGoalEditDialogProps = {
  goal: RegistrySessionGoal | null;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (patch: RegistrySessionGoalPatch) => void;
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
  if (target.kind === 'clearDatabase') return 'Clear database?';
  if (target.kind === 'archiveBatch') return `Archive sessions older than ${target.days} days?`;
  if (target.kind === 'restoreArchived') return 'Restore archived session?';
  if (target.kind === 'delete') return 'Delete session?';
  if (target.kind === 'goalClear') return 'Clear goal?';
  if (target.kind === 'npmPackage') return `${agentPackageActionLabel(target.action)} package?`;
  if (target.kind === 'npmPackageHubUpdate') return 'Update npm packages?';
  if (target.kind === 'wheelMakerUpdate') {
    return target.action === 'restart' ? 'Restart WheelMaker?' : 'Update WheelMaker?';
  }
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
  if (target.kind === 'clearDatabase') return 'All local data in this browser.';
  if (target.kind === 'archiveBatch') return `${target.candidates.length} sessions`;
  if (target.kind === 'restoreArchived') return target.title || 'Untitled session';
  if (target.kind === 'delete') return target.title || 'Untitled session';
  if (target.kind === 'goalClear') return target.objective;
  if (target.kind === 'npmPackage') return target.displayName || target.packageName;
  if (target.kind === 'npmPackageHubUpdate') {
    return `${target.hubId} - ${npmPackageUpdateSummary(target.packages.length)}`;
  }
  if (target.kind === 'wheelMakerUpdate') return `Hub: ${target.hubId}`;
  if (target.kind === 'wheelMakerUpdateAll') return `${target.hubIds.length} hubs`;
  if (target.kind === 'skillInstall') return skillScopeLabel(target);
  if (target.kind === 'skillUninstall') return target.skillName;
  if (target.kind === 'skillBatchUninstall') return `${target.skillNames.length} skills`;
  if (target.kind === 'skillUpdate') return target.skills?.length === 1 ? target.skills[0] : skillScopeLabel(target);
  return target.title || 'Untitled session';
}

function resolveConfirmCopy(target: ConfirmTarget): string {
  if (target.kind === 'hideMonitor') {
    return 'This hides Monitor from the chat workspace. You can show it again from Settings > Chat.';
  }
  if (target.kind === 'terminalClose') {
    return 'This terminates the terminal process tree and removes the terminal from every connected device.';
  }
  if (target.kind === 'clearDatabase') {
    return 'Every store in the local workspace database will be deleted, including settings, projects, chat history and file cache. The app will reload and you will need to sign in again.';
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
  if (target.kind === 'goalClear') {
    return 'The current turn will continue, but Goal will not start another turn. The objective and its saved progress will be removed.';
  }
  if (target.kind === 'npmPackage') {
    return `Hub: ${target.hubId}. Package: ${target.packageName}. Installed: ${target.installedVersion || '-'}. Target: ${target.action === 'uninstall' ? 'remove deprecated package' : target.latestVersion || 'latest'}. Agent availability refreshes automatically; running sessions are not interrupted.`;
  }
  if (target.kind === 'npmPackageHubUpdate') {
    return `Runs latest install/update for ${target.packages.map(pkg => pkg.displayName || pkg.packageName).join(', ')}. Agent availability refreshes automatically; running sessions are not interrupted.`;
  }
  if (target.kind === 'wheelMakerUpdate') {
    if (target.action === 'restart') {
      return `Current: ${target.currentVersion || '-'}. Restart does not download or update WheelMaker. The managed runtime reloads the latest environment variables.`;
    }
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
    if (target.skills?.length) {
      return `Updates ${target.skills.join(', ')} in ${skillScopeLabel(target)}.`;
    }
    return target.includeProjects
      ? 'Updates Hub Skills and online Project Skills on this Hub.'
      : `Updates installed skills in ${skillScopeLabel(target)}.`;
  }
  return 'Archived sessions leave the chat list.';
}

function resolveConfirmIcon(target: ConfirmTarget): IconName {
  if (target.kind === 'hideMonitor') return 'eyeOff';
  if (target.kind === 'terminalClose') return 'ban';
  if (target.kind === 'clearDatabase') return 'trash';
  if (target.kind === 'restoreArchived') return 'archiveRestore';
  if (target.kind === 'delete') return 'trash';
  if (target.kind === 'goalClear') return 'trash';
  if (target.kind === 'npmPackage') {
    return target.action === 'uninstall' ? 'trash' : 'cloudDownload';
  }
  if (target.kind === 'npmPackageHubUpdate') return 'cloudDownload';
  if (target.kind === 'wheelMakerUpdate') return target.action === 'restart' ? 'refreshCw' : 'cloudDownload';
  if (target.kind === 'wheelMakerUpdateAll') return 'cloudDownload';
  if (target.kind === 'skillInstall') return 'cloudDownload';
  if (target.kind === 'skillUninstall') return 'trash';
  if (target.kind === 'skillBatchUninstall') return 'trash';
  if (target.kind === 'skillUpdate') return 'refreshCw';
  return 'archive';
}

function resolveConfirmPrimaryLabel(target: ConfirmTarget): string {
  if (target.kind === 'hideMonitor') return 'Hide';
  if (target.kind === 'terminalClose') return 'Close Terminal';
  if (target.kind === 'clearDatabase') return 'Clear Database';
  if (target.kind === 'restoreArchived') return 'Restore';
  if (target.kind === 'delete') return 'Delete';
  if (target.kind === 'goalClear') return 'Clear Goal';
  if (target.kind === 'npmPackage') return agentPackageActionLabel(target.action);
  if (target.kind === 'npmPackageHubUpdate') return 'Update';
  if (target.kind === 'wheelMakerUpdate') return target.action === 'restart' ? 'Restart' : 'Update';
  if (target.kind === 'wheelMakerUpdateAll') return 'Update';
  if (target.kind === 'skillInstall') return 'Install';
  if (target.kind === 'skillUninstall') return 'Uninstall';
  if (target.kind === 'skillBatchUninstall') return 'Uninstall';
  if (target.kind === 'skillUpdate') return 'Update';
  return 'Archive';
}

function isDangerConfirmTarget(target: ConfirmTarget): boolean {
  return (
    target.kind === 'clearDatabase' ||
    target.kind === 'delete' ||
    target.kind === 'goalClear' ||
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
  preserveChatHubMenu = false,
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
      data-chat-hub-owned-overlay={preserveChatHubMenu ? 'true' : undefined}
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
          <Icon name={confirmIcon} size={17} />
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
            <Icon name={busy ? 'loader' : confirmIcon} spin={busy} />
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
          <Icon name="pencil" size={17} />
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
            <Icon name={busy ? 'loader' : 'check'} spin={busy} />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppHtmlExportNameDialog({
  open,
  nameStem,
  error,
  onNameStemChange,
  onCancel,
  onSubmit,
}: AppHtmlExportNameDialogProps) {
  if (!open) return null;

  return (
    <div
      className="app-confirm-backdrop"
      role="presentation"
      onPointerDown={onCancel}
    >
      <div
        className="app-confirm-dialog app-rename-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-html-export-name-title"
        onPointerDown={event => event.stopPropagation()}
      >
        <div className="app-confirm-icon">
          <Icon name="fileCode" size={17} />
        </div>
        <div className="app-confirm-content">
          <div id="app-html-export-name-title" className="app-confirm-title">
            Name HTML file
          </div>
          <div className="app-confirm-copy">Choose a name for this exported response.</div>
          <div className="app-html-export-name-field">
            <input
              className="app-rename-input app-html-export-name-input"
              type="text"
              value={nameStem}
              maxLength={155}
              autoFocus
              aria-label="HTML file name"
              aria-describedby={error ? 'app-html-export-name-error' : undefined}
              onChange={event => onNameStemChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (!error) {
                    onSubmit();
                  }
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onCancel();
                }
              }}
            />
            <span className="app-html-export-name-suffix" aria-hidden="true">.html</span>
          </div>
          {error ? (
            <div id="app-html-export-name-error" className="app-confirm-error">{error}</div>
          ) : null}
        </div>
        <div className="app-confirm-actions">
          <button
            type="button"
            className="app-confirm-btn secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="app-confirm-btn primary"
            disabled={Boolean(error)}
            onClick={onSubmit}
          >
            <Icon name="fileCode" />
            Export
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppGoalEditDialog({
  goal,
  busy,
  error,
  onCancel,
  onSubmit,
}: AppGoalEditDialogProps) {
  const [objectiveDraft, setObjectiveDraft] = React.useState('');
  const [budgetDraft, setBudgetDraft] = React.useState('');
  const [validationError, setValidationError] = React.useState('');

  React.useEffect(() => {
    setObjectiveDraft(goal?.objective ?? '');
    setBudgetDraft(goal?.tokenBudget === null || goal?.tokenBudget === undefined ? '' : String(goal.tokenBudget));
    setValidationError('');
  }, [goal?.sessionId]);

  if (!goal) return null;

  const submit = () => {
    const objective = objectiveDraft.trim();
    if (!objective) {
      setValidationError('Objective is required.');
      return;
    }
    if (Array.from(objective).length > 4000) {
      setValidationError('Objective must be 4,000 characters or fewer.');
      return;
    }
    const normalizedBudget = budgetDraft.trim();
    let tokenBudget: number | null = null;
    if (normalizedBudget) {
      tokenBudget = Number(normalizedBudget);
      if (!/^[1-9]\d*$/.test(normalizedBudget) || !Number.isSafeInteger(tokenBudget)) {
        setValidationError('Token budget must be a positive integer or left blank for unlimited.');
        return;
      }
    }
    const patch: RegistrySessionGoalPatch = {};
    if (objective !== goal.objective) {
      patch.objective = objective;
    }
    if (tokenBudget !== goal.tokenBudget) {
      patch.tokenBudget = tokenBudget;
    }
    if (Object.keys(patch).length === 0) {
      setValidationError('No changes to save.');
      return;
    }
    setValidationError('');
    onSubmit(patch);
  };

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
        className="app-confirm-dialog app-goal-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-goal-edit-title"
        onPointerDown={event => event.stopPropagation()}
      >
        <div className="app-confirm-icon">
          <Icon name="target" size={17} />
        </div>
        <div className="app-confirm-content">
          <div id="app-goal-edit-title" className="app-confirm-title">Edit goal</div>
          <label className="app-goal-edit-field">
            <span>Objective</span>
            <textarea
              className="app-goal-edit-objective"
              aria-label="Goal objective"
              value={objectiveDraft}
              autoFocus
              disabled={busy}
              onChange={event => {
                setObjectiveDraft(event.target.value);
                setValidationError('');
              }}
              onKeyDown={event => {
                if (event.key === 'Escape' && !busy) {
                  onCancel();
                }
              }}
            />
          </label>
          <label className="app-goal-edit-field">
            <span>Token budget</span>
            <input
              className="app-goal-edit-budget"
              type="text"
              inputMode="numeric"
              aria-label="Goal token budget"
              value={budgetDraft}
              placeholder="Unlimited"
              disabled={busy}
              onChange={event => {
                setBudgetDraft(event.target.value);
                setValidationError('');
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submit();
                }
                if (event.key === 'Escape' && !busy) {
                  onCancel();
                }
              }}
            />
          </label>
          <div className="app-confirm-copy">Leave token budget blank for unlimited.</div>
          {validationError || error ? (
            <div className="app-confirm-error" role="alert">{validationError || error}</div>
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
            aria-label="Save goal changes"
            disabled={busy}
            onClick={submit}
          >
            <Icon name={busy ? 'loader' : 'check'} spin={busy} />
            Save changes
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
              <span className="app-session-status-id-value">
                <code>{sessionId}</code>
                <button
                  type="button"
                  className="app-session-status-copy"
                  aria-label="Copy session ID"
                  title="Copy session ID"
                  onClick={() => {
                    void writeTextToClipboard(sessionId).catch(() => undefined);
                  }}
                >
                  <Icon name="copy" />
                </button>
              </span>
            </div>
            {status?.agentType ? (
              <div className="app-session-status-id" data-testid="session-status-agent">
                <span>Agent</span>
                <code>{status.agentType}</code>
              </div>
            ) : null}
          </div>
          <button type="button" className="app-session-status-close" onClick={onClose} aria-label="Close session status">
            <Icon name="x" />
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

          {loading ? (
            <div className="app-session-status-loading" aria-label="Refreshing session status">
              <Icon name="loader" spin />
              Refreshing status…
            </div>
          ) : null}
          {error ? <div className="app-confirm-error" role="alert">{error}</div> : null}
        </div>

        <div className="app-session-status-actions">
          <button type="button" className="app-confirm-btn secondary" onClick={onRefresh} disabled={loading}>
            <Icon name={loading ? 'loader' : 'refreshCw'} spin={loading} />
            Refresh
          </button>
          <button type="button" className="app-confirm-btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
