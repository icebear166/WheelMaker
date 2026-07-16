// Probe config options: how does ZCode expose model/thoughtLevel/permission config?
// ACP has session/set_config_option. ZCode has session/setMode. Check what config-related
// methods exist and their shapes.
const { call, proc } = globalThis.__harness;
const WS = { workspacePath: 'E:\\_Code\\WheelMaker', workspaceKey: 'E:\\_Code\\WheelMaker' };
let pass = 0, fail = 0;
function check(l, c, d) { if (c) { pass++; console.log(`  PASS  ${l}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' :: ' + d : ''}`); } }

(async () => {
  const rc = await call('session/create', { workspace: WS, mode: 'yolo' });
  const sid = rc.frames[rc.frames.length - 1].result.session.sessionId;
  const settings = rc.frames[rc.frames.length - 1].result.settings;
  console.log('=== full settings block from session/create ===');
  console.log(JSON.stringify(settings, null, 2));

  console.log('\n=== probe config-related methods ===');
  for (const m of ['session/set_config_option', 'session/setConfigOption', 'session/setModel',
                   'session/setMode', 'session/config', 'session/setOption', 'config/set']) {
    const r = await call(m, { sessionId: sid }, { timeout: 5000 });
    const last = r.frames[r.frames.length - 1];
    const err = last.error;
    if (!err) console.log(`  ${m.padEnd(28)} OK: ${JSON.stringify(last.result).slice(0, 80)}`);
    else if (err.code === -32601) console.log(`  ${m.padEnd(28)} NOTFOUND`);
    else console.log(`  ${m.padEnd(28)} PARAMS(${err.code}): ${err.data && err.data.message ? err.data.message.slice(0, 150) : err.message}`);
  }

  console.log('\n=== session/setMode param schema (what does mode accept?) ===');
  const r1 = await call('session/setMode', { sessionId: sid });
  console.log('  setMode missing mode ->', JSON.stringify(r1.frames[r1.frames.length - 1].error).slice(0, 200));
  const r2 = await call('session/setMode', { mode: 'plan' });
  console.log('  setMode missing sessionId ->', JSON.stringify(r2.frames[r2.frames.length - 1].error).slice(0, 200));

  console.log('\n=== setMode to plan, then read back settings ===');
  const r3 = await call('session/setMode', { sessionId: sid, mode: 'plan' });
  console.log('  setMode plan result keys:', r3.frames[r3.frames.length - 1].result && Object.keys(r3.frames[r3.frames.length - 1].result));
  const r4 = await call('session/read', { sessionId: sid });
  const after = r4.frames[r4.frames.length - 1].result;
  // where does mode land after setMode? check projection / settings if present
  console.log('  after setMode, projection:', JSON.stringify(after.projection).slice(0, 200));

  console.log('\n=== thoughtLevel: is it settable? ===');
  console.log('  thoughtLevel from create:', JSON.stringify(settings && settings.thoughtLevel).slice(0, 200));

  proc.kill();
  process.exit(0);
})();
