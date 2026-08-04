// @ts-nocheck
import React from 'react';
import {act, create} from 'react-test-renderer';

import {ReleasePublishSettings} from './ReleasePublishSettings';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, reject, resolve};
}

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
  await act(async () => { tree = create(<ReleasePublishSettings hubIds={['publisher', 'server']} start={async () => ({ok: true, status: 'running'})} query={async () => ({ok: true, status: 'running'})} queryStorage={async () => ({ok: true, status: 'success', storage: {totalBytes: 0, reclaimableBytes: 0, orphanCount: 0}})} pruneStorage={async () => ({ok: true, status: 'success'})} />); });
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
  await act(async () => { tree = create(<ReleasePublishSettings hubIds={['publisher']} start={async () => ({ok: true, status: 'running'})} query={async () => ({ok: true, status: 'running'})} queryStorage={async () => ({ok: true, status: 'success', storage: {totalBytes: 0, reclaimableBytes: 0, orphanCount: 0}})} pruneStorage={async () => ({ok: true, status: 'success'})} />); });
  expect(tree!.root.findAllByProps({className: 'release-publish-page'})).toHaveLength(1);
  expect(tree!.root.findAllByProps({className: 'release-publish-actions'})).toHaveLength(3);
  expect(tree!.root.findAllByType('section').map(section => section.props['aria-label'])).toEqual(['Publishing source', 'Version release', 'Temporary Web', 'Release storage']);
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
      queryStorage={async () => ({ok: true, status: 'success', storage: {totalBytes: 0, reclaimableBytes: 0, orphanCount: 0}})}
      pruneStorage={async () => ({ok: true, status: 'success'})}
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
    tree = create(<ReleasePublishSettings hubIds={['publisher', 'release-server', 'web-server']} start={start} query={async () => ({ok: true, status: 'running'})} queryStorage={async () => ({ok: true, status: 'success', storage: {totalBytes: 0, reclaimableBytes: 0, orphanCount: 0}})} pruneStorage={async () => ({ok: true, status: 'success'})} />);
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
    tree = create(<ReleasePublishSettings hubIds={['publisher']} start={async () => ({ok: true, status: 'running'})} query={async () => ({ok: true, status: 'running'})} queryStorage={async () => ({ok: true, status: 'success', storage: {totalBytes: 0, reclaimableBytes: 0, orphanCount: 0}})} pruneStorage={async () => ({ok: true, status: 'success'})} />);
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


function renderWithStorage({
  storageResult = {ok: true, status: 'success', storage: {totalBytes: 2048, reclaimableBytes: 1024, orphanCount: 1}},
  pruneResult = {ok: true, status: 'success', removedCount: 1},
  settings = {publisherHubId: 'publisher', sourcePath: '/src/WheelMaker'},
} = {}) {
  const values = new Map<string, string>();
  values.set('wheelmaker.settings.release-publish.v1', JSON.stringify(settings));
  (global as typeof globalThis & {window: Window}).window = {
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    setInterval: () => 1,
    clearInterval: () => undefined,
  } as unknown as Window;
  const queryStorage = jest.fn(async () => storageResult);
  const pruneStorage = jest.fn(async () => pruneResult);
  return {
    queryStorage,
    pruneStorage,
    async render() {
      let tree: ReturnType<typeof create>;
      await act(async () => {
        tree = create(<ReleasePublishSettings
          hubIds={['publisher']}
          start={async () => ({ok: true, status: 'running'})}
          query={async () => ({ok: true, status: 'running'})}
          queryStorage={queryStorage}
          pruneStorage={pruneStorage}
        />);
        await Promise.resolve();
      });
      return tree!;
    },
  };
}

test('loads release storage on mount and shows totals', async () => {
  const {queryStorage, render} = renderWithStorage();
  const tree = await render();
  expect(queryStorage).toHaveBeenCalledWith('publisher', '/src/WheelMaker');
  const text = JSON.stringify(tree.toJSON());
  expect(text).toContain('Release storage');
  expect(text).toContain('2.0 KB');
  expect(text).toContain('1.0 KB');
  tree.unmount();
});

test('prunes unreferenced versions after confirmation and refreshes', async () => {
  const {queryStorage, pruneStorage, render} = renderWithStorage();
  const tree = await render();
  const cleanupButton = tree.root.findAllByType('button').find(item =>
    item.children.some(child => typeof child === 'string' && child.includes('Clean up')))!;
  await act(async () => { cleanupButton.props.onClick(); await Promise.resolve(); });
  const confirmButton = tree.root.findAllByType('button').find(item =>
    item.children.some(child => typeof child === 'string' && child.trim() === 'Clean up'))!;
  await act(async () => { confirmButton.props.onClick(); await Promise.resolve(); await Promise.resolve(); });
  expect(pruneStorage).toHaveBeenCalledWith('publisher', '/src/WheelMaker');
  expect(queryStorage.mock.calls.length).toBeGreaterThanOrEqual(2);
  tree.unmount();
});

