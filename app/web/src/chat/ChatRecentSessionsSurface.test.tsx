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
  });
});
