import {buildPromptDoneCopyRange} from '../web/src/chat/chatCopyRange';
import {
  buildResponseChatShareSnapshot,
  buildSessionChatShareSnapshot,
  type ChatShareContentOptions,
  type ChatShareSnapshotContext,
} from '../web/src/chat/share/chatShareSnapshot';
import type {RegistryChatMessage} from '../web/src/registry/registryTypes';

function message(
  turnIndex: number,
  method: string,
  param: Record<string, unknown> = {},
  sessionId = 'sess-1',
): RegistryChatMessage {
  return {sessionId, turnIndex, method, param, finished: true};
}

function context(): ChatShareSnapshotContext {
  return {
    projectId: 'hub:project',
    sessionId: 'sess-1',
    title: 'Sharing design',
    capturedAt: '2026-08-11T08:30:00.000Z',
    presentation: {
      themeMode: 'dark',
      codeTheme: 'tokyo-night',
      codeFont: 'jetbrains-mono',
      codeFontSize: 13,
      codeLineHeight: 1.6,
      codeTabSize: 2,
    },
  };
}

function phasedMessage(
  turnIndex: number,
  text: string,
  phase: 'commentary' | 'final_answer',
): RegistryChatMessage {
  return message(turnIndex, 'agent_message_chunk', {
    text,
    _meta: {wm: {messagePhase: phase}},
  });
}

