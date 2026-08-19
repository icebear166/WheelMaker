import {
  buildChatDisplayIndex,
  chatDisplayItemContainsTurn,
  combineAssistantGroupMessages,
  resolveActiveToolGroupKey,
  resolveChatDisplayScrollIndex,
} from '../web/src/chat/turns/chatDisplayIndex';
import type {RegistryChatMessage} from '../web/src/registry/registryTypes';
import {deriveChatPermissionState} from '../web/src/chat/permission/chatPermissionState';

function message(
  turnIndex: number,
  method: string,
  text: string,
  finished = true,
): RegistryChatMessage {
  return {
    sessionId: 'sess-1',
    turnIndex,
    method,
    param: {text},
    finished,
  };
}

function toolMessage(
  turnIndex: number,
  cmd: string,
  status = 'completed',
): RegistryChatMessage {
  return {
    sessionId: 'sess-1',
    turnIndex,
    method: 'tool_call',
    param: {cmd, kind: 'read', status},
    finished: true,
  };
}

function phasedMessage(
  turnIndex: number,
  text: string,
  phase: 'commentary' | 'final_answer',
  finished = true,
): RegistryChatMessage {
  return {
    sessionId: 'sess-1',
    turnIndex,
    method: 'agent_message_chunk',
    param: {_meta: {wm: {messagePhase: phase}}, text},
    finished,
  };
}

function promptMessage(turnIndex: number, createdAt = '2026-08-02T00:00:00Z'): RegistryChatMessage {
  const prompt = message(turnIndex, 'prompt_request', 'run');
  prompt.param = {createdAt, text: 'run'};
  return prompt;
}

function doneMessage(
  turnIndex: number,
  stopReason = 'end_turn',
  completedAt = '2026-08-02T00:00:20Z',
): RegistryChatMessage {
  const done = message(turnIndex, 'prompt_done', '');
  done.param = {completedAt, stopReason};
  return done;
}

