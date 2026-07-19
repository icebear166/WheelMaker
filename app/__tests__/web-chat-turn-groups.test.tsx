import fs from 'fs';
import path from 'path';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('react-markdown', () => {
  const ReactModule = require('react') as typeof React;
  return {
    __esModule: true,
    default: ({children}: {children: React.ReactNode}) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

jest.mock('../web/src/code/markdownPreview', () => ({
  useMarkdownCapabilityPlugins: () => ({
    pending: false,
    remarkPlugins: [],
    rehypePlugins: [],
  }),
}));

import {ChatTurnView} from '../web/src/chat/ChatTurnView';
import {ChatToolCallGroup} from '../web/src/chat/ChatToolCallGroup';
import type {RegistryChatMessage} from '../web/src/registry/registryTypes';

const markdownComponents = {};
const markdownUrlTransform = (value: string) => value;

function thought(text: string, finished: boolean): RegistryChatMessage {
  return {
    sessionId: 'sess-1',
    turnIndex: 2,
    method: 'agent_thought_chunk',
    param: {text},
    finished,
  };
}

function tool(turnIndex: number, cmd: string, status: string): RegistryChatMessage {
  return {
    sessionId: 'sess-1',
    turnIndex,
    method: 'tool_call',
    param: {cmd, kind: 'read', status},
    finished: true,
  };
}

describe('chat turn groups', () => {
  test('keeps thinking collapsed by default and preserves an active expansion', async () => {
    let view!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      view = ReactTestRenderer.create(
        <ChatTurnView
          message={thought('Inspecting files', false)}
          markdownComponents={markdownComponents}
          markdownUrlTransform={markdownUrlTransform}
        />,
      );
    });

    expect(view.root.findByProps({className: 'chat-thought-title'}).children).toEqual([
      'Thinking',
    ]);
    expect(view.root.findAllByProps({className: 'chat-thought-chevron'})).toHaveLength(0);
    expect(view.root.findAllByProps({className: 'chat-thought-content'})).toHaveLength(0);

    await ReactTestRenderer.act(() => {
      view.root.findByProps({'aria-label': 'Expand thinking'}).props.onClick();
    });
    expect(view.root.findAllByProps({className: 'chat-thought-content'})).toHaveLength(1);
    expect(view.root.findByProps({className: 'chat-thought-title'}).children).toEqual([
      'Thinking',
    ]);

    await ReactTestRenderer.act(() => {
      view.update(
        <ChatTurnView
          message={thought('Inspecting files\nFound the renderer', true)}
          markdownComponents={markdownComponents}
          markdownUrlTransform={markdownUrlTransform}
        />,
      );
    });
    expect(view.root.findAllByProps({className: 'chat-thought-content'})).toHaveLength(1);

    await ReactTestRenderer.act(() => {
      view.root.findByProps({'aria-label': 'Collapse thinking'}).props.onClick();
    });
    expect(view.root.findByProps({className: 'chat-thought-title'}).children).toEqual([
      'Inspecting files',
    ]);
  });

  test('uses a fixed neutral collapsed thinking row', () => {
    const styles = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'styles', 'chat.css'),
      'utf8',
    );
    const header = styles.match(/\.chat-thought-header \{([\s\S]*?)\}/)?.[1] ?? '';
    const block = styles.match(/\.chat-thought-block \{([\s\S]*?)\}/)?.[1] ?? '';
    const content = styles.match(/\.chat-thought-content \{([\s\S]*?)\}/)?.[1] ?? '';

    expect(header).toContain('height: 28px;');
    expect(styles).toContain('.chat-thought-block.streaming .chat-thought-icon');
    expect(block).toContain('margin: 0;');
    expect(block).not.toContain('accent-primary');
    expect(content).not.toContain('background: color-mix');
  });

  test('summarizes the latest tool and stays expanded when the group grows', async () => {
    let view!: ReactTestRenderer.ReactTestRenderer;
    const first = [
      tool(2, 'Read CLAUDE.md', 'completed'),
      tool(3, 'Search turns', 'in_progress'),
    ];
    await ReactTestRenderer.act(() => {
      view = ReactTestRenderer.create(<ChatToolCallGroup messages={first} />);
    });

    expect(view.root.findByProps({className: 'chat-tool-group-count'}).children).toEqual([
      'Call 2 tools',
    ]);
    expect(view.root.findByProps({className: 'chat-tool-group-latest'}).children).toEqual([
      'Search turns',
    ]);
    expect(view.root.findAllByProps({className: 'chat-tool-group-chevron'})).toHaveLength(0);
    expect(view.root.findAllByProps({className: 'chat-tool-group-list'})).toHaveLength(0);

    await ReactTestRenderer.act(() => {
      view.root.findByProps({'aria-label': 'Expand 2 tool calls'}).props.onClick();
    });
    await ReactTestRenderer.act(() => {
      view.update(
        <ChatToolCallGroup
          messages={[...first, tool(4, 'Run tests', 'completed')]}
        />,
      );
    });

    expect(view.root.findAllByProps({className: 'chat-tool-group-row'})).toHaveLength(3);
    expect(view.root.findByProps({className: 'chat-tool-group-count'}).children).toEqual([
      'Call 3 tools',
    ]);
    expect(view.root.findAllByProps({className: 'chat-tool-group-latest'})).toHaveLength(0);

    await ReactTestRenderer.act(() => {
      view.root.findByProps({'aria-label': 'Collapse 3 tool calls'}).props.onClick();
    });
    expect(view.root.findByProps({className: 'chat-tool-group-latest'}).children).toEqual([
      'Run tests',
    ]);
  });

  test('routes grouped tool ranges through the shared live and archive virtual item renderer', () => {
    const workspace = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(workspace).toContain("import {ChatToolCallGroup} from '../chat/ChatToolCallGroup';");
    expect(workspace).toContain("displayItem.kind === 'tool-group'");
    expect(workspace).toContain('displayItem.sourceIndexes');
    expect(workspace).toContain('<ChatToolCallGroup messages={sourceToolMessages} />');
    expect(workspace).toContain(
      'chatDisplayItemContainsTurn(item, sessionSearchTargetTurn.turnIndex)',
    );
  });

  test('uses a fixed neutral collapsed tool-group row', () => {
    const styles = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'styles', 'chat.css'),
      'utf8',
    );
    const header = styles.match(/\.chat-tool-group-header \{([\s\S]*?)\}/)?.[1] ?? '';
    const block = styles.match(/\.chat-tool-group \{([\s\S]*?)\}/)?.[1] ?? '';

    expect(header).toContain('height: 28px;');
    expect(block).toContain('margin: 0;');
    expect(header).toContain('background: transparent;');
    expect(header).not.toContain('accent-primary');
    expect(styles).toContain('.chat-tool-group-latest');
    expect(styles).toContain('text-overflow: ellipsis;');
  });
});
