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
  test('renders Recent Sessions, Plan, and Limits in one desktop-only left stack', () => {
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
      stackSource.indexOf('<UsageFeatureSurface'),
    );
    expect(stackSource).toContain("showLimitsMonitor ? (");
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
      '.chat-edge-surface-stack > .chat-recent-sessions-surface.desktop,\n.chat-edge-surface-stack > .chat-plan-surface.desktop,\n.chat-edge-surface-stack > .chat-function-surface.desktop',
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

  test('keeps mobile Plan outside the stack and restores only hovered Recent Sessions', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainSource = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const planSource = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'ChatPlanSurface.tsx'));
    const stylesCss = readSourceText(path.join(projectRoot, 'web', 'src', 'styles', 'chat.css'));

    expect(planSource).toContain("useChatEdgeSurfaceGeometry('left'");
    expect(stylesCss).toContain(
      '.chat-recent-sessions-surface.desktop .chat-edge-surface-content,\n.chat-plan-surface.desktop .chat-edge-surface-glass,\n.chat-plan-surface.desktop .chat-edge-surface-content,\n.chat-function-surface.desktop .chat-edge-surface-glass,\n.chat-function-surface.desktop .chat-edge-surface-content {',
    );
    expect(mainSource).toContain('<ChatPlanSurface\n              mode="mobile"');
    expect(stylesCss).toContain('.chat-recent-sessions-surface.desktop:is(:hover, :focus-within) {');
    expect(stylesCss).not.toContain('.chat-plan-surface.desktop:is(:hover, :focus-within)');
    expect(stylesCss).not.toContain('.chat-function-surface.desktop:is(:hover, :focus-within)');
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
    expect(expand.findByProps({'aria-hidden': 'true'}).props.className).toContain('codicon-chevron-right');
    expect(renderer!.root.findByProps({className: 'chat-edge-surface-summary'}).children).toContain('Patch the UI');

    await ReactTestRenderer.act(() => {
      expand.props.onClick();
    });

    expect(renderer!.root.findAllByProps({className: 'chat-plan-surface-list'})).toHaveLength(1);
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
        sessionListDensity: 'relaxed' | 'compact';
      }>;
    };
    const onToggleCollapsed = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRecentSessionsSurface collapsed={true} onToggleCollapsed={onToggleCollapsed} sessionListDensity="compact">
          <div data-test-id="recent-row">Recent row</div>
        </ChatRecentSessionsSurface>,
      );
    });

    expect(renderer!.root.findAllByProps({className: 'chat-recent-sessions-surface-list'})).toHaveLength(0);
    expect(renderer!.root.findByProps({className: 'chat-edge-surface-title'}).children).toEqual(['Recent Sessions']);
    const trigger = renderer!.root.findByProps({'aria-label': 'Expand Recent Sessions'});
    expect(trigger.findByProps({'aria-hidden': 'true'}).props.className).toContain('codicon-chevron-right');

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
        sessionListDensity: 'relaxed' | 'compact';
      }>;
    };
    const onToggleCollapsed = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRecentSessionsSurface collapsed={false} onToggleCollapsed={onToggleCollapsed} sessionListDensity="compact">
          <div data-test-id="recent-row">Recent row</div>
        </ChatRecentSessionsSurface>,
      );
    });

    expect(renderer!.root.findByProps({'aria-label': 'Recent sessions'}).props['data-session-list-density']).toBe('compact');
    expect(renderer!.root.findAllByProps({className: 'chat-recent-sessions-surface-list'})).toHaveLength(1);
    expect(renderer!.root.findByProps({className: 'chat-edge-surface-title'}).children).toEqual(['Recent Sessions']);
    const collapse = renderer!.root.findByProps({'aria-label': 'Collapse Recent Sessions'});

    await ReactTestRenderer.act(() => {
      collapse.props.onClick();
    });

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });
});
