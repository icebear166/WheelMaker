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
  SkillInstallContent,
} from './SkillManagementContent';

test('keeps Marketplace inside the Add Skill content', async () => {
  const onPreview = jest.fn().mockResolvedValue(undefined);
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <SkillInstallContent
        sourceInput=""
        onSourceInputChange={jest.fn()}
        sourceLoading={false}
        sourceError=""
        preview={null}
        requestedSkillNames={[]}
        onPreview={onPreview}
        onApply={jest.fn()}
      />,
    );
  });

  expect(renderer.root.findByProps({className: 'skill-install-marketplace'}).props.href)
    .toBe('https://www.skills.sh/');
  expect(renderer.root.findByProps({placeholder: 'owner/repo, Git URL, or npx skills add --skill name'}))
    .toBeTruthy();
  expect(renderer.root.findAllByType('input').filter(input => input.props.type === 'checkbox'))
    .toHaveLength(0);
  await act(async () => {
    await renderer.root.findByProps({'aria-label': 'Preview skill source'}).props.onClick();
  });
  expect(onPreview).toHaveBeenCalled();
});

test('shows a bare repository as source-only and explicit skills without a selection step', async () => {
  const applyBare = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <SkillInstallContent
        sourceInput="acme/skills"
        onSourceInputChange={jest.fn()}
        sourceLoading={false}
        sourceError=""
        preview={{
          id: 'preview-1',
          kind: 'previewSource',
          scope: 'hub',
          source: 'https://github.com/acme/skills.git',
          sourceKey: 'github.com/acme/skills',
          ref: 'main',
          resolvedCommit: '1234567890abcdef',
          skillList: [
            {name: 'baseline-ui', skillPath: 'skills/baseline-ui', contentSha256: 'a'.repeat(64)},
            {name: 'scope', skillPath: 'skills/scope', contentSha256: 'b'.repeat(64)},
          ],
          createdAt: '2026-08-12T10:00:00Z',
        }}
        requestedSkillNames={[]}
        onPreview={jest.fn()}
        onApply={applyBare}
      />,
    );
  });

  expect(renderer.root.findByProps({className: 'skill-install-preview-mode'}).children.join(''))
    .toContain('Source only');
  expect(renderer.root.findAll(node => node.props.className === 'settings-skill-row settings-skill-candidate-row'))
    .toHaveLength(2);
  expect(renderer.root.findAllByProps({className: 'settings-skill-select-all-row'})).toHaveLength(0);
  act(() => renderer.root.findByProps({'aria-label': 'Save skill source'}).props.onClick());
  expect(applyBare).toHaveBeenCalledWith('preview-1');
});

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
