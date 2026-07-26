import type {
  RegistryTerminal,
  RegistryTerminalChangedEvent,
  RegistryTerminalGetResponse,
  RegistryTerminalOutputEvent,
} from '../registry/registryTypes';
import {base64ToBytes} from './terminalEncoding';

const MAX_BUFFERED_EVENTS = 256;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

type TerminalAttachment = {
  runId: string;
  expectedSeq: number;
  loading: boolean;
  refreshRequested: boolean;
  buffered: RegistryTerminalOutputEvent[];
  bufferedBytes: number;
};

export type TerminalSyncState = {
  terminals: Record<string, RegistryTerminal>;
  unavailableHubIds: Record<string, true>;
  attached: Record<string, TerminalAttachment>;
};

export type TerminalEffect =
  | {kind: 'reset'; terminalKey: string; data: Uint8Array}
  | {kind: 'write'; terminalKey: string; data: Uint8Array}
  | {kind: 'refresh'; terminalKey: string};

export type TerminalSyncResult = {state: TerminalSyncState; effects: TerminalEffect[]};

export function terminalSyncKey(hubId: string, terminalId: string): string {
  return `${hubId}:${terminalId}`;
}

export function createTerminalSyncState(): TerminalSyncState {
  return {terminals: {}, unavailableHubIds: {}, attached: {}};
}

export function mergeTerminalLists(
  state: TerminalSyncState,
  lists: Array<{hubId: string; terminals: RegistryTerminal[]}>,
): TerminalSyncState {
  const terminals = {...state.terminals};
  const attached = {...state.attached};
  const unavailableHubIds = {...state.unavailableHubIds};
  for (const list of lists) {
    const retainedKeys = new Set(list.terminals.map(item => terminalSyncKey(list.hubId, item.terminalId)));
    for (const [key, item] of Object.entries(terminals)) {
      if (item.hubId === list.hubId && !retainedKeys.has(key)) {
        delete terminals[key];
        delete attached[key];
      }
    }
    for (const item of list.terminals) {
      terminals[terminalSyncKey(list.hubId, item.terminalId)] = item;
    }
    delete unavailableHubIds[list.hubId];
  }
  return {...state, terminals, attached, unavailableHubIds};
}

export function markTerminalsUnavailable(state: TerminalSyncState, hubIds: string[]): TerminalSyncState {
  const unavailableHubIds = {...state.unavailableHubIds};
  for (const hubId of hubIds) unavailableHubIds[hubId] = true;
  return {...state, unavailableHubIds};
}

export function applyTerminalChanged(
  state: TerminalSyncState,
  hubId: string,
  event: RegistryTerminalChangedEvent,
): TerminalSyncState {
  const key = terminalSyncKey(hubId, event.terminalId);
  const terminals = {...state.terminals};
  const attached = {...state.attached};
  if (event.change === 'closed') {
    delete terminals[key];
    delete attached[key];
  } else if (event.terminal) {
    terminals[key] = event.terminal;
  }
  const unavailableHubIds = {...state.unavailableHubIds};
  delete unavailableHubIds[hubId];
  return {...state, terminals, attached, unavailableHubIds};
}

export function beginTerminalSnapshot(state: TerminalSyncState, hubId: string, terminalId: string): TerminalSyncState {
  const key = terminalSyncKey(hubId, terminalId);
  const current = state.attached[key];
  return {
    ...state,
    attached: {
      ...state.attached,
      [key]: {
        runId: current?.runId ?? '',
        expectedSeq: current?.expectedSeq ?? 1,
        loading: true,
        refreshRequested: true,
        buffered: [],
        bufferedBytes: 0,
      },
    },
  };
}

