import {
  agentDisplayLabel,
  buildAgentChoiceNodes,
  buildProjectAgentChoices,
  isCodexAppAgentType,
} from './projectAgents';
import type {RegistryProject} from '../registry/registryTypes';

describe('cx.deepseek agent presentation', () => {
  it('uses the short display label while preserving the wire agent ID', () => {
    expect(agentDisplayLabel('cx-deepseek')).toBe('cx.deepseek');
    expect(buildAgentChoiceNodes(['cx-deepseek'])).toEqual([
      {agentType: 'cx-deepseek', label: 'cx.deepseek'},
    ]);
  });

  it('is selectable only when the Hub reports cx-deepseek', () => {
    const project: RegistryProject = {
      projectId: 'project-1',
      name: 'Project 1',
      online: true,
      path: 'D:/Code/Project1',
      agent: 'codex',
      agents: ['codex', 'cx-deepseek'],
    };
    expect(buildProjectAgentChoices(project, [])).toEqual(['codex', 'cx-deepseek']);
    expect(buildProjectAgentChoices({...project, agents: ['codex']}, [])).toEqual(['codex']);
  });

  it('limits Codex App UI behavior to codex and cx-deepseek', () => {
    expect(isCodexAppAgentType('codex')).toBe(true);
    expect(isCodexAppAgentType(' CX-DeepSeek ')).toBe(true);
    expect(isCodexAppAgentType('cx-other')).toBe(false);
    expect(isCodexAppAgentType('claude')).toBe(false);
  });
});

describe('cx.flicker agent presentation', () => {
  it('uses the short display label and Codex behavior', () => {
    expect(agentDisplayLabel('cx-flicker')).toBe('cx.flicker');
    expect(isCodexAppAgentType(' CX-Flicker ')).toBe(true);
  });
});

describe('agent capsule labels', () => {
  it('normalizes capsule labels to lowercase', () => {
    expect(agentDisplayLabel('Codex')).toBe('codex');
    expect(agentDisplayLabel('Claude')).toBe('claude');
  });
});
