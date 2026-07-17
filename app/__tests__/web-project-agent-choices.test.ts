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
});
