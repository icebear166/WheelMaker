import type {RegistrySessionActionCapabilities} from '../../registry/registryTypes';
import {resolveChatSlashQuery} from '../composer/chatComposerTriggerQueries';

export type ChatSessionActionKind = 'status' | 'compact';

export type ChatSessionSlashOption = {
  name: string;
  description: string;
  kind: 'command' | 'skill';
  behavior: 'invoke' | 'insert';
  icon: string;
  enabled: boolean;
  disabledReason?: string;
  action?: ChatSessionActionKind;
};

export type StandaloneSessionActionResolution =
  | {kind: ChatSessionActionKind}
  | {kind: 'invalid'; command: '/status' | '/compact'}
  | null;

const unsupportedReason = 'Current Agent does not support this action.';

export function buildChatSessionActionOptions(
  skills: string[],
  capabilities?: RegistrySessionActionCapabilities,
): ChatSessionSlashOption[] {
  const compact = capabilities?.compact;
  const status = capabilities?.status;
  const fixed: ChatSessionSlashOption[] = [
    {
      name: '/compact',
      description: 'Compact this session\'s context',
      kind: 'command',
      behavior: 'invoke',
      icon: 'codicon-circle-large-outline',
      enabled: compact?.supported === true,
      disabledReason: compact?.supported ? undefined : compact?.reason || unsupportedReason,
      action: 'compact',
    },
    {
      name: '/status',
      description: 'Show session ID, context usage, and rate limits',
      kind: 'command',
      behavior: 'invoke',
      icon: 'codicon-dashboard',
      enabled: status?.supported === true,
      disabledReason: status?.supported ? undefined : status?.reason || unsupportedReason,
      action: 'status',
    },
  ];
  const deduped = new Map<string, string>();
  for (const rawSkill of skills) {
    const skill = rawSkill.trim().replace(/^\/+/, '');
    if (!skill) continue;
    const key = skill.toLowerCase();
    if (!deduped.has(key) && key !== 'status' && key !== 'compact') {
      deduped.set(key, skill);
    }
  }
  const skillOptions = Array.from(deduped.values())
    .sort((left, right) => left.localeCompare(right, undefined, {sensitivity: 'base'}))
    .map<ChatSessionSlashOption>(skill => ({
      name: `/${skill}`,
      description: 'Agent skill',
      kind: 'skill',
      behavior: 'insert',
      icon: 'codicon-wand',
      enabled: true,
    }));
  return [...fixed, ...skillOptions];
}

export function filterChatSessionActionOptions(
  options: ChatSessionSlashOption[],
  query: string | null,
): ChatSessionSlashOption[] {
  if (query === null) return [];
  const normalized = query.trim().replace(/^\/+/, '').toLowerCase();
  if (!normalized) return options;
  return options.filter(option =>
    option.name.toLowerCase().includes(normalized) ||
    option.description.toLowerCase().includes(normalized) ||
    option.kind.includes(normalized),
  );
}

export function resolveStandaloneSessionAction(text: string, attachmentCount: number): StandaloneSessionActionResolution {
  const trimmed = text.trim();
  const match = /^(\/compact|\/status)(?:\s|$)/i.exec(trimmed);
  if (!match) return null;
  const command = match[1].toLowerCase() as '/status' | '/compact';
  if (trimmed.toLowerCase() !== command || attachmentCount > 0) {
    return {kind: 'invalid', command};
  }
  return {kind: command.slice(1) as ChatSessionActionKind};
}

export function removeActiveSlashQuery(text: string, cursor: number): {text: string; cursor: number} {
  const query = resolveChatSlashQuery(text, cursor);
  if (!query) return {text, cursor};
  return {
    text: `${text.slice(0, query.start)}${text.slice(query.end)}`,
    cursor: query.start,
  };
}
