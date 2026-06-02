import fs from 'fs';
import path from 'path';

describe('web hub project preferences', () => {
  test('derives visible and hidden projects from hidden project ids', () => {
    const projectRoot = path.join(__dirname, '..');
    const modulePath = path.join(projectRoot, 'web', 'src', 'services', 'hubProjectPreferences.ts');

    expect(fs.existsSync(modulePath)).toBe(true);

    const {
      splitProjectsByVisibility,
      toggleProjectVisibility,
    } = require(modulePath);

    const projects = [
      {projectId: 'hub-a:one', name: 'One', hubId: 'hub-a'},
      {projectId: 'hub-a:two', name: 'Two', hubId: 'hub-a'},
      {projectId: 'hub-b:three', name: 'Three', hubId: 'hub-b'},
    ];

    expect(splitProjectsByVisibility(projects, ['hub-a:two', 'missing'])).toEqual({
      visibleProjects: [projects[0], projects[2]],
      hiddenProjects: [projects[1]],
    });
    expect(toggleProjectVisibility(['hub-a:two'], 'hub-a:two', true)).toEqual([]);
    expect(toggleProjectVisibility(['hub-a:two'], 'hub-b:three', false)).toEqual([
      'hub-a:two',
      'hub-b:three',
    ]);
  });

  test('derives hub checkbox state from project visibility', () => {
    const projectRoot = path.join(__dirname, '..');
    const modulePath = path.join(projectRoot, 'web', 'src', 'services', 'hubProjectPreferences.ts');

    expect(fs.existsSync(modulePath)).toBe(true);

    const {
      resolveHubVisibilityState,
      toggleHubVisibility,
    } = require(modulePath);

    const hubProjects = [
      {projectId: 'hub-a:one', name: 'One', hubId: 'hub-a'},
      {projectId: 'hub-a:two', name: 'Two', hubId: 'hub-a'},
    ];

    expect(resolveHubVisibilityState(hubProjects, [])).toBe('checked');
    expect(resolveHubVisibilityState(hubProjects, ['hub-a:one'])).toBe('mixed');
    expect(resolveHubVisibilityState(hubProjects, ['hub-a:one', 'hub-a:two'])).toBe('unchecked');
    expect(toggleHubVisibility(['hub-b:three'], hubProjects, false)).toEqual([
      'hub-b:three',
      'hub-a:one',
      'hub-a:two',
    ]);
    expect(toggleHubVisibility(['hub-b:three', 'hub-a:one'], hubProjects, true)).toEqual([
      'hub-b:three',
    ]);
  });

  test('finds the next visible project in current list order with wraparound', () => {
    const projectRoot = path.join(__dirname, '..');
    const modulePath = path.join(projectRoot, 'web', 'src', 'services', 'hubProjectPreferences.ts');

    expect(fs.existsSync(modulePath)).toBe(true);

    const {
      findNextVisibleProject,
    } = require(modulePath);

    const projects = [
      {projectId: 'project-a', name: 'A'},
      {projectId: 'project-b', name: 'B'},
      {projectId: 'project-c', name: 'C'},
      {projectId: 'project-d', name: 'D'},
    ];

    expect(findNextVisibleProject(projects, ['project-b', 'project-c'], 'project-b')).toEqual(projects[3]);
    expect(findNextVisibleProject(projects, ['project-b', 'project-c', 'project-d'], 'project-d')).toEqual(projects[0]);
    expect(findNextVisibleProject(projects, ['project-a', 'project-b', 'project-c', 'project-d'], 'project-b')).toBeNull();
  });

  test('sanitizes hub color preferences and supports resetting to default', () => {
    const projectRoot = path.join(__dirname, '..');
    const modulePath = path.join(projectRoot, 'web', 'src', 'services', 'hubProjectPreferences.ts');

    expect(fs.existsSync(modulePath)).toBe(true);

    const {
      setHubColorPreference,
      sanitizeHubColorMap,
    } = require(modulePath);

    expect(sanitizeHubColorMap({
      'hub-a': '#ABCDEF',
      'hub-b': 'red',
      '': '#123456',
    })).toEqual({'hub-a': '#abcdef'});

    expect(setHubColorPreference({'hub-a': '#abcdef'}, 'hub-b', '#00A6A6')).toEqual({
      'hub-a': '#abcdef',
      'hub-b': '#00a6a6',
    });
    expect(setHubColorPreference({'hub-a': '#abcdef'}, 'hub-a', '')).toEqual({});
  });

  test('resolves stable default hub colors from hub ids while honoring custom preferences', () => {
    const projectRoot = path.join(__dirname, '..');
    const modulePath = path.join(projectRoot, 'web', 'src', 'services', 'hubProjectPreferences.ts');

    expect(fs.existsSync(modulePath)).toBe(true);

    const {
      HUB_DEFAULT_COLORS,
      resolveHubColorVariantIndex,
      resolveDefaultHubColor,
      resolveHubColor,
    } = require(modulePath);

    const hubIds = ['ks-hub', 'ks-mac', 'local-hub', 'tools-hub'];
    const defaultColors = hubIds.map(resolveDefaultHubColor);
    const variantIndex = (value: string) => {
      const normalized = value.trim().toLowerCase();
      let hash = 0;
      for (let index = 0; index < normalized.length; index += 1) {
        hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
      }
      return hash % 8;
    };

    expect(HUB_DEFAULT_COLORS).toEqual([
      '#00a6a6',
      '#2f9e44',
      '#bc6c25',
      '#4f86c6',
      '#c879ff',
      '#d9480f',
      '#038c7f',
      '#7b6cb8',
    ]);
    expect(defaultColors.every(color => /^#[0-9a-f]{6}$/.test(color))).toBe(true);
    expect(resolveDefaultHubColor('ks-hub')).toBe(resolveDefaultHubColor('ks-hub'));
    expect(resolveHubColorVariantIndex('Local-Hub')).toBe(variantIndex('Local-Hub'));
    expect(resolveDefaultHubColor('local-hub')).toBe(HUB_DEFAULT_COLORS[variantIndex('local-hub')]);
    expect(new Set(defaultColors).size).toBeGreaterThan(1);
    expect(resolveHubColor({'ks-hub': '#ABCDEF'}, 'ks-hub')).toBe('#abcdef');
    expect(resolveHubColor({}, 'ks-hub')).toBe(resolveDefaultHubColor('ks-hub'));
  });
});
