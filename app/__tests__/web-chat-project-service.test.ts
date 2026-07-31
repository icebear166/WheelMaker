import { RegistryWorkspaceService } from '../web/src/registry/RegistryWorkspaceService';

describe('registry workspace project-scoped chat service methods', () => {
  test('preserves binary file metadata for Markdown export image reads', async () => {
    const service = new RegistryWorkspaceService();
    const repository = {
      readFile: jest.fn().mockResolvedValue({
        content: 'iVBORw0KGgo=',
        hash: 'hash-1',
        notModified: false,
        isBinary: true,
        mimeType: 'image/png',
        encoding: 'base64',
      }),
    };

    Object.assign(service as unknown as {repository: unknown}, {repository});

    await expect(service.readProjectFile('assets/logo.png', 'project-1')).resolves.toEqual({
      content: 'iVBORw0KGgo=',
      hash: 'hash-1',
      notModified: false,
      isBinary: true,
      mimeType: 'image/png',
      encoding: 'base64',
    });
  });

  test('connects to a hub with no projects without selecting or reading a project', async () => {
    const repository = {
      initialize: jest.fn().mockResolvedValue(undefined),
      listProjectSnapshot: jest.fn().mockResolvedValue({
        projects: [],
        hubs: [{hubId: 'hub-empty'}],
      }),
      listFiles: jest.fn(),
      onEvent: jest.fn(() => () => undefined),
      onClose: jest.fn(() => () => undefined),
      close: jest.fn(),
    };
    const service = new RegistryWorkspaceService(undefined, {
      createRepository: jest.fn(() => repository as never),
    });

    const session = await service.connect('ws://registry.example/ws', 'secret-token');

    expect(session).toMatchObject({
      projects: [],
      hubs: [{hubId: 'hub-empty'}],
      selectedProjectId: '',
      fileEntries: [],
    });
    expect(repository.listFiles).not.toHaveBeenCalled();
  });

  test('does not send project read requests when no project is selected', async () => {
    const service = new RegistryWorkspaceService();
    const repository = {
      listFiles: jest.fn(),
    };

    Object.assign(service as unknown as { repository: unknown; session: unknown }, {
      repository,
      session: {
        projects: [],
        hubs: [{hubId: 'hub-empty'}],
        selectedProjectId: '',
        fileEntries: [],
      },
    });

    await expect(service.listDirectory('.')).resolves.toEqual({
      entries: [],
      hash: '',
      notModified: false,
    });
    expect(repository.listFiles).not.toHaveBeenCalled();
  });

  test('delegates read/queue/config to the explicitly selected chat project', async () => {
    const service = new RegistryWorkspaceService();
    const repository = {
      readSession: jest.fn().mockResolvedValue({ messages: [], latestTurnIndex: 0 }),
      mutateSessionQueue: jest.fn().mockResolvedValue({
        ok: true,
        sessionId: 's1',
        session: {sessionId: 's1'},
      }),
      respondSessionPermission: jest.fn().mockResolvedValue({accepted: true, permissionId: 'perm-1', outcome: 'selected', optionId: 'allow'}),
      setSessionConfig: jest.fn().mockResolvedValue({ ok: true, sessionId: 's1', configOptions: [] }),
      renameSession: jest.fn().mockResolvedValue({ ok: true, sessionId: 's1', session: { sessionId: 's1', title: 'Manual title', updatedAt: '' } }),
      pinSession: jest.fn().mockResolvedValue({ ok: true, sessionId: 's1', session: { sessionId: 's1', pinned: true, updatedAt: '' } }),
      markSession: jest.fn().mockResolvedValue({ ok: true, sessionId: 's1', session: { sessionId: 's1', markColor: 'green', updatedAt: '' } }),
      deleteSession: jest.fn().mockResolvedValue({ ok: true, sessionId: 's1' }),
      startSessionAttachment: jest.fn().mockResolvedValue({ ok: true, sessionId: 's1', uploadId: 'upload-1', chunkSize: 1048576 }),
      uploadSessionAttachmentChunk: jest.fn().mockResolvedValue({ ok: true, sessionId: 's1', uploadId: 'upload-1', received: 1 }),
      finishSessionAttachment: jest.fn().mockResolvedValue({ ok: true, sessionId: 's1', attachment: { id: 'sha256-a', name: 'a.txt', size: 1, uri: 'file:///a.txt' }, block: { type: 'resource_link', uri: 'file:///a.txt', name: 'a.txt', size: 1 } }),
      cancelSessionAttachment: jest.fn().mockResolvedValue({ ok: true, sessionId: 's1', uploadId: 'upload-1' }),
      deleteSessionAttachment: jest.fn().mockResolvedValue({ ok: true, sessionId: 's1', attachmentId: 'sha256-a' }),
    };

    Object.assign(service as unknown as { repository: unknown; session: unknown }, {
      repository,
      session: {
        projects: [],
        selectedProjectId: 'workspace-project',
        fileEntries: [],
      },
    });

    await (service as any).readProjectSession('chat-project', 's1', 7);
    await (service as any).enqueueProjectSessionItem('chat-project', 's1', {
      itemId: 'item-1',
      kind: 'prompt',
      createdAt: '2026-07-31T00:00:00Z',
      blocks: [{type: 'text', text: 'hello'}],
    });
    await (service as any).cancelProjectSessionQueueItem('chat-project', 's1', 'item-1');
    await (service as any).respondProjectSessionPermission('chat-project', 's1', 'perm-1', 'allow');
    await (service as any).setProjectSessionConfig('chat-project', {
      sessionId: 's1',
      configId: 'model',
      value: 'x',
    });
    await (service as any).renameProjectSession('chat-project', 's1', 'Manual title');
    await (service as any).pinProjectSession('chat-project', 's1', true);
    await (service as any).markProjectSession('chat-project', 's1', 'green');
    await (service as any).deleteProjectSession('chat-project', 's1');
    await (service as any).startProjectSessionAttachment('chat-project', {
      sessionId: 's1',
      name: 'a.txt',
      size: 1,
    });
    await (service as any).uploadProjectSessionAttachmentChunk('chat-project', {
      sessionId: 's1',
      uploadId: 'upload-1',
      offset: 0,
      data: 'YQ==',
    });
    await (service as any).finishProjectSessionAttachment('chat-project', {
      sessionId: 's1',
      uploadId: 'upload-1',
      sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
    });
    await (service as any).cancelProjectSessionAttachment('chat-project', {
      sessionId: 's1',
      uploadId: 'upload-1',
    });
    await (service as any).deleteProjectSessionAttachment('chat-project', {
      sessionId: 's1',
      attachmentId: 'sha256-a',
    });

    expect(repository.readSession).toHaveBeenCalledWith('chat-project', 's1', 7);
    expect(repository.mutateSessionQueue).toHaveBeenNthCalledWith(1, 'chat-project', {
      sessionId: 's1',
      action: 'enqueue',
      item: {
        itemId: 'item-1',
        kind: 'prompt',
        createdAt: '2026-07-31T00:00:00Z',
        blocks: [{type: 'text', text: 'hello'}],
      },
    });
    expect(repository.mutateSessionQueue).toHaveBeenNthCalledWith(2, 'chat-project', {
      sessionId: 's1',
      action: 'cancel',
      itemId: 'item-1',
    });
    expect(repository.respondSessionPermission).toHaveBeenCalledWith('chat-project', 's1', 'perm-1', 'allow');
    expect(repository.setSessionConfig).toHaveBeenCalledWith('chat-project', {
      sessionId: 's1',
      configId: 'model',
      value: 'x',
    });
    expect(repository.renameSession).toHaveBeenCalledWith('chat-project', 's1', 'Manual title');
    expect(repository.pinSession).toHaveBeenCalledWith('chat-project', 's1', true);
    expect(repository.markSession).toHaveBeenCalledWith('chat-project', 's1', 'green');
    expect(repository.deleteSession).toHaveBeenCalledWith('chat-project', 's1');
    expect(repository.startSessionAttachment).toHaveBeenCalledWith('chat-project', {
      sessionId: 's1',
      name: 'a.txt',
      size: 1,
    });
    expect(repository.uploadSessionAttachmentChunk).toHaveBeenCalledWith('chat-project', {
      sessionId: 's1',
      uploadId: 'upload-1',
      offset: 0,
      data: 'YQ==',
    });
    expect(repository.finishSessionAttachment).toHaveBeenCalledWith('chat-project', {
      sessionId: 's1',
      uploadId: 'upload-1',
      sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
    });
    expect(repository.cancelSessionAttachment).toHaveBeenCalledWith('chat-project', {
      sessionId: 's1',
      uploadId: 'upload-1',
    });
    expect(repository.deleteSessionAttachment).toHaveBeenCalledWith('chat-project', {
      sessionId: 's1',
      attachmentId: 'sha256-a',
    });
    expect(repository.readSession).not.toHaveBeenCalledWith('workspace-project', 's1', 7);
  });

  test('lightweight project selection updates selected project without listing files', async () => {
    const service = new RegistryWorkspaceService();
    const repository = {
      listFiles: jest.fn().mockResolvedValue({ entries: [{ name: 'root', path: 'root', kind: 'file' }] }),
    };

    Object.assign(service as unknown as { repository: unknown; session: unknown }, {
      repository,
      session: {
        projects: [
          { projectId: 'p1', name: 'One', online: true, path: '/one' },
          { projectId: 'p2', name: 'Two', online: true, path: '/two' },
        ],
        selectedProjectId: 'p1',
        fileEntries: [{ name: 'old', path: 'old', kind: 'file' }],
      },
    });

    const session = await (service as any).selectProjectLightweight('p2');

    expect(session.selectedProjectId).toBe('p2');
    expect(session.fileEntries).toEqual([{ name: 'old', path: 'old', kind: 'file' }]);
    expect(repository.listFiles).not.toHaveBeenCalled();
  });

  test('lightweight project selection rejects unknown projects', async () => {
    const service = new RegistryWorkspaceService();

    Object.assign(service as unknown as { repository: unknown; session: unknown }, {
      repository: { listFiles: jest.fn() },
      session: {
        projects: [{ projectId: 'p1', name: 'One', online: true, path: '/one' }],
        selectedProjectId: 'p1',
        fileEntries: [],
      },
    });

    await expect((service as any).selectProjectLightweight('missing')).rejects.toThrow(
      'Project is no longer available',
    );
  });

  test('uploads app diagnostics to the registry repository', async () => {
    const service = new RegistryWorkspaceService();
    const repository = {
      uploadDebugLog: jest.fn().mockResolvedValue({ ok: true, fileName: 'client.log' }),
    };

    Object.assign(service as unknown as { repository: unknown; session: unknown }, {
      repository,
      session: {
        projects: [],
        hubs: [],
        selectedProjectId: '',
        fileEntries: [],
      },
    });

    const response = await (service as any).uploadDebugLog({
      source: 'web',
      text: 'one line\n',
    });

    expect(repository.uploadDebugLog).toHaveBeenCalledWith({
      source: 'web',
      text: 'one line\n',
    });
    expect(response).toEqual({ ok: true, fileName: 'client.log' });
  });
});
