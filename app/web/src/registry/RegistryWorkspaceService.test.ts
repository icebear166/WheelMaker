import type {RegistryClient} from './RegistryClient';
import {RegistryRepository} from './RegistryRepository';
import {RegistryMethods} from './registryMethods';
import {hubStateRefreshBatches} from './RegistryWorkspaceService';

test('keeps normal Hub refreshes combined', () => {
  expect(hubStateRefreshBatches('normal', ['wheelmakerUpdate', 'gatewayUpdate'])).toEqual([
    ['wheelmakerUpdate', 'gatewayUpdate'],
  ]);
});

test('splits Gateway refreshes for update-only Hubs', () => {
  expect(hubStateRefreshBatches('update_only', ['wheelmakerUpdate', 'gatewayUpdate'])).toEqual([
    ['wheelmakerUpdate'],
    ['gatewayUpdate'],
  ]);
});

test('prepares a managed file download with project and csrf scope', async () => {
  const request = jest.fn().mockResolvedValue({
    payload: {
      ok: true,
      downloadPath: '/download/token-1',
      fileName: 'report.txt',
      mimeType: 'text/plain',
      size: 42,
    },
  });
  const repository = new RegistryRepository({request} as unknown as RegistryClient);

  await expect(repository.prepareFileDownload(
    'hub:project',
    'csrf-1',
    {kind: 'project-file', path: 'docs/report.txt'},
  )).resolves.toEqual({
    ok: true,
    downloadPath: '/download/token-1',
    fileName: 'report.txt',
    mimeType: 'text/plain',
    size: 42,
  });
  expect(request).toHaveBeenCalledWith({
    method: 'file.download.prepare',
    projectId: 'hub:project',
    payload: {
      csrfToken: 'csrf-1',
      source: {kind: 'project-file', path: 'docs/report.txt'},
    },
    timeoutMs: 20000,
  });
});

test('normalizes MCP config without returning secret values', async () => {
  const request = jest.fn().mockResolvedValue({
    payload: {
      hubId: 'hub-mcp',
      config: {
        flickerBridge: {mode: 'v1', enabled: false},
        apiKeys: {},
        deepSeekPlatform: {configured: false},
        mcpServers: [{
          id: 'neo4j-id',
          name: 'neo4j',
          enabled: true,
          transport: 'stdio',
          command: 'python',
          args: ['-m', 'neo4j_mcp_server'],
          env: {
            NEO4J_URI: {value: 'bolt://127.0.0.1:7687', secret: false, configured: true},
            NEO4J_PASSWORD: {value: 'must-not-leak', secret: true, configured: true},
          },
        }],
      },
      mcpImportPreview: {
        source: 'codex',
        servers: [{
          id: 'preview-id',
          name: 'preview',
          enabled: true,
          transport: 'stdio',
          command: 'python',
        }],
        issues: [{name: 'legacy', reason: 'SSE is unsupported'}],
        conflicts: [{name: 'neo4j'}],
      },
    },
  });
  const repository = new RegistryRepository({request} as unknown as RegistryClient);

  const result = await repository.getHubConfig('hub-mcp');
  expect(result.config.mcpServers).toHaveLength(1);
  expect(result.config.mcpServers[0].env?.NEO4J_URI.value).toBe('bolt://127.0.0.1:7687');
  expect(result.config.mcpServers[0].env?.NEO4J_PASSWORD).toEqual({
    value: undefined,
    secret: true,
    configured: true,
    updatedAt: undefined,
  });
  expect(result.mcpImportPreview).toEqual({
    source: 'codex',
    servers: [{
      id: 'preview-id',
      name: 'preview',
      enabled: true,
      transport: 'stdio',
      command: 'python',
      args: undefined,
      cwd: undefined,
      env: undefined,
      url: undefined,
      headers: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      importedFrom: undefined,
    }],
    issues: [{name: 'legacy', reason: 'SSE is unsupported'}],
    conflicts: ['neo4j'],
  });
});

test('normalizes MCP HubState runtime status and keeps errors bounded to strings', () => {
  const repository = new RegistryRepository({request: jest.fn()} as unknown as RegistryClient);
  const state = repository.normalizeHubState({
    hubId: 'hub-mcp',
    instanceId: 'instance-1',
    sections: {
      mcp: {
        availability: 'ready',
        updateStatus: 'idle',
        revision: 3,
        data: {
          servers: [
            {serverId: 'neo4j-id', name: 'neo4j', state: 'failed', error: 'connection refused'},
            {serverId: 'bad-id', name: 'bad', state: 'unexpected'},
          ],
        },
      },
    },
  }, 'fallback');

  expect(state.sections.mcp.data).toEqual({
    servers: [
      {serverId: 'neo4j-id', name: 'neo4j', state: 'failed', error: 'connection refused', updatedAt: undefined},
      {serverId: 'bad-id', name: 'bad', state: 'not_started', error: undefined, updatedAt: undefined},
    ],
  });
});

