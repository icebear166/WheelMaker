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

describe('chat turn groups', () => {
  test('keeps thinking collapsed by default and preserves an active expansion', async () => {
    let view!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      view = ReactTestRenderer.create(
        <ChatTurnView
          message={thought('Inspecting files', false)}
          hideToolCalls={false}
          markdownComponents={markdownComponents}
          markdownUrlTransform={markdownUrlTransform}
        />,
      );
    });

    expect(view.root.findByProps({className: 'chat-thought-title'}).children).toEqual([
      'Thinking',
    ]);
    expect(view.root.findAllByProps({className: 'chat-thought-content'})).toHaveLength(0);

    await ReactTestRenderer.act(() => {
      view.root.findByProps({'aria-label': 'Expand thinking'}).props.onClick();
    });
    expect(view.root.findAllByProps({className: 'chat-thought-content'})).toHaveLength(1);

    await ReactTestRenderer.act(() => {
      view.update(
        <ChatTurnView
          message={thought('Inspecting files\nFound the renderer', true)}
          hideToolCalls={false}
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
    expect(block).not.toContain('accent-primary');
    expect(content).not.toContain('background: color-mix');
  });
});
