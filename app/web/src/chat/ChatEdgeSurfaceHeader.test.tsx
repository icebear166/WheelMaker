import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {ChatEdgeSurfaceHeader} from './ChatEdgeSurfaceHeader';

describe('ChatEdgeSurfaceHeader', () => {
  it('uses one title, toggle, summary, and actions layout for floating cards', async () => {
    const onToggleCollapsed = jest.fn();
    let tree: ReactTestRenderer;

    await act(async () => {
      tree = create(
        <ChatEdgeSurfaceHeader
          title="Plan"
          collapsed={false}
          onToggleCollapsed={onToggleCollapsed}
          summary={<span>Patch the sidebar</span>}
          leadingActions={<button type="button">Search</button>}
          actions={<button type="button">Pin</button>}
        />,
      );
    });

    expect(tree!.root.findByProps({className: 'chat-edge-surface-title'}).children).toEqual(['Plan']);
    expect(tree!.root.findByProps({className: 'chat-edge-surface-summary'})).toBeDefined();
    expect(tree!.root.findByProps({className: 'chat-edge-surface-leading-actions'})).toBeDefined();
    expect(tree!.root.findByProps({className: 'chat-edge-surface-actions'})).toBeDefined();
    const toggle = tree!.root.findByProps({'aria-label': 'Collapse Plan'});
    expect(toggle.findAllByType('svg')).toHaveLength(1);

    await act(async () => toggle.props.onClick());
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('uses a right-pointing chevron when collapsed', async () => {
    let tree: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ChatEdgeSurfaceHeader title="Limits" collapsed onToggleCollapsed={() => undefined} />,
      );
    });

    const toggle = tree!.root.findByProps({'aria-label': 'Expand Limits'});
    expect(toggle.findAllByType('svg')).toHaveLength(1);
  });
});
