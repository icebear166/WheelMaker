import path from 'path';

function projectRoot(): string {
  return path.join(__dirname, '..');
}

function loadProjectAgentsModule(): any {
  const helperPath = path.join(projectRoot(), 'web', 'src', 'chat', 'projectAgents.ts');
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

  test('projects flat Claude-compatible agents into one ordered display group', () => {
    const {buildAgentChoiceNodes} = loadProjectAgentsModule();

    expect(buildAgentChoiceNodes(['codex', 'claude', 'cc-deepseek', 'cc-glm', 'cc-kimi', 'kimi'])).toEqual([
      {kind: 'agent', agentType: 'codex', label: 'codex'},
      {
        kind: 'claude-group',
        agentType: 'claude',
        label: 'claude',
        children: [
          {agentType: 'claude', label: 'default'},
          {agentType: 'cc-deepseek', label: 'deepseek'},
          {agentType: 'cc-glm', label: 'glm'},
          {agentType: 'cc-kimi', label: 'kimi'},
        ],
      },
      {kind: 'agent', agentType: 'kimi', label: 'kimi'},
    ]);
  });

  test('keeps a compatible child selectable when the native Claude entry is absent', () => {
    const {buildAgentChoiceNodes, agentDisplayLabel} = loadProjectAgentsModule();

    expect(buildAgentChoiceNodes(['cc-glm'])).toEqual([
      {kind: 'agent', agentType: 'cc-glm', label: 'cc · glm'},
    ]);
    expect(buildAgentChoiceNodes(['claude', 'cc-kimi'])).toEqual([
      {
        kind: 'claude-group',
        agentType: 'claude',
        label: 'claude',
        children: [
          {agentType: 'claude', label: 'default'},
          {agentType: 'cc-kimi', label: 'kimi'},
        ],
      },
    ]);
    expect(agentDisplayLabel('claude')).toBe('claude');
    expect(agentDisplayLabel('cc-glm')).toBe('cc · glm');
    expect(agentDisplayLabel('cc-kimi')).toBe('cc · kimi');
    expect(agentDisplayLabel('cc-deepseek')).toBe('cc · deepseek');
  });
});
