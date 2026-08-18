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

import {
  SkillDetailContent,
} from './SkillManagementContent';

test('renders managed state, markdown, and supporting files in detail content', async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <SkillDetailContent
        loading={false}
        error=""
        detail={{
          name: 'baseline-ui',
          scope: 'hub',
          category: 'UI',
          categoryKey: 'ui',
          managed: false,
          source: 'owner/repo',
          skillMarkdown: '# Baseline UI',
          supportingFiles: [{relativePath: 'references/a.md', size: 12}],
        }}
      />,
    );
  });

  expect(renderer.root.findByProps({className: 'skill-detail-managed-state'}).children)
    .toEqual(['External']);
  expect(renderer.root.findByProps({className: 'skill-detail-markdown markdown-preview'}))
    .toBeTruthy();
  expect(renderer.root.findByProps({'data-tooltip': 'references/a.md'})).toBeTruthy();
});
