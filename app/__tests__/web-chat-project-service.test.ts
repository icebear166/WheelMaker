import { RegistryWorkspaceService } from '../web/src/registry/RegistryWorkspaceService';

describe('registry workspace project-scoped chat service methods', () => {
  test('keeps a newer repository active when close invalidates an in-flight reconnect', async () => {
    let releaseStaleSnapshot: ((snapshot: {projects: Array<{projectId: string}>; hubs: []}) => void) | null = null;
    let markStaleSnapshotStarted: (() => void) | null = null;
    const staleSnapshotStarted = new Promise<void>(resolve => {
      markStaleSnapshotStarted = resolve;
    });
    const staleSnapshot = new Promise<{projects: Array<{projectId: string}>; hubs: []}>(resolve => {
      releaseStaleSnapshot = resolve;
    });
    const createRepository = (
      projectId: string,
      snapshot: Promise<{projects: Array<{projectId: string}>; hubs: []}> | null = null,
    ) => {
      const eventListeners = new Set<(event: {type: 'event'; method: string; payload: {}}) => void>();
      const closeListeners = new Set<() => void>();
      return {
        initialize: jest.fn().mockResolvedValue(undefined),
        listProjectSnapshot: jest.fn(async () => {
          if (snapshot) {
            markStaleSnapshotStarted?.();
            return snapshot;
          }
          return {projects: [{projectId}], hubs: []};
        }),
        onEvent: jest.fn((listener: (event: {type: 'event'; method: string; payload: {}}) => void) => {
          eventListeners.add(listener);
          return () => eventListeners.delete(listener);
        }),
        onClose: jest.fn((listener: () => void) => {
          closeListeners.add(listener);
          return () => closeListeners.delete(listener);
        }),
        close: jest.fn(() => {
          closeListeners.forEach(listener => listener());
        }),
        emitEvent: (method: string) => {
          eventListeners.forEach(listener => listener({type: 'event', method, payload: {}}));
        },
      };
    };
    const initialRepository = createRepository('project-initial');
    const staleRepository = createRepository('project-stale', staleSnapshot);
    const recoveredRepository = createRepository('project-recovered');
    const repositories = [initialRepository, staleRepository, recoveredRepository];
    const service = new RegistryWorkspaceService({
      createRepository: () => repositories.shift() as never,
    });
    const onEvent = jest.fn();
    service.onEvent(onEvent);

    await service.connect('ws://registry.example/initial');
    const staleConnect = service.connect('ws://registry.example/stale');
    await staleSnapshotStarted;
    service.close();
    expect(staleRepository.close).toHaveBeenCalledTimes(1);
    const recoveredSession = await service.connect('ws://registry.example/recovered');
    releaseStaleSnapshot?.({projects: [{projectId: 'project-stale'}], hubs: []});

    await expect(staleConnect).rejects.toThrow('connection attempt superseded');
    expect(recoveredSession.selectedProjectId).toBe('project-recovered');
    expect(service.getSession()?.selectedProjectId).toBe('project-recovered');
    recoveredRepository.emitEvent('session.message');
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(staleRepository.close).toHaveBeenCalledTimes(1);
  });

  test('does not publish an intentional close as a remote repository close', async () => {
    const closeListeners = new Set<() => void>();
    const repository = {
      initialize: jest.fn().mockResolvedValue(undefined),
      listProjectSnapshot: jest.fn().mockResolvedValue({projects: [], hubs: []}),
      onEvent: jest.fn(() => () => undefined),
      onClose: jest.fn((listener: () => void) => {
        closeListeners.add(listener);
        return () => closeListeners.delete(listener);
      }),
      close: jest.fn(() => {
        closeListeners.forEach(listener => listener());
      }),
    };
    const service = new RegistryWorkspaceService({
      createRepository: () => repository as never,
    });
    const onRemoteClose = jest.fn();
    service.onClose(onRemoteClose);

    await service.connect('ws://registry.example/ws');
    service.close();

    expect(repository.close).toHaveBeenCalledTimes(1);
    expect(onRemoteClose).not.toHaveBeenCalled();

    await service.connect('ws://registry.example/ws');
    closeListeners.forEach(listener => listener());

    expect(onRemoteClose).toHaveBeenCalledTimes(1);
  });

  test('rejects project session listing while disconnected instead of reporting an empty list', async () => {
    const service = new RegistryWorkspaceService();

    await expect(service.listProjectSessions('project-1')).rejects.toThrow('session is not ready');
  });

  test('rejects project session reads while disconnected instead of reporting an empty session', async () => {
    const service = new RegistryWorkspaceService();

    await expect(service.readProjectSession('project-1', 'session-1', 4)).rejects.toThrow(
      'session is not ready',
    );
  });

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
      getHubState: jest.fn().mockResolvedValue({
        hubId: 'hub-empty',
        instanceId: 'instance-empty',
        sections: {},
      }),
      listFiles: jest.fn(),
      onEvent: jest.fn(() => () => undefined),
      onClose: jest.fn(() => () => undefined),
      close: jest.fn(),
    };
    const service = new RegistryWorkspaceService({
      createRepository: jest.fn(() => repository as never),
    });

    const session = await service.connect('ws://registry.example/ws', 'secret-token');

    expect(session).toMatchObject({
      projects: [],
      hubs: [{hubId: 'hub-empty'}],
      selectedProjectId: '',
    });
    expect(repository.listFiles).not.toHaveBeenCalled();
  });

  test('connect resolves before lightweight HubState discovery finishes', async () => {
    let resolveHubState!: (state: {
      hubId: string;
      instanceId: string;
      sections: {};
    }) => void;
    const hubState = new Promise<{
      hubId: string;
      instanceId: string;
      sections: {};
    }>(resolve => {
      resolveHubState = resolve;
    });
    const repository = {
      initialize: jest.fn().mockResolvedValue(undefined),
      listProjectSnapshot: jest.fn().mockResolvedValue({
        projects: [],
        hubs: [{hubId: 'hub-background'}],
      }),
      getHubState: jest.fn().mockReturnValue(hubState),
      listFiles: jest.fn(),
      onEvent: jest.fn(() => () => undefined),
      onClose: jest.fn(() => () => undefined),
      close: jest.fn(),
    };
    const service = new RegistryWorkspaceService({
      createRepository: jest.fn(() => repository as never),
    });

    const connect = service.connect('ws://registry.example/ws');
    const winner = await Promise.race([
      connect.then(() => 'connected'),
      new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 25)),
    ]);
    resolveHubState({
      hubId: 'hub-background',
      instanceId: 'instance-background',
      sections: {},
    });
    await connect;

    expect(winner).toBe('connected');
    expect(repository.getHubState).toHaveBeenCalledWith(
      'hub-background',
      ['tokenStats', 'agentPackages'],
    );
  });

  test('connect selects project metadata regardless of the project online flag', async () => {
    const repository = {
      initialize: jest.fn().mockResolvedValue(undefined),
      listProjectSnapshot: jest.fn().mockResolvedValue({
        projects: [{projectId: 'project-1', name: 'Project', online: false, path: '/project'}],
        hubs: [{hubId: 'hub-1'}],
      }),
      getHubState: jest.fn(),
      listFiles: jest.fn(),
      onEvent: jest.fn(() => () => undefined),
      onClose: jest.fn(() => () => undefined),
      close: jest.fn(),
    };
    const service = new RegistryWorkspaceService({
      createRepository: jest.fn(() => repository as never),
    });

    await expect(service.connect('ws://registry.example/ws')).resolves.toMatchObject({
      selectedProjectId: 'project-1',
    });
    expect(repository.listFiles).not.toHaveBeenCalled();
  });

  test('connect resolves without waiting for the project filesystem', async () => {
    jest.useFakeTimers();
    try {
      const repository = {
        initialize: jest.fn().mockResolvedValue(undefined),
        listProjectSnapshot: jest.fn().mockResolvedValue({
          projects: [{projectId: 'project-1', name: 'Project', online: true, path: '/project'}],
          hubs: [{hubId: 'hub-1'}],
        }),
        getHubState: jest.fn(),
        listFiles: jest.fn().mockReturnValue(new Promise(() => undefined)),
        onEvent: jest.fn(() => () => undefined),
        onClose: jest.fn(() => () => undefined),
        close: jest.fn(),
      };
      const service = new RegistryWorkspaceService({
        createRepository: jest.fn(() => repository as never),
      });

      const connect = service.connect('ws://registry.example/ws');
      const winner = Promise.race([
        connect.then(() => 'connected'),
        new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 1)),
      ]);
      await jest.advanceTimersByTimeAsync(1);

      expect(await winner).toBe('connected');
      await expect(connect).resolves.toMatchObject({selectedProjectId: 'project-1'});
      expect(repository.listFiles).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
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
      },
    });

    const readOptions = {onPage: jest.fn()};
    await (service as any).readProjectSession('chat-project', 's1', 7, readOptions);
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

    expect(repository.readSession).toHaveBeenCalledWith('chat-project', 's1', 7, readOptions);
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
      },
    });

    const session = await (service as any).selectProjectLightweight('p2');

    expect(session.selectedProjectId).toBe('p2');
    expect(repository.listFiles).not.toHaveBeenCalled();
  });

  test('lightweight project selection rejects unknown projects', async () => {
    const service = new RegistryWorkspaceService();

    Object.assign(service as unknown as { repository: unknown; session: unknown }, {
      repository: { listFiles: jest.fn() },
      session: {
        projects: [{ projectId: 'p1', name: 'One', online: true, path: '/one' }],
        selectedProjectId: 'p1',
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
