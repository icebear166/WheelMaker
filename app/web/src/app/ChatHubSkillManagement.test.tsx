import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {skillActionPendingKey} from '../settings/skillManagementView';
import {
  ChatHubSkillScopeDetail,
  type ChatHubSkillActions,
} from './ChatHubSkillManagement';

const hubTarget = {hubId: 'hub-a', scope: 'hub' as const};
const projectTarget = {
  hubId: 'hub-a',
  scope: 'project' as const,
  projectName: 'alpha',
};
const skills = [
  {name: 'baseline-ui', category: 'UI', categoryKey: 'ui', managed: true},
  {name: 'external-skill', category: 'External', categoryKey: 'external', managed: false},
];

function createActions(): ChatHubSkillActions {
  return {
    onAdd: jest.fn(),
    onDetail: jest.fn(),
    onUpdate: jest.fn(),
    onUninstall: jest.fn(),
    onBatchUninstall: jest.fn(),
    onRetry: jest.fn(),
  };
}

async function renderScope(options: {
  target?: typeof hubTarget | typeof projectTarget;
  pendingKey?: string;
  actions?: ChatHubSkillActions;
  items?: typeof skills;
}) {
  const actions = options.actions ?? createActions();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ChatHubSkillScopeDetail
        target={options.target ?? hubTarget}
        label={(options.target ?? hubTarget).scope === 'hub' ? 'Global skills' : 'Project skills'}
        skills={options.items ?? skills}
        loading={false}
        error=""
        operationRunning={false}
        pendingKey={options.pendingKey ?? ''}
        actions={actions}
      />,
    );
  });
  return {renderer, actions};
}

test('aligns skill rows, opens details from the name, and keeps External beside the name', async () => {
  const {renderer, actions} = await renderScope({});

  expect(renderer.root.findAllByProps({className: 'chat-hub-skill-row'})).toHaveLength(2);
  const skillRows = renderer.root.findAllByProps({className: 'chat-hub-skill-row'});
  expect(skillRows.map(row => row.props.className)).toEqual([
    'chat-hub-skill-row',
    'chat-hub-skill-row',
  ]);
  expect(skillRows.every(
    row => row.findAllByProps({className: 'chat-hub-skill-meta'}).length === 0,
  )).toBe(true);
  expect(renderer.root.findAllByProps({'aria-label': 'Refresh skills'})).toHaveLength(0);
  expect(renderer.root.findAllByProps({className: 'chat-hub-skill-row-actions'})
    .every(rowActions => rowActions.findAllByProps({className: 'chat-hub-action-slot'}).length === 2))
    .toBe(true);
  expect(renderer.root.findAllByProps({className: 'chat-hub-skill-category'})).toHaveLength(0);
  expect(renderer.root.findAllByProps({className: 'chat-hub-skill-meta'})).toHaveLength(0);
  expect(renderer.root.findAllByProps({'data-icon-name': 'info'})).toHaveLength(0);

  const managed = renderer.root.findByProps({'data-skill-name': 'baseline-ui'});
  expect(managed.findAllByType('button').map(button => button.props['aria-label']))
    .toEqual(['View baseline-ui details', 'Update baseline-ui', 'Uninstall baseline-ui']);
  expect(managed.findByProps({className: 'chat-hub-skill-name'}).type).toBe('button');
  expect(managed.findByProps({className: 'chat-hub-skill-name'}).props.title).toBe('baseline-ui');

  const external = renderer.root.findByProps({'data-skill-name': 'external-skill'});
  const externalNameCell = external.findByProps({className: 'chat-hub-skill-name-cell'});
  expect(externalNameCell.findByProps({'aria-label': 'View external-skill details'}).type).toBe('button');
  expect(externalNameCell.findByProps({className: 'chat-hub-skill-external'})
    .findByProps({'data-icon-name': 'link'})).toBeTruthy();
  expect(external.findAllByProps({'aria-label': 'Update external-skill'})).toHaveLength(0);
  expect(external.findAllByProps({'aria-label': 'Uninstall external-skill'})).toHaveLength(0);

  act(() => managed.findByProps({className: 'chat-hub-skill-name'}).props.onClick());
  expect(actions.onDetail).toHaveBeenCalledWith({...hubTarget, skillName: 'baseline-ui'});
});

test('keeps Hub update-all and selection-mode uninstall inside Hub scope', async () => {
  const {renderer, actions} = await renderScope({});

  act(() => renderer.root.findByProps({'aria-label': 'Add Hub skills'}).props.onClick());
  expect(actions.onAdd).toHaveBeenCalledWith(hubTarget);

  act(() => renderer.root.findByProps({'aria-label': 'Update all Hub skills'}).props.onClick());
  expect(actions.onUpdate).toHaveBeenCalledWith({...hubTarget, includeProjects: false});

  act(() => renderer.root.findByProps({'aria-label': 'Select Hub skills'}).props.onClick());
  const checkbox = renderer.root.findByProps({'aria-label': 'Select baseline-ui'});
  act(() => checkbox.props.onChange());
  act(() => renderer.root.findByProps({'aria-label': 'Uninstall selected Hub skills'}).props.onClick());
  expect(actions.onBatchUninstall).toHaveBeenCalledWith({
    ...hubTarget,
    skillNames: ['baseline-ui'],
  });
});

test('keeps Project update-all and selection-mode uninstall inside selected Project scope', async () => {
  const actions = createActions();
  const {renderer} = await renderScope({
    target: projectTarget,
    actions,
    items: [{name: 'project-skill', category: '', categoryKey: '', managed: true}],
  });

  act(() => renderer.root.findByProps({'aria-label': 'Update all Project skills'}).props.onClick());
  expect(actions.onUpdate).toHaveBeenCalledWith(projectTarget);

  act(() => renderer.root.findByProps({'aria-label': 'Select Project skills'}).props.onClick());
  act(() => renderer.root.findByProps({'aria-label': 'Select project-skill'}).props.onChange());
  act(() => renderer.root.findByProps({'aria-label': 'Uninstall selected Project skills'}).props.onClick());
  expect(actions.onBatchUninstall).toHaveBeenCalledWith({
    ...projectTarget,
    skillNames: ['project-skill'],
  });
});

test('replaces only the pending update icon while preserving aligned action slots', async () => {
  const pendingKey = skillActionPendingKey({
    ...hubTarget,
    skillName: 'baseline-ui',
    action: 'skillUpdate',
  });
  const {renderer} = await renderScope({pendingKey});
  const managed = renderer.root.findByProps({'data-skill-name': 'baseline-ui'});
  const actionButtons = managed
    .findByProps({className: 'chat-hub-skill-row-actions'})
    .findAllByType('button');

  expect(actionButtons).toHaveLength(2);
  expect(actionButtons[0].findByType('svg').props['data-icon-name']).toBe('loader');
  expect(actionButtons[1].findByType('svg').props['data-icon-name']).toBe('trash');
});
