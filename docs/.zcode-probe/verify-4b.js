// Verify 4b: inspect what tool.updated contains in build mode, and whether any
// permission-related event/request appears at all. Also probe: does build mode
// actually gate Bash, or is the gating only on certain tools?
const { call, proc, events } = globalThis.__harness;
const WS = { workspacePath: 'E:\\_Code\\WheelMaker', workspaceKey: 'E:\\_Code\\WheelMaker' };

(async () => {
  const rc = await call('session/create', { workspace: WS, mode: 'build' });
  const sid = rc.frames[rc.frames.length - 1].result.session.sessionId;
  await call('session/subscribe', { sessionId: sid, deliveryKind: 'desktop-continuous' });
  events.length = 0;
  await call('session/send', { sessionId: sid, content: 'Use the Bash tool to run: rm -rf /tmp/zcode-perm-test-xyz. Tell me what happened.' });
  await new Promise((r) => setTimeout(r, 40000));

  const allServerReqs = events.filter((f) => 'id' in f && typeof f.id === 'string' && f.id.startsWith('server-'));
  console.log('=== server-requests (any) ===', allServerReqs.length);
  for (const f of allServerReqs) console.log('  ', f.id, f.method, JSON.stringify(f.params).slice(0, 200));

  const toolUpd = events.filter((f) => f.params && f.params.type === 'tool.updated');
  console.log('\n=== tool.updated events:', toolUpd.length, '===');
  for (const f of toolUpd) console.log(JSON.stringify(f.params.payload, null, 2).slice(0, 600), '\n---');

  const permEvents = events.filter((f) => /permission/i.test(JSON.stringify(f)));
  console.log('=== permission-related frames:', permEvents.length, '===');
  for (const f of permEvents) console.log('  ', (f.params && f.params.type) || f.method, JSON.stringify(f.params).slice(0, 200));

  const stateUpd = events.filter((f) => f.method === 'state.updated');
  console.log('\n=== state.updated patches ===');
  for (const f of stateUpd) console.log('  ', JSON.stringify(f.params.patch));
  proc.kill(); process.exit(0);
})();
