import type {RegistryChatSession, RegistryProject} from '../registry/registryTypes';

function normalizeAgentTypeName(value?: string | null): string {
  return (value || '').trim();
}

export type AgentChoiceNode = {agentType: string; label: string};

export function agentDisplayLabel(agentType?: string | null): string {
  const normalized = normalizeAgentTypeName(agentType);
  switch (normalized.toLowerCase()) {
    case 'claude':
      return 'claude';
    case 'cx-deepseek':
      return 'cx.deepseek';
    case 'cc-deepseek':
      return 'cc · deepseek';
    case 'cc-glm':
      return 'cc · glm';
    case 'cc-kimi':
      return 'cc · kimi';
    case 'cc-qwen':
      return 'cc · qwen';
    case 'cc-flicker':
      return 'cc · flicker';
    default:
      return normalized;
  }
}

/**
 * Build a flat, deduplicated list of agent choice nodes for the selection menu.
 * Grouping/ordering for display happens in buildAgentChoiceGroups.
 */
export function buildAgentChoiceNodes(agentTypes: string[]): AgentChoiceNode[] {
  const seen = new Set<string>();
  const nodes: AgentChoiceNode[] = [];
  for (const agentType of agentTypes) {
    const normalized = normalizeAgentTypeName(agentType);
    const key = normalized.toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    nodes.push({agentType: normalized, label: agentDisplayLabel(normalized)});
  }
  return nodes;
}

export type AgentChoiceGroup = {key: string; label: string; nodes: AgentChoiceNode[]};

const AGENT_FAMILY_LABEL: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  other: 'Other',
};

// cc-* profiles ride the claude CLI and cx-* profiles ride codex, so they group
// under their engine; every other agent is standalone under "Other".
function agentFamilyKey(agentType: string): string {
  const key = agentType.toLowerCase();
  if (key === 'claude' || key.startsWith('cc-')) {
    return 'claude';
  }
  if (key === 'codex' || key.startsWith('cx-')) {
    return 'codex';
  }
  return 'other';
}

/**
 * Group agent choice nodes by engine family for the selection menu. The default
 * agent's family sorts first (and the default pill first within it), the base
 * engine pill (claude/codex) leads its family, and "Other" always trails.
 * Pills keep their full labels ("cc · deepseek") so profiles are recognizable
 * at a glance even outside their group.
 */
export function buildAgentChoiceGroups(agentTypes: string[], defaultAgent?: string): AgentChoiceGroup[] {
  const groups = new Map<string, AgentChoiceGroup>();
  for (const node of buildAgentChoiceNodes(agentTypes)) {
    const familyKey = agentFamilyKey(node.agentType);
    let group = groups.get(familyKey);
    if (!group) {
      group = {key: familyKey, label: AGENT_FAMILY_LABEL[familyKey], nodes: []};
      groups.set(familyKey, group);
    }
    group.nodes.push(node);
  }

  const defaultKey = (defaultAgent || '').toLowerCase();
  const defaultFamily = defaultKey ? agentFamilyKey(defaultKey) : '';
  const ordered = [...groups.values()];
  ordered.sort((a, b) => {
    const aScore = (a.key === defaultFamily ? 0 : 1) * 2 + (a.key === 'other' ? 1 : 0);
    const bScore = (b.key === defaultFamily ? 0 : 1) * 2 + (b.key === 'other' ? 1 : 0);
    return aScore - bScore;
  });

  for (const group of ordered) {
    group.nodes.sort((a, b) => {
      const aFirst = a.agentType.toLowerCase() === group.key || a.agentType.toLowerCase() === defaultKey;
      const bFirst = b.agentType.toLowerCase() === group.key || b.agentType.toLowerCase() === defaultKey;
      if (aFirst === bFirst) {
        return 0;
      }
      return aFirst ? -1 : 1;
    });
  }
  return ordered;
}

/**
 * Build the ordered list of agent types selectable under a project
 * (new/resume session menus).
 *
 * The list unions the hub-reported agents, the project's default agent, and the
 * agent types of existing sessions, then restricts the result to what the hub
 * actually reports as available (`project.agents` mirrors the hub's runtime
 * provider list). Without that restriction, a stale agent left over from an old
 * session (e.g. codex after it was uninstalled) stays selectable and creating a
 * session for it fails. When the hub reports no agents (offline / legacy
 * snapshot) the union is returned unchanged so the UI is not emptied.
 */
export function buildProjectAgentChoices(
  project: RegistryProject,
  sessions: RegistryChatSession[],
): string[] {
  const seen = new Set<string>();
  const agents: string[] = [];
  const append = (value?: string | null) => {
    const normalized = normalizeAgentTypeName(value);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    agents.push(normalized);
  };
  for (const item of project.agents ?? []) {
    append(item);
  }
  append(project.agent);
  for (const session of sessions) {
    append(session.agentType);
  }

  const available = (project.agents ?? [])
    .map(item => normalizeAgentTypeName(item).toLowerCase())
    .filter(Boolean);
  if (available.length > 0) {
    return agents.filter(agentType => available.includes(agentType.toLowerCase()));
  }
  return agents;
}
