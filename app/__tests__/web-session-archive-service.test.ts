import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import type {RegistryClient} from '../web/src/registry/RegistryClient';

describe('session archive registry service', () => {
  test('lists, reads, and restores archived sessions through project-scoped methods', async () => {
    const client = {
      request: jest.fn(async (args: {method: string}) => {
        if (args.method === 'session.archive.list') {
          return {
            type: 'response',
            payload: {
              sessions: [
                {
                  sessionId: 'archived-1',
                  projectName: 'proj1',
                  title: 'Archived one',
                  updatedAt: '2026-05-20T00:00:00.000Z',
                  archivedAt: '2026-05-21T00:00:00.000Z',
                  turnCount: 3,
                  gapCount: 1,
                  nativeSyncWarning: 'native warning',
                },
                {sessionId: '', archivedAt: 'ignored'},
              ],
            },
          };
        }
        if (args.method === 'session.archive.read') {
          return {
            type: 'response',
            payload: {
              sessionId: 'archived-1',
              session: {
                sessionId: 'archived-1',
                projectName: 'proj1',
                title: 'Archived one',
                updatedAt: '2026-05-20T00:00:00.000Z',
                archivedAt: '2026-05-21T00:00:00.000Z',
                turnCount: 3,
                gapCount: 0,
              },
              turns: [{turnIndex: 1, content: '{"method":"session/system"}', finished: true}],
              latestTurnIndex: 1,
              readOnly: true,
            },
          };
        }
        return {
          type: 'response',
          payload: {
            ok: true,
            sessionId: 'archived-1',
            warning: 'native restore warning',
            session: {
              sessionId: 'archived-1',
              title: 'Restored',
              preview: '',
              updatedAt: '2026-05-22T00:00:00.000Z',
              messageCount: 0,
            },
          },
        };
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    await expect(repository.listArchivedSessions('proj1')).resolves.toEqual([
      {
        sessionId: 'archived-1',
        projectName: 'proj1',
        title: 'Archived one',
        preview: '',
        updatedAt: '2026-05-20T00:00:00.000Z',
        messageCount: 0,
        running: false,
        archivedAt: '2026-05-21T00:00:00.000Z',
        turnCount: 3,
        gapCount: 1,
        nativeSyncWarning: 'native warning',
      },
    ]);
    await expect(repository.readArchivedSession('proj1', 'archived-1')).resolves.toMatchObject({
      sessionId: 'archived-1',
      readOnly: true,
      latestTurnIndex: 1,
      turns: [{turnIndex: 1, content: '{"method":"session/system"}', finished: true}],
    });
    await expect(repository.restoreArchivedSession('proj1', 'archived-1')).resolves.toMatchObject({
      ok: true,
      sessionId: 'archived-1',
      warning: 'native restore warning',
      session: {sessionId: 'archived-1', title: 'Restored'},
    });

    expect(client.request).toHaveBeenNthCalledWith(1, {
      method: 'session.archive.list',
      projectId: 'proj1',
      payload: {},
      timeoutMs: 15000,
    });
    expect(client.request).toHaveBeenNthCalledWith(2, {
      method: 'session.archive.read',
      projectId: 'proj1',
      payload: {sessionId: 'archived-1'},
      timeoutMs: 15000,
    });
    expect(client.request).toHaveBeenNthCalledWith(3, {
      method: 'session.archive.restore',
      projectId: 'proj1',
      payload: {sessionId: 'archived-1'},
      timeoutMs: 30000,
    });
  });
});
