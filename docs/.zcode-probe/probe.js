// Interactive probe harness for `zcode app-server`.
// Spawns the CLI, lets us call methods over the wire protocol, and captures
// every inbound frame (response + async notification/server-request) between
// a request and its reply.
//
// Usage:
//   node probe.js                       // interactive REPL: type method@json
//   node probe.js <script-file>         // run a scripted probe
//
// Probe protocol note (discovered earlier): ZCode Protocol is JSON-RPC 2.0 in
// semantics but the wire frames MUST OMIT the "jsonrpc":"2.0" key (sending it
// is rejected as an unrecognized key by a zod schema). Frames carry id/method/
// params for requests, id/result or id/error for responses.

const { spawn } = require('child_process');
const fs = require('fs');
const readline = require('readline');

const ZCODE_CJS = process.env.ZCODE_CJS ||
  require('path').join(process.env.LOCALAPPDATA, 'Programs', 'ZCode', 'resources', 'glm', 'zcode.cjs');

const WORKDIR = process.env.WORKDIR || 'E:\\_Code\\WheelMaker';

// Build the model-provider env for the app-server child WITHOUT touching any
// user config file. We reuse the apiKey already stored (in clear) in the
// desktop's ~/.zcode/v2/config.json under provider "builtin:zai". The key is
// injected only into the child's env and never printed or written to disk.
function buildModelEnv() {
  const env = {};
  if (process.env.ZCODE_API_KEY) {
    // explicit override
    env.ZCODE_API_KEY = process.env.ZCODE_API_KEY;
    env.ZCODE_MODEL = process.env.ZCODE_MODEL || 'zai/glm-5.2';
    env.ZCODE_MODEL_BASE_URL = process.env.ZCODE_MODEL_BASE_URL || 'https://api.z.ai/api/anthropic';
    return env;
  }
  try {
    const homedir = require('os').homedir();
    const cfgPath = require('path').join(homedir, '.zcode', 'v2', 'config.json');
    const cfg = JSON.parse(require('fs').readFileSync(cfgPath, 'utf8'));
    const zai = cfg && cfg.provider && cfg.provider['builtin:zai'];
    const key = zai && zai.options && zai.options.apiKey;
    if (key && zai.enabled) {
      env.ZCODE_API_KEY = key;
      env.ZCODE_MODEL = process.env.ZCODE_MODEL || 'zai/glm-5.2';
      env.ZCODE_MODEL_BASE_URL = zai.options.baseURL || 'https://api.z.ai/api/anthropic';
    }
  } catch (e) {
    process.stderr.write(`[probe] could not read desktop zai key: ${e.message}\n`);
  }
  return env;
}

const modelEnv = buildModelEnv();
const proc = spawn(process.execPath, [ZCODE_CJS, 'app-server', '--cwd', WORKDIR], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NO_COLOR: '1', ...modelEnv },
});
if (modelEnv.ZCODE_API_KEY) {
  process.stderr.write(`[probe] model env injected: model=${modelEnv.ZCODE_MODEL} baseURL=${modelEnv.ZCODE_MODEL_BASE_URL} key=<${modelEnv.ZCODE_API_KEY.length} chars>\n`);
}

let nextId = 1;
const pending = new Map(); // id -> {resolve, frames}
let bufIn = '';

proc.stdout.setEncoding('utf8');
proc.stderr.setEncoding('utf8');

// line-delimited JSON on stdout
proc.stdout.on('data', (chunk) => {
  bufIn += chunk;
  let nl;
  while ((nl = bufIn.indexOf('\n')) >= 0) {
    const line = bufIn.slice(0, nl).trim();
    bufIn = bufIn.slice(nl + 1);
    if (!line) continue;
    handleFrame(line);
  }
});

proc.stderr.on('data', (chunk) => {
  process.stderr.write(`[stderr] ${chunk}`);
});

function handleFrame(line) {
  let frame;
  try { frame = JSON.parse(line); } catch (e) {
    console.log(`[non-JSON stdout] ${line}`);
    return;
  }
  // route by shape
  if (('result' in frame || 'error' in frame) && 'id' in frame && frame.id !== 'invalid-message') {
    const p = pending.get(frame.id);
    if (p) {
      p.frames.push(frame);
      pending.delete(frame.id);
      p.resolve();
    } else {
      console.log(`[orphan response] ${JSON.stringify(frame)}`);
    }
  } else if ('method' in frame) {
    // async notification or server-initiated request -> push to global tap
    eventTap.push(frame);
    for (const p of pending.values()) p.frames.push(frame);
  } else {
    console.log(`[other] ${shorten(line)}`);
  }
}

// Global async-event tap. Scripts read/clear this to inspect the stream.
const eventTap = [];
globalThis.__events = eventTap;

function shorten(s, n = 1200) {
  return s.length > n ? s.slice(0, n) + ` …(+${s.length - n} bytes)` : s;
}

// Send a request (no jsonrpc key) and await its response, capturing all frames
// that arrive in the meantime. Returns {frames, response}.
function call(method, params = {}, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const id = String(nextId++);
    const entry = { frames: [], resolve: null };
    pending.set(id, entry);
    const frame = { id, method, params };
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for response to ${method} (id=${id})`));
      }
    }, timeout);
    entry.resolve = () => { clearTimeout(timer); resolve(entry); };
    const out = JSON.stringify(frame) + '\n';
    if (process.env.DEBUG) process.stderr.write(`[send] ${out}`);
    proc.stdin.write(out);
  });
}

function jlog(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

// expose for scripts
module.exports.__call = call;
module.exports.__proc = proc;

async function repl() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`# probe ready. zcode app-server pid=${proc.pid}`);
  console.log('# commands:  method@{"k":"v"}   |   raw {...}   |   wait   |   exit');
  for await (const line of rl) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    if (t === 'exit' || t === 'quit') break;
    if (t === 'wait') { await new Promise((r) => setTimeout(r, 5000)); continue; }
    try {
      if (t.startsWith('raw ')) {
        proc.stdin.write(t.slice(4).trim() + '\n');
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      const at = t.indexOf('@');
      const method = at >= 0 ? t.slice(0, at) : t;
      const params = at >= 0 ? JSON.parse(t.slice(at + 1)) : {};
      const entry = await call(method, params);
      const resp = entry.frames[entry.frames.length - 1];
      console.log(`=> response:`);
      jlog(resp);
    } catch (e) { console.log(`! ${e.message}`); }
  }
  proc.kill();
}

// If a script file is given, require it and pass the harness API.
const arg = process.argv[2];
if (!arg) {
  repl();
} else if (arg.endsWith('.js')) {
  globalThis.__harness = { call, jlog, shorten, proc, events: eventTap };
  require(require('path').resolve(arg));
} else {
  console.log('unknown arg');
  proc.kill();
}

proc.on('exit', (code) => console.log(`# app-server exited code=${code}`));
