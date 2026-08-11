// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {ShareManager} from '../web/src/shares/ShareManager';
import {writeTextToClipboard} from '../web/src/platform/clipboard';

jest.mock('../web/src/platform/clipboard', () => ({
  writeTextToClipboard: jest.fn(async () => undefined),
}));

const writeTextToClipboardMock = writeTextToClipboard as jest.MockedFunction<typeof writeTextToClipboard>;

beforeEach(() => {
  writeTextToClipboardMock.mockReset();
  writeTextToClipboardMock.mockResolvedValue(undefined);
});

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

function findButtonContaining(renderer, label) {
  return renderer.root.findAll(node => node.type === 'button' && node.children.some(child => (
    typeof child === 'string' && child.includes(label)
  )))[0];
}

function findText(renderer, label) {
  return renderer.root.findAll(node => node.children?.join?.('') === label)[0];
}

async function renderManager(props = {}) {
  const service = props.service ?? serviceFixture();
  const captureSnapshot = props.captureSnapshot ?? jest.fn(async () => ({kind: 'html', title: 'Page', html: '<p>Page</p>', warnings: []}));
  const initialSource = Object.prototype.hasOwnProperty.call(props, 'initialSource')
    ? props.initialSource
    : {projectId: 'hub:project', path: 'docs/page.html', kind: 'html', title: 'Page', content: '<p>Page</p>'};
  let renderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ShareManager
        service={service}
        initialSource={initialSource}
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
  const titleInput = renderer.root.findByProps({'aria-label': 'Share name'});
  expect(titleInput.props.value).toBe('Page');
  await ReactTestRenderer.act(async () => {
    titleInput.props.onChange({target: {value: 'Architecture review'}});
  });
  await ReactTestRenderer.act(async () => {
    findButton(renderer, 'Create public share').props.onClick();
    await flush();
    await flush();
  });
  expect(service.createShare).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Architecture review',
    expiry: '1d',
    encoding: 'gzip+base64',
  }));
});

test('ShareManager presents file creation as a modal with the Share server status', async () => {
  const {renderer} = await renderManager();
  const dialog = renderer.root.findByProps({role: 'dialog'});
  expect(dialog.props['aria-modal']).toBe(true);
  expect(renderer.root.findByProps({'data-share-enabled': 'true'})).toBeDefined();
  expect(findText(renderer, 'https://share.example.test')).toBeDefined();
  expect(renderer.root.findAllByProps({'aria-label': 'Current public shares'})).toHaveLength(0);
});

test('ShareManager automatically copies a created link and offers compact open and copy actions', async () => {
  const {renderer} = await renderManager();
  await ReactTestRenderer.act(async () => {
    findButton(renderer, 'Create public share').props.onClick();
    await flush();
    await flush();
  });
  const url = `https://share.example.test/s/${'a'.repeat(43)}`;
  expect(writeTextToClipboardMock).toHaveBeenCalledWith(url);
  expect(renderer.root.findByProps({'data-share-created-link': url})).toBeDefined();
  const open = renderer.root.findByProps({'aria-label': 'Open share link'});
  expect(open.type).toBe('a');
  expect(open.props).toMatchObject({
    href: url,
    target: '_blank',
    rel: 'noopener noreferrer',
    'data-tooltip': 'Open share link',
  });
  expect(open.findByProps({'data-icon-name': 'externalLink'})).toBeDefined();
  expect(open.children.filter(child => typeof child === 'string')).toHaveLength(0);

  const copy = renderer.root.findByProps({'aria-label': 'Copy share link'});
  expect(copy.type).toBe('button');
  expect(copy.props['data-tooltip']).toBe('Copy share link');
  expect(copy.findByProps({'data-icon-name': 'copy'})).toBeDefined();
  expect(copy.children.filter(child => typeof child === 'string')).toHaveLength(0);
  expect(findButton(renderer, 'Done')).toBeDefined();
  expect(renderer.root.findAllByProps({'aria-label': 'Delete share'})).toHaveLength(0);

  await ReactTestRenderer.act(async () => copy.props.onClick());
  expect(writeTextToClipboardMock).toHaveBeenCalledTimes(2);
  expect(writeTextToClipboardMock).toHaveBeenLastCalledWith(url);
});

