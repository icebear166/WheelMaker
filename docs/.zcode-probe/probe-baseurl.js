// Minimal baseURL-resolution probe. Creates a session, sends "hi", and prints
// the baseURL the app-server actually resolved for the model request.
// Reads ZCODE_* env from the parent (set by the caller). Does NOT use probe.js.
const { spawn } = require('child_process');
const path = require('path');

const F = path.join(process.env.LOCALAPPDATA, 'Programs', 'ZCode', 'resources', 'glm', 'zcode.cjs');
const p = spawn(process.execPath, [F, 'app-server', '--cwd', 'E:\\_Code\\WheelMaker'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
let sid = null;
let done = false;

p.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let f;
    try { f = JSON.parse(line); } catch (e) { continue; }

    // capture sessionId from create response
    if (f.result && f.result.session && f.result.session.sessionId) {
      sid = f.result.session.sessionId;
      // send a prompt to trigger a model request
      p.stdin.write(JSON.stringify({ id: '2', method: 'session/send', params: { sessionId: sid, content: 'hi' } }) + '\n');
    }

    // capture the model_request event to see resolved baseURL
    if (f.method === 'session/event' && f.params && /model_request/.test(f.params.type || '')) {
      const pl = f.params.payload || {};
      if (!done) {
        done = true;
        console.log('RESOLVED baseURL:', pl.baseURL);
        console.log('providerKind:', pl.providerKind, '| model:', JSON.stringify(pl.model));
        console.log('env used -> ZCODE_MODEL:', process.env.ZCODE_MODEL || '(unset)',
          '| ZCODE_BASE_URL:', process.env.ZCODE_BASE_URL || '(unset)',
          '| ZCODE_MODEL_BASE_URL:', process.env.ZCODE_MODEL_BASE_URL || '(unset)');
        p.kill();
        process.exit(0);
      }
    }
  }
});
p.stderr.on('data', () => {});
p.stdin.write(JSON.stringify({ id: '1', method: 'session/create', params: { workspace: { workspacePath: 'E:\\_Code\\WheelMaker', workspaceKey: 'E:\\_Code\\WheelMaker' } } }) + '\n');
setTimeout(() => { if (!done) { console.log('NO model_request event in 25s'); p.kill(); process.exit(0); } }, 25000);
