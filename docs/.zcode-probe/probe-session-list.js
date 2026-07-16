// Probe 3: capture full shapes.
// (a) session/list full result -> session object schema
// (b) session/create param error in full -> workspace object fields
// (c) feed a dummy string into session/resume etc. to learn next required field

const { call, jlog, proc } = globalThis.__harness;

(async () => {
  console.log('=== (a) session/list full result ===');
  const r1 = await call('session/list', {});
  jlog(r1.frames[r1.frames.length - 1]);

  console.log('\n=== (b) session/create with empty workspace object ===');
  const r2 = await call('session/create', { workspace: {} });
  jlog(r2.frames[r2.frames.length - 1]);

  console.log('\n=== (c) session/create with workspace.path ===');
  const r3 = await call('session/create', { workspace: { path: 'E:\\_Code\\WheelMaker' } });
  jlog(r3.frames[r3.frames.length - 1]);

  console.log('\n=== (d) session/subscribe with a dummy sessionId ===');
  const r4 = await call('session/subscribe', 'sess_dummy');
  jlog(r4.frames[r4.frames.length - 1]);

  console.log('\n=== (e) session/read with dummy sessionId ===');
  const r5 = await call('session/read', 'sess_dummy');
  jlog(r5.frames[r5.frames.length - 1]);

  proc.kill();
  process.exit(0);
})();