test('ShareManager keeps the created link visible when automatic clipboard copy fails', async () => {
  writeTextToClipboardMock.mockRejectedValueOnce(new Error('clipboard denied'));
  const {renderer} = await renderManager();
  await ReactTestRenderer.act(async () => {
    findButton(renderer, 'Create public share').props.onClick();
    await flush();
    await flush();
  });
  const url = `https://share.example.test/s/${'a'.repeat(43)}`;
  expect(renderer.root.findByProps({'data-share-created-link': url})).toBeDefined();
  expect(findText(renderer, 'Share created, but automatic copy failed: clipboard denied')).toBeDefined();
});

test('ShareManager disables modal creation when the Share server is unavailable', async () => {
  const service = serviceFixture({
    listShares: jest.fn(async () => ({enabled: false, items: [], nextCursor: undefined})),
  });
  const {renderer} = await renderManager({service});
  expect(renderer.root.findByProps({'data-share-enabled': 'false'})).toBeDefined();
  expect(findButton(renderer, 'Create public share').props.disabled).toBe(true);
  expect(findText(renderer, 'Set a Share public URL in Config to create new links.')).toBeDefined();
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

test('ShareManager stays busy while a frozen chat document is being rendered', async () => {
  let resolveCapture;
  const captureSnapshot = jest.fn(() => new Promise(resolve => {
    resolveCapture = resolve;
  }));
  const {renderer} = await renderManager({captureSnapshot});

  await ReactTestRenderer.act(async () => {
    findButton(renderer, 'Create public share').props.onClick();
    await flush();
  });

  expect(findButtonContaining(renderer, 'Creating…').props.disabled).toBe(true);
  expect(findButton(renderer, 'Cancel').props.disabled).toBe(true);

  await ReactTestRenderer.act(async () => {
    resolveCapture({kind: 'html', title: 'Page', html: '<p>Page</p>', warnings: []});
    await flush();
    await flush();
  });
});

test('ShareManager creates a frozen current-response source without project path fields', async () => {
  const sessionFixture = {title: 'Design review', answer: 'Frozen answer'};
  const frozenSnapshot = Object.freeze({
    scope: 'response',
    projectId: 'hub:p',
    sessionId: 'sess-1',
    terminalTurnIndex: 9,
    title: sessionFixture.title,
    capturedAt: '2026-08-11T08:30:00Z',
    presentation: Object.freeze({themeMode: 'dark', codeTheme: 'tokyo-night', codeFont: 'jetbrains-mono', codeFontSize: 13, codeLineHeight: 1.6, codeTabSize: 2}),
    entries: Object.freeze([Object.freeze({
      role: 'assistant',
      markdown: sessionFixture.answer,
      attachments: Object.freeze([]),
      startTurnIndex: 2,
      endTurnIndex: 9,
    })]),
  });
  const source = Object.freeze({
    sourceType: 'chat_response',
    projectId: 'hub:p',
    sessionId: 'sess-1',
    turnIndex: 9,
    sessionTitle: sessionFixture.title,
    title: 'Design review',
    snapshot: frozenSnapshot,
  });
  const captureSnapshot = jest.fn(async current => ({
    kind: 'html',
    title: current.title,
    html: `<p>${current.snapshot.entries[0].markdown}</p>`,
    warnings: [],
  }));
  const {renderer, service} = await renderManager({source, initialSource: source, captureSnapshot});

  sessionFixture.title = 'Changed later';
  sessionFixture.answer = 'Changed later answer';
  expect(findText(renderer, 'Current response · Design review')).toBeDefined();
  await ReactTestRenderer.act(async () => {
    findButton(renderer, 'Create public share').props.onClick();
    await flush();
    await flush();
  });

  expect(captureSnapshot).toHaveBeenCalledWith(source);
  expect(service.createShare).toHaveBeenCalledWith(expect.objectContaining({
    sourceType: 'chat_response',
    projectId: 'hub:p',
    sessionId: 'sess-1',
    turnIndex: 9,
  }));
  const payload = service.createShare.mock.calls[0][0];
  const sharedHtml = gunzipSync(Buffer.from(payload.content, 'base64')).toString('utf8');
  expect(sharedHtml).toContain('Frozen answer');
  expect(sharedHtml).not.toContain('Changed later answer');
  expect(payload).not.toHaveProperty('path');
  expect(payload).not.toHaveProperty('kind');
});

test('ShareManager labels full-session records and presents three compact link actions', async () => {
  const token = 'c'.repeat(43);
  const url = `https://share.example.test/s/${token}`;
  const service = serviceFixture({
    listShares: jest.fn(async () => ({enabled: true, items: [{
      token,
      title: 'Team sync',
      sourceType: 'chat_session',
      projectId: 'hub:p',
      sessionId: 'sess-2',
      createdAt: '2026-08-10T12:00:00Z',
      expiresAt: null,
      sizeBytes: 3,
      url,
    }], nextCursor: undefined})),
  });
  const {renderer} = await renderManager({service, initialSource: null});

  expect(findText(renderer, 'Full session · Team sync · permanent')).toBeDefined();
  const record = renderer.root.findByProps({'data-share-token': token});
  const actions = record.findAll(node => node.props['data-share-action']);
  expect(actions.map(action => action.props['data-share-action'])).toEqual(['open', 'copy', 'delete']);
  actions.forEach(action => {
    expect(action.children.filter(child => typeof child === 'string')).toHaveLength(0);
  });

  const open = record.findByProps({'data-share-action': 'open'});
  expect(open.type).toBe('a');
  expect(open.props).toMatchObject({
    href: url,
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': 'Open share link',
    'data-tooltip': 'Open share link',
  });
  expect(open.findByProps({'data-icon-name': 'externalLink'})).toBeDefined();

  const copy = record.findByProps({'data-share-action': 'copy'});
  expect(copy.props).toMatchObject({'aria-label': 'Copy share link', 'data-tooltip': 'Copy share link'});
  expect(copy.findByProps({'data-icon-name': 'copy'})).toBeDefined();
  await ReactTestRenderer.act(async () => copy.props.onClick());
  expect(writeTextToClipboardMock).toHaveBeenCalledWith(url);

  const remove = record.findByProps({'data-share-action': 'delete'});
  expect(remove.props).toMatchObject({'aria-label': 'Delete share', 'data-tooltip': 'Delete share'});
  expect(remove.props.className).toContain('share-manager-danger-button');
  expect(remove.findByProps({'data-icon-name': 'trash'})).toBeDefined();
  const shareStyles = fs.readFileSync(path.resolve(__dirname, '../web/src/shares/shares.css'), 'utf8');
  expect(shareStyles).toMatch(/\.share-manager-record-actions\s*\{[^}]*gap:\s*6px/);
  expect(shareStyles).toMatch(/\.share-manager-record-actions \.share-manager-danger-button\s*\{[^}]*color:\s*var\(--state-danger/);
});

test('ShareManager confirms deletion before revoking a public link', async () => {
  const token = 'd'.repeat(43);
  const service = serviceFixture({
    listShares: jest.fn(async () => ({enabled: true, items: [{
      token,
      title: 'Review notes',
      projectId: 'hub:p',
      path: 'review.html',
      kind: 'html',
      createdAt: '2026-08-10T12:00:00Z',
      expiresAt: null,
      sizeBytes: 3,
      url: `https://share.example.test/s/${token}`,
    }], nextCursor: undefined})),
  });
  const {renderer} = await renderManager({service, initialSource: null});
  const remove = renderer.root.findByProps({'data-share-action': 'delete'});

  await ReactTestRenderer.act(async () => remove.props.onClick());
  expect(service.deleteShare).not.toHaveBeenCalled();
  expect(renderer.root.findByProps({role: 'alertdialog'}).props).toMatchObject({
    'aria-labelledby': 'app-confirm-title',
    'aria-describedby': 'app-confirm-copy',
  });
  expect(findText(renderer, 'Delete share?')).toBeDefined();
  expect(findText(renderer, 'Review notes')).toBeDefined();
  expect(findText(renderer, 'The public link will stop working immediately. The source document or session will not be deleted.')).toBeDefined();

  await ReactTestRenderer.act(async () => findButton(renderer, 'Cancel').props.onClick());
  expect(service.deleteShare).not.toHaveBeenCalled();
  expect(renderer.root.findByProps({'data-share-token': token})).toBeDefined();
  expect(renderer.root.findAllByProps({className: 'app-confirm-backdrop'})).toHaveLength(0);

  await ReactTestRenderer.act(async () => remove.props.onClick());
  await ReactTestRenderer.act(async () => {
    findButtonContaining(renderer, 'Delete share').props.onClick();
    await flush();
  });
  expect(service.deleteShare).toHaveBeenCalledWith(token);
  expect(renderer.root.findAllByProps({'data-share-token': token})).toHaveLength(0);
});

test('ShareManager disables open and copy without a URL but keeps confirmed deletion available', async () => {
  const token = 'b'.repeat(43);
  const service = serviceFixture({
    listShares: jest.fn(async () => ({enabled: false, items: [{token, title: 'Old', projectId: 'hub:p', path: 'old.html', kind: 'html', createdAt: '2026-08-10T12:00:00Z', expiresAt: null, sizeBytes: 3}], nextCursor: undefined})),
  });
  const {renderer} = await renderManager({service, initialSource: null});
  expect(renderer.root.findByProps({'data-share-enabled': 'false'})).toBeDefined();
  expect(findText(renderer, 'Old')).toBeDefined();
  const record = renderer.root.findByProps({'data-share-token': token});
  expect(record.findByProps({'data-share-action': 'open'}).props.disabled).toBe(true);
  expect(record.findByProps({'data-share-action': 'copy'}).props.disabled).toBe(true);
  expect(record.findByProps({'data-share-action': 'delete'}).props.disabled).toBe(false);

  await ReactTestRenderer.act(async () => record.findByProps({'data-share-action': 'delete'}).props.onClick());
  await ReactTestRenderer.act(async () => {
    findButtonContaining(renderer, 'Delete share').props.onClick();
    await flush();
  });
  expect(service.deleteShare).toHaveBeenCalledWith(token);
  expect(findText(renderer, 'No active shares.')).toBeDefined();
});

test('ShareManager keeps a record and the confirmation open when deletion fails', async () => {
  const token = 'e'.repeat(43);
  const service = serviceFixture({
    listShares: jest.fn(async () => ({enabled: true, items: [{
      token,
      title: 'Persistent link',
      projectId: 'hub:p',
      path: 'persistent.html',
      kind: 'html',
      createdAt: '2026-08-10T12:00:00Z',
      expiresAt: null,
      sizeBytes: 3,
      url: `https://share.example.test/s/${token}`,
    }], nextCursor: undefined})),
    deleteShare: jest.fn(async () => { throw new Error('delete denied'); }),
  });
  const {renderer} = await renderManager({service, initialSource: null});

  await ReactTestRenderer.act(async () => renderer.root.findByProps({'data-share-action': 'delete'}).props.onClick());
  await ReactTestRenderer.act(async () => {
    findButtonContaining(renderer, 'Delete share').props.onClick();
    await flush();
  });

  expect(renderer.root.findByProps({'data-share-token': token})).toBeDefined();
  expect(findText(renderer, 'delete denied')).toBeDefined();
  expect(findText(renderer, 'Delete share?')).toBeDefined();
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

test('file share actions open the create dialog without opening the management screen', () => {
  const workspaceSource = fs.readFileSync(
    path.resolve(__dirname, '../web/src/app/WorkspaceApp.tsx'),
    'utf8',
  );
  expect(workspaceSource).toContain('const openShareCreate = useCallback');
  expect(workspaceSource.match(/openShareCreate\(\{/g)).toHaveLength(3);
  expect(workspaceSource).not.toContain('openShares({');
  expect(workspaceSource).toContain('{shareSource ? (');
});
