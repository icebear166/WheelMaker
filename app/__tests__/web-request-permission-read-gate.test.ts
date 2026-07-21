import {ChatPermissionReadGate} from '../web/src/chat/permission/chatPermissionReadGate';

describe('permission session.read gate', () => {
  test('becomes ready only after the matching read completes', () => {
    const gate = new ChatPermissionReadGate();
    const token = gate.begin('project/session');
    expect(gate.isReady('project/session')).toBe(false);
    expect(gate.complete('project/session', token)).toBe(true);
    expect(gate.isReady('project/session')).toBe(true);
  });

  test('disconnect invalidates reads that finish after the connection closes', () => {
    const gate = new ChatPermissionReadGate();
    const staleToken = gate.begin('project/session');
    gate.disconnect();
    expect(gate.complete('project/session', staleToken)).toBe(false);
    expect(gate.isReady('project/session')).toBe(false);
  });

  test('starting a repair hides a previously ready request until it completes', () => {
    const gate = new ChatPermissionReadGate();
    const first = gate.begin('project/session');
    gate.complete('project/session', first);
    const repair = gate.begin('project/session');
    expect(gate.isReady('project/session')).toBe(false);
    gate.complete('project/session', repair);
    expect(gate.isReady('project/session')).toBe(true);
  });
});
