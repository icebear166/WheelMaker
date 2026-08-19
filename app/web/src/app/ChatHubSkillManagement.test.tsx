import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import type {RegistrySkillSourceScopeSnapshot} from '../registry/registryTypes';
import {
  ChatHubSkillScopeDetail,
  type ChatHubSkillActions,
} from './ChatHubSkillManagement';

const hubTarget = {hubId: 'hub-a', scope: 'hub' as const};
const projectTarget = {hubId: 'hub-a', scope: 'project' as const, projectName: 'alpha'};
const catalog: RegistrySkillSourceScopeSnapshot = {
  sources: [{
    source: 'https://github.com/acme/skills.git',
    sourceKey: 'github.com/acme/skills',
    resolvedCommit: '1234567890abcdef',
    refreshedAt: '2026-08-12T12:34:56Z',
    status: 'ready',
    installedCount: 3,
    updateCount: 1,
    skills: [
      {name: 'installed', skillPath: 'skills/installed/SKILL.md', remoteContentSha256: 'a'.repeat(64), status: 'up_to_date', installed: true, managed: true, conflict: false, canInstall: false, canUpdate: false, canUninstall: true},
      {name: 'changed', skillPath: 'skills/changed/SKILL.md', remoteContentSha256: 'b'.repeat(64), status: 'update_available', installed: true, managed: true, conflict: false, canInstall: false, canUpdate: true, canUninstall: true},
      {name: 'new-skill', skillPath: 'skills/new-skill/SKILL.md', remoteContentSha256: 'c'.repeat(64), status: 'uninstalled', installed: false, managed: false, conflict: false, canInstall: true, canUpdate: false, canUninstall: false},
      {name: 'gone', status: 'removed_upstream', installed: true, managed: true, conflict: false, canInstall: false, canUpdate: false, canUninstall: true},
      {name: 'duplicate', status: 'conflict', installed: true, managed: true, conflict: true, canInstall: false, canUpdate: false, canUninstall: false, error: 'Same name is owned elsewhere'},
    ],
  }],
  unmanagedSkills: [{
    name: 'local-only',
    status: 'unmanaged',
    installed: true,
    managed: false,
    conflict: false,
    canInstall: false,
    canUpdate: false,
    canUninstall: true,
  }],
};

function createActions(): ChatHubSkillActions {
  return {
    onAddRepo: jest.fn(),
    onDetail: jest.fn(),
    onUpdateScope: jest.fn(),
    onInstallAllScope: jest.fn(),
    onRefreshSource: jest.fn(),
    onUpdateSource: jest.fn(),
    onInstallAll: jest.fn(),
    onDeleteSource: jest.fn(),
    onInstallSkill: jest.fn(),
    onUninstall: jest.fn(),
    onRetry: jest.fn(),
  };
}

async function renderScope(options: {
  target?: typeof hubTarget | typeof projectTarget;
  snapshot?: RegistrySkillSourceScopeSnapshot;
  actions?: ChatHubSkillActions;
  operationRunning?: boolean;
} = {}) {
  const actions = options.actions ?? createActions();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ChatHubSkillScopeDetail
        target={options.target ?? hubTarget}
        label={(options.target ?? hubTarget).scope === 'hub' ? 'Global skills' : 'Project skills'}
        snapshot={options.snapshot ?? catalog}
        loading={false}
        error=""
        operationRunning={options.operationRunning ?? false}
        operation={options.operationRunning ? {
          running: true,
          action: 'update',
          status: 'running',
          startedAt: '2026-08-12T10:00:00Z',
          exitCode: null,
        } : null}
        pendingKey=""
        actions={actions}
      />,
    );
  });
  return {renderer, actions};
}

test('renders source-first hierarchy and hides uninstalled skills by default per scope', async () => {
  const {renderer} = await renderScope();

  expect(renderer.root.findByProps({'data-source-key': 'github.com/acme/skills'})).toBeTruthy();
  expect(renderer.root.findAllByProps({className: 'chat-hub-skill-source-ref-input'})).toHaveLength(0);
  expect(renderer.root.findAllByProps({className: 'chat-hub-skill-source-meta'})).toHaveLength(0);
  expect(renderer.root.findAllByProps({'data-skill-name': 'new-skill'})).toHaveLength(0);
  expect(renderer.root.findByProps({'aria-label': 'Show all Hub skills'}).props.checked).toBe(false);
  expect(renderer.root.findByProps({'data-skill-name': 'local-only'})).toBeTruthy();
});

