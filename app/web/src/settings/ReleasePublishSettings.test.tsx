// @ts-nocheck
import React from 'react';
import {act, create} from 'react-test-renderer';

import {ReleasePublishSettings} from './ReleasePublishSettings';

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
