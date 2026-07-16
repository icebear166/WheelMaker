// Probe: permission round-trip — reply allow, capture permission.resolved + tool execution.
// Use a high-risk Bash command to reliably trigger interaction/requestPermission in build mode.
const { call, proc, events } = globalThis.__harness;
const WS = { workspacePath: 'E:\\_Code\\WheelMaker', workspaceKey: 'E:\\_Code\\WheelMaker' };

(async () => {
  const rc = await call('session/create', { workspace: WS, mode: 'build' });
  const sid = rc.frames[rc.frames.length - 1].result.session.sessionId;
  console.log('session(build):', sid);
  await call('session/subscribe', { sessionId: sid, deliveryKind: 'desktop-continuous' });
  events.length = 0;

  await call('session/send', { sessionId: sid, content: 'Use the Bash tool to run this exact command: rm -rf /tmp/zcode-perm-roundtrip-test. Then tell me the exit code.' });

  // As soon as a requestPermission arrives, reply allow to the first unseen id.
  const replied = new Set();
  let resolved = null;
  for (let i = 0; i < 100; i++) {
    for (const f of events) {
      if (f.id && String(f.id).startsWith('server-') && f.method === 'interaction/requestPermission' && !replied.has(f.id)) {
        replied.add(f.id);
        const allow = (f.params.options || []).find(o => o.response && o.response.decision === 'allow');
        const resp = allow ? allow.response : { decision: 'allow', reason: 'probe' };
        console.log('replying allow to', f.id, JSON.stringify(resp));
        proc.stdin.write(JSON.stringify({ id: f.id, result: resp }) + '\n');
      }
    }
    resolved = events.find(f => f.params && /permission.*resolved/i.test(f.params.type || ''));
    if (resolved) break;
    await new Promise(r => setTimeout(r, 400));
  }

  // drain a bit more for tool execution + turn completed
  await new Promise(r => setTimeout(r, 15000));

  const types = {};
  for (const f of events) { const t = (f.params && f.params.type) || f.method || 'resp'; types[t] = (types[t] || 0) + 1; }
  console.log('\n=== event types ===', JSON.stringify(types));

  console.log('\n=== permission.resolved payload ===');
  const res = events.find(f => f.params && /permission.*resolved/i.test(f.params.type || ''));
  console.log(res ? JSON.stringify(res.params, null, 2) : '(none)');

  console.log('\n=== tool.updated events (did the Bash tool run?) ===');
  const tools = events.filter(f => f.params && f.params.type === 'tool.updated');
  for (const f of tools) {
    const pl = f.params.payload || {};
    console.log(`  ${pl.toolName} kind=${pl.kind} success=${pl.result && pl.result.success}`);
  }

  console.log('\n=== turn.completed (if any) ===');
  const comp = events.find(f => f.params && f.params.type === 'turn.completed');
  console.log(comp ? JSON.stringify(comp.params.payload, null, 2).slice(0, 400) : '(none / still running or failed)');

  proc.kill();
  process.exit(0);
})();
