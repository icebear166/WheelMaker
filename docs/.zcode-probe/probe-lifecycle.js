// Probe 8: complete the lifecycle method schema map (no model calls needed).
// For each method, send minimal params to elicit the zod "missing field" error,
// which reveals required fields. Also probe session/create optional fields.

const { call, jlog, proc } = globalThis.__harness;
const WS = { workspacePath: 'E:\\_Code\\WheelMaker', workspaceKey: 'E:\\_Code\\WheelMaker' };

function fields(resp) {
  const err = resp && resp.error;
  if (!err || !err.data || !err.data.message) return '(ok or no zod detail)';
  const paths = [...err.data.message.matchAll(/"path":\s*\[([^\]]*)\]/g)]
    .map((m) => m[1].replace(/"/g, ''));
  const uniq = [...new Set(paths.filter(Boolean).map((p) => p.split(',').pop().trim()))];
  return uniq.length ? `missing=[${uniq.join(',')}]` : '(no missing fields)';
}

(async () => {
  // create a real session first
  const r0 = await call('session/create', { workspace: WS });
  const sid = r0.frames[r0.frames.length - 1].result.session.sessionId;
  console.log('sessionId =', sid);

  console.log('\n=== session/create optional fields (mode/model/permission/initialPrompt) ===');
  for (const extra of [
    { workspace: WS, mode: 'yolo' },
    { workspace: WS, mode: 'invalid' },
    { workspace: WS, model: 'myzai/glm-5.2' },
    { workspace: WS, permission: 'yolo' },
    { workspace: WS, initialPrompt: 'hi' },
    { workspace: WS, content: 'hi' },
  ]) {
    const r = await call('session/create', extra, { timeout: 8000 });
    const last = r.frames[r.frames.length - 1];
    const err = last.error;
    console.log(`  create + ${JSON.stringify(Object.keys(extra)).slice(1, -1).replace('workspace,','')}: ${err ? fields(last) + ' (' + err.message + ')' : 'OK result.sessionId=' + (last.result&&last.result.session&&last.result.session.sessionId)}`);
  }

  console.log('\n=== lifecycle methods param schemas (use real sid where string expected) ===');
  const probes = [
    ['session/read', {}],
    ['session/read', { sessionId: sid }],
    ['session/cancel', {}],
    ['session/cancel', { sessionId: sid }],
    ['session/stop', {}],
    ['session/stop', { sessionId: sid }],
    ['session/steer', {}],
    ['session/steer', { sessionId: sid }],
    ['session/rewind', {}],
    ['session/rewind', { sessionId: sid }],
    ['session/setMode', {}],
    ['session/setMode', { sessionId: sid }],
    ['session/events', {}],
    ['session/events', { sessionId: sid }],
    ['session/resume', {}],
    ['session/resume', { sessionId: sid }],
    ['session/list', {}],
    ['session/delete', {}],
    ['session/delete', { sessionId: sid }],
  ];
  for (const [m, p] of probes) {
    try {
      const r = await call(m, p, { timeout: 8000 });
      const last = r.frames[r.frames.length - 1];
      const err = last.error;
      if (err && err.code === -32601) { console.log(`  ${m.padEnd(20)} n/a`); continue; }
      if (err) { console.log(`  ${m.padEnd(20)} ${fields(last)}`); }
      else { console.log(`  ${m.padEnd(20)} OK: ${JSON.stringify(last.result).slice(0, 100)}`); }
    } catch (e) { console.log(`  ${m.padEnd(20)} TIMEOUT`); }
  }

  proc.kill();
  process.exit(0);
})();
