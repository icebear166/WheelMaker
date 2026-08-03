import {execFileSync} from 'child_process';
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

jest.mock('react-markdown', () => {
  const ReactModule = require('react') as typeof React;
  return {
    __esModule: true,
    default: ({
      children,
      components,
    }: {
      children?: React.ReactNode;
      components?: Record<string, React.ElementType>;
    }) => {
      const source = String(children ?? '');
      const blocks = source.split(/\r?\n\s*\r?\n/).filter(block => block.trim());
      return ReactModule.createElement(
        'mock-react-markdown',
        {source},
        ...blocks.map((block, index) => {
          const blockStartLine = source.slice(0, source.indexOf(block)).split(/\r?\n/).length;
          if (/^\d+\.\s+/m.test(block)) {
            const ListItem = components?.li ?? 'li';
            return ReactModule.createElement(
              'ol',
              {key: index},
              ...block.split(/\r?\n/).filter(Boolean).map((line, lineIndex) => {
                const props = ListItem === 'li'
                  ? {key: lineIndex}
                  : {
                      key: lineIndex,
                      node: {
                        type: 'element',
                        tagName: 'li',
                        properties: {},
                        children: [],
                        position: {
                          start: {line: blockStartLine + lineIndex, column: 1, offset: 0},
                          end: {line: blockStartLine + lineIndex, column: line.length + 1, offset: line.length},
                        },
                      },
                    };
                return ReactModule.createElement(
                  ListItem,
                  props,
                  line.replace(/^\d+\.\s+/, ''),
                );
              }),
            );
          }
          if (/^\s*[-*+]\s+/m.test(block) && !/^[A-H1-9]\.\s+/.test(block)) {
            return ReactModule.createElement(
              'ul',
              {key: index},
              ReactModule.createElement('li', null, block),
            );
          }
          const Paragraph = components?.p ?? 'p';
          const props = Paragraph === 'p'
            ? {key: index}
            : {
                key: index,
                node: {
                  type: 'element',
                  tagName: 'p',
                  properties: {},
                  children: [],
                  position: {
                    start: {line: blockStartLine, column: 1, offset: 0},
                    end: {line: blockStartLine, column: block.length + 1, offset: block.length},
                  },
                },
              };
          return ReactModule.createElement(Paragraph, props, block);
        }),
      );
    },
  };
});
jest.mock('../web/src/code/markdownPreview', () => ({
  useMarkdownCapabilityPlugins: () => ({
    pending: false,
    remarkPlugins: [],
    rehypePlugins: [],
  }),
}));

import type {RegistryChatMessage} from '../web/src/registry/registryTypes';
import {ChatTurnView} from '../web/src/chat/ChatTurnView';

const malformedOptionText = [
  '**下一项决策：Session API 暴露多少 queue 信息？**',
  '',
  'A. **列表给摘要，详情给完整状态（推荐）**  ',
  '   - `session.list/session.updated`：`queueCount`、`queuePaused`、`queueRevision`。  ',
  '   - `session.read`：完整 `activeItem + waitingItems`。  ',
  'B. `session.list/session.updated/session.read` 都携带完整 queue。  ',
  'C. Session 信息只带 revision，完整 queue 必须另调接口读取。',
].join('\n');

const optionText = [
  '**下一项决策：Session API 暴露多少 queue 信息？**',
  '',
  'A. **列表给摘要，详情给完整状态（推荐）**',
  '',
  '- `session.list/session.updated`：`queueCount`、`queuePaused`、`queueRevision`。',
  '- `session.read`：完整 `activeItem + waitingItems`。',
  '',
  'B. `session.list/session.updated/session.read` 都携带完整 queue。',
  '',
  'C. Session 信息只带 revision，完整 queue 必须另调接口读取。',
].join('\n');

const boldOptionText = [
  '下一个决策：Floating Nav 的“常驻”范围到哪里？',
  '',
  '**A. 所有移动端主界面都常驻（推荐）**  ',
  'Chat、Preview、Terminal、Relay、Monitor、Settings 都显示。',
  '',
  '**B. 只在 Chat、Preview、Terminal 常驻**  ',
  '本次只解决明确提出的三个界面。',
  '',
  '选 A 还是 B？',
].join('\n');

