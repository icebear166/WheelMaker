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
import {ChatWorkGroup} from '../web/src/chat/ChatWorkGroup';
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
  test.each([
    ['worked', 20_000, 'Worked for 20.0s'],
    ['failed', 20_000, 'Failed after 20.0s'],
    ['stopped', 20_000, 'Stopped after 20.0s'],
    ['worked', 0, 'Worked'],
    ['failed', 0, 'Failed'],
    ['stopped', 0, 'Stopped'],
  ] as const)('toggles completed %s work with duration %d', async (status, durationMs, label) => {
    let view!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      view = ReactTestRenderer.create(
        <ChatWorkGroup status={status} durationMs={durationMs}>
          <div className="work-child">Work</div>
        </ChatWorkGroup>,
      );
    });

    const expand = view.root.findByProps({'aria-label': 'Expand completed work'});
    expect(expand.props['aria-expanded']).toBe(false);
    expect(view.root.findByProps({className: 'chat-work-group-label'}).children).toEqual([label]);
    expect(view.root.findAllByProps({className: 'chat-work-group-content'})).toHaveLength(0);

    await ReactTestRenderer.act(() => {
      expand.props.onClick();
    });
    expect(view.root.findByProps({'aria-label': 'Collapse completed work'}).props['aria-expanded']).toBe(true);
    expect(view.root.findByProps({className: 'chat-work-group-content'})).toBeTruthy();

    await ReactTestRenderer.act(() => {
      view.root.findByProps({'aria-label': 'Collapse completed work'}).props.onClick();
    });
    expect(view.root.findAllByProps({className: 'chat-work-group-content'})).toHaveLength(0);
  });

  test('auto-expands for the active search result and stays open after search closes', async () => {
    let view!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      view = ReactTestRenderer.create(
        <ChatWorkGroup status="worked" durationMs={0} searchOpen searchExpanded>
          <div className="work-child">Work</div>
        </ChatWorkGroup>,
      );
    });

    expect(view.root.findAllByProps({className: 'chat-work-group-content'})).toHaveLength(1);

    await ReactTestRenderer.act(() => {
      view.update(
        <ChatWorkGroup status="worked" durationMs={0} searchOpen={false} searchExpanded={false}>
          <div className="work-child">Work</div>
        </ChatWorkGroup>,
      );
    });

    expect(view.root.findAllByProps({className: 'chat-work-group-content'})).toHaveLength(1);
  });

  test('closes an automatic expansion when the active search result moves away', async () => {
    let view!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      view = ReactTestRenderer.create(
        <ChatWorkGroup status="worked" durationMs={0} searchOpen searchExpanded>
          <div className="work-child">Work</div>
        </ChatWorkGroup>,
      );
    });

    await ReactTestRenderer.act(() => {
      view.update(
        <ChatWorkGroup status="worked" durationMs={0} searchOpen searchExpanded={false}>
          <div className="work-child">Work</div>
        </ChatWorkGroup>,
      );
    });

    expect(view.root.findAllByProps({className: 'chat-work-group-content'})).toHaveLength(0);
  });

  test('uses a fixed neutral completed-work row', () => {
    const styles = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'styles', 'chat.css'),
      'utf8',
    );
    const header = styles.match(/\.chat-work-group-header \{([\s\S]*?)\}/)?.[1] ?? '';
    const group = styles.match(/\.chat-work-group \{([\s\S]*?)\}/)?.[1] ?? '';
    const chevron = styles.match(/\.chat-work-group-chevron \{([\s\S]*?)\}/)?.[1] ?? '';
    const label = styles.match(/\.chat-work-group-label \{([\s\S]*?)\}/)?.[1] ?? '';

    expect(header).toContain('height: 28px;');
    expect(header).toContain('background: transparent;');
    expect(header).toContain('border-radius: 6px;');
    expect(header).toContain('padding: 0 6px;');
    expect(header).toContain('font: inherit;');
    expect(group).not.toContain('accent-primary');
    expect(chevron).toContain('color: var(--text-tertiary);');
    expect(label).toContain('font-weight: 500;');
    expect(label).toContain('font-variant-numeric: tabular-nums;');
    expect(styles).toMatch(
      /\.chat-work-group-header:hover,[\s\S]*?\.chat-work-group-header:focus-visible\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--hover\) 78%, transparent\);/,
    );
    expect(styles).toMatch(
      /\.chat-work-group-header:focus-visible\s*\{[^}]*outline:\s*1px solid color-mix\(in srgb, var\(--border-strong\) 56%, transparent\);/,
    );
    expect(styles).toMatch(
      /\.chat-work-group-open \.chat-work-group-header\s*\{[^}]*color:\s*var\(--text-primary\);/,
    );
    expect(styles).toContain('.chat-work-group-open .chat-work-group-chevron');
    expect(styles).toContain('.chat-work-group-child.compact');
  });

  test('keeps expanded work children flush with the transcript column', () => {
    const styles = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'styles', 'chat.css'),
      'utf8',
    );
    expect(styles).toMatch(
      /\.chat-view-width-fixed-800 \.chat-work-group \.chat-view-content,\s*\n\s*\.chat-view-width-fixed-800-edge-surfaces \.chat-work-group \.chat-view-content\s*\{[^}]*width:\s*100%;[^}]*margin-left:\s*0;[^}]*margin-right:\s*0;/,
    );
  });

  test('highlights matching characters inside structured prompt text', async () => {
    let view!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      view = ReactTestRenderer.create(
        <ChatTurnView
          message={{
            sessionId: 'sess-1',
            turnIndex: 1,
            method: 'prompt_request',
            param: {contentBlocks: [{type: 'text', text: 'find this phrase'}]},
            finished: true,
          }}
          highlightQuery="this"
          markdownComponents={markdownComponents}
          markdownUrlTransform={markdownUrlTransform}
        />,
      );
    });

    const matches = view.root.findAllByProps({className: 'chat-search-match'});
    expect(matches).toHaveLength(1);
    expect(matches[0].children).toEqual(['this']);
  });

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

    expect(view.root.findByProps({className: 'chat-thought-title'}).children[0]).toBe('Thinking');
    expect(view.root.findAllByProps({className: 'chat-activity-dots'})).toHaveLength(1);
    expect(view.root.findByProps({className: 'chat-activity-dots'}).children).toHaveLength(3);
    expect(view.root.findAllByProps({className: 'sl-icon chat-thought-chevron'}))
      .toHaveLength(1);
    expect(view.root.findAllByProps({className: 'chat-thought-content'})).toHaveLength(0);

    await ReactTestRenderer.act(() => {
      view.root.findByProps({'aria-label': 'Expand thinking'}).props.onClick();
    });
    expect(view.root.findAllByProps({className: 'chat-thought-content'})).toHaveLength(1);
    expect(view.root.findByProps({className: 'chat-thought-title'}).children[0]).toBe('Thinking');
    expect(view.root.findAllByProps({className: 'chat-activity-dots'})).toHaveLength(1);

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
    expect(view.root.findAllByProps({className: 'chat-activity-dots'})).toHaveLength(0);

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
    const chevron = styles.match(/\.chat-thought-chevron \{([\s\S]*?)\}/)?.[1] ?? '';
    const chevronTone = styles.match(/\.chat-thought-header \.chat-thought-chevron \{([\s\S]*?)\}/)?.[1] ?? '';

    expect(header).toContain('height: 28px;');
    expect(styles).toContain('.chat-thought-block.streaming .chat-thought-icon');
    expect(styles).toContain('.chat-thought-block.streaming .chat-thought-icon,');
    expect(styles).toContain('.chat-tool-group-running .chat-tool-group-summary-icon');
    expect(styles).toContain('.chat-activity-dots > span');
    expect(styles).toContain('@keyframes chatActivityDot');
    expect(block).toContain('margin: 0;');
    expect(block).not.toContain('accent-primary');
    expect(content).not.toContain('background: color-mix');
    expect(chevron).toContain('color: var(--text-tertiary);');
    expect(chevronTone).toContain('opacity: 0.72;');
    expect(styles).toContain('.chat-thought-open .chat-thought-chevron');
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

    expect(view.root.findByProps({className: 'chat-tool-group-count'}).children[0]).toBe('Calling 2 tools');
    expect(view.root.findAllByProps({className: 'chat-activity-dots'})).toHaveLength(1);
    expect(view.root.find(node => (
      typeof node.props.className === 'string' &&
      node.props.className.split(' ').includes('chat-tool-group')
    )).props.className)
      .toContain('chat-tool-group-running');
    expect(view.root.findByProps({className: 'chat-tool-group-latest'}).children).toEqual([
      'Search turns',
    ]);
    expect(view.root.findAllByProps({className: 'sl-icon chat-tool-group-chevron'}))
      .toHaveLength(1);
    expect(view.root.findAllByProps({className: 'sl-icon chat-tool-group-summary-icon'}))
      .toHaveLength(1);
    expect(view.root.findAll(node => (
      node.type === 'svg' &&
      typeof node.props.className === 'string' &&
      node.props.className.includes('chat-tool-group-status')
    ))).toHaveLength(0);
    expect(view.root.findAllByProps({className: 'chat-tool-group-list'})).toHaveLength(0);

    await ReactTestRenderer.act(() => {
      view.root.findByProps({'aria-label': 'Expand 2 tool calls'}).props.onClick();
    });
    await ReactTestRenderer.act(() => {
      view.update(
        <ChatToolCallGroup
          messages={[
            tool(2, 'Read CLAUDE.md', 'completed'),
            tool(3, 'Search turns', 'completed'),
            tool(4, 'Run tests', 'completed'),
          ]}
        />,
      );
    });

    expect(view.root.findAllByProps({className: 'chat-tool-group-row'})).toHaveLength(3);
    expect(view.root.findAll(node => (
      node.type === 'svg' &&
      typeof node.props.className === 'string' &&
      node.props.className.includes('chat-tool-group-status')
    ))).toHaveLength(3);
    expect(view.root.findByProps({className: 'chat-tool-group-count'}).children).toEqual([
      'Called 3 tools',
    ]);
    expect(view.root.findAllByProps({className: 'chat-activity-dots'})).toHaveLength(0);
    expect(view.root.find(node => (
      typeof node.props.className === 'string' &&
      node.props.className.split(' ').includes('chat-tool-group')
    )).props.className)
      .not.toContain('chat-tool-group-running');
    expect(view.root.findAllByProps({className: 'chat-tool-group-latest'})).toHaveLength(0);

    await ReactTestRenderer.act(() => {
      view.root.findByProps({'aria-label': 'Collapse 3 tool calls'}).props.onClick();
    });
    expect(view.root.findByProps({className: 'chat-tool-group-latest'}).children).toEqual([
      'Run tests',
    ]);
  });

  test('keeps a completed tail tool group active until the prompt moves on', async () => {
    const messages = [
      tool(2, 'Read CLAUDE.md', 'completed'),
      tool(3, 'Search turns', 'completed'),
    ];
    let view!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      view = ReactTestRenderer.create(
        <ChatToolCallGroup messages={messages} active />,
      );
    });

    expect(view.root.findByProps({className: 'chat-tool-group-count'}).children[0])
      .toBe('Calling 2 tools');
    expect(view.root.findAllByProps({className: 'chat-activity-dots'})).toHaveLength(1);

    await ReactTestRenderer.act(() => {
      view.update(<ChatToolCallGroup messages={messages} active={false} />);
    });

    expect(view.root.findByProps({className: 'chat-tool-group-count'}).children)
      .toEqual(['Called 2 tools']);
    expect(view.root.findAllByProps({className: 'chat-activity-dots'})).toHaveLength(0);
  });

  test('routes grouped tool ranges through the shared live and archive virtual item renderer', () => {
    const workspace = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(workspace).toContain("import {ChatToolCallGroup} from '../chat/ChatToolCallGroup';");
    expect(workspace).toContain("displayItem.kind === 'tool-group'");
    expect(workspace).toContain('displayItem.sourceIndexes');
    expect(workspace).toContain('active={toolGroupActive}');
    expect(workspace).toContain(
      'chatDisplayItemContainsTurn(item, chatPromptHistoryTargetTurn.turnIndex)',
    );
  });

  test('uses a fixed neutral collapsed tool-group row', () => {
    const styles = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'styles', 'chat.css'),
      'utf8',
    );
    const header = styles.match(/\.chat-tool-group-header \{([\s\S]*?)\}/)?.[1] ?? '';
    const block = styles.match(/\.chat-tool-group \{([\s\S]*?)\}/)?.[1] ?? '';
    const chevron = styles.match(/\.chat-tool-group-chevron \{([\s\S]*?)\}/)?.[1] ?? '';
    const summaryIcon = styles.match(/\.chat-tool-group-summary-icon \{([\s\S]*?)\}/)?.[1] ?? '';

    expect(header).toContain('height: 28px;');
    expect(block).toContain('margin: 0;');
    expect(header).toContain('background: transparent;');
    expect(header).not.toContain('accent-primary');
    expect(styles).toContain('.chat-tool-group-latest');
    expect(styles).toContain('text-overflow: ellipsis;');
    expect(chevron).toContain('color: var(--text-tertiary);');
    expect(summaryIcon).toContain('color: inherit;');
    expect(styles).toContain('.chat-tool-group-running .chat-tool-group-summary-icon');
    expect(styles).toContain('.chat-tool-group-open .chat-tool-group-chevron');
  });
});
