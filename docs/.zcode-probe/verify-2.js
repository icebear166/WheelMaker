// Verify suite 2: send success loop, lifecycle methods, method-not-found enumeration.
const { call, proc, events } = globalThis.__harness;
const WS = { workspacePath: 'E:\\_Code\\WheelMaker', workspaceKey: 'E:\\_Code\\WheelMaker' };
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' :: ' + detail : ''}`); }
}

(async () => {
  console.log('\n########## 5. session/send success loop ##########');
  const rc = await call('session/create', { workspace: WS, mode: 'yolo' });
  const sid = rc.frames[rc.frames.length - 1].result.session.sessionId;
  const rs = await call('session/subscribe', { sessionId: sid, deliveryKind: 'desktop-continuous' });
  check('subscribe returns eventSeq + events array',
    rs.frames[rs.frames.length - 1].result &&
    'eventSeq' in rs.frames[rs.frames.length - 1].result &&
    Array.isArray(rs.frames[rs.frames.length - 1].result.events));

  events.length = 0;
  const sresp = await call('session/send', { sessionId: sid, content: 'Reply with exactly PONG. No tools.' });
  const sr = sresp.frames[sresp.frames.length - 1].result;
  check('send returns accepted:true', sr && sr.accepted === true);
  check('send returns sessionId', sr && sr.sessionId === sid);
  check('send returns stateRevision (number>0)', sr && typeof sr.stateRevision === 'number' && sr.stateRevision > 0);

  await new Promise((r) => setTimeout(r, 25000));

  const types = {};
  for (const f of events) { const t = (f.params && f.params.type) || f.method; types[t] = (types[t] || 0) + 1; }
  console.log('  event types seen:', JSON.stringify(types));
  check('event stream includes turn.started', !!types['turn.started']);
  check('event stream includes model.streaming', !!types['model.streaming']);
  check('event stream includes turn.completed', !!types['turn.completed']);
  check('event stream includes state.updated', !!types['state.updated']);

  // streaming payload shape
  const streamEvt = events.find((f) => f.params && f.params.type === 'model.streaming');
  if (streamEvt) {
    const pl = streamEvt.params.payload;
    check('model.streaming payload has kind=text_delta', pl && pl.kind === 'text_delta', JSON.stringify(pl));
    check('model.streaming payload has delta string', pl && typeof pl.delta === 'string');
    check('model.streaming payload has assistantMessageId', pl && typeof pl.assistantMessageId === 'string');
  } else { check('model.streaming payload shape', false, 'no streaming event'); }

  // completed payload shape
  const compEvt = events.find((f) => f.params && f.params.type === 'turn.completed');
  if (compEvt) {
    const pl = compEvt.params.payload;
    check('turn.completed payload.resultType === success', pl && pl.resultType === 'success');
    check('turn.completed payload has response string', pl && typeof pl.response === 'string');
    check('turn.completed payload has usage object', pl && pl.usage && typeof pl.usage === 'object');
    check('turn.completed payload has toolCallCount', pl && typeof pl.toolCallCount === 'number');
    check('response contains PONG', pl && /PONG/i.test(pl.response), pl && pl.response);
  } else { check('turn.completed payload shape', false, 'no completed event'); }

  // seq monotonic on session/event
  const seqs = events.filter((f) => f.params && f.params.seq).map((f) => f.params.seq);
  const mono = seqs.every((v, i) => i === 0 || v > seqs[i - 1]);
  check('session/event seq is monotonically increasing', seqs.length > 0 && mono, JSON.stringify(seqs));

  console.log('\n########## 6. session/read shows history after send ##########');
  const rr = await call('session/read', { sessionId: sid });
  const msgs = rr.frames[rr.frames.length - 1].result.messages;
  console.log(`  messages after 1 turn: ${msgs.length}`);
  check('read returns >=1 message after send', msgs.length >= 1);
  if (msgs.length) {
    console.log('  sample message keys:', Object.keys(msgs[0]));
    check('message has role/id or type field', msgs[0].role || msgs[0].type || msgs[0].kind, JSON.stringify(msgs[0]).slice(0, 200));
  }

  console.log('\n########## 7. session/setMode ##########');
  // session.mode is fixed; setMode should change permission mode
  const rm1 = await call('session/setMode', { sessionId: sid, mode: 'plan' });
  const rm1r = rm1.frames[rm1.frames.length - 1];
  console.log('  setMode plan ->', rm1r.error ? ('ERR ' + rm1r.error.code) : 'OK', JSON.stringify(rm1r.result || '').slice(0, 200));
  const rm2 = await call('session/setMode', { sessionId: sid, mode: 'bogus' });
  check('setMode invalid mode rejected', rm2.frames[rm2.frames.length - 1].error, 'expected error');

  console.log('\n########## 8. session/events (pull after seq) ##########');
  const rev = await call('session/events', { sessionId: sid });
  const revr = rev.frames[rev.frames.length - 1].result;
  check('events returns array', revr && Array.isArray(revr.events), JSON.stringify(revr));
  check('events returns previously emitted events count > 0', revr && revr.events.length > 0);

  console.log(`\n=== SUITE 2 RESULT: ${pass} passed, ${fail} failed ===`);
  proc.kill();
  process.exit(0);
})();
