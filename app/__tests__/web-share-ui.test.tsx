// @ts-nocheck
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {ShareManager} from '../web/src/shares/ShareManager';

function serviceFixture(overrides = {}) {
  return {
    listShares: jest.fn(async () => ({enabled: true, publicUrl: 'https://share.example.test', items: [], nextCursor: undefined})),
    createShare: jest.fn(async payload => ({token: 'a'.repeat(43), url: `https://share.example.test/s/${'a'.repeat(43)}`, createdAt: '2026-08-10T12:00:00Z', expiresAt: payload.expiry === 'permanent' ? null : '2026-08-11T12:00:00Z'})),
    deleteShare: jest.fn(async () => ({ok: true})),
    ...overrides,
  };
}

function findButton(renderer, label) {
  return renderer.root.findAll(node => node.type === 'button' && node.children.join('') === label)[0];
}

function findText(renderer, label) {
  return renderer.root.findAll(node => node.children?.join?.('') === label)[0];
}

async function renderManager(props = {}) {
  const service = props.service ?? serviceFixture();
  const captureSnapshot = props.captureSnapshot ?? jest.fn(async () => ({kind: 'html', title: 'Page', html: '<p>Page</p>', warnings: []}));
  let renderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ShareManager
        service={service}
        initialSource={props.initialSource ?? {projectId: 'hub:project', path: 'docs/page.html', kind: 'html', title: 'Page', content: '<p>Page</p>'}}
        captureSnapshot={captureSnapshot}
        onBack={jest.fn()}
      />,
    );
  });
  return {renderer, service, captureSnapshot};
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('ShareManager defaults new shares to one day', async () => {
  const {renderer, service} = await renderManager();
  const select = renderer.root.findByType('select');
  expect(select.props.value).toBe('1d');
  await ReactTestRenderer.act(async () => {
    findButton(renderer, 'Create public share').props.onClick();
    await flush();
    await flush();
  });
  expect(service.createShare).toHaveBeenCalledWith(expect.objectContaining({expiry: '1d', encoding: 'gzip+base64'}));
});

test('ShareManager pauses on dependency warnings and can continue', async () => {
  const captureSnapshot = jest.fn(async () => ({
    kind: 'html', title: 'Page', html: '<script src="./app.js"></script>',
    warnings: [{source: './app.js', message: 'Relative dependency may not load.'}],
  }));
  const {renderer, service} = await renderManager({captureSnapshot});
  await ReactTestRenderer.act(async () => {
    findButton(renderer, 'Create public share').props.onClick();
    await flush();
  });
  expect(findButton(renderer, 'Continue anyway')).toBeDefined();
  expect(service.createShare).not.toHaveBeenCalled();
  await ReactTestRenderer.act(async () => {
    findButton(renderer, 'Continue anyway').props.onClick();
    await flush();
    await flush();
  });
  expect(service.createShare).toHaveBeenCalledTimes(1);
});

test('ShareManager keeps management usable while sharing is disabled and stops records', async () => {
  const token = 'b'.repeat(43);
  const service = serviceFixture({
    listShares: jest.fn(async () => ({enabled: false, items: [{token, title: 'Old', projectId: 'hub:p', path: 'old.html', kind: 'html', createdAt: '2026-08-10T12:00:00Z', expiresAt: null, sizeBytes: 3}], nextCursor: undefined})),
  });
  const {renderer} = await renderManager({service, initialSource: null});
  expect(renderer.root.findByProps({'data-share-enabled': 'false'})).toBeDefined();
  expect(findText(renderer, 'Old')).toBeDefined();
  const stop = findButton(renderer, 'Stop sharing');
  await ReactTestRenderer.act(async () => stop.props.onClick());
  expect(service.deleteShare).toHaveBeenCalledWith(token);
  expect(findText(renderer, 'No active shares.')).toBeDefined();
});

test('ShareManager paginates with a cursor and a default 50-item page', async () => {
  const service = serviceFixture({
    listShares: jest.fn()
      .mockResolvedValueOnce({enabled: true, items: [], nextCursor: 'next'})
      .mockResolvedValueOnce({enabled: true, items: [], nextCursor: undefined}),
  });
  const {renderer} = await renderManager({service, initialSource: null});
  expect(service.listShares).toHaveBeenCalledWith({limit: 50});
  await ReactTestRenderer.act(async () => findButton(renderer, 'Load more').props.onClick());
  expect(service.listShares).toHaveBeenLastCalledWith({cursor: 'next', limit: 50});
});
