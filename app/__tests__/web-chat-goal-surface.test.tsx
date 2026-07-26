import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import fs from 'fs';
import path from 'path';

import {ChatGoalSurface} from '../web/src/chat/ChatGoalSurface';
import {
  canResumeGoal,
  formatGoalElapsed,
  formatGoalTokens,
} from '../web/src/chat/chatGoal';
import type {
  RegistrySessionGoal,
  RegistrySessionGoalStatus,
} from '../web/src/registry/registryTypes';

function goal(overrides: Partial<RegistrySessionGoal> = {}): RegistrySessionGoal {
  return {
    sessionId: 'session-1',
    objective: 'Ship Session Goal without losing queued prompts',
    status: 'active',
    tokenBudget: null,
    tokensUsed: 12_345,
    timeUsedSeconds: 3_661,
    createdAt: 10,
    updatedAt: 11,
    ...overrides,
  };
}

async function renderGoal(
  status: RegistrySessionGoalStatus,
  mode: 'desktop' | 'mobile' = 'desktop',
) {
  const handlers = {
    onPause: jest.fn(),
    onResume: jest.fn(),
    onEdit: jest.fn(),
    onClear: jest.fn(),
  };
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <ChatGoalSurface
        mode={mode}
        goal={goal({status})}
        {...handlers}
      />,
    );
  });
  return {renderer: renderer!, handlers};
}

describe('ChatGoalSurface', () => {
  test('formats Goal stats without locale-dependent fractions', () => {
    expect(formatGoalTokens(9999)).toBe('9,999');
    expect(formatGoalTokens(12_345)).toBe('12K');
    expect(formatGoalElapsed(59)).toBe('0m');
    expect(formatGoalElapsed(3_661)).toBe('1h 1m');
  });

  test('renders an active Goal with tabular stats and Pause', async () => {
    const {renderer, handlers} = await renderGoal('active');

    expect(renderer.root.findByProps({className: 'chat-edge-surface-title'}).children).toEqual(['Goal']);
    expect(renderer.root.findByProps({className: 'chat-goal-budget-value'}).children).toContain('Unlimited');
    expect(renderer.root.findAllByProps({'aria-label': 'Resume goal'})).toHaveLength(0);
    const pause = renderer.root.findByProps({'aria-label': 'Pause goal'});
    expect(pause.props.title).toBe('Pause goal');
    expect(renderer.root.findAllByProps({'data-icon-name': 'target'})).toHaveLength(1);
    expect(renderer.root.findAllByProps({'data-icon-name': 'pause'})).toHaveLength(1);
    const styles = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'styles', 'chat.css'), 'utf8');
    expect(styles).toMatch(/\.chat-goal-stats \{[\s\S]*font-variant-numeric: tabular-nums;/);

    await ReactTestRenderer.act(() => {
      pause.props.onClick();
    });
    expect(handlers.onPause).toHaveBeenCalledTimes(1);
  });

  test.each(['paused', 'blocked', 'usageLimited', 'budgetLimited'] as const)(
    'offers Resume for %s',
    async status => {
      const {renderer, handlers} = await renderGoal(status);
      const resume = renderer.root.findByProps({'aria-label': 'Resume goal'});
      expect(renderer.root.findAllByProps({'aria-label': 'Pause goal'})).toHaveLength(0);
      await ReactTestRenderer.act(() => {
        resume.props.onClick();
      });
      expect(handlers.onResume).toHaveBeenCalledTimes(1);
    },
  );

  test('expands the compact mobile pill without hiding controls', async () => {
    const {renderer} = await renderGoal('paused', 'mobile');
    const trigger = renderer.root.findByProps({'aria-label': 'Expand goal details'});
    expect(renderer.root.findAllByProps({className: 'chat-goal-details'})).toHaveLength(0);
    expect(renderer.root.findByProps({'aria-label': 'Resume goal'})).toBeDefined();

    await ReactTestRenderer.act(() => {
      trigger.props.onClick();
    });

    expect(renderer.root.findAllByProps({className: 'chat-goal-details'})).toHaveLength(1);
    expect(renderer.root.findByProps({'aria-label': 'Collapse goal details'})).toBeDefined();
  });

  test('only non-terminal stopped statuses can resume', () => {
    expect(canResumeGoal('paused')).toBe(true);
    expect(canResumeGoal('blocked')).toBe(true);
    expect(canResumeGoal('usageLimited')).toBe(true);
    expect(canResumeGoal('budgetLimited')).toBe(true);
    expect(canResumeGoal('active')).toBe(false);
    expect(canResumeGoal('complete')).toBe(false);
  });
});
