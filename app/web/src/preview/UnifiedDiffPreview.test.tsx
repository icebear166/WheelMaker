import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {UnifiedDiffPreview} from './UnifiedDiffPreview';

test('renders binary and truncated states without losing file metadata', async () => {
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(
      <UnifiedDiffPreview
        files={[{
          path: 'asset.bin',
          status: 'M',
          additions: 0,
          deletions: 0,
          diff: '',
          expanded: true,
          isBinary: true,
          truncated: true,
        }]}
        activeFilePath="asset.bin"
        loading={false}
        error=""
        overviewLabel="1 changed file"
        onToggleFile={() => undefined}
        themeMode="dark"
        codeTheme="auto-plus"
        codeFont="jetbrains-mono"
        codeFontFamily="JetBrains Mono"
        codeFontSize={13}
        codeLineHeight={1.5}
        codeTabSize={2}
      />,
    );
  });

  const text = JSON.stringify(view.toJSON());
  expect(text).toContain('asset.bin');
  expect(text).toContain('Binary diff is not rendered');
  expect(text).toContain('Diff was truncated');
});
