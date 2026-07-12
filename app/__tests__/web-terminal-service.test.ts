import { redactRegistryDebugEnvelope } from '../web/src/debug/registryDebug';
import { RegistryClient } from '../web/src/registry/RegistryClient';
import { RegistryRepository } from '../web/src/registry/RegistryRepository';
import { RegistryWorkspaceService } from '../web/src/registry/RegistryWorkspaceService';
import { RegistryMethods } from '../web/src/registry/registryMethods';

describe('terminal registry service', () => {
  test('sends terminal input as a redacted one-way event', () => {
    const originalWebSocket = globalThis.WebSocket;
    const send = jest.fn();
    const debugSink = jest.fn();
    (
      globalThis as typeof globalThis & { WebSocket: { OPEN: number } }
    ).WebSocket = { OPEN: 1 };
    const client = new RegistryClient(8000, debugSink);
    Object.assign(client as unknown as { ws: unknown }, {
      ws: { readyState: 1, send },
    });

    try {
      client.sendEvent({
        method: RegistryMethods.TerminalInput,
        hubId: 'hub-a',
        payload: { terminalId: 'term-1', runId: 'run-1', data: 'c2VjcmV0' },
      });
      const raw = send.mock.calls[0][0] as string;
      expect(JSON.parse(raw)).toEqual({
        type: 'event',
        method: RegistryMethods.TerminalInput,
        hubId: 'hub-a',
        payload: { terminalId: 'term-1', runId: 'run-1', data: 'c2VjcmV0' },
      });
      expect(raw).not.toContain('requestId');
      const debug = debugSink.mock.calls[0][0];
      expect(debug.raw).not.toContain('c2VjcmV0');
      expect(debug.envelope.payload).toMatchObject({
        terminalId: 'term-1',
        runId: 'run-1',
        byteCount: 6,
      });
    } finally {
      (
        globalThis as typeof globalThis & { WebSocket?: typeof WebSocket }
      ).WebSocket = originalWebSocket;
    }
  });

  test('routes terminal control methods by project or hub', async () => {
    const request = jest.fn(async ({ method }: { method: string }) => {
      if (method === RegistryMethods.TerminalList)
        return { payload: { terminals: [] } };
      if (method === RegistryMethods.TerminalGet)
        return {
          payload: {
            terminal: { terminalId: 'term-1' },
            snapshotSeq: 0,
            snapshot: '',
          },
        };
      return {
        payload: { terminal: { terminalId: 'term-1' }, resizeToken: 'token-1' },
      };
    });
    const sendEvent = jest.fn();
    const repository = new RegistryRepository({ request, sendEvent } as never);

    await repository.listTerminals('hub-a');
    await repository.createTerminal('hub-a:project', 100, 30);
    await repository.getTerminal('hub-a', 'term-1');
    await repository.resizeTerminal('hub-a', {
      terminalId: 'term-1',
      cols: 90,
      rows: 28,
      claim: true,
    });
    await repository.closeTerminal('hub-a', 'term-1');
    await repository.restartTerminal('hub-a', 'term-1');
    repository.sendTerminalInput('hub-a', {
      terminalId: 'term-1',
      runId: 'run-1',
      data: 'YQ==',
    });

    expect(request.mock.calls.map(([value]) => value)).toEqual([
      { method: RegistryMethods.TerminalList, hubId: 'hub-a', payload: {} },
      {
        method: RegistryMethods.TerminalCreate,
        projectId: 'hub-a:project',
        payload: { cols: 100, rows: 30 },
      },
      {
        method: RegistryMethods.TerminalGet,
        hubId: 'hub-a',
        payload: { terminalId: 'term-1' },
      },
      {
        method: RegistryMethods.TerminalResize,
        hubId: 'hub-a',
        payload: { terminalId: 'term-1', cols: 90, rows: 28, claim: true },
      },
      {
        method: RegistryMethods.TerminalClose,
        hubId: 'hub-a',
        payload: { terminalId: 'term-1' },
      },
      {
        method: RegistryMethods.TerminalRestart,
        hubId: 'hub-a',
        payload: { terminalId: 'term-1' },
      },
    ]);
    expect(sendEvent).toHaveBeenCalledWith({
      method: RegistryMethods.TerminalInput,
      hubId: 'hub-a',
      payload: { terminalId: 'term-1', runId: 'run-1', data: 'YQ==' },
    });
  });

  test('delegates terminal methods through the workspace service', async () => {
    const repository = {
      listTerminals: jest.fn().mockResolvedValue({ terminals: [] }),
      createTerminal: jest
        .fn()
        .mockResolvedValue({
          terminal: { terminalId: 'term-1' },
          resizeToken: 'token',
        }),
      getTerminal: jest
        .fn()
        .mockResolvedValue({
          terminal: { terminalId: 'term-1' },
          snapshotSeq: 0,
          snapshot: '',
        }),
      resizeTerminal: jest
        .fn()
        .mockResolvedValue({ terminal: { terminalId: 'term-1' } }),
      closeTerminal: jest.fn().mockResolvedValue(undefined),
      restartTerminal: jest
        .fn()
        .mockResolvedValue({
          terminal: { terminalId: 'term-1' },
          resizeToken: 'token',
        }),
      sendTerminalInput: jest.fn(),
    };
    const service = new RegistryWorkspaceService();
    Object.assign(service as unknown as { repository: unknown }, {
      repository,
    });

    await service.listTerminals('hub-a');
    await service.createTerminal('hub-a:project', 80, 24);
    await service.getTerminal('hub-a', 'term-1');
    await service.resizeTerminal('hub-a', {
      terminalId: 'term-1',
      cols: 100,
      rows: 30,
      resizeToken: 'token',
    });
    await service.closeTerminal('hub-a', 'term-1');
    await service.restartTerminal('hub-a', 'term-1');
    service.sendTerminalInput('hub-a', {
      terminalId: 'term-1',
      runId: 'run-1',
      data: 'YQ==',
    });

    expect(repository.createTerminal).toHaveBeenCalledWith(
      'hub-a:project',
      80,
      24,
    );
    expect(repository.sendTerminalInput).toHaveBeenCalledWith('hub-a', {
      terminalId: 'term-1',
      runId: 'run-1',
      data: 'YQ==',
    });
  });

  test('redacts terminal snapshots and ownership tokens from debug capture', () => {
    const redacted = redactRegistryDebugEnvelope({
      type: 'response',
      method: RegistryMethods.TerminalGet,
      payload: {
        terminal: { terminalId: 'term-1', runId: 'run-1' },
        snapshotSeq: 4,
        snapshot: 'c2VjcmV0LXNuYXBzaG90',
        resizeToken: 'private-token',
      },
    });
    expect(JSON.stringify(redacted)).not.toContain('c2VjcmV0LXNuYXBzaG90');
    expect(JSON.stringify(redacted)).not.toContain('private-token');
    expect(redacted.payload).toMatchObject({
      snapshotSeq: 4,
      snapshotByteCount: 15,
    });
  });
});
