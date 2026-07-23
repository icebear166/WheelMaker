import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {ChatRecentSessionsSurface} from './ChatRecentSessionsSurface';

describe('ChatRecentSessionsSurface', () => {
  it('uses the shared floating session panel frame when expanded', async () => {
    let tree: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ChatRecentSessionsSurface
          collapsed={false}
          onToggleCollapsed={() => undefined}
          sessionListDensity="relaxed"
          header={<button type="button">All sessions</button>}
        >
          <div>Recent session</div>
        </ChatRecentSessionsSurface>,
      );
    });

    expect(tree!.root.findAll(node =>
      typeof node.props.className === 'string' &&
      node.props.className.includes('chat-session-panel-floating'),
    )).toHaveLength(1);
    expect(tree!.root.findByProps({className: 'chat-edge-surface-title'}).children).toEqual(['Recent Sessions']);
    const collapse = tree!.root.findByProps({'aria-label': 'Collapse Recent Sessions'});
    expect(collapse.findAllByType('svg')).toHaveLength(1);
    expect(tree!.root.findAllByType('button').find(button => button.children.includes('All sessions'))).toBeDefined();
  });
});
