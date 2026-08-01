import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {
  AppConfirmDialog,
  AppHtmlExportNameDialog,
  type ConfirmTarget,
} from './AppDialogs';

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

test('marks a Hub-owned confirmation as part of the Hub interaction surface', () => {
  const props = {
    target: {
      kind: 'wheelMakerUpdateAll',
      hubIds: ['hub-a'],
    } satisfies ConfirmTarget,
    busy: false,
    error: '',
    onCancel: () => undefined,
    onPrimary: () => undefined,
    preserveChatHubMenu: true,
  } as React.ComponentProps<typeof AppConfirmDialog> & {preserveChatHubMenu: boolean};
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<AppConfirmDialog {...props} />);
  });

  expect(renderer.root.findByProps({className: 'app-confirm-backdrop'}).props)
    .toMatchObject({'data-chat-hub-owned-overlay': 'true'});
});

test('Restart confirmation uses runtime-reload copy and refresh icon', () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <AppConfirmDialog
        target={{
          kind: 'wheelMakerUpdate',
          action: 'restart',
          hubId: 'hub-a',
          currentVersion: 'v1.2.0',
          latestVersion: 'v1.3.0',
        }}
        busy={false}
        error=""
        onCancel={() => undefined}
        onPrimary={() => undefined}
      />,
    );
  });

  expect(renderer.root.findByProps({className: 'app-confirm-title'}).children.join(''))
    .toBe('Restart WheelMaker?');
  expect(renderer.root.findByProps({className: 'app-confirm-copy'}).children.join(''))
    .toContain('does not download or update WheelMaker');
  expect(renderer.root.findByProps({className: 'app-confirm-copy'}).children.join(''))
    .toContain('latest environment variables');
  const primary = renderer.root.findByProps({className: 'app-confirm-btn primary'});
  expect(primary.findByProps({'data-icon-name': 'refreshCw'})).toBeDefined();
  expect(primary.children.join('')).toContain('Restart');
});

test('HTML export name dialog presents an editable stem with a fixed extension', () => {
  const onCancel = jest.fn();
  const onSubmit = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <AppHtmlExportNameDialog
        open
        nameStem="2026-07-30_15-42-08"
        error=""
        onNameStemChange={() => undefined}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />,
    );
  });

  const input = renderer.root.findByProps({'aria-label': 'HTML file name'});
  expect(input.props.value).toBe('2026-07-30_15-42-08');
  expect(renderer.root.findByProps({className: 'app-html-export-name-suffix'}).children)
    .toEqual(['.html']);

  act(() => {
    input.props.onKeyDown({key: 'Enter', preventDefault: jest.fn()});
  });
  expect(onSubmit).toHaveBeenCalledTimes(1);

  act(() => {
    input.props.onKeyDown({key: 'Escape', preventDefault: jest.fn()});
  });
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test('HTML export name dialog disables export for an invalid stem', () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <AppHtmlExportNameDialog
        open
        nameStem=""
        error="Enter a file name."
        onNameStemChange={() => undefined}
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );
  });

  expect(renderer.root.findByProps({className: 'app-confirm-btn primary'}).props.disabled)
    .toBe(true);
  expect(renderer.root.findByProps({className: 'app-confirm-error'}).children)
    .toEqual(['Enter a file name.']);
});