test('renders scope Update and Install all controls', async () => {
  const {renderer, actions} = await renderScope({target: projectTarget});

  act(() => renderer.root.findByProps({'aria-label': 'Update Project skills'}).props.onClick());
  act(() => renderer.root.findByProps({'aria-label': 'Install all Project skills'}).props.onClick());

  expect(actions.onUpdateScope).toHaveBeenCalledWith(projectTarget);
  expect(actions.onInstallAllScope).toHaveBeenCalledWith(projectTarget);
});

test('disables scope and repository actions while a skill operation is running', async () => {
  const {renderer} = await renderScope({operationRunning: true});

  expect(renderer.root.findByProps({'aria-label': 'Update Hub skills'}).props.disabled).toBe(true);
  expect(renderer.root.findByProps({'aria-label': 'Install all Hub skills'}).props.disabled).toBe(true);
  expect(renderer.root.findByProps({'aria-label': 'Update acme/skills'}).props.disabled).toBe(true);
  expect(renderer.root.findByProps({'aria-label': 'Install all acme/skills skills'}).props.disabled).toBe(true);
});

test('treats nullable source skills from the registry as an empty catalog', async () => {
  const nullableCatalog = {
    ...catalog,
    sources: [{...catalog.sources[0], skills: null}],
  } as unknown as RegistrySkillSourceScopeSnapshot;

  const {renderer} = await renderScope({snapshot: nullableCatalog});

  expect(renderer.root.findByProps({'data-source-key': 'github.com/acme/skills'})).toBeTruthy();
  expect(renderer.root.findByProps({className: 'chat-hub-skill-source-empty'}).children.join(''))
    .toContain('No installed skills');
});

test('offers uninstall for unmanaged skills', async () => {
  const {renderer, actions} = await renderScope();
  const unmanaged = renderer.root.findByProps({'data-skill-name': 'local-only'});

  act(() => unmanaged.findByProps({'aria-label': 'Uninstall local-only'}).props.onClick());
  expect(actions.onUninstall).toHaveBeenCalledWith({...hubTarget, skillName: 'local-only'});
});

test('shows remote additions after enabling the scope preference and offers install only there', async () => {
  const {renderer, actions} = await renderScope({target: projectTarget});

  act(() => renderer.root.findByProps({'aria-label': 'Show all Project skills'}).props.onChange({target: {checked: true}}));
  const added = renderer.root.findByProps({'data-skill-name': 'new-skill'});
  expect(added.props.className).toContain('is-uninstalled');
  act(() => added.findByProps({'aria-label': 'Download new-skill'}).props.onClick());
  expect(actions.onInstallSkill).toHaveBeenCalledWith({
    ...projectTarget,
    source: 'https://github.com/acme/skills.git',
    sourceKey: 'github.com/acme/skills',
    skillName: 'new-skill',
  });
});

test('does not offer skill-level update and keeps removed skills manual', async () => {
  const {renderer, actions} = await renderScope();
  const installed = renderer.root.findByProps({'data-skill-name': 'installed'});
  const changed = renderer.root.findByProps({'data-skill-name': 'changed'});
  const removed = renderer.root.findByProps({'data-skill-name': 'gone'});

  expect(installed.findAllByProps({'aria-label': 'Update installed'})).toHaveLength(0);
  expect(changed.findAllByProps({'aria-label': 'Update changed'})).toHaveLength(0);
  expect(removed.props.className).toContain('is-removed');
  expect(removed.findAllByProps({'aria-label': 'Update gone'})).toHaveLength(0);
  act(() => removed.findByProps({'aria-label': 'Uninstall gone'}).props.onClick());
  expect(actions.onUninstall).toHaveBeenCalledWith({...hubTarget, skillName: 'gone'});
});

test('disables every skill action for same-name conflicts', async () => {
  const {renderer} = await renderScope();
  const conflict = renderer.root.findByProps({'data-skill-name': 'duplicate'});

  expect(conflict.props.className).toContain('is-conflict');
  expect(conflict.findAllByType('button')).toHaveLength(0);
  expect(conflict.findByProps({className: 'chat-hub-skill-status'}).children.join('')).toContain('Conflict');
});