describe('chat share snapshot projector', () => {
  test('hides lifecycle commentary by default for response and session snapshots', () => {
    const turns = [
      message(1, 'prompt_request', {contentBlocks: [{type: 'text', text: 'Question'}]}),
      phasedMessage(2, 'Checking the implementation.', 'commentary'),
      phasedMessage(3, 'Final answer.', 'final_answer'),
      message(4, 'prompt_done', {stopReason: 'end_turn'}),
    ];
    const options: ChatShareContentOptions = {messageLifecycleSupported: true, includeWorkDetails: false};

    const response = buildResponseChatShareSnapshot(turns, 4, context(), options);
    const session = buildSessionChatShareSnapshot(turns, context(), options);

    expect(response?.entries[0].markdown).toBe('Final answer.');
    expect(session?.entries.find(entry => entry.role === 'assistant')?.markdown).toBe('Final answer.');
  });

  test('includes only commentary and final-answer messages when work details are selected', () => {
    const turns = [
      message(1, 'prompt_request', {contentBlocks: [{type: 'text', text: 'Question'}]}),
      phasedMessage(2, 'Checking the implementation.', 'commentary'),
      message(3, 'agent_message_chunk', {text: 'Unphased internal text'}),
      message(4, 'agent_thought_chunk', {text: 'Hidden thought'}),
      message(5, 'tool_call', {text: 'Hidden tool'}),
      phasedMessage(6, 'Final answer.', 'final_answer'),
      message(7, 'prompt_done', {stopReason: 'end_turn'}),
    ];
    const options: ChatShareContentOptions = {messageLifecycleSupported: true, includeWorkDetails: true};

    const response = buildResponseChatShareSnapshot(turns, 7, context(), options);
    const session = buildSessionChatShareSnapshot(turns, context(), options);

    expect(response?.entries[0].markdown).toBe('Checking the implementation.\n\nFinal answer.');
    expect(session?.entries.find(entry => entry.role === 'assistant')?.markdown).toBe(
      'Checking the implementation.\n\nFinal answer.',
    );
    expect(JSON.stringify(session)).not.toMatch(/Unphased internal text|Hidden thought|Hidden tool/);
  });

  test('keeps unsupported sessions unchanged regardless of the work-details value', () => {
    const turns = [
      message(1, 'prompt_request', {contentBlocks: [{type: 'text', text: 'Question'}]}),
      phasedMessage(2, 'Checking the implementation.', 'commentary'),
      phasedMessage(3, 'Final answer.', 'final_answer'),
      message(4, 'prompt_done', {stopReason: 'end_turn'}),
    ];
    const options: ChatShareContentOptions = {messageLifecycleSupported: false, includeWorkDetails: false};

    const response = buildResponseChatShareSnapshot(turns, 4, context(), options);
    const session = buildSessionChatShareSnapshot(turns, context(), options);

    expect(response?.entries[0].markdown).toBe('Checking the implementation.\n\nFinal answer.');
    expect(session?.entries.find(entry => entry.role === 'assistant')?.markdown).toBe(
      'Checking the implementation.\n\nFinal answer.',
    );
  });

  test('falls back to the last assistant message when lifecycle history has no phase metadata', () => {
    const turns = [
      message(1, 'prompt_request', {contentBlocks: [{type: 'text', text: 'Question'}]}),
      message(2, 'agent_message_chunk', {text: 'Legacy progress'}),
      message(3, 'agent_message_chunk', {text: 'Legacy final'}),
      message(4, 'prompt_done', {stopReason: 'end_turn'}),
    ];

    const hidden = buildSessionChatShareSnapshot(turns, context(), {
      messageLifecycleSupported: true,
      includeWorkDetails: false,
    });
    const included = buildSessionChatShareSnapshot(turns, context(), {
      messageLifecycleSupported: true,
      includeWorkDetails: true,
    });

    expect(hidden?.entries.find(entry => entry.role === 'assistant')?.markdown).toBe('Legacy final');
    expect(included?.entries.find(entry => entry.role === 'assistant')?.markdown).toBe(
      'Legacy progress\n\nLegacy final',
    );
  });

  test('projects a current response with the existing copy range semantics', () => {
    const turns = [
      message(1, 'prompt_request', {contentBlocks: [{type: 'text', text: 'Question'}]}),
      message(2, 'agent_thought_chunk', {text: 'hidden'}),
      message(3, 'agent_message_chunk', {text: 'First paragraph.'}),
      message(4, 'tool_call', {text: 'hidden tool'}),
      message(5, 'agent_plan', {entries: [{content: 'hidden plan'}]}),
      message(6, 'agent_message_chunk', {text: '- item one\n- item two'}),
      message(7, 'prompt_done', {stopReason: 'end_turn'}),
    ];

    const copy = buildPromptDoneCopyRange(turns, 7);
    const snapshot = buildResponseChatShareSnapshot(turns, 7, context());

    expect(copy.ok).toBe(true);
    expect(snapshot).toEqual({
      scope: 'response',
      projectId: 'hub:project',
      sessionId: 'sess-1',
      terminalTurnIndex: 7,
      title: 'Sharing design',
      capturedAt: '2026-08-11T08:30:00.000Z',
      presentation: context().presentation,
      entries: [{
        role: 'assistant',
        markdown: copy.ok ? copy.markdown : '',
        attachments: [],
        startTurnIndex: copy.ok ? copy.startTurnIndex : 0,
        endTurnIndex: copy.ok ? copy.endTurnIndex : 0,
      }],
    });
  });

  test('pairs completed prompt ranges and omits controls and a live tail', () => {
    const snapshot = buildSessionChatShareSnapshot([
      message(9, 'prompt_done', {stopReason: 'end_turn'}),
      message(1, 'prompt_request', {contentBlocks: [{type: 'text', text: 'First question'}]}),
      message(2, 'agent_thought_chunk', {text: 'hidden thought'}),
      message(3, 'agent_message_chunk', {text: 'First answer'}),
      message(4, 'prompt_done', {stopReason: 'end_turn'}),
      message(5, 'user_message_chunk', {contentBlocks: [{type: 'text', text: 'Second question'}]}),
      message(6, 'permission_request', {text: 'hidden permission'}),
      message(7, 'agent_message_chunk', {text: 'Second answer'}),
      message(8, 'session_operation', {message: 'hidden operation'}),
      message(10, 'prompt_request', {contentBlocks: [{type: 'text', text: 'Streaming question'}]}),
      {...message(11, 'agent_message_chunk', {text: 'unfinished output'}), finished: false},
    ], context());

    expect(snapshot?.entries).toEqual([
      {role: 'user', markdown: 'First question', attachments: [], startTurnIndex: 1, endTurnIndex: 4},
      {role: 'assistant', markdown: 'First answer', attachments: [], startTurnIndex: 1, endTurnIndex: 4},
      {role: 'user', markdown: 'Second question', attachments: [], startTurnIndex: 5, endTurnIndex: 9},
      {role: 'assistant', markdown: 'Second answer', attachments: [], startTurnIndex: 5, endTurnIndex: 9},
    ]);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('hidden thought');
    expect(serialized).not.toContain('hidden permission');
    expect(serialized).not.toContain('hidden operation');
    expect(serialized).not.toContain('unfinished output');
  });

  test('retains public terminal statuses with partial or empty assistant output', () => {
    const snapshot = buildSessionChatShareSnapshot([
      message(1, 'prompt_request', {contentBlocks: [{type: 'text', text: 'One'}]}),
      message(2, 'agent_message_chunk', {text: 'Partial one'}),
      message(3, 'prompt_done', {stopReason: 'failed', message: 'private provider detail'}),
      message(4, 'user_message_chunk', {contentBlocks: [{type: 'text', text: 'Two'}]}),
      message(5, 'agent_message_chunk', {text: 'Partial two'}),
      message(6, 'prompt_done', {stopReason: 'canceled'}),
      message(7, 'prompt_request', {contentBlocks: [{type: 'text', text: 'Three'}]}),
      message(8, 'prompt_done', {stopReason: 'interrupted'}),
    ], context());

    expect(snapshot?.entries.filter(entry => entry.role === 'assistant')).toEqual([
      {role: 'assistant', markdown: 'Partial one', attachments: [], status: 'failed', startTurnIndex: 1, endTurnIndex: 3},
      {role: 'assistant', markdown: 'Partial two', attachments: [], status: 'cancelled', startTurnIndex: 4, endTurnIndex: 6},
      {role: 'assistant', markdown: '', attachments: [], status: 'interrupted', startTurnIndex: 7, endTurnIndex: 8},
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('private provider detail');
  });

  test('skips gap, missing-turn, and orphan ranges while preserving valid ranges', () => {
    const snapshot = buildSessionChatShareSnapshot([
      message(1, 'prompt_request', {contentBlocks: [{type: 'text', text: 'Keep one'}]}),
      message(2, 'agent_message_chunk', {text: 'Answer one'}),
      message(3, 'prompt_done', {stopReason: 'end_turn'}),
      message(4, 'prompt_request', {contentBlocks: [{type: 'text', text: 'Drop gap'}]}),
      message(5, 'session/gap', {reason: 'missing_turn'}),
      message(6, 'prompt_done', {stopReason: 'failed'}),
      message(7, 'prompt_request', {contentBlocks: [{type: 'text', text: 'Drop missing'}]}),
      message(9, 'prompt_done', {stopReason: 'end_turn'}),
      message(10, 'agent_message_chunk', {text: 'orphan assistant'}),
      message(11, 'prompt_done', {stopReason: 'end_turn'}),
      message(12, 'prompt_request', {contentBlocks: [{type: 'text', text: 'Keep two'}]}),
      message(13, 'agent_message_chunk', {text: 'Answer two'}),
      message(14, 'prompt_done', {stopReason: 'end_turn'}),
    ], context());

    expect(snapshot?.entries.map(entry => entry.markdown)).toEqual([
      'Keep one',
      'Answer one',
      'Keep two',
      'Answer two',
    ]);
  });

  test('copies source presentation and reduces attachments to detached labels', () => {
    const mutableContext = context();
    const blocks = [
      {type: 'text', text: 'Review these'},
      {type: 'resource_link', name: 'report.pdf', uri: 'file:///secret/report.pdf', size: 42},
      {type: 'image', data: 'private-base64', mimeType: 'image/png'},
      {type: 'resource_link', uri: 'file:///secret/unnamed.bin'},
    ];
    const turns = [
      message(1, 'prompt_request', {contentBlocks: blocks}),
      message(2, 'agent_message_chunk', {text: 'Reviewed'}),
      message(3, 'prompt_done', {stopReason: 'end_turn'}),
    ];

    const snapshot = buildSessionChatShareSnapshot(turns, mutableContext);
    mutableContext.title = 'Changed later';
    mutableContext.presentation.codeFontSize = 99;
    blocks[0].text = 'Changed prompt';
    blocks[1].name = 'changed.pdf';

    expect(snapshot).toMatchObject({
      scope: 'session',
      projectId: 'hub:project',
      sessionId: 'sess-1',
      title: 'Sharing design',
      capturedAt: '2026-08-11T08:30:00.000Z',
      presentation: {
        themeMode: 'dark',
        codeTheme: 'tokyo-night',
        codeFont: 'jetbrains-mono',
        codeFontSize: 13,
        codeLineHeight: 1.6,
        codeTabSize: 2,
      },
    });
    expect(snapshot?.entries[0]).toEqual({
      role: 'user',
      markdown: 'Review these',
      attachments: [
        {kind: 'file', label: 'report.pdf'},
        {kind: 'image', label: 'Image attachment'},
        {kind: 'file', label: 'File attachment'},
      ],
      startTurnIndex: 1,
      endTurnIndex: 3,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/private-base64|file:\/\/\/secret|changed\.pdf|Changed prompt|\bdata\b|\buri\b/);
  });
});
