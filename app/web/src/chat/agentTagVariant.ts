// Shared agent color-variant mapping for the `wide-session-agent-N` CSS classes
// (each class defines a `--agent-accent` custom property, see chat.css).
// Used both by session-list agent tags and the agent-choice pills so every
// surface agrees on a given agent's accent color.

const AGENT_TAG_VARIANT_INDEX: Record<string, number> = {
  codex: 0,
  copilot: 1,
  claude: 2,
  opencode: 3,
  codebuddy: 4,
  mimo: 5,
  kimi: 7,
  flicker: 8,
  // Claude-compatible profiles ride claude's accent (variant 2) — same family.
  'cc-deepseek': 2,
  'cc-glm': 2,
  'cc-kimi': 2,
};

function normalizeAgentTypeName(value?: string | null): string {
  return (value || '').trim();
}

/**
 * Resolve the `wide-session-agent-N` class for a given agent type.
 * Falls back to a stable hash-derived variant for unmapped agents so every
 * agent always gets a deterministic accent color.
 */
export function agentTagVariantClass(agentType: string): string {
  const normalized = normalizeAgentTypeName(agentType).toLowerCase();
  const explicitIndex = AGENT_TAG_VARIANT_INDEX[normalized];
  if (typeof explicitIndex === 'number') {
    return `wide-session-agent-${explicitIndex}`;
  }
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }
  return `wide-session-agent-${hash % 8}`;
}
