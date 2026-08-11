import {RegistryMethods} from '../web/src/registry/registryMethods';
import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import type {RegistryShareCreatePayload} from '../web/src/registry/registryTypes';

test('registry exposes public share methods', () => {
  expect(RegistryMethods.ShareCreate).toBe('share.create');
  expect(RegistryMethods.ShareList).toBe('share.list');
  expect(RegistryMethods.ShareDelete).toBe('share.delete');
});

test('registry sends all valid public share source payloads unchanged', async () => {
  const request = jest.fn(async () => ({payload: {
    token: 'a'.repeat(43),
    createdAt: '2026-08-11T08:30:00Z',
  }}));
  const repository = new RegistryRepository({request} as never);
  const common = {
    title: 'Share',
    expiry: '1d' as const,
    encoding: 'gzip+base64' as const,
    content: 'H4sI',
  };
  const payloads: RegistryShareCreatePayload[] = [
    {projectId: 'hub:p', path: 'docs/readme.md', kind: 'markdown', ...common},
    {sourceType: 'chat_response', projectId: 'hub:p', sessionId: 'sess-1', turnIndex: 9, ...common},
    {sourceType: 'chat_session', projectId: 'hub:p', sessionId: 'sess-1', ...common},
  ];

  for (const payload of payloads) {
    await repository.createShare(payload);
  }

  expect(request.mock.calls.map(call => call[0].payload)).toEqual(payloads);
});

test('registry strictly parses project, response, and session share records', async () => {
  const request = jest.fn(async () => ({payload: {
    enabled: true,
    items: [
      {
        token: 'a'.repeat(43), title: 'Legacy', projectId: 'hub:p', path: 'docs/readme.md', kind: 'markdown',
        createdAt: '2026-08-11T08:00:00Z', sizeBytes: 10,
      },
      {
        token: 'b'.repeat(43), title: 'Answer', sourceType: 'chat_response', projectId: 'hub:p', sessionId: 'sess-1', turnIndex: 9,
        createdAt: '2026-08-11T08:01:00Z', sizeBytes: 20,
      },
      {
        token: 'c'.repeat(43), title: 'Session', sourceType: 'chat_session', projectId: 'hub:p', sessionId: 'sess-2',
        createdAt: '2026-08-11T08:02:00Z', sizeBytes: 30,
      },
      {
        token: 'd'.repeat(43), title: 'Mixed response', sourceType: 'chat_response', projectId: 'hub:p', sessionId: 'sess-1', turnIndex: 4, path: 'fake.md',
        createdAt: '2026-08-11T08:03:00Z', sizeBytes: 40,
      },
      {
        token: 'e'.repeat(43), title: 'Missing turn', sourceType: 'chat_response', projectId: 'hub:p', sessionId: 'sess-1',
        createdAt: '2026-08-11T08:04:00Z', sizeBytes: 50,
      },
      {
        token: 'f'.repeat(43), title: 'Unknown', sourceType: 'other', projectId: 'hub:p', path: 'fake.md', kind: 'markdown',
        createdAt: '2026-08-11T08:05:00Z', sizeBytes: 60,
      },
    ],
  }}));
  const repository = new RegistryRepository({request} as never);

  const result = await repository.listShares();

  expect(result.items).toEqual([
    expect.objectContaining({sourceType: 'project_document', path: 'docs/readme.md', kind: 'markdown'}),
    expect.objectContaining({sourceType: 'chat_response', sessionId: 'sess-1', turnIndex: 9}),
    expect.objectContaining({sourceType: 'chat_session', sessionId: 'sess-2'}),
  ]);
  expect(result.items).toHaveLength(3);
  expect(result.items[1]).not.toHaveProperty('path');
  expect(result.items[1]).not.toHaveProperty('kind');
  expect(result.items[2]).not.toHaveProperty('turnIndex');
});
