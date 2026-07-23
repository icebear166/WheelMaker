import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {ChatSessionGlobalBar} from './ChatSessionGlobalBar';

describe('ChatSessionGlobalBar', () => {
  it('keeps list expansion before Pin in the right layout action group', async () => {
    const Bar = ChatSessionGlobalBar as React.ComponentType<Record<string, unknown>>;
    let tree: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <Bar
          leading={<button type="button">Archive</button>}
          slideOutOpen={false}
          onToggleSlideOut={() => undefined}
          showSlideOutShortcut
          pinActive={false}
          onTogglePin={() => undefined}
        />,
      );
    });

    expect(tree!.root.findByProps({className: 'chat-session-global-bar-leading-actions'})).toBeDefined();
    const actions = tree!.root.findByProps({className: 'chat-session-global-bar-layout-actions'});
    expect(actions.children.slice(0, 2).map(child =>
      typeof child === 'string' ? child : child.props.className,
    )).toEqual(['chat-session-global-bar-shortcut', 'chat-session-global-bar-btn']);
    expect(actions.findByProps({className: 'chat-session-global-bar-shortcut'}).children).toEqual(['Ctrl+1']);
    expect(actions.findByProps({'aria-label': 'Show all sessions'})).toBeDefined();
    const buttons = actions.findAllByType('button');
    expect(buttons.map(button => button.props['aria-label'])).toEqual([
      'Show all sessions',
      'Pin session sidebar',
    ]);
    expect(buttons[0].findAllByType('svg')).toHaveLength(1);
  });

  it('uses the sidebar-off icon when the full list is open and highlights active Pin', async () => {
    let tree: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ChatSessionGlobalBar
          slideOutOpen
          onToggleSlideOut={() => undefined}
          pinActive
          onTogglePin={() => undefined}
        />,
      );
    });

    const closeBtn = tree!.root.findByProps({'aria-label': 'Close all sessions'});
    expect(closeBtn.findAllByType('svg')).toHaveLength(1);
    expect(tree!.root.findByProps({'aria-label': 'Unpin session sidebar'}).props.className).toContain('active');
    expect(tree!.root.findAllByProps({className: 'chat-session-global-bar-shortcut'})).toHaveLength(0);
  });

  it('renders only the expand button when collapsible and collapsed', async () => {
    let tree: ReactTestRenderer | undefined;
    const onToggleExpanded = jest.fn();
    await act(async () => {
      tree = create(
        <ChatSessionGlobalBar
          collapsible
          expanded={false}
          onToggleExpanded={onToggleExpanded}
          pinActive
          onTogglePin={() => undefined}
          leading={<button type="button">archive</button>}
        />,
      );
    });
    expect(tree!.root.findAllByProps({'aria-label': 'Show session toolbar'})).toHaveLength(1);
    expect(tree!.root.findAll(node => node.children?.includes?.('archive'))).toHaveLength(0);
    expect(tree!.root.findAllByProps({'aria-label': 'Unpin session sidebar'})).toHaveLength(0);

    await act(async () => {
      tree!.root.findByProps({'aria-label': 'Show session toolbar'}).props.onClick();
    });
    expect(onToggleExpanded).toHaveBeenCalledTimes(1);
  });

  it('renders full bar with svgs when expanded', async () => {
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = create(
        <ChatSessionGlobalBar
          collapsible
          expanded
          onToggleExpanded={() => undefined}
          pinActive
          onTogglePin={() => undefined}
          leading={<button type="button">archive</button>}
        />,
      );
    });
    expect(tree!.root.findAllByProps({'aria-label': 'Hide session toolbar'})).toHaveLength(1);
    expect(tree!.root.findAllByProps({'aria-label': 'Unpin session sidebar'})).toHaveLength(1);
    expect(tree!.root.findAllByType('svg').length).toBeGreaterThanOrEqual(2);
  });
});
