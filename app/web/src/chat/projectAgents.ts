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
 * Every agent (claude default + cc-* variants + codex/copilot/...) is a sibling
 * — no grouping, so the UI renders them as uniform pills.
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