test('routes repository update, install-all, and delete through source actions', async () => {
  const {renderer, actions} = await renderScope();
  const source = renderer.root.findByProps({'data-source-key': 'github.com/acme/skills'});

  expect(source.findAllByProps({'aria-label': 'Refresh acme/skills'})).toHaveLength(0);
  act(() => source.findByProps({'aria-label': 'Update acme/skills'}).props.onClick());
  expect(actions.onUpdateSource).toHaveBeenCalledWith(expect.objectContaining({sourceKey: 'github.com/acme/skills'}));
  act(() => source.findByProps({'aria-label': 'Install all acme/skills skills'}).props.onClick());
  expect(actions.onInstallAll).toHaveBeenCalledWith(expect.objectContaining({sourceKey: 'github.com/acme/skills'}));
  expect(source.findAllByProps({'aria-label': 'Apply ref for acme/skills'})).toHaveLength(0);
  act(() => source.findByProps({'aria-label': 'Delete acme/skills source'}).props.onClick());
  expect(actions.onDeleteSource).toHaveBeenCalledWith(expect.objectContaining({sourceKey: 'github.com/acme/skills'}));
});

test('marks a source when refresh finds a newer remote commit', async () => {
  const snapshot = {
    ...catalog,
    sources: [{...catalog.sources[0], updateAvailable: true, remoteCommit: 'b'.repeat(40)}],
  };
  const {renderer} = await renderScope({snapshot});
  const source = renderer.root.findByProps({'data-source-key': 'github.com/acme/skills'});
  const statusDot = source.findByProps({className: 'chat-hub-skill-source-status-dot is-update-available'});

  expect(statusDot.props['aria-label']).toBe('Update available source');
  expect(statusDot.props['data-tooltip']).toBe('Update available');
});

test('renders copies-differ as a precise actionable state', async () => {
  const snapshot = {
    ...catalog,
    sources: catalog.sources.map(source => ({
      ...source,
      skills: source.skills.map(skill => skill.name === 'changed'
        ? {...skill, status: 'copies_differ', canUpdate: true}
        : skill),
    })),
  };
  const {renderer} = await renderScope({snapshot});
  const changed = renderer.root.findByProps({'data-skill-name': 'changed'});
  expect(changed.findByProps({className: 'chat-hub-skill-status'}).children.join('')).toBe('Copies differ');
  expect(changed.findAllByProps({'aria-label': 'Update changed'})).toHaveLength(0);
});

test('keeps stale catalog visible while allowing explicit recovery operations', async () => {
  const stale = {
    ...catalog,
    sources: catalog.sources.map(source => ({...source, status: 'stale', error: 'Network unavailable'})),
  };
  const {renderer} = await renderScope({snapshot: stale});

  act(() => renderer.root.findByProps({'aria-label': 'Show all Hub skills'}).props.onChange({target: {checked: true}}));
  expect(renderer.root.findByProps({'aria-label': 'Download new-skill'}).props.disabled).toBe(false);
  expect(renderer.root.findByProps({'aria-label': 'Update acme/skills'}).props.disabled).toBe(false);
  expect(renderer.root.findAllByProps({'aria-label': 'Refresh acme/skills'})).toHaveLength(0);
});

test('keeps itemized per-repository partial results visible after a batch operation', async () => {
  const actions = createActions();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ChatHubSkillScopeDetail
        target={hubTarget}
        label="Global skills"
        snapshot={catalog}
        loading={false}
        error=""
        operationRunning={false}
        operation={{
          running: false,
          action: 'updateScope',
          scope: 'hub',
          status: 'partial',
          startedAt: '2026-08-12T10:00:00Z',
          finishedAt: '2026-08-12T10:00:02Z',
          exitCode: 1,
          errorSummary: '1 repository operation(s) failed',
          results: [
            {skill: 'github.com/acme/skills', action: 'update', status: 'succeeded'},
            {skill: 'github.com/other/skills', action: 'update', status: 'failed', errorSummary: 'command failed'},
          ],
        }}
        pendingKey=""
        actions={actions}
      />,
    );
  });

  const resultRows = renderer.root.findAllByProps({className: 'chat-hub-skill-operation-result'});
  expect(resultRows).toHaveLength(2);
  expect(resultRows[0].findAllByType('span').map(node => node.children.join(''))).toContain('github.com/acme/skills');
  expect(resultRows[0].findByType('strong').children.join('')).toBe('Succeeded');
  expect(resultRows[1].findAllByType('span').map(node => node.children.join(''))).toContain('github.com/other/skills');
  expect(resultRows[1].findByType('strong').children.join('')).toBe('Failed');
  expect(resultRows[1].props['data-tooltip']).toBe('command failed');
});

test('renders a compact source header with fixed source actions', async () => {
  const {renderer} = await renderScope();
  const source = renderer.root.findByProps({'data-source-key': 'github.com/acme/skills'});
  const disclosure = source.findByProps({className: 'chat-hub-skill-source-disclosure'});

  expect(disclosure.props['aria-expanded']).toBe(true);
  expect(source.findAllByProps({className: 'chat-hub-skill-source-meta'})).toHaveLength(0);
  expect(source.findAllByProps({'aria-label': 'Refresh acme/skills'})).toHaveLength(0);
  expect(source.findByProps({'aria-label': 'Update acme/skills'})).toBeTruthy();
  expect(source.findByProps({'aria-label': 'Install all acme/skills skills'})).toBeTruthy();
  expect(source.findByProps({'aria-label': 'Delete acme/skills source'})).toBeTruthy();
});

