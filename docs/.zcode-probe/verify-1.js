// Verify suite 1: frame format, error codes, method enumeration, create/list/read/resume.
// Each check prints PASS/FAIL against the documented assertion. Real API (env injected
// by probe.js harness). No model calls here (send is in verify-2).

const { call, proc, jlog, raw } = globalThis.__harness;
const WS = { workspacePath: 'E:\\_Code\\WheelMaker', workspaceKey: 'E:\\_Code\\WheelMaker' };

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' :: ' + detail : ''}`); }
}

(async () => {
  console.log('\n########## 1. Frame format & error codes ##########');

  // 1a. jsonrpc key must be rejected with -32600 + unrecognized_keys
  const jr = await raw(JSON.stringify({ jsonrpc: '2.0', id: 'j1', method: 'session/list', params: {} }));
  check('frame with jsonrpc key is rejected', jr && jr.error, JSON.stringify(jr));
  check('jsonrpc rejection code === -32600', jr && jr.error && jr.error.code === -32600);
  check('jsonrpc rejection message mentions invalid', jr && jr.error && /invalid/i.test(jr.error.message));
  check('jsonrpc rejection data.issues flag unrecognized jsonrpc', jr && jr.error && jr.error.data &&
    JSON.stringify(jr.error.data).includes('jsonrpc'));

  // 1b. method not found -> -32601
  const r404 = await call('session/__nonexistent__', {});
  const e404 = r404.frames[r404.frames.length - 1].error;
  check('unknown method returns -32601', e404 && e404.code === -32601, JSON.stringify(e404));

  // 1c. invalid params (missing fields) -> -32602 with ZodError data
  const rParams = await call('session/create', {});
  const eParams = rParams.frames[rParams.frames.length - 1].error;
  check('missing params returns -32602', eParams && eParams.code === -32602, JSON.stringify(eParams));
  check('error.data.name === ZodError', eParams && eParams.data && eParams.data.name === 'ZodError');

  console.log('\n########## 2. session/create ##########');

  // 2a. create with workspace succeeds
  const rc = await call('session/create', { workspace: WS });
  const cresp = rc.frames[rc.frames.length - 1].result;
  const sid = cresp && cresp.session && cresp.session.sessionId;
  check('create returns sessionId', !!sid, JSON.stringify(cresp && cresp.session));
  check('protocol.name === "ZCode Protocol"', cresp && cresp.protocol && cresp.protocol.name === 'ZCode Protocol');
  check('protocol.version === 1', cresp && cresp.protocol && cresp.protocol.version === 1);
  check('session.workspace preserved', cresp && cresp.session && cresp.session.workspace &&
    cresp.session.workspace.workspacePath === WS.workspacePath);
  check('projection present', cresp && cresp.projection && 'status' in cresp.projection);
  check('runtime.eventSeq === 0', cresp && cresp.runtime && cresp.runtime.eventSeq === 0);
  check('runtime.stateRevision === 0', cresp && cresp.runtime && cresp.runtime.stateRevision === 0);
  check('settings.model.available is array', cresp && Array.isArray(cresp.settings.model.available));
  check('session.status === "idle"', cresp && cresp.session && cresp.session.status === 'idle');

  // 2b. create with mode
  const rcm = await call('session/create', { workspace: WS, mode: 'plan' });
  const cm = rcm.frames[rcm.frames.length - 1].result;
  check('create with mode=plan sets session.mode', cm && cm.session && cm.session.mode === 'plan', cm && cm.session && cm.session.mode);
  check('create with mode reflects in projection.mode', cm && cm.projection && cm.projection.mode === 'plan');

  // 2c. create with invalid mode -> error
  const rci = await call('session/create', { workspace: WS, mode: 'bogus' });
  const eci = rci.frames[rci.frames.length - 1].error;
  check('create with invalid mode rejected', !!eci, JSON.stringify(eci));

  globalThis.__sid = sid; // hand off to next suite via this process
  console.log('\n  created sessionId for later suites:', sid);

  console.log('\n########## 3. session/list ##########');
  const rl = await call('session/list', {});
  const lresp = rl.frames[rl.frames.length - 1].result;
  check('list returns sessions array', lresp && Array.isArray(lresp.sessions));
  const found = lresp && lresp.sessions.find((s) => s.sessionId === sid);
  check('newly created session appears in list', !!found);
  if (found) {
    check('SessionInfo has sessionKind', !!found.sessionKind, found.sessionKind);
    check('SessionInfo has title', 'title' in found);
    check('SessionInfo has workspace.{workspaceKey,workspacePath}', found.workspace && found.workspace.workspaceKey && found.workspace.workspacePath);
    check('SessionInfo has createdAt/updatedAt (ms)', typeof found.createdAt === 'number' && typeof found.updatedAt === 'number');
  }

  console.log('\n########## 4. session/read & session/resume ##########');
  const rr = await call('session/read', { sessionId: sid });
  const rresp = rr.frames[rr.frames.length - 1].result;
  check('read returns messages array', rresp && Array.isArray(rresp.messages), JSON.stringify(rresp).slice(0, 200));
  check('read returns projection', rresp && rresp.projection);

  const rrs = await call('session/resume', { sessionId: sid });
  const rsresp = rrs.frames[rrs.frames.length - 1].result;
  check('resume returns messages array', rsresp && Array.isArray(rsresp.messages));
  check('resume returns projection', rsresp && rsresp.projection);

  console.log(`\n=== SUITE 1 RESULT: ${pass} passed, ${fail} failed ===`);
  globalThis.__verify1 = { pass, fail, sid };
  proc.kill();
  process.exit(0);
})();