test('disables cleanup when there is nothing to reclaim', async () => {
  const {render} = renderWithStorage({
    storageResult: {ok: true, status: 'success', storage: {totalBytes: 100, reclaimableBytes: 0, orphanCount: 0}},
  });
  const tree = await render();
  const cleanupButton = tree.root.findAllByType('button').find(item =>
    item.children.some(child => typeof child === 'string' && child.includes('Clean up')))!;
  expect(cleanupButton.props.disabled).toBe(true);
  tree.unmount();
});

test('shows storage errors in the page', async () => {
  const {render} = renderWithStorage({
    storageResult: {ok: false, status: 'failed', error: 'release token is not configured'},
  });
  const tree = await render();
  expect(JSON.stringify(tree.toJSON())).toContain('release token is not configured');
  tree.unmount();
});

test('ignores a stale storage response after the publishing target changes', async () => {
  const values = new Map<string, string>();
  values.set('wheelmaker.settings.release-publish.v1', JSON.stringify({publisherHubId: 'publisher-a', sourcePath: '/src/a'}));
  (global as typeof globalThis & {window: Window}).window = {
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    setInterval: () => 1,
    clearInterval: () => undefined,
  } as unknown as Window;
  const first = deferred<any>();
  const second = deferred<any>();
  const queryStorage = jest.fn((hubId: string) => hubId === 'publisher-a' ? first.promise : second.promise);
  let tree: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<ReleasePublishSettings
      hubIds={['publisher-a', 'publisher-b']}
      start={async () => ({ok: true, status: 'running'})}
      query={async () => ({ok: true, status: 'running'})}
      queryStorage={queryStorage}
      pruneStorage={async () => ({ok: true, status: 'success'})}
    />);
    await Promise.resolve();
  });
  const publishingHub = tree!.root.findAllByType('select')[0];
  await act(async () => {
    publishingHub.props.onChange({target: {value: 'publisher-b'}});
    await Promise.resolve();
  });
  await act(async () => {
    second.resolve({ok: true, status: 'success', storage: {totalBytes: 4096, reclaimableBytes: 0, orphanCount: 0}});
    await second.promise;
  });
  await act(async () => {
    first.resolve({ok: true, status: 'success', storage: {totalBytes: 1024, reclaimableBytes: 0, orphanCount: 0}});
    await first.promise;
  });
  const text = JSON.stringify(tree!.toJSON());
  expect(text).toContain('4.0 KB');
  expect(text).not.toContain('1.0 KB');
  tree!.unmount();
});

test('prunes the storage target captured when confirmation opens', async () => {
  const {pruneStorage, render} = renderWithStorage();
  const tree = await render();
  const cleanupButton = tree.root.findAllByType('button').find(item =>
    item.children.some(child => typeof child === 'string' && child.includes('Clean up')))!;
  await act(async () => { cleanupButton.props.onClick(); await Promise.resolve(); });
  const sourceSection = tree.root.findAllByType('section').find(section => section.props['aria-label'] === 'Publishing source')!;
  const sourceInput = sourceSection.findAllByType('input').find(input => input.props.value === '/src/WheelMaker')!;
  await act(async () => {
    sourceSection.findAllByType('select')[0].props.onChange({target: {value: 'publisher-b'}});
    sourceInput.props.onChange({target: {value: '/src/other'}});
    await Promise.resolve();
  });
  const confirmButton = tree.root.findAllByType('button').find(item =>
    item.children.some(child => typeof child === 'string' && child.trim() === 'Clean up'))!;
  await act(async () => { confirmButton.props.onClick(); await Promise.resolve(); await Promise.resolve(); });
  expect(pruneStorage).toHaveBeenCalledWith('publisher', '/src/WheelMaker');
  tree.unmount();
});

test('a successful storage refresh does not clear a publish error', async () => {
  const values = new Map<string, string>();
  values.set('wheelmaker.settings.release-publish.v1', JSON.stringify({
    publisherHubId: 'publisher',
    sourcePath: '/src/WheelMaker',
    jobId: 'job-1',
    jobHubId: 'publisher',
  }));
  (global as typeof globalThis & {window: Window}).window = {
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    setInterval: () => 1,
    clearInterval: () => undefined,
  } as unknown as Window;
  const storage = deferred<any>();
  let tree: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<ReleasePublishSettings
      hubIds={['publisher']}
      start={async () => ({ok: true, status: 'running'})}
      query={async () => ({ok: false, status: 'failed', error: 'publish failed visibly'})}
      queryStorage={() => storage.promise}
      pruneStorage={async () => ({ok: true, status: 'success'})}
    />);
    await Promise.resolve();
  });
  expect(JSON.stringify(tree!.toJSON())).toContain('publish failed visibly');
  await act(async () => {
    storage.resolve({ok: true, status: 'success', storage: {totalBytes: 0, reclaimableBytes: 0, orphanCount: 0}});
    await storage.promise;
  });
  expect(JSON.stringify(tree!.toJSON())).toContain('publish failed visibly');
  tree!.unmount();
});
