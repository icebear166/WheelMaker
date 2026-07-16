// Probe 7: capture the FULL async event stream after send.
// send returns immediately; model output arrives as notifications afterward.
// We use the global eventTap to drain everything for N seconds.

const { call, proc, events } = globalThis.__harness;

const WS = { workspacePath: 'E:\\_Code\\WheelMaker', workspaceKey: 'E:\\_Code\\WheelMaker' };
const PROMPT = 'Reply with exactly the word PONG and nothing else. Do not use any tools.';

(async () => {
  const r1 = await call('session/create', { workspace: WS });
  const sid = r1.frames[r1.frames.length - 1].result.session.sessionId;
  console.log('sessionId =', sid);

  await call('session/subscribe', { sessionId: sid, deliveryKind: 'desktop-continuous' });

  events.length = 0; // clear tap right before send

  console.log(`\n=== send: "${PROMPT}" ===`);
  const sr = await call('session/send', { sessionId: sid, content: PROMPT });
  console.log('send response =', JSON.stringify(sr.frames[sr.frames.length - 1].result));

  console.log('=== draining async events for 50s ===');
  await new Promise((r) => setTimeout(r, 50000));

  console.log(`\n=== captured ${events.length} async frames ===`);
  let idx = 0;
  for (const f of events) {
    idx++;
    const kind = 'id' in f ? 'server-request' : 'notification';
    console.log(`\n[${idx}] ${kind} ${f.method}`);
    console.log(JSON.stringify(f.params, null, 2).slice(0, 1500));
  }

  proc.kill();
  process.exit(0);
})();
