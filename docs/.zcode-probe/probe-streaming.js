// Probe 10: capture model.streaming (text deltas) and turn.completed payloads.
// These are the success-path events needed for the ACP message mapping.
// Dump the FULL params of these two event types, verbatim.

const { call, proc, events } = globalThis.__harness;
const WS = { workspacePath: 'E:\\_Code\\WheelMaker', workspaceKey: 'E:\\_Code\\WheelMaker' };
const PROMPT = 'In one short sentence, what is 2+2? Reply plainly.';

(async () => {
  const r1 = await call('session/create', { workspace: WS, mode: 'yolo' });
  const sid = r1.frames[r1.frames.length - 1].result.session.sessionId;
  console.log('sessionId =', sid);
  await call('session/subscribe', { sessionId: sid, deliveryKind: 'desktop-continuous' });
  events.length = 0;

  await call('session/send', { sessionId: sid, content: PROMPT });
  await new Promise((r) => setTimeout(r, 30000));

  // group by type
  const byType = {};
  for (const f of events) {
    const t = (f.params && f.params.type) || f.method || '?';
    (byType[t] = byType[t] || []).push(f);
  }
  console.log('\n=== event type counts ===');
  for (const [t, arr] of Object.entries(byType)) console.log(`  ${t}: ${arr.length}`);

  // dump first model.streaming and the turn.completed in full
  const stream = byType['model.streaming'] || [];
  console.log(`\n=== model.streaming: ${stream.length} events; first 3 payloads ===`);
  for (const f of stream.slice(0, 3)) {
    console.log(JSON.stringify(f.params, null, 2));
  }
  if (stream.length > 3) {
    console.log(`\n... and last model.streaming:`);
    console.log(JSON.stringify(stream[stream.length - 1].params, null, 2));
  }

  const completed = byType['turn.completed'];
  if (completed) {
    console.log('\n=== turn.completed (full) ===');
    console.log(JSON.stringify(completed[0].params, null, 2));
  } else {
    console.log('\n(no turn.completed captured)');
  }

  proc.kill();
  process.exit(0);
})();
