// Probe message parts structure: send a prompt that produces text + tool call,
// then session/read to capture full message objects with their parts[].
const { call, proc } = globalThis.__harness;
const WS = { workspacePath: 'E:\\_Code\\WheelMaker', workspaceKey: 'E:\\_Code\\WheelMaker' };

(async () => {
  const rc = await call('session/create', { workspace: WS, mode: 'yolo' });
  const sid = rc.frames[rc.frames.length - 1].result.session.sessionId;
  await call('session/subscribe', { sessionId: sid, deliveryKind: 'desktop-continuous' });
  // prompt that forces a tool call (Read) + text reply
  await call('session/send', { sessionId: sid, content: 'Read the file CLAUDE.md and tell me the first section heading. Be brief.' });
  await new Promise(r => setTimeout(r, 25000));

  const rr = await call('session/read', { sessionId: sid });
  const msgs = rr.frames[rr.frames.length - 1].result.messages;
  console.log(`=== ${msgs.length} messages ===\n`);
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    console.log(`--- message[${i}] role=${m.info && m.info.role} parts=${m.parts.length} ---`);
    for (let j = 0; j < m.parts.length; j++) {
      const p = m.parts[j];
      // print type + key fields, truncate long content
      const summary = { ...p };
      if (summary.content && typeof summary.content === 'string' && summary.content.length > 150) summary.content = summary.content.slice(0, 150) + '…';
      console.log(`  part[${j}] keys=${Object.keys(p).join(',')} :: ${JSON.stringify(summary).slice(0, 400)}`);
    }
    console.log();
  }

  // dump one assistant message part fully to see text part shape, and one tool part
  const asst = msgs.find(m => m.info && m.info.role === 'assistant');
  if (asst) {
    console.log('=== full first assistant part ===');
    console.log(JSON.stringify(asst.parts[0], null, 2).slice(0, 800));
  }

  proc.kill();
  process.exit(0);
})();
