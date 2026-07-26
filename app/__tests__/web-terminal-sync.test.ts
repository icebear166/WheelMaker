import type {RegistryTerminal, RegistryTerminalOutputEvent} from '../web/src/registry/registryTypes';
import {base64ToBytes, bytesToBase64} from '../web/src/terminal/terminalEncoding';
import {
  applyTerminalSnapshot,
  applyTerminalChanged,
  beginTerminalSnapshot,
  canSendTerminalInput,
  createTerminalSyncState,
  markTerminalsUnavailable,
  mergeTerminalLists,
  receiveTerminalOutput,
} from '../web/src/terminal/terminalSync';

function terminal(overrides: Partial<RegistryTerminal> = {}): RegistryTerminal {
  return {
    terminalId: 't1', runId: 'r1', hubId: 'hub-a', projectId: 'hub-a:p1', projectName: 'p1',
    initialCwd: 'C:\\src\\p1', shell: 'pwsh.exe', status: 'running', cols: 80, rows: 24,
    createdAt: '2026-07-12T00:00:00Z',
    ...overrides,
  };
}

function output(seq: number, overrides: Partial<RegistryTerminalOutputEvent> = {}): RegistryTerminalOutputEvent {
  return {
    terminalId: 't1', runId: 'r1', seq,
    data: bytesToBase64(new TextEncoder().encode(String(seq))),
    ...overrides,
  };
}

