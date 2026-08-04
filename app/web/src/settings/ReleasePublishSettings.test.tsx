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

test('uses a single-column publish page layout', async () => {
  (global as typeof globalThis & {window: Window}).window = {
    localStorage: {getItem: () => null, setItem: () => undefined},
  } as unknown as Window;
  let tree: ReturnType<typeof create>;
  await act(async () => { tree = create(<ReleasePublishSettings hubIds={['publisher']} start={async () => ({ok: true, status: 'running'})} query={async () => ({ok: true, status: 'running'})} />); });
  expect(tree!.root.findAllByProps({className: 'release-publish-page'})).toHaveLength(1);
  expect(tree!.root.findAllByProps({className: 'release-publish-actions'})).toHaveLength(2);
  expect(tree!.root.findAllByType('section').map(section => section.props['aria-label'])).toEqual(['Publishing source', 'Version release', 'Temporary Web']);
});

test('shows the publishing Hub failure instead of a missing state response', async () => {
  const values = new Map<string, string>();
  values.set('wheelmaker.settings.release-publish.v1', JSON.stringify({jobId: 'job-1', jobHubId: 'publisher'}));
  (global as typeof globalThis & {window: Window}).window = {
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    setInterval: () => 1,
    clearInterval: () => undefined,
  } as unknown as Window;
  let tree: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<ReleasePublishSettings
      hubIds={['publisher']}
      start={async () => ({ok: true, status: 'running'})}
      query={async () => ({ok: false, status: 'failed', error: 'release token is not configured'})}
    />);
    await Promise.resolve();
  });
  expect(JSON.stringify(tree!.toJSON())).toContain('release token is not configured');
  tree!.unmount();
});

test('sends temporary Web to the configured Server Hub', async () => {
  const values = new Map<string, string>();
  values.set('wheelmaker.settings.release-publish.v1', JSON.stringify({
    publisherHubId: 'publisher',
    sourcePath: '/src/WheelMaker',
    serverHubId: 'release-server',
    autoPull: true,
    webHubId: 'web-server',
  }));
  (global as typeof globalThis & {window: Window}).window = {
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    setInterval: () => 1,
    clearInterval: () => undefined,
  } as unknown as Window;
  const start = jest.fn(async () => ({ok: false, status: 'failed', error: 'expected test rejection'}));
  let tree: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<ReleasePublishSettings hubIds={['publisher', 'release-server', 'web-server']} start={start} query={async () => ({ok: true, status: 'running'})} />);
  });
  const button = tree!.root.findAllByType('button').find(item => item.children.some(child => typeof child === 'string' && child.includes('Publish temporary Web')));
  await act(async () => { button!.props.onClick(); await Promise.resolve(); });
  const publishButton = tree!.root.findAllByType('button').find(item => item.children.some(child => typeof child === 'string' && child.trim() === 'Publish'));
  await act(async () => { publishButton!.props.onClick(); await Promise.resolve(); await Promise.resolve(); });
  expect(start).toHaveBeenCalledWith('publisher', {
    kind: 'debugWeb',
    sourcePath: '/src/WheelMaker',
    webHubId: 'release-server',
  });
  tree!.unmount();
});

test('requires a Server Hub only for temporary Web publishing', async () => {
  const values = new Map<string, string>();
  values.set('wheelmaker.settings.release-publish.v1', JSON.stringify({publisherHubId: 'publisher', sourcePath: '/src/WheelMaker'}));
  (global as typeof globalThis & {window: Window}).window = {
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
  } as unknown as Window;
  let tree: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<ReleasePublishSettings hubIds={['publisher']} start={async () => ({ok: true, status: 'running'})} query={async () => ({ok: true, status: 'running'})} />);
  });
  const buttons = tree!.root.findAllByType('button');
  expect(buttons.find(item => item.children.some(child => typeof child === 'string' && child.includes('Publish version')))!.props.disabled).toBe(false);
  expect(buttons.find(item => item.children.some(child => typeof child === 'string' && child.includes('Publish temporary Web')))!.props.disabled).toBe(true);
  expect(JSON.stringify(tree!.toJSON())).toContain('Server Hub');
  const source = tree!.root.findAllByType('section').find(section => section.props['aria-label'] === 'Publishing source')!;
  expect(source.findAllByType('select')).toHaveLength(2);
  expect(source.findAllByProps({className: 'set-field-label'}).some(label => label.children.includes('Server Hub'))).toBe(true);
  tree!.unmount();
});

test('migrates a legacy Web Hub setting into the Server Hub field', async () => {
  const values = new Map<string, string>();
  values.set('wheelmaker.settings.release-publish.v1', JSON.stringify({
    publisherHubId: 'publisher',
    sourcePath: '/src/WheelMaker',
    webHubId: 'web-server',
  }));
  (global as typeof globalThis & {window: Window}).window = {
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    setInterval: () => 1,
    clearInterval: () => undefined,
  } as unknown as Window;
  let tree: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<ReleasePublishSettings
      hubIds={['publisher', 'web-server']}
      start={async () => ({ok: true, status: 'running'})}
      query={async () => ({ok: true, status: 'running'})}
      queryStorage={async () => ({ok: true, status: 'success', storage: {totalBytes: 0, reclaimableBytes: 0, orphanCount: 0}})}
      pruneStorage={async () => ({ok: true, status: 'success'})}
    />);
  });
  const selects = tree!.root.findAllByType('select');
  expect(selects.some(select => select.props.value === 'web-server')).toBe(true);
  const persisted = JSON.parse(values.get('wheelmaker.settings.release-publish.v1')!);
  expect(persisted.serverHubId).toBe('web-server');
  expect('webHubId' in persisted).toBe(false);
  tree!.unmount();
});
