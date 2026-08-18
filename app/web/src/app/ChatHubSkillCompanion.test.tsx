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