test('submits a current scope skills update without a source', async () => {
  const request = jest.fn().mockResolvedValue({
    payload: {accepted: true, result: {ok: true, hubId: 'hub-skills'}},
  });
  const repository = new RegistryRepository({request} as unknown as RegistryClient);

  await expect(repository.updateSkillScope({
    hubId: 'hub-skills',
    scope: 'project',
    projectName: 'WheelMaker',
  })).resolves.toEqual({ok: true, hubId: 'hub-skills'});
  expect(request).toHaveBeenCalledWith({
    method: RegistryMethods.HubStateAction,
    hubId: 'hub-skills',
    payload: {
      section: 'skills',
      action: 'updateScope',
      params: {scope: 'project', projectName: 'WheelMaker'},
    },
    timeoutMs: 60000,
  });
});

test('submits current scope install all without a source', async () => {
  const request = jest.fn().mockResolvedValue({
    payload: {accepted: true, result: {ok: true, hubId: 'hub-skills'}},
  });
  const repository = new RegistryRepository({request} as unknown as RegistryClient);

  await expect(repository.installAllSkillsInScope({
    hubId: 'hub-skills',
    scope: 'hub',
  })).resolves.toEqual({ok: true, hubId: 'hub-skills'});
  expect(request).toHaveBeenCalledWith({
    method: RegistryMethods.HubStateAction,
    hubId: 'hub-skills',
    payload: {
      section: 'skills',
      action: 'installAllScope',
      params: {scope: 'hub'},
    },
    timeoutMs: 60000,
  });
});

test('keeps subagent relationship and lifecycle fields in session summaries', async () => {
  const request = jest.fn().mockResolvedValue({
    payload: {
      sessions: [
        {
          sessionId: 'child-1',
          title: 'Zeno',
          preview: 'Inspect renderer',
          updatedAt: '2026-08-19T10:00:00Z',
          messageCount: 3,
          sessionKind: 'subagent',
          parentSessionId: 'root-1',
          rootSessionId: 'root-1',
          readOnly: true,
          subagent: {
            name: 'Zeno',
            role: 'worker',
            prompt: 'Inspect renderer',
            spawnedAt: '2026-08-19T09:59:00Z',
            spawnSequence: 2,
            status: 'waiting_approval',
          },
        },
      ],
    },
  });
  const repository = new RegistryRepository({
    request,
  } as unknown as RegistryClient);

  const sessions = await repository.listSessions('hub:project');

  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({
    sessionKind: 'subagent',
    parentSessionId: 'root-1',
    rootSessionId: 'root-1',
    readOnly: true,
    subagent: {
      name: 'Zeno',
      role: 'worker',
      prompt: 'Inspect renderer',
      spawnedAt: '2026-08-19T09:59:00Z',
      spawnSequence: 2,
      status: 'waiting_approval',
    },
  });
});

test('keeps archived subagent summaries on a root preview', async () => {
  const request = jest.fn().mockResolvedValue({
    payload: {
      sessionId: 'root-1',
      session: {
        sessionId: 'root-1',
        title: 'Root',
        preview: '',
        updatedAt: '',
        messageCount: 1,
        archivedAt: '2026-08-19T10:00:00Z',
        turnCount: 1,
        gapCount: 0,
        subagentCount: 1,
      },
      latestTurnIndex: 1,
      turns: [],
      readOnly: true,
      subagents: [
        {
          sessionId: 'child-1',
          title: 'Zeno',
          preview: '',
          updatedAt: '',
          messageCount: 2,
          archivedAt: '2026-08-19T10:00:00Z',
          turnCount: 2,
          gapCount: 0,
          sessionKind: 'subagent',
          parentSessionId: 'root-1',
          rootSessionId: 'root-1',
          readOnly: true,
          subagent: {name: 'Zeno', spawnSequence: 1, status: 'completed'},
        },
      ],
    },
  });
  const repository = new RegistryRepository({
    request,
  } as unknown as RegistryClient);

  const preview = await repository.readArchivedSession('hub:project', 'root-1');

  expect(preview.session.subagentCount).toBe(1);
  expect(preview.subagents).toEqual([
    expect.objectContaining({
      sessionId: 'child-1',
      sessionKind: 'subagent',
      rootSessionId: 'root-1',
      subagent: expect.objectContaining({name: 'Zeno', status: 'completed'}),
    }),
  ]);
});

test('reads an archived child through its root archive group', async () => {
  const request = jest.fn().mockResolvedValue({
    payload: {
      sessionId: 'child-1',
      session: {
        sessionId: 'child-1',
        title: 'Zeno',
        preview: '',
        updatedAt: '',
        messageCount: 1,
        archivedAt: '2026-08-19T10:00:00Z',
        turnCount: 1,
        gapCount: 0,
        sessionKind: 'subagent',
        rootSessionId: 'root-1',
      },
      latestTurnIndex: 1,
      turns: [],
      readOnly: true,
    },
  });
  const repository = new RegistryRepository({request} as unknown as RegistryClient);

  await repository.readArchivedSession('hub:project', 'child-1', 'root-1');

  expect(request).toHaveBeenCalledWith(expect.objectContaining({
    projectId: 'hub:project',
    payload: {sessionId: 'child-1', rootSessionId: 'root-1'},
  }));
});
