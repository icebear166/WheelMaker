import {
  applySessionReadResult,
  buildMergedRawTurns,
  createEmptyChatTurnStore,
  getDurableTurnPrefix,
  getFinishedCursor,
  hydrateFinishedStore,
  mergeCachedTurnPrefix,
  mergeRealtimeTurn,
  shouldReadRepairForIncomingTurn,
} from '../web/src/chat/turns/chatTurnStores';
import type {RegistrySessionTurn} from '../web/src/registry/registryTypes';

const turn = (turnIndex: number, finished = true, text = `turn-${turnIndex}`): RegistrySessionTurn => ({
  turnIndex,
  content: JSON.stringify({method: 'agent_message_chunk', param: {text}}),
  finished,
});

describe('raw chat turn stores', () => {
  test('finished cursor ignores holes and durable prefix stops before the hole', () => {
    const turns = [turn(1), turn(2), turn(4)];

    expect(getFinishedCursor(turns)).toEqual({turnIndex: 2});
    expect(getDurableTurnPrefix(turns, {turnIndex: 9})).toEqual([turn(1), turn(2)]);
  });

  test('live turns do not advance finished cursor', () => {
    const state = createEmptyChatTurnStore();
    mergeRealtimeTurn(state, turn(1, true));
    mergeRealtimeTurn(state, turn(2, false));

    expect(state.cursor).toEqual({turnIndex: 1});
    expect(buildMergedRawTurns(state)).toEqual([turn(1, true), turn(2, false)]);
  });

  test('cached prefix merge preserves in-memory live tail', () => {
    const state = createEmptyChatTurnStore();
    mergeRealtimeTurn(state, turn(6, false, 'live tail'));

    mergeCachedTurnPrefix(state, [turn(1), turn(2), turn(3), turn(4), turn(5)]);

    expect(state.cursor).toEqual({turnIndex: 5});
    expect(buildMergedRawTurns(state)).toEqual([
      turn(1),
      turn(2),
      turn(3),
      turn(4),
      turn(5),
      turn(6, false, 'live tail'),
    ]);
  });

  test('same-index live turn updates and finished turn absorbs live', () => {
    const state = createEmptyChatTurnStore();
    mergeRealtimeTurn(state, turn(1, true));
    mergeRealtimeTurn(state, turn(2, false, 'partial'));
    mergeRealtimeTurn(state, turn(2, false, 'partial updated'));
    expect(buildMergedRawTurns(state)).toEqual([turn(1, true), turn(2, false, 'partial updated')]);

    mergeRealtimeTurn(state, turn(2, true, 'done'));
    expect(state.live).toEqual([]);
    expect(state.finished).toEqual([turn(1, true), turn(2, true, 'done')]);
    expect(state.cursor).toEqual({turnIndex: 2});
  });

  test('gap read trigger uses finished cursor and allows next unfinished tail', () => {
    const state = hydrateFinishedStore([turn(1), turn(2), turn(3), turn(4), turn(5), turn(6), turn(7), turn(8), turn(9), turn(10)]);

    expect(shouldReadRepairForIncomingTurn(state, turn(12, false))).toEqual({turnIndex: 10});
    expect(shouldReadRepairForIncomingTurn(state, turn(11, false))).toBeNull();
    mergeRealtimeTurn(state, turn(11, false));
    expect(shouldReadRepairForIncomingTurn(state, turn(12, true))).toEqual({turnIndex: 10});
  });

  test('read response replaces covered range and rejects middle unfinished turns', () => {
    const state = hydrateFinishedStore([turn(1), turn(2)]);
    mergeRealtimeTurn(state, turn(4, false, 'live'));

    applySessionReadResult(state, 2, [turn(3, true), turn(4, false, 'server live')], 4);
    expect(state.finished).toEqual([turn(1), turn(2), turn(3)]);
    expect(state.live).toEqual([turn(4, false, 'server live')]);
    expect(state.cursor).toEqual({turnIndex: 3});

    expect(() => applySessionReadResult(state, 3, [turn(4, false), turn(5, true)], 5)).toThrow(/unfinished tail/);
  });

  test('read response preserves a same-turn realtime update received after the read started', () => {
    const state = hydrateFinishedStore([turn(1)]);
    mergeRealtimeTurn(state, turn(2, false, 'before read'));
    const turnsAtReadStart = buildMergedRawTurns(state);
    mergeRealtimeTurn(state, turn(2, false, 'new realtime content'));

    applySessionReadResult(
      state,
      1,
      [turn(2, false, 'stale read content')],
      2,
      turnsAtReadStart,
    );

    expect(buildMergedRawTurns(state)).toEqual([
      turn(1),
      turn(2, false, 'new realtime content'),
    ]);
  });

  test('read response preserves the first realtime turn received after an empty read baseline', () => {
    const state = createEmptyChatTurnStore();
    const turnsAtReadStart = buildMergedRawTurns(state);
    mergeRealtimeTurn(state, turn(1, false, 'new realtime content'));

    applySessionReadResult(
      state,
      0,
      [turn(1, false, 'stale read content')],
      1,
      turnsAtReadStart,
    );

    expect(buildMergedRawTurns(state)).toEqual([
      turn(1, false, 'new realtime content'),
    ]);
  });

  test('stale read response resets local turns when server latest is behind cursor', () => {
    const state = hydrateFinishedStore([turn(1), turn(2), turn(3)]);
    mergeRealtimeTurn(state, turn(4, false, 'dirty live'));

    applySessionReadResult(state, 3, [], 2);

    expect(state.finished).toEqual([]);
    expect(state.live).toEqual([]);
    expect(state.cursor).toEqual({turnIndex: 0});
  });
});