const optionReplies = [
  {label: 'A', text: '**列表给摘要，详情给完整状态（推荐）**'},
  {label: 'B', text: '`session.list/session.updated/session.read` 都携带完整 queue。'},
  {label: 'C', text: 'Session 信息只带 revision，完整 queue 必须另调接口读取。'},
];

const markdownComponents = {};
const markdownUrlTransform = (value: string) => value;

function message(text: string): RegistryChatMessage {
  return {
    sessionId: 'sess-1',
    turnIndex: 3,
    method: 'agent_message_chunk',
    param: {text},
    finished: true,
  };
}

async function renderTurn(
  text: string,
  extra?: Partial<React.ComponentProps<typeof ChatTurnView>>,
): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(
      <ChatTurnView
        message={message(text)}
        markdownComponents={markdownComponents}
        markdownUrlTransform={markdownUrlTransform}
        {...extra}
      />,
    );
  });
  return tree!;
}

function markdownSources(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType('mock-react-markdown')
    .map(node => String(node.props.source));
}

function renderWithRealReactMarkdown(source: string): string {
  const script = [
    "const fs = require('fs');",
    "const React = require('./node_modules/react');",
    "const {renderToStaticMarkup} = require('./node_modules/react-dom/server');",
    "const ReactMarkdown = require('./node_modules/react-markdown').default;",
    "const remarkGfm = require('./node_modules/remark-gfm').default;",
    "const source = fs.readFileSync(0, 'utf8');",
    'process.stdout.write(renderToStaticMarkup(React.createElement(ReactMarkdown, {remarkPlugins: [remarkGfm]}, source)));',
  ].join('');
  return execFileSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    input: source,
    encoding: 'utf8',
  });
}

function renderedMarkdownBlocks(tree: ReactTestRenderer): Array<{type: string; text: string}> {
  return tree.root
    .findAll(node => node.type === 'p' || node.type === 'ul')
    .map(node => ({
      type: String(node.type),
      text: node
        .findAll(child => typeof child.children[0] === 'string')
        .flatMap(child => child.children)
        .filter((child): child is string => typeof child === 'string')
        .join(''),
    }));
}

