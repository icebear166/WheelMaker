import type {
  RegistryHub,
  RegistrySkillCatalogItem,
  RegistrySkillProjectSnapshot,
  RegistrySkillScope,
} from '../registry/registryTypes';

export type SkillScopeTarget = {
  hubId: string;
  scope: RegistrySkillScope;
  projectName?: string;
};

export type SkillInstallTarget = SkillScopeTarget;

export type SkillDetailTarget = SkillScopeTarget & {
  skillName: string;
};

export type SkillUpdateTarget = SkillScopeTarget & {
  skills?: string[];
};

export type SkillUninstallTarget = SkillScopeTarget & {
  skillName: string;
};

export type SkillBatchUninstallTarget = SkillScopeTarget & {
  skillNames: string[];
};

export type SkillPendingKeyInput = SkillScopeTarget & {
  skillName?: string;
  action: string;
};

export interface ParsedSkillSourceInput {
  source: string;
  skillNames: string[];
  ref?: string;
}

export function deriveSkillHubIds(hubs: RegistryHub[]): string[] {
  return Array.from(new Set(
    hubs
      .map(hub => (hub.hubId || '').trim())
      .filter(Boolean),
  )).sort((left, right) => left.localeCompare(right));
}

export function parseSkillSourceInput(input: string): ParsedSkillSourceInput {
  const tokens = splitSkillSourceInput(input);
  if (tokens.length === 0) {
    return {source: '', skillNames: []};
  }

  const sourceIndex = findSkillSourceTokenIndex(tokens);
  const sourceToken = sourceIndex >= 0 ? tokens[sourceIndex] : '';
  const direct = parseDirectGitHubSkillURL(sourceToken);
  if (direct) return direct;
  const hashIndex = sourceToken.lastIndexOf('#');
  const source = hashIndex > 0 ? sourceToken.slice(0, hashIndex) : sourceToken;
  const ref = hashIndex > 0 ? sourceToken.slice(hashIndex + 1).trim() : '';
  const parsed: ParsedSkillSourceInput = {
    source,
    skillNames: extractSkillNamesFromTokens(tokens),
  };
  if (ref) parsed.ref = ref;
  return parsed;
}

function parseDirectGitHubSkillURL(source: string): ParsedSkillSourceInput | null {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/#]+)\/tree\/([^/]+)\/(.+)$/i.exec(source);
  if (!match) return null;
  const [, owner, repository, ref, skillPath] = match;
  const skillName = skillPath.split('/').filter(Boolean).at(-1) ?? '';
  return {
    source: `https://github.com/${owner}/${repository.replace(/\.git$/i, '')}.git`,
    ref,
    skillNames: skillName ? [skillName] : [],
  };
}

function splitSkillSourceInput(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | '' = '';
  let escaping = false;

  const pushCurrent = () => {
    if (current) {
      tokens.push(current);
      current = '';
    }
  };

  for (const char of input.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = '';
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      pushCurrent();
      continue;
    }
    current += char;
  }
  pushCurrent();
  return tokens;
}

function findSkillSourceTokenIndex(tokens: string[]): number {
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (tokens[index].toLowerCase() === 'skills' && tokens[index + 1].toLowerCase() === 'add') {
      return index + 2;
    }
  }
  return tokens.findIndex(token => token && !token.startsWith('-'));
}

function extractSkillNamesFromTokens(tokens: string[]): string[] {
  const names: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--skill') {
      for (let valueIndex = index + 1; valueIndex < tokens.length; valueIndex += 1) {
        const value = tokens[valueIndex];
        if (!value || value.startsWith('-')) {
          break;
        }
        names.push(value);
        index = valueIndex;
      }
      continue;
    }
    if (token.startsWith('--skill=')) {
      names.push(token.slice('--skill='.length));
    }
  }
  return Array.from(new Set(names.map(name => name.trim()).filter(Boolean)));
}

export function sortSkillProjects(projects: RegistrySkillProjectSnapshot[]): RegistrySkillProjectSnapshot[] {
  return [...projects].sort((left, right) => left.projectName.localeCompare(right.projectName));
}

export function projectSkillTotal(projects: RegistrySkillProjectSnapshot[]): number {
  return projects.reduce((total, project) => total + project.skills.length, 0);
}

export function skillScopeSelectionKey(input: SkillScopeTarget): string {
  return [input.hubId, input.scope, input.projectName || ''].join(':');
}

export function skillActionPendingKey(input: SkillPendingKeyInput): string {
  return [
    input.hubId,
    input.scope,
    input.projectName || '',
    input.skillName || '',
    input.action,
  ].join(':');
}

export function sameSkillScopeTarget(
  left: SkillScopeTarget | null,
  right: SkillScopeTarget,
): boolean {
  return Boolean(
    left
    && left.hubId === right.hubId
    && left.scope === right.scope
    && (left.projectName || '') === (right.projectName || ''),
  );
}

export function skillScopeLabel(input: {scope: RegistrySkillScope; hubId: string; projectName?: string}): string {
  if (input.scope === 'project') return `Project: ${input.projectName || ''}`.trim();
  return `Hub: ${input.hubId}`;
}

export function skillDetailCacheKey(input: {hubId: string; scope: RegistrySkillScope; projectName?: string; skillName: string}): string {
  return [
    input.hubId,
    input.scope,
    input.projectName || '',
    input.skillName,
  ].join(':');
}

export function isSkillActionPendingForHub(pendingKey: string, hubId: string): boolean {
  const normalizedHubId = (hubId || '').trim();
  if (!pendingKey || !normalizedHubId) return false;
  return pendingKey.split(':', 1)[0] === normalizedHubId;
}

type SkillPreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

function skillPreferenceStorage(storage?: SkillPreferenceStorage): SkillPreferenceStorage | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function skillShowUninstalledPreferenceKey(input: SkillScopeTarget): string {
  return `wheelmaker.skills.showUninstalled.v1/${encodeURIComponent(input.hubId)}/${input.scope}/${encodeURIComponent(input.projectName || '')}`;
}

export function readSkillShowUninstalled(
  input: SkillScopeTarget,
  storage?: SkillPreferenceStorage,
): boolean {
  try {
    return skillPreferenceStorage(storage)?.getItem(skillShowUninstalledPreferenceKey(input)) === 'true';
  } catch {
    return false;
  }
}

export function writeSkillShowUninstalled(
  input: SkillScopeTarget,
  value: boolean,
  storage?: SkillPreferenceStorage,
): void {
  try {
    skillPreferenceStorage(storage)?.setItem(skillShowUninstalledPreferenceKey(input), value ? 'true' : 'false');
  } catch {
    // A blocked preference store must not block Skills management.
  }
}

export function shouldShowSkillCatalogRow(
  row: Pick<RegistrySkillCatalogItem, 'status'>,
  showUninstalled: boolean,
): boolean {
  return showUninstalled || row.status !== 'uninstalled';
}
