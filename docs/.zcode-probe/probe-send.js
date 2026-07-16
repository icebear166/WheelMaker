// Probe 5: full send -> event stream -> completion lifecycle.
// Steps: create -> discover send param schema -> send a real prompt ->
// capture EVERY notification/server-request until the response returns.
//
// We print the ordered event log so the ACP-bridge mapping becomes obvious.

const { call, jlog, proc } = globalThis.__harness;

const WS = { workspacePath: 'E:\\_Code\\WheelMaker', workspaceKey: 'E:\\_Code\\WheelMaker' };

(async () => {
  console.log('=== (1) create session ===');
  const r1 = await call('session/create', { workspace: WS });
  const created = r1.frames[r1.frames.length - 1].result;
  const sid = created.session.sessionId;
  console.log('sessionId =', sid);

  console.log('\n=== (2) session/send param probe (empty object) ===');
  const r2 = await call('session/send', {});
  jlog(r2.frames[r2.frames.length - 1]);

  console.log('\n=== (3) session/send with {sessionId} ===');
  const r3 = await call('session/send', { sessionId: sid });
  jlog(r3.frames[r3.frames.length - 1]);

  console.log('\n=== (4) session/subscribe with {sessionId} ===');
  const r4 = await call('session/subscribe', { sessionId: sid });
  jlog(r4.frames[r4.frames.length - 1]);

  proc.kill();
  process.exit(0);
})();
