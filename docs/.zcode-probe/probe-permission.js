// Probe 9: capture interaction/requestPermission (requires build mode + OAuth).
// In yolo mode the server bypasses all permission prompts, so this probe only
// yields results when run in build/edit/plan mode against a working model.
//
// Strategy: create session in "build" mode, send a prompt that forces a Bash
// tool call ("run `echo hi` in a shell"). The server should emit an
// interaction/requestPermission server-request (id="server-N") before executing
// the tool. We answer it with allow_once and dump the exchange.
//
// NOTE: as of this writing the model call itself 404s under API-key routing
// (plan endpoint requires OAuth), so no tool call is reached. Re-run this once
// a valid OAuth credential is available.

const { call, proc, events } = globalThis.__harness;
const WS = { workspacePath: 'E:\\_Code\\WheelMaker', workspaceKey: 'E:\\_Code\\WheelMaker' };
const PROMPT = 'Run the shell command `echo hello` and tell me the output.';

(async () => {
  const r1 = await call('session/create', { workspace: WS, mode: 'build' });
  const sid = r1.frames[r1.frames.length - 1].result.session.sessionId;
  console.log('sessionId =', sid, '(build mode)');

  await call('session/subscribe', { sessionId: sid, deliveryKind: 'desktop-continuous' });
  events.length = 0;

  await call('session/send', { sessionId: sid, content: PROMPT });
  console.log('draining for 45s, watching for interaction/* server-requests...');
  await new Promise((r) => setTimeout(r, 45000));

  const reqs = events.filter((f) => 'id' in f && f.method && f.method.startsWith('interaction/'));
  console.log(`\n=== ${reqs.length} interaction server-request(s) captured ===`);
  for (const f of reqs) {
    console.log(`\n[server-request id=${f.id}] ${f.method}`);
    console.log(JSON.stringify(f.params, null, 2).slice(0, 1500));
  }
  if (!reqs.length) {
    console.log('(none — likely model 404 before any tool call; see probe-events.js outcome)');
  }

  proc.kill();
  process.exit(0);
})();
