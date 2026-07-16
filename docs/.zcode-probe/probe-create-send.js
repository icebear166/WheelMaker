// Probe 4: actually create a session and send a prompt. Capture the whole
// lifecycle: create -> subscribe -> send -> events -> (response).
//
// We now know:
//   session/create { workspace: { workspacePath, workspaceKey } }
//   session/subscribe { ... } (object, fields unknown)
//   session/send      { ... } (object, fields unknown)
// Step 1: create a real session. Step 2: probe subscribe/send param shapes.

const { call, jlog, proc } = globalThis.__harness;

(async () => {
  console.log('=== (1) session/create with full workspace ===');
  const r1 = await call('session/create', {
    workspace: { workspacePath: 'E:\\_Code\\WheelMaker', workspaceKey: 'E:\\_Code\\WheelMaker' },
  });
  jlog(r1.frames[r1.frames.length - 1]);

  const created = r1.frames[r1.frames.length - 1].result;
  const sid = created && (created.sessionId || (created.session && created.session.sessionId));
  console.log(`\n# created sessionId = ${sid}`);

  if (!sid) {
    console.log('# no sessionId, aborting send probe');
    proc.kill(); process.exit(0);
  }

  console.log('\n=== (2) session/subscribe with {sessionId} ===');
  const r2 = await call('session/subscribe', { sessionId: sid });
  jlog(r2.frames[r2.frames.length - 1]);

  console.log('\n=== (3) session/send param probe (empty object) ===');
  const r3 = await call('session/send', {});
  jlog(r3.frames[r3.frames.length - 1]);

  console.log('\n=== (4) session/send with {sessionId} ===');
  const r4 = await call('session/send', { sessionId: sid });
  jlog(r4.frames[r4.frames.length - 1]);

  // keep subscribers
  globalThis.__sid = sid;
  // do not exit; let follow-up happen via next tick
  console.log('\n# probe-4 done; sid saved');
  proc.kill();
  process.exit(0);
})();