describe('chat display index', () => {
  test('folds a permission response into one compact request item and hides pending requests', () => {
    const pendingMessages: RegistryChatMessage[] = [
      message(1, 'prompt_request', 'run'),
      {sessionId: 'sess-1', turnIndex: 2, method: 'permission_request', param: {permissionId: 'perm-1'}, finished: true},
    ];
    const pendingState = deriveChatPermissionState(pendingMessages);
    expect(buildChatDisplayIndex(pendingMessages, {permissionState: pendingState}).items.map(item => item.turnIndex)).toEqual([1]);

    const resolvedMessages: RegistryChatMessage[] = [
      ...pendingMessages,
      {sessionId: 'sess-1', turnIndex: 3, method: 'permission_response', param: {
        permissionId: 'perm-1', requestTurnIndex: 2, outcome: 'selected', optionId: 'allow', optionName: 'Allow',
      }, finished: true},
    ];
    const resolvedState = deriveChatPermissionState(resolvedMessages);
    const index = buildChatDisplayIndex(resolvedMessages, {
      permissionState: resolvedState,
      shouldRender: () => false,
    });
    expect(index.items.map(item => item.turnIndex)).toEqual([2]);
    expect(index.items[0]).toMatchObject({kind: 'turn', compact: true, estimatedHeight: 36});
  });

  test('stores lightweight sorted render metadata without copying message content', () => {
    const source = [
      message(3, 'prompt_done', 'done'),
      message(1, 'prompt_request', 'hello'),
      message(2, 'agent_message_chunk', 'assistant answer'),
    ];

    const index = buildChatDisplayIndex(source);

    expect(index.items.map(item => item.turnIndex)).toEqual([1, 2, 3]);
    expect(index.items.map(item => item.sourceIndex)).toEqual([1, 2, 0]);
    expect(Object.keys(index.items[0]).sort()).toEqual([
      'endTurnIndex',
      'estimatedHeight',
      'key',
      'kind',
      'sourceIndex',
      'sourceIndexes',
      'turnIndex',
    ]);
  });

  test('filters hidden turns and appends pending turn metadata', () => {
    const source = [
      message(1, 'prompt_request', 'hello'),
      message(2, 'tool_result', 'tool output'),
    ];

    const index = buildChatDisplayIndex(source, {
      shouldRender: turn => turn.method !== 'tool_result',
      pendingKey: 'pending-1',
      pendingEstimatedHeight: 88,
    });

    expect(index.items.map(item => item.kind)).toEqual(['turn', 'pending']);
    expect(index.items.map(item => item.key)).toEqual([
      'sess-1:1:prompt_request',
      'pending-1',
    ]);
  });

  test('uses turn type and layout width when estimating dynamic chat heights', () => {
    const assistantText = [
      'This is a long assistant response that should wrap differently depending on the chat column width.',
      '',
      'A second paragraph keeps markdown-style block spacing in the estimate.',
    ].join('\n');
    const wide = buildChatDisplayIndex([message(1, 'agent_message_chunk', assistantText)], {
      layoutMetrics: {contentWidth: 900},
    });
    const narrow = buildChatDisplayIndex([message(1, 'agent_message_chunk', assistantText)], {
      layoutMetrics: {contentWidth: 320},
    });

    expect(narrow.items[0].estimatedHeight).toBeGreaterThan(wide.items[0].estimatedHeight);
  });

  test('uses ordinary Markdown height for recognized choices and confirmations', () => {
    const choiceText = [
      'A. Alpha  ',
      'B. Bravo  ',
      'C. Cedar',
    ].join('\n');
    const sameShapeText = [
      'X. Alpha  ',
      'Y. Bravo  ',
      'Z. Cedar',
    ].join('\n');
    const confirmationText = '确认继续吗？';
    const sameLengthText = '现在继续吧。';

    const choice = buildChatDisplayIndex([
      message(1, 'agent_message_chunk', choiceText),
    ]);
    const sameShape = buildChatDisplayIndex([
      message(1, 'agent_message_chunk', sameShapeText),
    ]);
    const confirmation = buildChatDisplayIndex([
      message(1, 'agent_message_chunk', confirmationText),
    ]);
    const sameLength = buildChatDisplayIndex([
      message(1, 'agent_message_chunk', sameLengthText),
    ]);

    expect(choice.items[0].estimatedHeight).toBe(sameShape.items[0].estimatedHeight);
    expect(confirmation.items[0].estimatedHeight).toBe(sameLength.items[0].estimatedHeight);
  });

  test('groups consecutive tool calls with a stable first-turn key and fixed estimate', () => {
    const source = [
      message(1, 'prompt_request', 'hello'),
      toolMessage(2, 'Read a'),
      toolMessage(3, 'Read b', 'in_progress'),
      message(4, 'agent_thought_chunk', 'thinking'),
      toolMessage(5, 'Run tests'),
    ];
    const index = buildChatDisplayIndex(source);

    expect(index.items.map(item => item.kind)).toEqual([
      'turn',
      'tool-group',
      'turn',
      'tool-group',
    ]);
    expect(index.items[1]).toMatchObject({
      key: 'sess-1:2:tool-group',
      turnIndex: 2,
      endTurnIndex: 3,
      sourceIndex: 1,
      sourceIndexes: [1, 2],
      estimatedHeight: 28,
    });
    expect(index.items[1].estimatedHeight).toBe(index.items[3].estimatedHeight);
  });

  test('keeps a tool group open across hidden empty thinking turns', () => {
    const source = [
      message(1, 'prompt_request', 'hello'),
      toolMessage(2, 'Read a'),
      message(3, 'agent_thought_chunk', ' \n\t'),
      toolMessage(4, 'Read b'),
      message(5, 'agent_thought_chunk', 'visible reasoning'),
      toolMessage(6, 'Run tests'),
    ];
    const index = buildChatDisplayIndex(source, {
      shouldRender: message => message.method !== 'agent_thought_chunk' || Boolean(message.param.text.trim()),
    });

    expect(index.items.map(item => item.kind)).toEqual([
      'turn',
      'tool-group',
      'turn',
      'tool-group',
    ]);
    expect(index.items[1]).toMatchObject({
      key: 'sess-1:2:tool-group',
      turnIndex: 2,
      endTurnIndex: 4,
      sourceIndexes: [1, 3],
      compact: true,
    });
    expect(index.items[2]).toMatchObject({compact: true});
    expect(index.items[3]).toMatchObject({sourceIndexes: [5]});
  });

  test('activates only a tail tool group while its prompt is running', () => {
    const tailToolIndex = buildChatDisplayIndex([
      message(1, 'prompt_request', 'hello'),
      toolMessage(2, 'Read a'),
    ], {
      queuedKeys: ['queued-1'],
    });
    const followedByThinking = buildChatDisplayIndex([
      message(1, 'prompt_request', 'hello'),
      toolMessage(2, 'Read a'),
      message(3, 'agent_thought_chunk', 'checking result'),
    ]);

    expect(resolveActiveToolGroupKey(tailToolIndex, true)).toBe('sess-1:2:tool-group');
    expect(resolveActiveToolGroupKey(tailToolIndex, false)).toBe('');
    expect(resolveActiveToolGroupKey(followedByThinking, true)).toBe('');
  });

  test('keeps structured plan updates out of the ordinary chat turn list', () => {
    const plan = message(2, 'agent_plan', '');
    plan.param = {
      entries: [
        {content: 'Inspect files', status: 'completed'},
        {content: 'Patch UI', status: 'in_progress'},
      ],
    };
    const index = buildChatDisplayIndex([
      message(1, 'prompt_request', 'hello'),
      plan,
      message(3, 'agent_message_chunk', 'answer'),
    ]);

    expect(index.items.map(item => item.turnIndex)).toEqual([1, 3]);
  });

  test('resolves grouped tool turns to the same display item', () => {
    const source = [
      message(1, 'prompt_request', 'hello'),
      toolMessage(2, 'Read a'),
      toolMessage(3, 'Read b'),
      message(4, 'agent_message_chunk', 'answer'),
    ];
    const index = buildChatDisplayIndex(source);

    expect(resolveChatDisplayScrollIndex(index, 1)).toBe(0);
    expect(resolveChatDisplayScrollIndex(index, 2)).toBe(1);
    expect(resolveChatDisplayScrollIndex(index, 3)).toBe(1);
    expect(resolveChatDisplayScrollIndex(index, 5)).toBe(2);
    expect(chatDisplayItemContainsTurn(index.items[1], 3)).toBe(true);
    expect(resolveChatDisplayScrollIndex({items: []}, 1)).toBe(null);
  });

  test('coalesces adjacent phased assistant turns while prompt is running', () => {
    const source = [
      promptMessage(1),
      phasedMessage(2, 'work', 'commentary'),
      phasedMessage(3, 'done', 'final_answer', false),
    ];

    const index = buildChatDisplayIndex(source, {collapseCompletedWork: true});

    expect(index.items.map(item => item.kind)).toEqual(['turn', 'assistant-group']);
    expect(index.items[1]).toMatchObject({
      key: 'sess-1:2:agent_message_chunk',
      turnIndex: 2,
      endTurnIndex: 3,
      sourceIndexes: [1, 2],
    });
    expect(combineAssistantGroupMessages(source.slice(1))?.param.text).toBe('workdone');
  });

  test('collapses completed phased work but leaves final answer and done outside', () => {
    const source = [
      promptMessage(1),
      phasedMessage(2, 'checking', 'commentary'),
      message(3, 'agent_thought_chunk', 'reasoning'),
      toolMessage(4, 'Read a'),
      toolMessage(5, 'Run tests'),
      phasedMessage(6, 'final', 'final_answer'),
      doneMessage(7),
    ];

    const index = buildChatDisplayIndex(source, {collapseCompletedWork: true});

    expect(index.items.map(item => item.kind)).toEqual(['turn', 'work-group', 'turn', 'turn']);
    expect(index.items[1]).toMatchObject({
      key: 'sess-1:1:7:work-group',
      turnIndex: 2,
      endTurnIndex: 5,
      sourceIndexes: [1, 2, 3, 4],
      workStatus: 'worked',
      durationMs: 20_000,
      compact: true,
      estimatedHeight: 28,
    });
    expect(index.items[1].childItems?.map(item => item.kind)).toEqual(['turn', 'turn', 'tool-group']);
    expect(index.items[2].sourceIndex).toBe(5);
    expect(index.items[3].sourceIndex).toBe(6);
    expect(chatDisplayItemContainsTurn(index.items[1], 5)).toBe(true);
    expect(resolveChatDisplayScrollIndex(index, 4)).toBe(1);
  });

  test.each([
    ['failed', 'failed'],
    ['cancelled', 'stopped'],
    ['interrupted', 'stopped'],
  ])('collapses no-final %s prompts with %s status', (stopReason, workStatus) => {
    const source = [
      promptMessage(1),
      phasedMessage(2, 'working', 'commentary'),
      toolMessage(3, 'Run tests', stopReason === 'failed' ? 'failed' : 'completed'),
      doneMessage(4, stopReason),
    ];

    const index = buildChatDisplayIndex(source, {collapseCompletedWork: true});

    expect(index.items.map(item => item.kind)).toEqual(['turn', 'work-group', 'turn']);
    expect(index.items[1]).toMatchObject({workStatus, sourceIndexes: [1, 2]});
  });

  test('uses the last phase-less assistant as final for old history', () => {
    const source = [
      promptMessage(1),
      message(2, 'agent_message_chunk', 'legacy work'),
      toolMessage(3, 'Read'),
      message(4, 'agent_message_chunk', 'legacy final'),
      doneMessage(5),
    ];

    const index = buildChatDisplayIndex(source, {collapseCompletedWork: true});

    expect(index.items.map(item => item.kind)).toEqual(['turn', 'work-group', 'turn', 'turn']);
    expect(index.items[1].sourceIndexes).toEqual([1, 2]);
    expect(index.items[2].sourceIndex).toBe(3);
  });

  test('does not collapse other agents and does not invent missing duration', () => {
    const source = [
      promptMessage(1, ''),
      phasedMessage(2, 'work', 'commentary'),
      phasedMessage(3, 'final', 'final_answer'),
      doneMessage(4, 'end_turn', ''),
    ];

    expect(buildChatDisplayIndex(source).items.map(item => item.kind)).toEqual([
      'turn', 'turn', 'turn', 'turn',
    ]);
    const codex = buildChatDisplayIndex(source, {collapseCompletedWork: true});
    expect(codex.items[1]).toMatchObject({kind: 'work-group', durationMs: 0});
  });

  test('accounts for prompt status and explicit user newlines', () => {
    const compactPrompt = message(1, 'prompt_request', 'one line');
    compactPrompt.param = {contentBlocks: [{type: 'text', text: 'one line'}]};
    const multilinePrompt = message(2, 'prompt_request', 'line one\nline two\nline three');
    multilinePrompt.param = {contentBlocks: [{type: 'text', text: 'line one\nline two\nline three'}]};

    const compact = buildChatDisplayIndex([compactPrompt], {
      layoutMetrics: {contentWidth: 360},
      promptStatus: () => null,
    });
    const multiline = buildChatDisplayIndex([multilinePrompt], {
      layoutMetrics: {contentWidth: 360},
      promptStatus: () => 'responding',
    });

    expect(multiline.items[0].estimatedHeight).toBeGreaterThan(compact.items[0].estimatedHeight);
  });

  test('reserves visible prompt height for attachment-only content blocks', () => {
    const attachmentOnlyPrompt = message(1, 'prompt_request', '');
    attachmentOnlyPrompt.param = {
      contentBlocks: [
        {
          type: 'resource_link',
          uri: 'file:///D:/Code/WheelMaker/docs/spec.pdf',
          name: 'spec.pdf',
          mimeType: 'application/pdf',
          size: 42_000,
        },
      ],
    };
    const emptyPrompt = message(2, 'prompt_request', '');
    emptyPrompt.param = {contentBlocks: []};

    const index = buildChatDisplayIndex([attachmentOnlyPrompt, emptyPrompt], {
      layoutMetrics: {contentWidth: 360},
      promptStatus: () => null,
    });

    expect(index.items[0].estimatedHeight).toBeGreaterThan(index.items[1].estimatedHeight);
  });

  test('reuses height estimates for unchanged message objects', () => {
    const stableMessage = message(1, 'agent_message_chunk', 'streamed answer');
    let paramReadCount = 0;
    Object.defineProperty(stableMessage, 'param', {
      get: () => {
        paramReadCount += 1;
        return {text: 'streamed answer'};
      },
    });
    const layoutMetrics = {contentWidth: 720};

    buildChatDisplayIndex([stableMessage], {layoutMetrics});
    const readsAfterFirstBuild = paramReadCount;
    buildChatDisplayIndex([stableMessage], {layoutMetrics});

    expect(readsAfterFirstBuild).toBeGreaterThan(0);
    expect(paramReadCount).toBe(readsAfterFirstBuild);
  });

});