export function receiveTerminalOutput(
  state: TerminalSyncState,
  hubId: string,
  event: RegistryTerminalOutputEvent,
): TerminalSyncResult {
  const key = terminalSyncKey(hubId, event.terminalId);
  const attachment = state.attached[key];
  if (!attachment) return {state, effects: []};
  let data: Uint8Array;
  try {
    data = base64ToBytes(event.data);
  } catch {
    return requestRefresh(state, key, attachment);
  }
  if (attachment.loading) {
    const buffered = [...attachment.buffered, event];
    const bufferedBytes = attachment.bufferedBytes + data.byteLength;
    if (buffered.length > MAX_BUFFERED_EVENTS || bufferedBytes > MAX_BUFFERED_BYTES) {
      if (attachment.refreshRequested) {
        return {
          state: withAttachment(state, key, {...attachment, buffered: [], bufferedBytes: 0}),
          effects: [{kind: 'refresh', terminalKey: key}],
        };
      }
      return requestRefresh(state, key, attachment);
    }
    return {
      state: withAttachment(state, key, {...attachment, buffered, bufferedBytes}),
      effects: [],
    };
  }
  if (event.runId !== attachment.runId || event.seq > attachment.expectedSeq) {
    return {
      state: withAttachment(state, key, {
        ...attachment, loading: true, refreshRequested: true,
        buffered: [event], bufferedBytes: data.byteLength,
      }),
      effects: [{kind: 'refresh', terminalKey: key}],
    };
  }
  if (event.seq < attachment.expectedSeq) return {state, effects: []};
  return {
    state: withAttachment(state, key, {...attachment, expectedSeq: attachment.expectedSeq + 1}),
    effects: [{kind: 'write', terminalKey: key, data}],
  };
}

export function applyTerminalSnapshot(
  state: TerminalSyncState,
  hubId: string,
  snapshot: RegistryTerminalGetResponse,
): TerminalSyncResult {
  const key = terminalSyncKey(hubId, snapshot.terminal.terminalId);
  const current = state.attached[key] ?? {
    runId: '', expectedSeq: 1, loading: true, refreshRequested: true, buffered: [], bufferedBytes: 0,
  };
  let snapshotData: Uint8Array;
  try {
    snapshotData = base64ToBytes(snapshot.snapshot);
  } catch {
    return requestRefresh(state, key, current);
  }
  const unavailableHubIds = {...state.unavailableHubIds};
  delete unavailableHubIds[hubId];
  const availableState = {...state, unavailableHubIds};
  const effects: TerminalEffect[] = [{kind: 'reset', terminalKey: key, data: snapshotData}];
  let expectedSeq = snapshot.snapshotSeq + 1;
  for (const event of current.buffered) {
    if (event.runId !== snapshot.terminal.runId) {
      return snapshotGap(availableState, key, snapshot.terminal, expectedSeq, effects);
    }
    if (event.seq < expectedSeq) continue;
    if (event.seq > expectedSeq) {
      return snapshotGap(availableState, key, snapshot.terminal, expectedSeq, effects);
    }
    try {
      effects.push({kind: 'write', terminalKey: key, data: base64ToBytes(event.data)});
    } catch {
      return snapshotGap(availableState, key, snapshot.terminal, expectedSeq, effects);
    }
    expectedSeq += 1;
  }
  return {
    state: {
      ...withAttachment(availableState, key, {
        runId: snapshot.terminal.runId,
        expectedSeq,
        loading: false,
        refreshRequested: false,
        buffered: [],
        bufferedBytes: 0,
      }),
      terminals: {...availableState.terminals, [key]: snapshot.terminal},
    },
    effects,
  };
}

export function canSendTerminalInput(state: TerminalSyncState, key: string, connected: boolean): boolean {
  if (!connected) return false;
  const terminal = state.terminals[key];
  const attachment = state.attached[key];
  return !!terminal && terminal.status === 'running' && !state.unavailableHubIds[terminal.hubId] &&
    !!attachment && !attachment.loading && attachment.runId === terminal.runId;
}

function withAttachment(state: TerminalSyncState, key: string, attachment: TerminalAttachment): TerminalSyncState {
  return {...state, attached: {...state.attached, [key]: attachment}};
}

function requestRefresh(state: TerminalSyncState, key: string, attachment: TerminalAttachment): TerminalSyncResult {
  if (attachment.refreshRequested) return {state, effects: []};
  return {
    state: withAttachment(state, key, {
      ...attachment, loading: true, refreshRequested: true, buffered: [], bufferedBytes: 0,
    }),
    effects: [{kind: 'refresh', terminalKey: key}],
  };
}

function snapshotGap(
  state: TerminalSyncState,
  key: string,
  terminal: RegistryTerminal,
  expectedSeq: number,
  effects: TerminalEffect[],
): TerminalSyncResult {
  return {
    state: {
      ...withAttachment(state, key, {
        runId: terminal.runId, expectedSeq, loading: true, refreshRequested: true,
        buffered: [], bufferedBytes: 0,
      }),
      terminals: {...state.terminals, [key]: terminal},
    },
    effects: [...effects, {kind: 'refresh', terminalKey: key}],
  };
}
