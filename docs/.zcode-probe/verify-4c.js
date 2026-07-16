// Verify 4c: full permission round-trip — capture requestPermission, reply allow,
// confirm the tool executes and turn completes.
const { call, proc, events } = globalThis.__harness;
const WS = { workspacePath: 'E:\\_Code\\WheelMaker', workspaceKey: 'E:\\_Code\\WheelMaker' };
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' :: ' + detail : ''}`); }
}

(async () => {
  const rc = await call('session/create', { workspace: WS, mode: 'build' });
  const sid = rc.frames[rc.frames.length - 1].result.session.sessionId;
  await call('session/subscribe', { sessionId: sid, deliveryKind: 'desktop-continuous' });
  events.length = 0;
  await call('session/send', { sessionId: sid, content: 'Use the Bash tool to run: echo PERMOK' });

  // wait for the first requestPermission
  let req = null;
  for (let i = 0; i < 80 && !req; i++) {
    req = events.find((f) => f.id && String(f.id).startsWith('server-') && f.method === 'interaction/requestPermission');
    if (req) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  check('requestPermission captured', !!req);
  if (!req) { console.log('none'); proc.kill(); process.exit(0); }

  const p = req.params;
  console.log('  toolName:', p.toolName, '| riskLevel:', p.riskLevel, '| reason:', p.reason);
  console.log('  options:', (p.options || []).map((o) => o.optionId + '/' + o.kind));
  const allowOpt = p.options.find((o) => o.response && o.response.decision === 'allow');
  check('an allow option exists', !!allowOpt);

  // reply allow to the FIRST server-request id (avoid duplicates: reply to each unique id once)
  const seenIds = new Set();
  const replyLoop = setInterval(() => {
    for (const f of events) {
      if (f.id && String(f.id).startsWith('server-') && f.method === 'interaction/requestPermission' && !seenIds.has(f.id)) {
        seenIds.add(f.id);
        proc.stdin.write(JSON.stringify({ id: f.id, result: allowOpt ? allowOpt.response : { decision: 'allow', reason: 'probe' } }) + '\n');
        console.log('  replied allow to', f.id);
      }
    }
  }, 500);

  await new Promise((r) => setTimeout(r, 30000));
  clearInterval(replyLoop);

  const types = {};
  for (const f of events) { const t = (f.params && f.params.type) || f.method || 'resp'; types[t] = (types[t] || 0) + 1; }
  console.log('  event types:', JSON.stringify(types));
  check('tool.updated (tool executed) seen after allow', !!types['tool.updated']);
  check('turn.completed seen after allow', !!types['turn.completed']);

  // did the bash actually run? check for permission.resolved
  const resolved = events.find((f) => f.params && /permission.*resolved/i.test(f.params.type || ''));
  check('permission.resolved notification seen', !!resolved, JSON.stringify(resolved && resolved.params && resolved.params.payload).slice(0, 150));

  console.log(`\n=== SUITE 4c RESULT: ${pass} passed, ${fail} failed ===`);
  proc.kill();
  process.exit(0);
})();
