import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import fs from 'fs';
import path from 'path';

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

  test('keeps pinned recent sessions expanded until the user collapses or unpins them', async () => {
    const projectRoot = path.join(__dirname, '..');
    const surfacePath = path.join(projectRoot, 'web', 'src', 'chat', 'ChatRecentSessionsSurface.tsx');

    expect(fs.existsSync(surfacePath)).toBe(true);
    const {ChatRecentSessionsSurface} = require(surfacePath) as {
      ChatRecentSessionsSurface: React.ComponentType<{
        children: React.ReactNode;
        onUnpin: () => void;
      }>;
    };
    const onUnpin = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRecentSessionsSurface onUnpin={onUnpin}>
          <div data-test-id="recent-row">Recent row</div>
        </ChatRecentSessionsSurface>,
      );
    });

    expect(renderer!.root.findAllByProps({className: 'chat-recent-sessions-surface-list'})).toHaveLength(1);
    const collapse = renderer!.root.findByProps({'aria-label': 'Collapse recent sessions'});

    await ReactTestRenderer.act(() => {
      collapse.props.onClick();
    });

    expect(renderer!.root.findAllByProps({className: 'chat-recent-sessions-surface-list'})).toHaveLength(0);
    const expand = renderer!.root.findByProps({'aria-label': 'Expand recent sessions'});
    expect(renderer!.root.findByProps({className: 'chat-recent-sessions-surface-title'}).children).toEqual(['Recent Sessions']);

    await ReactTestRenderer.act(() => {
      expand.props.onClick();
    });

    const unpin = renderer!.root.findByProps({'aria-label': 'Unpin recent sessions'});
    await ReactTestRenderer.act(() => {
      unpin.props.onClick();
    });

    expect(onUnpin).toHaveBeenCalledTimes(1);
  });
});