test('uses a two-slot skill action column and suppresses ordinary status copy', async () => {
  const {renderer} = await renderScope();
  const installed = renderer.root.findByProps({'data-skill-name': 'installed'});
  const changed = renderer.root.findByProps({'data-skill-name': 'changed'});
  const removed = renderer.root.findByProps({'data-skill-name': 'gone'});

  expect(installed.findAllByProps({className: 'chat-hub-skill-status'})).toHaveLength(0);
  expect(changed.findAllByProps({className: 'chat-hub-skill-status'})).toHaveLength(0);
  expect(installed.findByProps({className: 'chat-hub-skill-action-slot chat-hub-skill-primary-action-slot'})).toBeTruthy();
  expect(installed.findByProps({className: 'chat-hub-skill-action-slot chat-hub-skill-uninstall-action-slot'})).toBeTruthy();
  expect(changed.findAllByProps({'aria-label': 'Update changed'})).toHaveLength(0);
  expect(removed.findByProps({className: 'chat-hub-skill-status'}).children.join('')).toBe('Removed upstream');
  expect(installed.findByProps({className: 'chat-hub-skill-row-actions'}).findAllByType('button')
    .map(button => button.props['aria-label'])).toEqual(['Uninstall installed']);
  expect(changed.findByProps({className: 'chat-hub-skill-row-actions'}).findAllByType('button')
    .map(button => button.props['aria-label'])).toEqual(['Uninstall changed']);
  expect(removed.findByProps({className: 'chat-hub-skill-row-actions'}).findAllByType('button')
    .map(button => button.props['aria-label'])).toEqual(['Uninstall gone']);
});

test('collapsing a source hides its list but keeps the error visible', async () => {
  const stale = {
    ...catalog,
    sources: catalog.sources.map(source => ({...source, status: 'stale', error: 'Network unavailable'})),
  };
  const {renderer} = await renderScope({snapshot: stale});
  const source = renderer.root.findByProps({'data-source-key': 'github.com/acme/skills'});
  const disclosure = source.findByProps({className: 'chat-hub-skill-source-disclosure'});

  act(() => disclosure.props.onClick());
  expect(disclosure.props['aria-expanded']).toBe(false);
  expect(source.findAllByProps({className: 'chat-hub-skill-list'})).toHaveLength(0);
  expect(source.findByProps({className: 'chat-hub-skill-source-error'}).children.join(''))
    .toContain('Network unavailable');
});

test('adds a repository directly from the inline form without selecting skills', async () => {
  const {renderer, actions} = await renderScope();
  act(() => renderer.root.findByProps({className: 'chat-hub-skill-add-repository-trigger'}).props.onClick());
  const input = renderer.root.findByProps({'aria-label': 'Git repository URL'});
  act(() => input.props.onChange({target: {value: 'acme/new-skills'}}));
  act(() => renderer.root.findByProps({children: 'Add'}).props.onClick());
  expect(actions.onAddRepo).toHaveBeenCalledWith(hubTarget, 'acme/new-skills');
  expect(renderer.root.findByProps({className: 'chat-hub-skill-add-repository-trigger'})).toBeTruthy();
});

test('submits the repository with Enter from the input', async () => {
  const {renderer, actions} = await renderScope();
  act(() => renderer.root.findByProps({className: 'chat-hub-skill-add-repository-trigger'}).props.onClick());
  const input = renderer.root.findByProps({'aria-label': 'Git repository URL'});
  act(() => input.props.onChange({target: {value: 'acme/new-skills'}}));
  act(() => input.props.onKeyDown({key: 'Enter'}));
  expect(actions.onAddRepo).toHaveBeenCalledWith(hubTarget, 'acme/new-skills');
});

test('requires a repository URL before adding', async () => {
  const {renderer, actions} = await renderScope();
  act(() => renderer.root.findByProps({className: 'chat-hub-skill-add-repository-trigger'}).props.onClick());
  act(() => renderer.root.findByProps({children: 'Add'}).props.onClick());
  expect(actions.onAddRepo).not.toHaveBeenCalled();
  expect(renderer.root.findByProps({className: 'chat-hub-skill-source-error'}).children.join(''))
    .toContain('Git repository is required.');
});
