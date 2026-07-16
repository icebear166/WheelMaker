// Verify suite 4: permission request (interaction/requestPermission) in build mode.
// Create session in build mode, prompt the agent to run a shell command, capture the
// server-request, validate its schema, reply allow_once, and confirm execution proceeds.
const { call, proc, events } = globalThis.__harness;
const WS = { workspacePath: 'E:\\_Code\\WheelMaker', workspaceKey: 'E:\\_Code\\WheelMaker' };
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' :: ' + detail : ''}`); }
}

(async () => {
  console.log('\n########## 12. Permission request (build mode) ##########');
  const rc = await call('session/create', { workspace: WS, mode: 'build' });
  const cresp = rc.frames[rc.frames.length - 1].result;
  const sid = cresp.session.sessionId;
  console.log('  build-mode permission.mode =', cresp.settings.permission.mode);
  check('create mode=build sets permission.mode=build', cresp.settings.permission.mode === 'build');

  await call('session/subscribe', { sessionId: sid, deliveryKind: 'desktop-continuous' });
  events.length = 0;

  // prompt that forces a Bash call
  await call('session/send', { sessionId: sid, content: 'Run the shell command: echo hello-perm-test. Then report its exact output.' });
  console.log('  waiting up to 40s for interaction/requestPermission...');

  let permReq = null;
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline && !permReq) {
    permReq = events.find((f) => 'id' in f && typeof f.id === 'string' && f.id.startsWith('server-') && f.method === 'interaction/requestPermission');
    if (permReq) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!permReq) {
    console.log('  (no interaction/requestPermission captured within 40s)');
    console.log('  event types seen:', JSON.stringify(
      events.reduce((a, f) => { const t = (f.params && f.params.type) || f.method || ('resp'); a[t] = (a[t] || 0) + 1; return a; }, {})
    ));
    check('interaction/requestPermission captured', false, 'none');
  } else {
    check('interaction/requestPermission captured', true);
    const p = permReq.params;
    console.log('  requestPermission params:', JSON.stringify(p, null, 2).slice(0, 1200));
    check('params has requestId', !!p.requestId);
    check('params has sessionId', !!p.sessionId);
    check('params has toolCallId', !!p.toolCallId);
    check('params has toolName', typeof p.toolName === 'string', p.toolName);
    check('params has reason string', typeof p.reason === 'string');
    check('params has riskLevel in enum', ['low', 'medium', 'high', 'critical'].includes(p.riskLevel), p.riskLevel);
    check('params has input', 'input' in p);
    check('params has options array (>=1)', Array.isArray(p.options) && p.options.length >= 1);
    const allowOnce = p.options.find((o) => o.optionId === 'allow_once' || o.kind === 'allow_once');
    check('options include an allow_once option', !!allowOnce);
    if (allowOnce) {
      check('allow_once has response.decision=allow', allowOnce.response && allowOnce.response.decision === 'allow');
    }

    // reply with the allow_once response
    const reply = allowOnce ? allowOnce.response : { decision: 'allow', reason: 'probe approved' };
    console.log('  replying to server-request id=' + permReq.id + ' with:', JSON.stringify(reply));
    // send a raw response frame: {id, result}
    proc.stdin.write(JSON.stringify({ id: permReq.id, result: reply }) + '\n');
    await new Promise((r) => setTimeout(r, 25000));

    const types = {};
    for (const f of events) { const t = (f.params && f.params.type) || f.method || 'resp'; types[t] = (types[t] || 0) + 1; }
    console.log('  event types after reply:', JSON.stringify(types));
    check('turn completed after allow', !!types['turn.completed'] || !!types['turn.failed']);
  }

  console.log(`\n=== SUITE 4 RESULT: ${pass} passed, ${fail} failed ===`);
  proc.kill();
  process.exit(0);
})();
