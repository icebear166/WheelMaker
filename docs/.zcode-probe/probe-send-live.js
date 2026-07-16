// Probe 6: real prompt -> full event stream. Subscribe first, then send,
// and dump every inbound frame in arrival order until the send response
// resolves. This is the core wire capture for the ACP bridge mapping.

const { call, proc } = globalThis.__harness;

const WS = { workspacePath: 'E:\\_Code\\WheelMaker', workspaceKey: 'E:\\_Code\\WheelMaker' };
const PROMPT = 'Reply with exactly the word PONG and nothing else. Do not use any tools.';

(async () => {
  const r1 = await call('session/create', { workspace: WS });
  const sid = r1.frames[r1.frames.length - 1].result.session.sessionId;
  console.log('sessionId =', sid);

  console.log('\n=== subscribe (desktop-continuous) ===');
  const r2 = await call('session/subscribe', { sessionId: sid, deliveryKind: 'desktop-continuous' });
  console.log('subscribe result =', JSON.stringify(r2.frames[r2.frames.length - 1].result));

  console.log(`\n=== send: "${PROMPT}" ===`);
  console.log('--- event stream (ordered) ---');
  const r3 = await call('session/send', { sessionId: sid, content: PROMPT }, { timeout: 180000 });
  console.log('--- end event stream ---');

  // r3.frames contains every notification + the final response, in order.
  let idx = 0;
  for (const f of r3.frames) {
    idx++;
    if ('method' in f) {
      const kind = 'id' in f ? 'server-request' : 'notification';
      console.log(`[${idx}] ${kind} ${f.method}`);
      console.log(`     ${JSON.stringify(f.params).slice(0, 600)}`);
    } else {
      console.log(`[${idx}] RESPONSE`);
      console.log(`     ${JSON.stringify(f).slice(0, 800)}`);
    }
  }

  proc.kill();
  process.exit(0);
})();
