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
  test('renders Recent Sessions before Plan in one desktop-only left stack', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainSource = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stackStart = mainSource.indexOf('className="chat-edge-surface-stack"');
    const stackSource = stackStart >= 0 ? mainSource.slice(stackStart, stackStart + 1800) : '';

    expect(stackStart).toBeGreaterThanOrEqual(0);
    expect(stackSource).toContain('showPinnedRecentSessionsSurface ? (');
    expect(stackSource.indexOf('<ChatRecentSessionsSurface')).toBeLessThan(
      stackSource.indexOf('<ChatPlanSurface'),
    );
    expect(mainSource).toContain('isWide && (showPinnedRecentSessionsSurface || selectedChatPlan) ? (');
  });

  test('uses one 360px stack width and an 8px gap without reserving a Recent placeholder', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readSourceText(path.join(projectRoot, 'web', 'src', 'styles', 'chat.css'));
    const stackRule = cssRuleBlock(stylesCss, '.chat-edge-surface-stack');
    const stackItemRule = cssRuleBlock(
      stylesCss,
      '.chat-edge-surface-stack > .chat-recent-sessions-surface.desktop,\n.chat-edge-surface-stack > .chat-plan-surface.desktop',
    );

    expect(stackRule).toContain('--chat-edge-surface-stack-width: 360px;');
    expect(stackRule).toContain('display: flex;');
    expect(stackRule).toContain('flex-direction: column;');
    expect(stackRule).toContain('gap: 8px;');
    expect(stackItemRule).toContain('position: relative;');
    expect(stackItemRule).toContain('width: 100%;');
    expect(stackItemRule).toContain('pointer-events: auto;');
  });

  test('keeps mobile Plan outside the stack and restores only the hovered desktop panel', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainSource = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const planSource = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'ChatPlanSurface.tsx'));
    const stylesCss = readSourceText(path.join(projectRoot, 'web', 'src', 'styles', 'chat.css'));

    expect(planSource).toContain("useChatEdgeSurfaceGeometry('left'");
    expect(stylesCss).toContain(
      '.chat-recent-sessions-surface.desktop .chat-edge-surface-content,\n.chat-plan-surface.desktop .chat-edge-surface-glass,\n.chat-plan-surface.desktop .chat-edge-surface-content {',
    );
    expect(mainSource).toContain('<ChatPlanSurface\n              mode="mobile"');
    expect(stylesCss).toContain(
      '.chat-recent-sessions-surface.desktop:is(:hover, :focus-within),\n.chat-plan-surface.desktop:is(:hover, :focus-within) {',
    );
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

    [planSource, recentSource].forEach(source => {
      expect(source).toContain('useChatEdgeSurfaceGeometry');
      expect(source).toContain('className="chat-edge-surface-glass"');
      expect(source).toContain('className="chat-edge-surface-content"');
    });
  });

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
        sessionListDensity: 'relaxed' | 'compact';
      }>;
    };
    const onUnpin = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRecentSessionsSurface onUnpin={onUnpin} sessionListDensity="compact">
          <div data-test-id="recent-row">Recent row</div>
        </ChatRecentSessionsSurface>,
      );
    });

    expect(renderer!.root.findByProps({'aria-label': 'Recent sessions'}).props['data-session-list-density']).toBe('compact');
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
