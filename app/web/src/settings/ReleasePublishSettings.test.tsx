// @ts-nocheck
import React from 'react';
import {act, create} from 'react-test-renderer';

import {ReleasePublishSettings} from './ReleasePublishSettings';
import {settingsDetailTitle} from './SettingsSurface';
import {isSettingsChildDetail, isSettingsDetailId} from './settingsNavigation';

test('exposes release publishing as a dedicated Debug detail', () => {
  expect(isSettingsDetailId('releasePublish')).toBe(true);
  expect(isSettingsChildDetail('releasePublish')).toBe(true);
  expect(settingsDetailTitle('releasePublish')).toBe('Release publishing');
});

test('restores browser-only publishing settings without token or URL controls', async () => {
  const values = new Map<string, string>();
  (global as typeof globalThis & {window: Window}).window = {
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  } as unknown as Window;
  values.set('wheelmaker.settings.release-publish.v1', JSON.stringify({publisherHubId: 'publisher', sourcePath: '/src/WheelMaker'}));
  let tree: ReturnType<typeof create>;
  await act(async () => { tree = create(<ReleasePublishSettings hubIds={['publisher', 'server']} start={async () => ({ok: true, status: 'running'})} query={async () => ({ok: true, status: 'running'})} />); });
  const inputs = tree!.root.findAllByType('input');
  expect(inputs.some(input => input.props.value === '/src/WheelMaker')).toBe(true);
  expect(inputs.some(input => input.props.type === 'checkbox' && input.props.disabled === true)).toBe(true);
  expect(JSON.stringify(tree!.toJSON()).toLowerCase()).not.toContain('token');
  expect(JSON.stringify(tree!.toJSON()).toLowerCase()).not.toContain('release server url');
});

test('uses a single-column publish page layout', async () => {
  (global as typeof globalThis & {window: Window}).window = {
    localStorage: {getItem: () => null, setItem: () => undefined},
  } as unknown as Window;
  let tree: ReturnType<typeof create>;
  await act(async () => { tree = create(<ReleasePublishSettings hubIds={['publisher']} start={async () => ({ok: true, status: 'running'})} query={async () => ({ok: true, status: 'running'})} />); });
  expect(tree!.root.findAllByProps({className: 'release-publish-page'})).toHaveLength(1);
  expect(tree!.root.findAllByProps({className: 'release-publish-actions'})).toHaveLength(1);
});
