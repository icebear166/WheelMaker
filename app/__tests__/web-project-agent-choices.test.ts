import path from 'path';

function projectRoot(): string {
  return path.join(__dirname, '..');
}

function loadProjectAgentsModule(): any {
  const helperPath = path.join(projectRoot(), 'web', 'src', 'chat', 'projectAgents.ts');
  return require(helperPath);
}

function loadAgentTagVariantModule(): any {
  const helperPath = path.join(projectRoot(), 'web', 'src', 'chat', 'agentTagVariant.ts');
  return require(helperPath);
}

describe('web project agent choices', () => {
  test('filters out agents the hub does not report as available', () => {
    const {buildProjectAgentChoices} = loadProjectAgentsModule();

    // codex only survives here via a stale session; the hub reports only claude.
    const choices = buildProjectAgentChoices(
      {agents: ['claude']},
      [{agentType: 'codex'}, {agentType: 'claude'}],
    );

    expect(choices).toEqual(['claude']);
  });

  test('keeps stale session agents when the hub reports no available agents', () => {
    const {buildProjectAgentChoices} = loadProjectAgentsModule();

    const choices = buildProjectAgentChoices({agent: 'claude'}, [{agentType: 'codex'}]);

    // No `agents` list => do not empty the UI; keep the union.
    expect(choices).toEqual(['claude', 'codex']);
  });

  test('preserves reported agents when there are no sessions', () => {
    const {buildProjectAgentChoices} = loadProjectAgentsModule();

    const choices = buildProjectAgentChoices({agents: ['codex', 'claude']}, []);

    expect(choices).toEqual(['codex', 'claude']);
  });

  test('normalizes whitespace and dedupes case-insensitively', () => {
    const {buildProjectAgentChoices} = loadProjectAgentsModule();

    const choices = buildProjectAgentChoices(
      {agents: ['  Claude  '], agent: 'claude'},
      [{agentType: 'CLAUDE'}],
    );

    expect(choices).toEqual(['Claude']);
  });

  test('returns a flat list of agent choice nodes without grouping', () => {
    const {buildAgentChoiceNodes} = loadProjectAgentsModule();

    expect(buildAgentChoiceNodes(['codex', 'claude', 'cc-deepseek', 'cc-glm', 'cc-kimi', 'cc-qwen', 'cc-flicker', 'kimi'])).toEqual([
      {agentType: 'codex', label: 'codex'},
      {agentType: 'claude', label: 'claude'},
      {agentType: 'cc-deepseek', label: 'cc · deepseek'},
      {agentType: 'cc-glm', label: 'cc · glm'},
      {agentType: 'cc-kimi', label: 'cc · kimi'},
      {agentType: 'cc-qwen', label: 'cc · qwen'},
      {agentType: 'cc-flicker', label: 'cc · flicker'},
      {agentType: 'kimi', label: 'kimi'},
    ]);
  });

  test('preserves display labels and dedupes case-insensitively for flat nodes', () => {
    const {buildAgentChoiceNodes, agentDisplayLabel} = loadProjectAgentsModule();

    expect(buildAgentChoiceNodes(['cc-glm'])).toEqual([{agentType: 'cc-glm', label: 'cc · glm'}]);
    expect(buildAgentChoiceNodes(['Claude', 'claude'])).toEqual([{agentType: 'Claude', label: 'claude'}]);
    expect(agentDisplayLabel('claude')).toBe('claude');
    expect(agentDisplayLabel('cc-glm')).toBe('cc · glm');
    expect(agentDisplayLabel('cc-kimi')).toBe('cc · kimi');
    expect(agentDisplayLabel('cc-deepseek')).toBe('cc · deepseek');
    expect(agentDisplayLabel('cc-qwen')).toBe('cc · qwen');
    expect(agentDisplayLabel('cc-flicker')).toBe('cc · flicker');
  });

  test('uses the Claude accent for Claude-compatible pills', () => {
    const {agentTagVariantClass} = loadAgentTagVariantModule();

    expect(agentTagVariantClass('cc-qwen')).toBe('wide-session-agent-2');
    expect(agentTagVariantClass('cc-flicker')).toBe('wide-session-agent-2');
  });
});
