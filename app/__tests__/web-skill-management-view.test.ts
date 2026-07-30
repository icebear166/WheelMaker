import {
  deriveSkillHubIds,
  groupSkillsByCategory,
  isSkillActionPendingForHub,
  onlineSkillProjects,
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

  test('groups skills by upstream category and keeps General last', () => {
    const groups = groupSkillsByCategory([
      {name: 'plain', category: '', categoryKey: '', agents: []},
      {name: 'tdd', category: 'Mattpocock Skills', categoryKey: 'mattpocock-skills', agents: []},
    ]);

    expect(groups.map(group => group.category)).toEqual(['Mattpocock Skills', 'General']);
    expect(groups[0].skills[0].name).toBe('tdd');
  });

  test('sorts projects by online state then name', () => {
    expect(sortSkillProjects([
      {projectName: 'zeta', online: false, skills: []},
      {projectName: 'alpha', online: true, skills: []},
    ]).map(project => project.projectName)).toEqual(['alpha', 'zeta']);
  });

  test('keeps all-project counts separate from online project selection', () => {
    const projects = [
      {
        projectName: 'offline',
        online: false,
        skills: [{name: 'one', category: '', categoryKey: '', managed: true}],
      },
      {
        projectName: 'beta',
        online: true,
        skills: [{name: 'two', category: '', categoryKey: '', managed: true}],
      },
      {projectName: 'alpha', online: true, skills: []},
    ];

    expect(projectSkillTotal(projects)).toBe(2);
    expect(onlineSkillProjects(projects).map(project => project.projectName))
      .toEqual(['alpha', 'beta']);
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
