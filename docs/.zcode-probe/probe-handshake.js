// Probe 1: discover the handshake method name and message union shape.
// Strategy: ZCode Protocol frames are a zod union. The earlier error showed
// branches like "request {id,method,params}" and a server-request {id,method,error?}.
// We (a) enumerate likely handshake method names, (b) capture the exact error
// schema for an unknown method so we learn how the server reports it.

const { call, jlog, proc } = globalThis.__harness;

(async () => {
  const candidates = [
    'initialize', 'initialise', 'handshake', 'hello', 'ping',
    'ready', 'start', 'connect', 'begin', 'register', 'bootstrap',
    'session/new', 'session/start', 'session/create', 'session.begin',
    'subscribeSession', 'listSessions', 'readMessages', 'readEvents',
    'sendPrompt', 'auth/login', 'auth/whoami', 'auth/status',
    'client/register', 'client/registerCapabilities',
  ];

  console.log('=== probing candidate method names (expecting -32601 method-not-found for wrong ones) ===');
  for (const m of candidates) {
    try {
      const e = await call(m, {}, { timeout: 5000 });
      const resp = e.frames[e.frames.length - 1];
      const err = resp && resp.error;
      const verdict = err && err.code === -32601 ? 'NOT-FOUND' : (err ? `ERR(${err.code})` : 'REPLY');
      console.log(`  ${m.padEnd(28)} -> ${verdict}`);
      // print any reply that is not a plain method-not-found (those are interesting)
      if (verdict !== 'NOT-FOUND') {
        console.log(`    ${JSON.stringify(resp).slice(0, 400)}`);
      }
    } catch (err) {
      console.log(`  ${m.padEnd(28)} -> THROW ${err.message}`);
    }
  }

  console.log('\n=== done. exiting. ===');
  proc.kill();
  process.exit(0);
})();