describe('ChatTurnView Markdown reply structure', () => {
  it('passes stored Markdown through without repairing alphabetic choice boundaries', async () => {
    const tree = await renderTurn(malformedOptionText);
    const sources = markdownSources(tree);

    expect(sources).toEqual([malformedOptionText]);
    expect(renderWithRealReactMarkdown(sources[0])).toBe(
      renderWithRealReactMarkdown(malformedOptionText),
    );
  });

  it('adds interaction without changing Markdown blocks or source formatting', async () => {
    const historical = await renderTurn(optionText);
    const selectable = await renderTurn(optionText, {
      optionReplies,
      onSelectOptionReply: jest.fn(),
    });

    expect(markdownSources(selectable)).toEqual([optionText]);
    expect(markdownSources(historical)).toEqual([optionText]);
    expect(renderedMarkdownBlocks(selectable)).toEqual(renderedMarkdownBlocks(historical));
    expect(selectable.root.findAllByType('button')).toHaveLength(0);
    expect(selectable.root.findAllByProps({className: 'chat-reply-target'})).toHaveLength(3);
  });

  it('submits a recognized reply from the original Markdown paragraph', async () => {
    const onSelectOptionReply = jest.fn();
    const tree = await renderTurn(optionText, {
      optionReplies,
      onSelectOptionReply,
    });

    const optionA = tree.root.findByProps({'data-chat-reply-value': 'A'});
    await act(async () => optionA.props.onClick());

    expect(optionA.type).toBe('p');
    expect(onSelectOptionReply).toHaveBeenCalledWith('A');
  });

  it('adds interaction to option paragraphs wrapped in Markdown bold markers', async () => {
    const historical = await renderTurn(boldOptionText);
    const selectable = await renderTurn(boldOptionText, {
      optionReplies: [
        {label: 'A', text: '所有移动端主界面都常驻（推荐）'},
        {label: 'B', text: '只在 Chat、Preview、Terminal 常驻'},
      ],
      onSelectOptionReply: jest.fn(),
    });

    expect(markdownSources(selectable)).toEqual([boldOptionText]);
    expect(renderedMarkdownBlocks(selectable)).toEqual(renderedMarkdownBlocks(historical));
    expect(selectable.root.findByProps({'data-chat-reply-value': 'A'}).type).toBe('p');
    expect(selectable.root.findByProps({'data-chat-reply-value': 'B'}).type).toBe('p');
  });

  it('adds interaction to bold option headings with inline descriptions', async () => {
    const text = [
      '只确认一个核心范围：首版 Git 功能是否只读？',
      '',
      '**A. 只读浏览（推荐）**：显示当前分支、工作区改动与完整提交历史。',
      '',
      '**B. 同时支持操作**：加入暂存、提交与切换分支能力。',
    ].join('\n');
    const historical = await renderTurn(text);
    const selectable = await renderTurn(text, {
      optionReplies: [
        {label: 'A', text: '只读浏览（推荐）：显示当前分支、工作区改动与完整提交历史。'},
        {label: 'B', text: '同时支持操作：加入暂存、提交与切换分支能力。'},
      ],
      onSelectOptionReply: jest.fn(),
    });

    expect(markdownSources(selectable)).toEqual(markdownSources(historical));
    expect(renderedMarkdownBlocks(selectable)).toEqual(renderedMarkdownBlocks(historical));
    expect(selectable.root.findByProps({'data-chat-reply-value': 'A'}).type).toBe('p');
    expect(selectable.root.findByProps({'data-chat-reply-value': 'B'}).type).toBe('p');
  });

  it('targets bold option labels instead of the preceding confirmation question', async () => {
    const text = [
      '屏蔽条件是否沿用这个判断？',
      '',
      '**A.（推荐）私有 registry 不可用时，隐藏整个 MyFlicker/Flicker 功能；恢复可用后自动显示。**',
      '',
      '**B.** 仅当本机未安装 `@myflicker/cli` 时隐藏。',
      '',
      '**C.** 两个条件任一不满足就隐藏。',
    ].join('\n');
    const selectable = await renderTurn(text, {
      optionReplies: [
        {
          label: 'A',
          text: '（推荐）私有 registry 不可用时，隐藏整个 MyFlicker/Flicker 功能；恢复可用后自动显示。',
        },
        {label: 'B', text: '仅当本机未安装 `@myflicker/cli` 时隐藏。'},
        {label: 'C', text: '两个条件任一不满足就隐藏。'},
      ],
      onSelectOptionReply: jest.fn(),
    });

    expect(markdownSources(selectable)).toEqual([text]);
    expect(selectable.root.findAllByProps({className: 'chat-reply-target'})).toHaveLength(3);
    expect(selectable.root.findByProps({'data-chat-reply-value': 'A'}).type).toBe('p');
    expect(selectable.root.findByProps({'data-chat-reply-value': 'B'}).type).toBe('p');
    expect(selectable.root.findByProps({'data-chat-reply-value': 'C'}).type).toBe('p');
  });

  it('adds the same geometry-free interaction to native numeric list items', async () => {
    const text = [
      '请选择一个选项：',
      '',
      '1. **采用方案一**',
      '2. 保持现状',
    ].join('\n');
    const replies = [
      {label: '1', text: '**采用方案一**'},
      {label: '2', text: '保持现状'},
    ];
    const historical = await renderTurn(text);
    const selectable = await renderTurn(text, {
      optionReplies: replies,
      onSelectOptionReply: jest.fn(),
    });

    expect(markdownSources(selectable)).toEqual(markdownSources(historical));
    expect(selectable.root.findAllByType('button')).toHaveLength(0);
    expect(selectable.root.findByProps({'data-chat-reply-value': '1'}).type).toBe('li');
    expect(selectable.root.findByProps({'data-chat-reply-value': '2'}).type).toBe('li');
  });

  it('keeps confirmation text in Markdown and adds only interaction metadata', async () => {
    const text = '建议使用现有实现。\n\n按这个方向修改可以吗？';
    const historical = await renderTurn(text);
    const selectable = await renderTurn(text, {
      confirmationReply: {
        sentence: '按这个方向修改可以吗？',
        replyText: '确认',
      },
      onSelectConfirmationReply: jest.fn(),
    });

    expect(markdownSources(selectable)).toEqual(markdownSources(historical));
    expect(renderedMarkdownBlocks(selectable)).toEqual(renderedMarkdownBlocks(historical));
    expect(selectable.root.findAllByType('button')).toHaveLength(0);
    expect(selectable.root.findByProps({'data-chat-reply-value': '确认'}).type).toBe('p');
  });
});