describe('terminal synchronization', () => {
  test('round trips arbitrary bytes through browser-safe base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  test('merges successful hub lists without discarding other hubs', () => {
    let state = createTerminalSyncState();
    state = mergeTerminalLists(state, [
      {hubId: 'hub-a', terminals: [terminal()]},
      {hubId: 'hub-b', terminals: [terminal({hubId: 'hub-b', terminalId: 't2', projectId: 'hub-b:p2'})]},
    ]);
    state = mergeTerminalLists(state, [{hubId: 'hub-a', terminals: []}]);
    expect(Object.keys(state.terminals)).toEqual(['hub-b:t2']);
  });

  test('retains known terminals as unavailable across a disconnect', () => {
    let state = mergeTerminalLists(createTerminalSyncState(), [{hubId: 'hub-a', terminals: [terminal()]}]);
    state = markTerminalsUnavailable(state, ['hub-a']);
    expect(state.terminals['hub-a:t1']).toBeDefined();
    expect(state.unavailableHubIds['hub-a']).toBe(true);
    expect(canSendTerminalInput(state, 'hub-a:t1', true)).toBe(false);
  });

  test('clears a stale unavailable marker after a successful terminal snapshot', () => {
    let state = mergeTerminalLists(createTerminalSyncState(), [{hubId: 'hub-a', terminals: [terminal()]}]);
    state = markTerminalsUnavailable(state, ['hub-a']);
    state = applyTerminalSnapshot(beginTerminalSnapshot(state, 'hub-a', 't1'), 'hub-a', {
      terminal: terminal(), snapshotSeq: 0, snapshot: '',
    }).state;

    expect(state.unavailableHubIds['hub-a']).toBeUndefined();
    expect(canSendTerminalInput(state, 'hub-a:t1', true)).toBe(true);
  });

  test('clears a stale unavailable marker when a successful snapshot still needs gap recovery', () => {
    let state = mergeTerminalLists(createTerminalSyncState(), [{hubId: 'hub-a', terminals: [terminal()]}]);
    state = markTerminalsUnavailable(state, ['hub-a']);
    state = beginTerminalSnapshot(state, 'hub-a', 't1');
    state = receiveTerminalOutput(state, 'hub-a', output(2)).state;
    const result = applyTerminalSnapshot(state, 'hub-a', {
      terminal: terminal(), snapshotSeq: 0, snapshot: '',
    });

    expect(result.state.unavailableHubIds['hub-a']).toBeUndefined();
    expect(result.effects.at(-1)).toEqual({kind: 'refresh', terminalKey: 'hub-a:t1'});
  });

  test('applies changed metadata and removes closed terminals', () => {
    let state = mergeTerminalLists(createTerminalSyncState(), [{hubId: 'hub-a', terminals: [terminal()]}]);
    state = applyTerminalChanged(state, 'hub-a', {
      change: 'exited', terminalId: 't1', terminal: terminal({status: 'exited', exitCode: 7}),
    });
    expect(state.terminals['hub-a:t1'].exitCode).toBe(7);
    state = applyTerminalChanged(state, 'hub-a', {change: 'closed', terminalId: 't1'});
    expect(state.terminals['hub-a:t1']).toBeUndefined();
  });

  test('restores a snapshot then drains contiguous buffered output', () => {
    let state = mergeTerminalLists(createTerminalSyncState(), [{hubId: 'hub-a', terminals: [terminal()]}]);
    state = beginTerminalSnapshot(state, 'hub-a', 't1');
    state = receiveTerminalOutput(state, 'hub-a', output(8)).state;
    const restored = applyTerminalSnapshot(state, 'hub-a', {
      terminal: terminal(), snapshotSeq: 7,
      snapshot: bytesToBase64(new TextEncoder().encode('snapshot')),
    });
    expect(restored.effects).toEqual([
      {kind: 'reset', terminalKey: 'hub-a:t1', data: new TextEncoder().encode('snapshot')},
      {kind: 'write', terminalKey: 'hub-a:t1', data: new TextEncoder().encode('8')},
    ]);
    expect(restored.state.attached['hub-a:t1'].expectedSeq).toBe(9);
  });

  test('applies exact output and ignores duplicates', () => {
    let state = mergeTerminalLists(createTerminalSyncState(), [{hubId: 'hub-a', terminals: [terminal()]}]);
    state = applyTerminalSnapshot(beginTerminalSnapshot(state, 'hub-a', 't1'), 'hub-a', {
      terminal: terminal(), snapshotSeq: 3, snapshot: '',
    }).state;
    const exact = receiveTerminalOutput(state, 'hub-a', output(4));
    expect(exact.effects[0]).toMatchObject({kind: 'write', terminalKey: 'hub-a:t1'});
    const duplicate = receiveTerminalOutput(exact.state, 'hub-a', output(4));
    expect(duplicate.effects).toEqual([]);
    expect(duplicate.state.attached['hub-a:t1'].expectedSeq).toBe(5);
  });

  test('requests a snapshot on a sequence gap or run change', () => {
    let state = mergeTerminalLists(createTerminalSyncState(), [{hubId: 'hub-a', terminals: [terminal()]}]);
    state = applyTerminalSnapshot(beginTerminalSnapshot(state, 'hub-a', 't1'), 'hub-a', {
      terminal: terminal(), snapshotSeq: 2, snapshot: '',
    }).state;
    const gap = receiveTerminalOutput(state, 'hub-a', output(5));
    expect(gap.effects).toEqual([{kind: 'refresh', terminalKey: 'hub-a:t1'}]);
    const changedRun = receiveTerminalOutput(gap.state, 'hub-a', output(1, {runId: 'r2'}));
    expect(changedRun.effects).toEqual([]);
    expect(changedRun.state.attached['hub-a:t1'].loading).toBe(true);
  });

  test('ignores output for a terminal that is not attached', () => {
    const state = mergeTerminalLists(createTerminalSyncState(), [{hubId: 'hub-a', terminals: [terminal()]}]);
    const received = receiveTerminalOutput(state, 'hub-a', output(1));
    expect(received.state).toBe(state);
    expect(received.effects).toEqual([]);
  });

  test('restarts snapshot recovery when the event buffer reaches its bound', () => {
    let state = mergeTerminalLists(createTerminalSyncState(), [{hubId: 'hub-a', terminals: [terminal()]}]);
    state = beginTerminalSnapshot(state, 'hub-a', 't1');
    let effects: unknown[] = [];
    for (let seq = 1; seq <= 257; seq += 1) {
      const received = receiveTerminalOutput(state, 'hub-a', output(seq));
      state = received.state;
      effects = received.effects;
    }
    expect(effects).toEqual([{kind: 'refresh', terminalKey: 'hub-a:t1'}]);
    expect(state.attached['hub-a:t1'].buffered).toEqual([]);
  });

  test('enables input only for a connected available running attachment', () => {
    let state = mergeTerminalLists(createTerminalSyncState(), [{hubId: 'hub-a', terminals: [terminal()]}]);
    state = applyTerminalSnapshot(beginTerminalSnapshot(state, 'hub-a', 't1'), 'hub-a', {
      terminal: terminal(), snapshotSeq: 0, snapshot: '',
    }).state;
    expect(canSendTerminalInput(state, 'hub-a:t1', true)).toBe(true);
    expect(canSendTerminalInput(state, 'hub-a:t1', false)).toBe(false);
  });
});
