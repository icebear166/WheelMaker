import React from 'react';

import {Icon} from '../common/Icon';
import type {
  RegistrySkillDetail,
} from '../registry/registryTypes';
import {
  SkillDetailContent,
} from '../settings/SkillManagementContent';
import {
  skillActionPendingKey,
  skillDetailCacheKey,
  skillScopeLabel,
  type SkillDetailTarget,
  type SkillUninstallTarget,
} from '../settings/skillManagementView';

export type ChatHubSkillSurface = {kind: 'detail'; target: SkillDetailTarget};

export type ChatHubSkillDetailEntry = {
  loading: boolean;
  error: string;
  detail: RegistrySkillDetail | null;
};

export type ChatHubSkillCompanionProps = {
  surface: ChatHubSkillSurface;
  detail: {
    entries: Record<string, ChatHubSkillDetailEntry>;
    pendingKey: string;
    onUninstall: (target: SkillUninstallTarget) => void;
  };
  onClose: () => void;
};

export function ChatHubSkillCompanion({
  surface,
  detail,
  onClose,
}: ChatHubSkillCompanionProps) {
  const title = surface.target.skillName;
  const closeLabel = 'Close Skill details';
  const detailEntry = detail.entries[skillDetailCacheKey(surface.target)];
  const managed = detailEntry?.detail?.managed !== false;
  const uninstallPending = detail.pendingKey === skillActionPendingKey({
    ...surface.target,
    action: 'skillUninstall',
  });

  return (
    <div className="chat-hub-skill-companion-content">
      <header className="chat-hub-skill-companion-header">
        <span className="chat-hub-skill-companion-heading">
          <strong className="chat-hub-skill-companion-title">{title}</strong>
          <span className="chat-hub-skill-companion-scope">
            {skillScopeLabel(surface.target)}
          </span>
        </span>
        <button
          type="button"
          className="chat-hub-skill-companion-close"
          aria-label={closeLabel}
          onClick={onClose}
        >
          <Icon name="x" />
        </button>
      </header>
      <div className="chat-hub-skill-companion-body">
        <SkillDetailContent
          loading={detailEntry?.loading === true}
          error={detailEntry?.error ?? ''}
          detail={detailEntry?.detail ?? null}
        />
      </div>
      {detailEntry?.detail && managed ? (
        <footer className="chat-hub-skill-companion-footer">
          <button
            type="button"
            className="set-btn set-btn--danger"
            aria-label={`Uninstall ${surface.target.skillName}`}
            disabled={uninstallPending}
            onClick={() => detail.onUninstall(surface.target)}
          >
            <Icon name={uninstallPending ? 'loader' : 'trash'} spin={uninstallPending} />
            <span>{uninstallPending ? 'Uninstalling…' : 'Uninstall'}</span>
          </button>
        </footer>
      ) : null}
    </div>
  );
}
