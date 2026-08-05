import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import type {RegistryClient} from '../web/src/registry/RegistryClient';

describe('registry session.read', () => {
  test('does not synthesize a fallback session when server omits session metadata', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          latestTurnIndex: 7,
          turns: [
            {
              turnIndex: 4,
              content: JSON.stringify({method: 'agent_message_chunk', param: {text: 'missing session id'}}),
              finished: true,
            },
          ],
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    const result = await repository.readSession('project-1', 'sess-1', 3);

    expect(result.session).toBeUndefined();
    expect(result.messages).toEqual([]);
    expect(result.latestTurnIndex).toBe(7);
  });

  test('loads a stable session snapshot across paginated responses', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({
        type: 'response',
        payload: {
          sessionId: 'sess-1',
          latestTurnIndex: 4,
          session: {
            sessionId: 'sess-1',
            title: 'Long task',
            updatedAt: '2026-08-04T00:00:00Z',
            latestTurnIndex: 4,
            running: false,
            lastDoneTurnIndex: 4,
            lastDoneSuccess: true,
            lastReadTurnIndex: 0,
          },
          turns: [
            {turnIndex: 1, content: JSON.stringify({method: 'prompt_request', param: {text: 'run'}}), finished: true},
            {turnIndex: 2, content: JSON.stringify({method: 'agent_message_chunk', param: {text: 'part 1'}}), finished: true},
          ],
          hasMore: true,
          nextAfterTurnIndex: 2,
        },
      })
      .mockResolvedValueOnce({
        type: 'response',
        payload: {
          sessionId: 'sess-1',
          latestTurnIndex: 4,
          turns: [
            {turnIndex: 3, content: JSON.stringify({method: 'agent_message_chunk', param: {text: 'part 2'}}), finished: true},
            {turnIndex: 4, content: JSON.stringify({method: 'prompt_done', param: {stopReason: 'end_turn'}}), finished: true},
          ],
          hasMore: false,
        },
      });
    const repository = new RegistryRepository({request} as unknown as RegistryClient);

    const result = await repository.readSession('project-1', 'sess-1');

    expect(result.turns.map(turn => turn.turnIndex)).toEqual([1, 2, 3, 4]);
    expect(result.latestTurnIndex).toBe(4);
    expect(result.session?.sessionId).toBe('sess-1');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0].payload).toEqual({
      sessionId: 'sess-1',
      maxTurns: 1024,
      maxBytes: 6 * 1024 * 1024,
    });
    expect(request.mock.calls[0][0].timeoutMs).toBe(30000);
    expect(request.mock.calls[1][0].payload).toEqual({
      sessionId: 'sess-1',
      afterTurnIndex: 2,
      throughTurnIndex: 4,
      maxTurns: 1024,
      maxBytes: 6 * 1024 * 1024,
    });
  });

  test('publishes a completed page before a later page fails', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({
        type: 'response',
        payload: {
          sessionId: 'sess-1',
          latestTurnIndex: 4,
          turns: [
            {turnIndex: 1, content: JSON.stringify({method: 'prompt_request', param: {text: 'run'}}), finished: true},
            {turnIndex: 2, content: JSON.stringify({method: 'agent_message_chunk', param: {text: 'part 1'}}), finished: true},
          ],
          hasMore: true,
          nextAfterTurnIndex: 2,
        },
      })
      .mockRejectedValueOnce(new Error('second page timeout'));
    const repository = new RegistryRepository({request} as unknown as RegistryClient);
    const onPage = jest.fn();

    await expect(repository.readSession('project-1', 'sess-1', 0, {onPage})).rejects.toThrow(
      'second page timeout',
    );

    expect(onPage).toHaveBeenCalledTimes(1);
    expect(onPage.mock.calls[0][0]).toMatchObject({
      sessionId: 'sess-1',
      afterTurnIndex: 0,
      throughTurnIndex: 2,
      latestTurnIndex: 4,
      turns: [
        expect.objectContaining({turnIndex: 1}),
        expect.objectContaining({turnIndex: 2}),
      ],
    });
  });

  test('rejects a paginated response that cannot advance its cursor', async () => {
    const request = jest.fn().mockResolvedValue({
      type: 'response',
      payload: {
        sessionId: 'sess-1',
        latestTurnIndex: 4,
        turns: [],
        hasMore: true,
        nextAfterTurnIndex: 0,
      },
    });
    const repository = new RegistryRepository({request} as unknown as RegistryClient);

    await expect(repository.readSession('project-1', 'sess-1')).rejects.toThrow(
      'session.read pagination did not advance',
    );
  });
});
