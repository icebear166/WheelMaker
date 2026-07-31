import {agentDisplayLabel, buildAgentChoiceNodes, buildProjectAgentChoices} from './projectAgents';
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
});
