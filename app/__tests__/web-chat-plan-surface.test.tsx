import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {ChatPlanSurface} from '../web/src/chat/ChatPlanSurface';
import {ChatRecentSessionsSurface} from '../web/src/chat/ChatRecentSessionsSurface';
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

async function renderPlan(plan: ChatPlanSnapshot = planSnapshot(), mode: 'desktop' | 'mobile' = 'desktop') {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<ChatPlanSurface mode={mode} plan={plan} />);
  });
  return renderer!;
}

describe('ChatPlanSurface', () => {
  test('collapses desktop plan into the shared header with a current-step summary', async () => {
    const renderer = await renderPlan();

    expect(renderer.root.findAllByProps({className: 'chat-plan-surface-list'})).toHaveLength(1);
    expect(renderer.root.findByProps({className: 'chat-edge-surface-title'}).children).toEqual(['Plan']);
    const toggle = renderer.root.findByProps({'aria-label': 'Collapse Plan'});

    await ReactTestRenderer.act(() => toggle.props.onClick());
    expect(renderer.root.findAllByProps({className: 'chat-plan-surface-list'})).toHaveLength(0);
    const expand = renderer.root.findByProps({'aria-label': 'Expand Plan'});
    expect(expand.findAllByType('svg')).toHaveLength(1);
    expect(renderer.root.findByProps({className: 'chat-edge-surface-summary'}).children).toContain('Patch the UI');

    await ReactTestRenderer.act(() => expand.props.onClick());
    expect(renderer.root.findAllByProps({className: 'chat-plan-surface-list'})).toHaveLength(1);
  });

  test('reveals the desktop Plan only after a sustained pointer hover', async () => {
    jest.useFakeTimers();
    const renderer = await renderPlan();
    const desktopSurface = () => renderer.root.findByProps({'aria-label': 'Current plan'});

    try {
      expect(desktopSurface().props.className).not.toContain('chat-edge-surface-hover-revealed');
      await ReactTestRenderer.act(() => {
        desktopSurface().props.onPointerEnter({pointerType: 'mouse'});
        jest.advanceTimersByTime(599);
      });
      expect(desktopSurface().props.className).not.toContain('chat-edge-surface-hover-revealed');

      await ReactTestRenderer.act(() => jest.advanceTimersByTime(1));
      expect(desktopSurface().props.className).toContain('chat-edge-surface-hover-revealed');

      await ReactTestRenderer.act(() => desktopSurface().props.onPointerLeave());
      expect(desktopSurface().props.className).not.toContain('chat-edge-surface-hover-revealed');
    } finally {
      renderer.unmount();
      jest.useRealTimers();
    }
  });

  test('cancels the desktop Plan reveal when the pointer leaves early', async () => {
    jest.useFakeTimers();
    const renderer = await renderPlan();
    try {
      const surface = renderer.root.findByProps({'aria-label': 'Current plan'});
      await ReactTestRenderer.act(() => {
        surface.props.onPointerEnter({pointerType: 'mouse'});
        jest.advanceTimersByTime(300);
        surface.props.onPointerLeave();
        jest.advanceTimersByTime(600);
      });
      expect(renderer.root.findByProps({'aria-label': 'Current plan'}).props.className).not.toContain(
        'chat-edge-surface-hover-revealed',
      );
    } finally {
      renderer.unmount();
      jest.useRealTimers();
    }
  });

  test.each([
    {collapsed: true, trigger: 'Expand Recent Sessions', listLength: 1},
    {collapsed: false, trigger: 'Collapse Recent Sessions', listLength: 1},
  ])('renders the shared Sessions header in $collapsed state', async ({collapsed, trigger, listLength}) => {
    const onToggleCollapsed = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRecentSessionsSurface collapsed={collapsed} onToggleCollapsed={onToggleCollapsed}>
          <div data-test-id="recent-row">Recent row</div>
        </ChatRecentSessionsSurface>,
      );
    });

    expect(renderer!.root.findAllByProps({className: 'chat-recent-sessions-surface-list'})).toHaveLength(listLength);
    expect(renderer!.root.findByProps({className: 'chat-edge-surface-title'}).children).toEqual(['Recent Sessions']);
    if (!collapsed) {
      expect(renderer!.root.findByProps({'aria-label': 'Recent sessions'}).props['data-session-list-density']).toBe('relaxed');
    }
    const toggle = renderer!.root.findByProps({'aria-label': trigger});
    expect(toggle.findAllByType('svg')).toHaveLength(1);
    await ReactTestRenderer.act(() => toggle.props.onClick());
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
    renderer!.unmount();
  });

  test('renders Lucide step markers and a segmented progress track', async () => {
    const renderer = await renderPlan();
    const iconNames = renderer.root.findAllByType('svg').map(svg => svg.props['data-icon-name']);
    expect(iconNames).toEqual(expect.arrayContaining(['check', 'arrowRight', 'circle']));
    expect(renderer.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('codicon'))).toHaveLength(0);
    const track = renderer.root.findByProps({className: 'chat-plan-progress-track segmented'});
    expect(track.findAllByProps({className: 'chat-plan-progress-segment completed'})).toHaveLength(1);
    expect(track.findAllByProps({className: 'chat-plan-progress-segment in-progress'})).toHaveLength(1);
    expect(track.findAllByProps({className: 'chat-plan-progress-segment pending'})).toHaveLength(1);
    expect(renderer.root.findByProps({className: 'chat-plan-progress'}).children).toEqual(['2/3']);
  });

  test('uses a continuous accent bar beyond twelve steps', async () => {
    const bigPlan: ChatPlanSnapshot = {
      turnIndex: 3,
      entries: Array.from({length: 13}, (_, index) => ({
        content: `Step ${index + 1}`,
        status: index < 5 ? 'completed' : index === 5 ? 'in_progress' : 'pending',
      })),
      activeEntry: {content: 'Step 6', status: 'in_progress'},
      activeIndex: 5,
      completedCount: 5,
      totalCount: 13,
    };
    const renderer = await renderPlan(bigPlan);
    const track = renderer.root.findByProps({className: 'chat-plan-progress-track continuous active'});
    expect(track.findByProps({className: 'chat-plan-progress-track-fill'}).props.style.width).toBe('38%');
    expect(renderer.root.findAllByProps({className: 'chat-plan-progress-track segmented'})).toHaveLength(0);
    expect(renderer.root.findByProps({className: 'chat-plan-progress'}).children).toEqual(['6/13']);
  });

  test('keeps the mobile pill text-only and uses Lucide icons', async () => {
    const renderer = await renderPlan(planSnapshot(), 'mobile');
    expect(renderer.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('chat-plan-progress-track'))).toHaveLength(0);
    expect(renderer.root.findByProps({className: 'chat-plan-progress'}).children).toEqual(['2/3']);
    expect(renderer.root.findAllByType('svg').map(svg => svg.props['data-icon-name'])).toContain('arrowRight');
    expect(renderer.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('codicon'))).toHaveLength(0);
  });
});
