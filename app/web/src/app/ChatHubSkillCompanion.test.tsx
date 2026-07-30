import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({children}: {children?: React.ReactNode}) => <>{children}</>,
}));
jest.mock('remark-gfm', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import {skillDetailCacheKey} from '../settings/skillManagementView';
import {ChatHubSkillCompanion} from './ChatHubSkillCompanion';

const installHarness = {
  sourceInput: '',
  onSourceInputChange: jest.fn(),
  sourceLoading: false,
  sourceError: '',
  candidates: [],
  selectedNames: [],
  onList: jest.fn().mockResolvedValue(undefined),
  onToggleAll: jest.fn(),
  onToggleCandidate: jest.fn(),
  onInstall: jest.fn(),
};

test('renders one Add Skill companion with the bound target', async () => {
  const target = {hubId: 'hub-a', scope: 'project' as const, projectName: 'alpha'};
  const onClose = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ChatHubSkillCompanion
        surface={{kind: 'install', target}}
        install={installHarness}
        detail={{entries: {}, pendingKey: '', onUninstall: jest.fn()}}
        onClose={onClose}
      />,
    );
  });

  expect(renderer.root.findByProps({className: 'chat-hub-skill-companion-title'}).children)
    .toEqual(['Add Skill']);
  expect(renderer.root.findByProps({className: 'chat-hub-skill-companion-scope'}).children)
    .toEqual(['Project: alpha']);
  expect(renderer.root.findAllByProps({className: 'skill-install-marketplace'})).toHaveLength(1);
  act(() => renderer.root.findByProps({'aria-label': 'Close Add Skill'}).props.onClick());
  expect(onClose).toHaveBeenCalled();
});

test('renders shared detail content and a managed uninstall footer', async () => {
  const target = {
    hubId: 'hub-a',
    scope: 'hub' as const,
    skillName: 'baseline-ui',
  };
  const onUninstall = jest.fn();
  const key = skillDetailCacheKey(target);
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ChatHubSkillCompanion
        surface={{kind: 'detail', target}}
        install={installHarness}
        detail={{
          entries: {
            [key]: {
              loading: false,
              error: '',
              detail: {
                ...target,
                name: target.skillName,
                category: 'UI',
                categoryKey: 'ui',
                managed: true,
                skillMarkdown: '',
                supportingFiles: [],
              },
            },
          },
          pendingKey: '',
          onUninstall,
        }}
        onClose={jest.fn()}
      />,
    );
  });

  expect(renderer.root.findByProps({className: 'chat-hub-skill-companion-title'}).children)
    .toEqual(['baseline-ui']);
  expect(renderer.root.findByProps({className: 'chat-hub-skill-companion-scope'}).children)
    .toEqual(['Hub: hub-a']);
  expect(renderer.root.findByProps({className: 'skill-detail-markdown markdown-preview'})).toBeTruthy();
  act(() => renderer.root.findByProps({'aria-label': 'Uninstall baseline-ui'}).props.onClick());
  expect(onUninstall).toHaveBeenCalledWith(target);
});
