import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {AppConfirmDialog, type ConfirmTarget} from './AppDialogs';

function confirmCopy(target: ConfirmTarget): string {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <AppConfirmDialog
        target={target}
        busy={false}
        error=""
        onCancel={() => undefined}
        onPrimary={() => undefined}
      />,
    );
  });
  return renderer.root.findByProps({className: 'app-confirm-copy'}).children.join('');
}

test('npm confirmation explains automatic Agent availability reload', () => {
  const copy = confirmCopy({
    kind: 'npmPackage',
    action: 'uninstall',
    hubId: 'hub-a',
    packageName: '@openai/codex',
    displayName: 'Codex',
    installedVersion: '1.0.0',
    latestVersion: '1.0.0',
  });

  expect(copy).toContain('Agent availability refreshes automatically');
  expect(copy).not.toContain('Restart WheelMaker');
});

test('bulk npm confirmation explains automatic Agent availability reload', () => {
  const copy = confirmCopy({
    kind: 'npmPackageHubUpdate',
    hubId: 'hub-a',
    packages: [{
      packageName: '@openai/codex',
      displayName: 'Codex',
      installedVersion: '1.0.0',
      latestVersion: '2.0.0',
    }],
  });

  expect(copy).toContain('Agent availability refreshes automatically');
  expect(copy).not.toContain('Restart WheelMaker');
});

test('single-skill update confirmation names the selected skill', () => {
  const copy = confirmCopy({
    kind: 'skillUpdate',
    hubId: 'hub-a',
    scope: 'hub',
    skills: ['baseline-ui'],
  });

  expect(copy).toContain('baseline-ui');
  expect(copy).toContain('Hub: hub-a');
});
