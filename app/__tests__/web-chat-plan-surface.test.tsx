import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import fs from 'fs';
import path from 'path';

import {ChatPlanSurface} from '../web/src/chat/ChatPlanSurface';
import type {ChatPlanSnapshot} from '../web/src/chat/chatPlan';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function cssRuleBlock(stylesCss: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesCss.match(new RegExp(`${escapedSelector} \\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? '';
}

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
  test('renders Recent Sessions, Plan, and Monitor in one desktop-only left stack', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainSource = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stackStart = mainSource.indexOf('chat-edge-surface-stack');
    const stackSource = stackStart >= 0 ? mainSource.slice(stackStart, stackStart + 2600) : '';

    expect(stackStart).toBeGreaterThanOrEqual(0);
    expect(stackSource).toContain('showFloatingSessionPanel ? (');
    expect(stackSource.indexOf('<ChatRecentSessionsSurface')).toBeLessThan(
      stackSource.indexOf('<ChatPlanSurface'),
    );
    expect(stackSource.indexOf('<ChatPlanSurface')).toBeLessThan(
      stackSource.indexOf('<MonitorSurface'),
    );
    expect(stackSource).toContain("showMonitor ? (");
    expect(mainSource).toContain('isWide ? (');
  });

  test('uses one 360px stack width and an 8px gap without reserving a Recent placeholder', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readSourceText(path.join(projectRoot, 'web', 'src', 'styles', 'chat.css'));
    const stackRule = cssRuleBlock(stylesCss, '.chat-edge-surface-stack');
    const recentFixedRule = cssRuleBlock(stylesCss, '.chat-view-width-fixed-800 .chat-recent-sessions-surface.desktop');
    const planFixedRule = cssRuleBlock(stylesCss, '.chat-view-width-fixed-800 .chat-plan-surface.desktop');
    const stackItemRule = cssRuleBlock(
      stylesCss,
      '.chat-edge-surface-stack > .chat-recent-sessions-surface.desktop,\n.chat-edge-surface-stack > .chat-goal-surface.desktop,\n.chat-edge-surface-stack > .chat-plan-surface.desktop,\n.chat-edge-surface-stack > .chat-function-surface.desktop',
    );

    expect(stylesCss).toContain('--chat-edge-surface-width: var(--chat-session-panel-width);');
    expect(stackRule).toContain('--chat-edge-surface-stack-width: var(--chat-edge-surface-width);');
    expect(stackRule).toContain('display: flex;');
    expect(stackRule).toContain('flex-direction: column;');
    expect(stackRule).toContain('gap: 8px;');
    expect(stackItemRule).toContain('position: relative;');
    expect(stackItemRule).toContain('bottom: auto;');
    expect(stackItemRule).toContain('width: 100%;');
    expect(stackItemRule).toContain('pointer-events: auto;');
    expect(recentFixedRule).toContain('left: var(--chat-recent-sessions-edge-gap);');
    expect(recentFixedRule).not.toContain('(100% - 800px) / 2');
    expect(planFixedRule).toContain('left: var(--chat-plan-edge-gap);');
    expect(planFixedRule).not.toContain('(100% + 800px) / 2');
  });

  test('keeps wrapped plan steps from shrinking inside the scrollable list', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readSourceText(path.join(projectRoot, 'web', 'src', 'styles', 'chat.css'));
    const planStepRule = cssRuleBlock(stylesCss, '.chat-plan-step');

    expect(planStepRule).toContain('flex: 0 0 auto;');
  });

  test('keeps mobile Plan outside the stack and restores desktop edges through scoped reveal rules', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainSource = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const planSource = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'ChatPlanSurface.tsx'));
    const stylesCss = readSourceText(path.join(projectRoot, 'web', 'src', 'styles', 'chat.css'));

    expect(planSource).toContain("useChatEdgeSurfaceGeometry('left'");
    expect(stylesCss).toContain(
      '.chat-recent-sessions-surface.desktop .chat-edge-surface-content,\n.chat-goal-surface.desktop .chat-edge-surface-glass,\n.chat-goal-surface.desktop .chat-edge-surface-content,\n.chat-plan-surface.desktop .chat-edge-surface-glass,\n.chat-plan-surface.desktop .chat-edge-surface-content,\n.chat-function-surface.desktop .chat-edge-surface-glass,\n.chat-function-surface.desktop .chat-edge-surface-content {',
    );
    expect(mainSource).toMatch(/<ChatPlanSurface\s+mode="mobile"/);
    expect(stylesCss).toContain('.chat-recent-sessions-surface.desktop:is(:hover, :focus-within),');
    expect(stylesCss).toContain('.chat-goal-surface.desktop:is(.chat-edge-surface-hover-revealed, :focus-within),');
    expect(stylesCss).toContain('.chat-plan-surface.desktop:is(.chat-edge-surface-hover-revealed, :focus-within),');
    expect(stylesCss).toContain('.chat-function-surface.desktop.monitor-surface:is(.chat-edge-surface-hover-revealed, :focus-within) {');
    expect(stylesCss).not.toContain('.chat-plan-surface.desktop:is(:hover');
    expect(stylesCss).not.toContain('.chat-function-surface.desktop.monitor-surface:is(:hover');
    expect(stylesCss).not.toContain('.chat-edge-surface-stack:is(:hover, :focus-within)');
  });

  test('renders separate geometry-aware glass and content layers on desktop', () => {
    const projectRoot = path.join(__dirname, '..');
    const planSource = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'chat', 'ChatPlanSurface.tsx'),
      'utf8',
    );
    const recentSource = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'chat', 'ChatRecentSessionsSurface.tsx'),
      'utf8',
    );
    const panelSource = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'chat', 'ChatSessionPanel.tsx'),
      'utf8',
    );

    expect(planSource).toContain('useChatEdgeSurfaceGeometry');
    expect(planSource).toContain('className="chat-edge-surface-glass"');
    expect(planSource).toContain('className="chat-edge-surface-content"');
    expect(recentSource).toContain('useChatEdgeSurfaceGeometry');
    expect(recentSource).toContain('<ChatSessionPanel');
    expect(panelSource).toContain('className="chat-edge-surface-glass"');
    expect(panelSource).toContain('className="chat-edge-surface-content chat-session-panel-content"');
  });

  test('collapses desktop plan into the shared header with a current-step summary', async () => {
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
    expect(renderer!.root.findByProps({className: 'chat-edge-surface-title'}).children).toEqual(['Plan']);
    const toggle = renderer!.root.findByProps({'aria-label': 'Collapse Plan'});

    await ReactTestRenderer.act(() => {
      toggle.props.onClick();
    });

    expect(renderer!.root.findAllByProps({className: 'chat-plan-surface-list'})).toHaveLength(0);
    const expand = renderer!.root.findByProps({'aria-label': 'Expand Plan'});
    expect(expand.findAllByType('svg')).toHaveLength(1);
    expect(renderer!.root.findByProps({className: 'chat-edge-surface-summary'}).children).toContain('Patch the UI');

    await ReactTestRenderer.act(() => {
      expand.props.onClick();
    });

    expect(renderer!.root.findAllByProps({className: 'chat-plan-surface-list'})).toHaveLength(1);
  });

  test('reveals the desktop Plan only after a sustained pointer hover', async () => {
    jest.useFakeTimers();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    const desktopSurface = () => renderer!.root.findByProps({'aria-label': 'Current plan'});

    try {
      await ReactTestRenderer.act(() => {
        renderer = ReactTestRenderer.create(
          <ChatPlanSurface mode="desktop" plan={planSnapshot()} />,
        );
      });

      const surface = desktopSurface();
      expect(surface.props.className).not.toContain('chat-edge-surface-hover-revealed');
      expect(typeof surface.props.onPointerEnter).toBe('function');

      await ReactTestRenderer.act(() => {
        surface.props.onPointerEnter({pointerType: 'mouse'});
        jest.advanceTimersByTime(599);
      });
      expect(desktopSurface().props.className).not.toContain('chat-edge-surface-hover-revealed');

      await ReactTestRenderer.act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(desktopSurface().props.className).toContain('chat-edge-surface-hover-revealed');

      await ReactTestRenderer.act(() => {
        desktopSurface().props.onPointerLeave();
      });
      expect(desktopSurface().props.className).not.toContain('chat-edge-surface-hover-revealed');
    } finally {
      renderer?.unmount();
      jest.useRealTimers();
    }
  });

  test('cancels the desktop Plan reveal when the pointer leaves early', async () => {
    jest.useFakeTimers();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    try {
      await ReactTestRenderer.act(() => {
        renderer = ReactTestRenderer.create(
          <ChatPlanSurface mode="desktop" plan={planSnapshot()} />,
        );
      });
      const surface = renderer!.root.findByProps({'aria-label': 'Current plan'});

      await ReactTestRenderer.act(() => {
        surface.props.onPointerEnter({pointerType: 'mouse'});
        jest.advanceTimersByTime(300);
        surface.props.onPointerLeave();
        jest.advanceTimersByTime(600);
      });

      expect(renderer!.root.findByProps({'aria-label': 'Current plan'}).props.className)
        .not.toContain('chat-edge-surface-hover-revealed');
    } finally {
      renderer?.unmount();
      jest.useRealTimers();
    }
  });

  test('renders the shared Sessions header when collapsed and reports toggle clicks', async () => {
    const projectRoot = path.join(__dirname, '..');
    const surfacePath = path.join(projectRoot, 'web', 'src', 'chat', 'ChatRecentSessionsSurface.tsx');

    expect(fs.existsSync(surfacePath)).toBe(true);
    const {ChatRecentSessionsSurface} = require(surfacePath) as {
      ChatRecentSessionsSurface: React.ComponentType<{
         children: React.ReactNode;
         collapsed: boolean;
         onToggleCollapsed: () => void;
       }>;
    };
    const onToggleCollapsed = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRecentSessionsSurface collapsed={true} onToggleCollapsed={onToggleCollapsed}>
          <div data-test-id="recent-row">Recent row</div>
        </ChatRecentSessionsSurface>,
      );
    });

    expect(renderer!.root.findAllByProps({className: 'chat-recent-sessions-surface-list'})).toHaveLength(0);
    expect(renderer!.root.findByProps({className: 'chat-edge-surface-title'}).children).toEqual(['Recent Sessions']);
    const trigger = renderer!.root.findByProps({'aria-label': 'Expand Recent Sessions'});
    expect(trigger.findAllByType('svg')).toHaveLength(1);

    await ReactTestRenderer.act(() => {
      trigger.props.onClick();
    });

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  test('renders the expanded list when not collapsed and reports toggle clicks', async () => {
    const projectRoot = path.join(__dirname, '..');
    const surfacePath = path.join(projectRoot, 'web', 'src', 'chat', 'ChatRecentSessionsSurface.tsx');

    const {ChatRecentSessionsSurface} = require(surfacePath) as {
      ChatRecentSessionsSurface: React.ComponentType<{
         children: React.ReactNode;
         collapsed: boolean;
         onToggleCollapsed: () => void;
       }>;
    };
    const onToggleCollapsed = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRecentSessionsSurface collapsed={false} onToggleCollapsed={onToggleCollapsed}>
          <div data-test-id="recent-row">Recent row</div>
        </ChatRecentSessionsSurface>,
      );
    });

    expect(renderer!.root.findByProps({'aria-label': 'Recent sessions'}).props['data-session-list-density']).toBe('relaxed');
    expect(renderer!.root.findAllByProps({className: 'chat-recent-sessions-surface-list'})).toHaveLength(1);
    expect(renderer!.root.findByProps({className: 'chat-edge-surface-title'}).children).toEqual(['Recent Sessions']);
    const collapse = renderer!.root.findByProps({'aria-label': 'Collapse Recent Sessions'});

    await ReactTestRenderer.act(() => {
      collapse.props.onClick();
    });

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  test('renders Lucide step markers and a segmented progress track in the desktop header', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatPlanSurface mode="desktop" plan={planSnapshot()} />,
      );
    });

    const iconNames = renderer!.root.findAllByType('svg').map(svg => svg.props['data-icon-name']);
    expect(iconNames).toContain('check');
    expect(iconNames).toContain('arrowRight');
    expect(iconNames).toContain('circle');
    expect(renderer!.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('codicon'))).toHaveLength(0);

    const track = renderer!.root.findByProps({className: 'chat-plan-progress-track segmented'});
    expect(track.findAllByProps({className: 'chat-plan-progress-segment completed'})).toHaveLength(1);
    expect(track.findAllByProps({className: 'chat-plan-progress-segment in-progress'})).toHaveLength(1);
    expect(track.findAllByProps({className: 'chat-plan-progress-segment pending'})).toHaveLength(1);
    expect(renderer!.root.findByProps({className: 'chat-plan-progress'}).children).toEqual(['2/3']);
  });

  test('falls back to a continuous accent bar beyond twelve steps', async () => {
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
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatPlanSurface mode="desktop" plan={bigPlan} />,
      );
    });

    const track = renderer!.root.findByProps({className: 'chat-plan-progress-track continuous active'});
    expect(track.findByProps({className: 'chat-plan-progress-track-fill'}).props.style.width).toBe('38%');
    expect(renderer!.root.findAllByProps({className: 'chat-plan-progress-track segmented'})).toHaveLength(0);
    expect(renderer!.root.findByProps({className: 'chat-plan-progress'}).children).toEqual(['6/13']);
  });

  test('keeps the mobile pill text-only with glass material and Lucide icons', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatPlanSurface mode="mobile" plan={planSnapshot()} />,
      );
    });

    expect(renderer!.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('chat-plan-progress-track'))).toHaveLength(0);
    expect(renderer!.root.findByProps({className: 'chat-plan-progress'}).children).toEqual(['2/3']);
    const iconNames = renderer!.root.findAllByType('svg').map(svg => svg.props['data-icon-name']);
    expect(iconNames).toContain('arrowRight');
    expect(renderer!.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('codicon'))).toHaveLength(0);

    const stylesCss = readSourceText(path.join(__dirname, '..', 'web', 'src', 'styles', 'chat.css'));
    const pillRule = cssRuleBlock(stylesCss, '.chat-plan-compact-trigger');
    expect(pillRule).toContain('border: 1px solid var(--border-faint);');
    expect(pillRule).toContain('blur(12px) saturate(1.1)');
  });
});
