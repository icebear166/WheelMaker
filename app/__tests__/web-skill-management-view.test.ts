import {
  deriveSkillHubIds,
  isSkillActionPendingForHub,
  parseSkillSourceInput,
  projectSkillTotal,
  sameSkillScopeTarget,
  skillActionPendingKey,
  skillScopeLabel,
  skillScopeSelectionKey,
  sortSkillProjects,
} from '../web/src/settings/skillManagementView';

describe('skill management view helpers', () => {
  test('derives sorted hub ids from project.list hubs', () => {
    expect(deriveSkillHubIds([{hubId: 'hub-b'}, {hubId: ' '}, {hubId: 'hub-a'}])).toEqual(['hub-a', 'hub-b']);
  });

  test('sorts all projects by name', () => {
    expect(sortSkillProjects([
      {projectName: 'zeta', skills: []},
      {projectName: 'alpha', skills: []},
    ]).map(project => project.projectName)).toEqual(['alpha', 'zeta']);
  });

  test('counts skills across all projects', () => {
    const projects = [
      {
        projectName: 'offline',
        skills: [{name: 'one', category: '', categoryKey: '', managed: true}],
      },
      {
        projectName: 'beta',
        skills: [{name: 'two', category: '', categoryKey: '', managed: true}],
      },
      {projectName: 'alpha', skills: []},
    ];

    expect(projectSkillTotal(projects)).toBe(2);
    expect(sortSkillProjects(projects).map(project => project.projectName))
      .toEqual(['alpha', 'beta', 'offline']);
  });

  test('builds stable Skill scope and action identities', () => {
    const target = {hubId: 'hub-a', scope: 'project' as const, projectName: 'WheelMaker'};

    expect(skillScopeSelectionKey(target)).toBe('hub-a:project:WheelMaker');
    expect(skillActionPendingKey({...target, skillName: 'scope', action: 'skillUpdate'}))
      .toBe('hub-a:project:WheelMaker:scope:skillUpdate');
    expect(sameSkillScopeTarget(target, {...target})).toBe(true);
    expect(sameSkillScopeTarget(target, {hubId: 'hub-a', scope: 'hub'})).toBe(false);
  });

  test('formats scope labels', () => {
    expect(skillScopeLabel({scope: 'hub', hubId: 'hub-a'})).toBe('Hub: hub-a');
    expect(skillScopeLabel({scope: 'project', hubId: 'hub-a', projectName: 'WheelMaker'})).toBe('Project: WheelMaker');
  });

  test('matches pending skill actions by hub only', () => {
    const pendingKey = 'hub-a:project:WheelMaker:diagnose:skillUninstall';

    expect(isSkillActionPendingForHub(pendingKey, 'hub-a')).toBe(true);
    expect(isSkillActionPendingForHub(pendingKey, 'hub-b')).toBe(false);
    expect(isSkillActionPendingForHub('', 'hub-a')).toBe(false);
  });

  test('parses pasted skills add commands without accepting agent flags', () => {
    expect(parseSkillSourceInput('mattpocock/skills')).toEqual({
      source: 'mattpocock/skills',
      skillNames: [],
    });
    expect(parseSkillSourceInput('npx skills add https://github.com/mattpocock/skills --skill grill-me')).toEqual({
      source: 'https://github.com/mattpocock/skills',
      skillNames: ['grill-me'],
    });
    expect(parseSkillSourceInput('npx --yes skills add mattpocock/skills --skill tdd --skill diagnose --agent claude-code')).toEqual({
      source: 'mattpocock/skills',
      skillNames: ['tdd', 'diagnose'],
    });
  });
});
