import fs from 'fs';
import path from 'path';
import {
  buildChatDisplayIndex,
  chatDisplayItemContainsTurn,
  resolveActiveToolGroupKey,
  resolveChatDisplayScrollIndex,
} from '../web/src/chat/turns/chatDisplayIndex';
import type {RegistryChatMessage} from '../web/src/registry/registryTypes';

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

describe('chat display index', () => {
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

  test('does not keep a manual virtual range implementation', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'chat', 'turns', 'chatDisplayIndex.ts'),
      'utf8',
    );

    expect(source).not.toContain('getChatDisplayIndexRange');
    expect(source).not.toContain('ChatDisplayRange');
    expect(source).not.toContain('paddingTop');
    expect(source).not.toContain('paddingBottom');
    expect(source).not.toContain('totalEstimatedHeight');
  });
});
