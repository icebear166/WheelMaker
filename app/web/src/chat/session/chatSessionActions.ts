import type {
  RegistrySessionActionCapabilities,
  RegistrySessionConfigOption,
} from '../../registry/registryTypes';
import type {ChatIconName} from '../ChatIcon';
import {resolveChatSlashQuery} from '../composer/chatComposerTriggerQueries';

export type ChatSessionActionKind = 'status' | 'compact' | 'fast';

export type ChatSessionSkill = {
  name: string;
  description?: string;
};

export type ChatSessionSlashOption = {
  name: string;
  description: string;
  kind: 'command' | 'skill';
  behavior: 'invoke' | 'insert' | 'insert-command';
  insertText?: string;
  icon: ChatIconName;
  enabled: boolean;
  disabledReason?: string;
  action?: ChatSessionActionKind;
  checked?: boolean;
};

export type StandaloneSessionActionResolution =
  | {kind: ChatSessionActionKind}
  | {kind: 'invalid'; command: '/status' | '/compact' | '/fast'}
  | null;

const unsupportedReason = 'Current Agent does not support this action.';

export function buildChatSessionActionOptions(
  skills: Array<string | ChatSessionSkill>,
  capabilities?: RegistrySessionActionCapabilities,
  configOptions: RegistrySessionConfigOption[] = [],
): ChatSessionSlashOption[] {
  const compact = capabilities?.compact;
  const status = capabilities?.status;
  const goal = capabilities?.goal;
  const fastMode = configOptions.find(option => option.id === 'fast_mode');
  const fixed: ChatSessionSlashOption[] = [
    {
      name: '/compact',
      description: 'Compact this session\'s context',
      kind: 'command',
      behavior: 'invoke',
      icon: 'circle',
      enabled: compact?.supported === true,
      disabledReason: compact?.supported ? undefined : compact?.reason || unsupportedReason,
      action: 'compact',
    },
    {
      name: '/status',
      description: 'Show session ID, context usage, and rate limits',
      kind: 'command',
      behavior: 'invoke',
      icon: 'layoutDashboard',
      enabled: status?.supported === true,
      disabledReason: status?.supported ? undefined : status?.reason || unsupportedReason,
      action: 'status',
    },
  ];
  if (goal?.supported === true) {
    fixed.push({
      name: '/goal',
      description: 'Run toward an objective across turns',
      kind: 'command',
      behavior: 'insert-command',
      insertText: '/goal ',
      icon: 'target',
      enabled: true,
    });
  }
  if (fastMode) {
    const checked = fastMode.currentValue === 'on';
    fixed.push({
      name: '/fast',
      description: checked ? 'On · 1.5x speed, increased usage' : 'Off · Standard speed',
      kind: 'command',
      behavior: 'invoke',
      icon: 'zap',
      enabled: true,
      action: 'fast',
      checked,
    });
  }
  const deduped = new Map<string, ChatSessionSkill>();
  for (const rawSkill of skills) {
    const skill = (typeof rawSkill === 'string' ? rawSkill : rawSkill.name).trim().replace(/^\/+/, '');
    if (!skill) continue;
    const key = skill.toLowerCase();
    if (key === 'status' || key === 'compact' || key === 'fast' || key === 'goal') {
      continue;
    }
    const description = typeof rawSkill === 'string' ? '' : (rawSkill.description ?? '').trim();
    const existing = deduped.get(key);
    if (!existing || (!existing.description && description)) {
      deduped.set(key, {name: skill, description});
    }
  }
  const skillOptions = Array.from(deduped.values())
    .sort((left, right) => left.name.localeCompare(right.name, undefined, {sensitivity: 'base'}))
    .map<ChatSessionSlashOption>(skill => ({
      name: `/${skill.name}`,
      description: skill.description ?? '',
      kind: 'skill',
      behavior: 'insert',
      icon: 'wand',
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
  const match = /^(\/compact|\/status|\/fast)(?:\s|$)/i.exec(trimmed);
  if (!match) return null;
  const command = match[1].toLowerCase() as '/status' | '/compact' | '/fast';
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

export function replaceActiveSlashQuery(
  text: string,
  cursor: number,
  replacement: string,
): {text: string; cursor: number} {
  const query = resolveChatSlashQuery(text, cursor);
  if (!query) return {text, cursor};
  return {
    text: `${text.slice(0, query.start)}${replacement}${text.slice(query.end)}`,
    cursor: query.start + replacement.length,
  };
}

export type ChatSlashMenuSection = {
  id: 'commands' | 'skills';
  title: string;
  options: ChatSessionSlashOption[];
};

export function groupChatSlashMenuOptions(options: ChatSessionSlashOption[]): ChatSlashMenuSection[] {
  const commands = options.filter(option => option.kind === 'command');
  const skills = options.filter(option => option.kind === 'skill');
  const sections: ChatSlashMenuSection[] = [];
  if (commands.length > 0) {
    sections.push({id: 'commands', title: 'Commands', options: commands});
  }
  if (skills.length > 0) {
    sections.push({id: 'skills', title: 'Skills', options: skills});
  }
  return sections;
}

export function chatSlashOptionDisplayName(name: string): string {
  return name.replace(/^\/+/, '');
}
