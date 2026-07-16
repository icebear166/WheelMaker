// Verify suite 3: method existence map + message structure + steer/stop/rewind schemas.
const { call, proc } = globalThis.__harness;
const WS = { workspacePath: 'E:\\_Code\\WheelMaker', workspaceKey: 'E:\\_Code\\WheelMaker' };
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' :: ' + detail : ''}`); }
}

async function verdict(method) {
  const r = await call(method, {}, { timeout: 6000 });
  const last = r.frames[r.frames.length - 1];
  const err = last.error;
  if (!err) return 'OK';
  if (err.code === -32601) return 'NOTFOUND';
  return 'PARAMS'; // exists but needs params
}

(async () => {
  console.log('\n########## 9. Method existence map ##########');
  console.log('  (documented EXISTS methods should be OK or PARAMS; documented ABSENT should be NOTFOUND)\n');

  const shouldExist = ['session/list','session/create','session/resume','session/read','session/send',
    'session/steer','session/stop','session/rewind','session/setMode','session/events','session/subscribe'];
  for (const m of shouldExist) {
    const v = await verdict(m);
    check(`EXISTS  ${m}`, v !== 'NOTFOUND', `got ${v}`);
  }

  const shouldNotExist = ['initialize','session/new','session/load','session/prompt','session/cancel',
    'session/delete','session/archive','thread/list','thread/start','turn/start','model/list','auth/whoami',
    'sendPrompt','subscribeSession','readMessages'];
  console.log();
  for (const m of shouldNotExist) {
    const v = await verdict(m);
    check(`ABSENT  ${m}`, v === 'NOTFOUND', `got ${v}`);
  }

  console.log('\n########## 10. message structure (info/parts) ##########');
  const rc = await call('session/create', { workspace: WS, mode: 'yolo' });
  const sid = rc.frames[rc.frames.length - 1].result.session.sessionId;
  await call('session/subscribe', { sessionId: sid, deliveryKind: 'desktop-continuous' });
  await call('session/send', { sessionId: sid, content: 'Say hi.' });
  await new Promise((r) => setTimeout(r, 20000));
  const rr = await call('session/read', { sessionId: sid });
  const msgs = rr.frames[rr.frames.length - 1].result.messages;
  console.log(`  ${msgs.length} messages; dumping first message structure:`);
  console.log(JSON.stringify(msgs[0], null, 2).slice(0, 900));
  check('message has info object', msgs[0] && typeof msgs[0].info === 'object');
  check('message.info has role', msgs[0] && msgs[0].info && typeof msgs[0].info.role === 'string');
  check('message has parts array', msgs[0] && Array.isArray(msgs[0].parts));
  if (msgs[0] && msgs[0].info) {
    console.log('  info keys:', Object.keys(msgs[0].info));
  }

  console.log('\n########## 11. steer / stop / rewind param schemas ##########');
  // steer needs {sessionId, content}
  const st1 = await call('session/steer', { sessionId: sid });
  check('steer needs content', st1.frames[st1.frames.length - 1].error && /content/i.test(JSON.stringify(st1.frames[st1.frames.length - 1].error)));
  // stop needs {sessionId}
  const sp1 = await call('session/stop', { sessionId: sid });
  console.log('  stop ->', JSON.stringify(sp1.frames[sp1.frames.length - 1].result || sp1.frames[sp1.frames.length - 1].error));
  // rewind needs {sessionId, target}
  const rw1 = await call('session/rewind', { sessionId: sid });
  check('rewind needs target', rw1.frames[rw1.frames.length - 1].error && /target/i.test(JSON.stringify(rw1.frames[rw1.frames.length - 1].error)));

  console.log(`\n=== SUITE 3 RESULT: ${pass} passed, ${fail} failed ===`);
  proc.kill();
  process.exit(0);
})();
