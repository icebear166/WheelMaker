import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {ChatPlanSurface} from '../web/src/chat/ChatPlanSurface';
import type {ChatPlanSnapshot} from '../web/src/chat/chatPlan';

function planSnapshot(): ChatPlanSnapshot {
  return {
    turnIndex: 12,
    entries: [
      {content: 'Read the code', status: 'completed'},
      {content: 'Patch the UI', status: 'in_progress'},
      {content: 'Run tests', status: 'pending'},
    ],
    activeEntry: {content: 'Patch the UI', status: 'in_progress'},
    activeIndex: 1,
    completedCount: 1,
    totalCount: 3,
  };
}

describe('ChatPlanSurface', () => {
  test('collapses desktop plan to a compact current-step row from the leading control', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatPlanSurface
          mode="desktop"
          plan={planSnapshot()}
        />,
      );
    });

    expect(renderer!.root.findAllByProps({className: 'chat-plan-surface-list'})).toHaveLength(1);
    const toggle = renderer!.root.findByProps({'aria-label': 'Collapse current plan'});

    await ReactTestRenderer.act(() => {
      toggle.props.onClick();
    });

    expect(renderer!.root.findAllByProps({className: 'chat-plan-surface-list'})).toHaveLength(0);
    const expand = renderer!.root.findByProps({'aria-label': 'Expand current plan'});
    expect(renderer!.root.findByProps({className: 'chat-plan-current'}).children).toEqual(['Patch the UI']);

    await ReactTestRenderer.act(() => {
      expand.props.onClick();
    });

    expect(renderer!.root.findAllByProps({className: 'chat-plan-surface-list'})).toHaveLength(1);
  });
});
