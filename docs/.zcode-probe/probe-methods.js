// Probe 2: map the session/* method namespace now that we know the naming
// convention is slash-delimited (session/create exists). Enumerate likely
// methods and capture param-validation errors, which reveal required fields.

const { call, jlog, proc } = globalThis.__harness;

(async () => {
  // namespace guesses based on codex app-server (thread/*, turn/*, item/*,
  // model/*) and ACP (session/*), plus zcode-specific hints from the bundle
  // (sendPrompt -> session/prompt, subscribeSession -> session/subscribe).
  const methods = [
    'session/create', 'session/list', 'session/load', 'session/resume',
    'session/delete', 'session/archive', 'session/start', 'session/new',
    'session/prompt', 'session/send', 'session/sendPrompt', 'session/message',
    'session/cancel', 'session/stop', 'session/interrupt',
    'session/subscribe', 'session/subscribeSession', 'session/events',
    'session/read', 'session/readMessages', 'session/readEvents',
    'session/update', 'session/info', 'session/get',
    'session/steer', 'session/rewind',
    'session/setMode', 'session/mode', 'session/model',
    'thread/list', 'thread/start', 'thread/resume',
    'turn/start', 'turn/cancel',
    'model/list', 'models/list', 'models',
    'agent/info', 'agent/list', 'auth/whoami', 'auth/status',
    'initialize', 'initialized',
  ];

  console.log('method                       verdict    hint');
  console.log('---------------------------  ---------  ----');
  for (const m of methods) {
    try {
      const e = await call(m, {}, { timeout: 5000 });
      const resp = e.frames[e.frames.length - 1];
      const err = resp && resp.error;
      if (!err) {
        console.log(`${m.padEnd(28)} OK         result=${JSON.stringify(resp.result).slice(0,120)}`);
        continue;
      }
      if (err.code === -32601) { console.log(`${m.padEnd(28)} n/a`); continue; }
      // param error: extract required-field hints
      let hint = '';
      if (err.data && err.data.message) {
        const paths = [...err.data.message.matchAll(/"path":\s*\[\s*"([^"]+)"\]/g)].map((x) => x[1]);
        const reqs = [...err.data.message.matchAll(/"message":\s*"Invalid input: expected ([^"]+)"/g)].map((x) => x[1]);
        hint = (paths.length ? `need=[${[...new Set(paths)].join(',')}] ` : '') + (reqs.length ? `types=[${[...new Set(reqs)].slice(0,3).join(',')}]` : '');
      }
      console.log(`${m.padEnd(28)} PARAMS     ${hint}  | ${err.message}`);
    } catch (err) {
      console.log(`${m.padEnd(28)} TIMEOUT`);
    }
  }
  proc.kill();
  process.exit(0);
})();
