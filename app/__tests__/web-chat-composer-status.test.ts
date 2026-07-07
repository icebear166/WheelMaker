import {
  formatChatContextUsage,
  resolveChatReasoningSignal,
  splitChatComposerStatusOptions,
} from '../web/src/chat/session/chatComposerStatus';
import type { RegistrySessionConfigOption } from '../web/src/registry/registryTypes';
import fs from 'fs';
import path from 'path';

import { readWebStyles } from '../testHelpers/webStyles';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function cssRuleBlock(stylesCss: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesCss.match(new RegExp(`${escapedSelector} \\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? '';
}

function zIndexValue(rule: string): number {
  const match = rule.match(/z-index:\s*(\d+);/);
  return match ? Number(match[1]) : -1;
}

function option(
  partial: RegistrySessionConfigOption,
): RegistrySessionConfigOption {
  return partial;
}

describe('chat composer status helpers', () => {
  test('formats context usage with rounded-up percent and compact token counts', () => {
    expect(
      formatChatContextUsage({
        used: 19000,
        size: 258000,
        updatedAt: '2026-07-07T08:00:00Z',
      }),
    ).toEqual({
      percent: 8,
      percentText: '8%',
      usedText: '19k',
      sizeText: '258k',
      title: 'Context window: 8% used (19k / 258k tokens)',
    });
  });

  test('resolves reasoning effort into active signal bars from configured levels', () => {
    const signal = resolveChatReasoningSignal(
      option({
        id: 'reasoning_effort',
        name: 'Reasoning',
        currentValue: 'high',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'medium', name: 'Medium' },
          { value: 'high', name: 'High' },
        ],
      }),
    );

    expect(signal).toEqual({
      activeBars: 3,
      totalBars: 3,
      label: 'High',
      value: 'high',
    });
  });

  test('keeps usage model and reasoning visible while compacting secondary options', () => {
    const options: RegistrySessionConfigOption[] = [
      option({
        id: 'model',
        name: 'Model',
        currentValue: 'gpt-5.5',
        options: [{ value: 'gpt-5.5', name: 'GPT 5.5' }],
      }),
      option({
        id: 'reasoning_effort',
        name: 'Reasoning',
        currentValue: 'high',
        options: [{ value: 'high', name: 'High' }],
      }),
      option({ id: 'approval_preset', name: 'Access', currentValue: 'full' }),
      option({
        id: 'personality',
        name: 'Personality',
        currentValue: 'pragmatic',
      }),
    ];

    const compact = splitChatComposerStatusOptions(options, true);
    expect(compact.modelOption?.id).toBe('model');
    expect(compact.reasoningOption?.id).toBe('reasoning_effort');
    expect(compact.secondaryOptions).toEqual([]);
    expect(compact.overflowOptions.map(item => item.id)).toEqual([
      'approval_preset',
      'personality',
    ]);
    expect(compact.showOverflowToggle).toBe(true);

    const wide = splitChatComposerStatusOptions(options, false);
    expect(wide.modelOption?.id).toBe('model');
    expect(wide.reasoningOption?.id).toBe('reasoning_effort');
    expect(wide.secondaryOptions.map(item => item.id)).toEqual([
      'approval_preset',
      'personality',
    ]);
    expect(wide.overflowOptions).toEqual([]);
    expect(wide.showOverflowToggle).toBe(false);
  });

  test('raises config popovers above the current task surface only while open', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain("chatConfigMenuOptionId || chatConfigOverflowOpen ? ' config-menu-open' : ''");

    const planLayer = zIndexValue(cssRuleBlock(stylesCss, '.chat-plan-surface.desktop'));
    const openComposerLayer = zIndexValue(cssRuleBlock(stylesCss, '.chat-composer.config-menu-open'));
    expect(planLayer).toBeGreaterThan(0);
    expect(openComposerLayer).toBeGreaterThan(planLayer);

    const overflowMenu = cssRuleBlock(stylesCss, '.chat-config-overflow-menu');
    const valueMenu = cssRuleBlock(stylesCss, '.chat-config-value-menu');
    expect(overflowMenu).toContain('z-index: var(--chat-config-popover-layer);');
    expect(valueMenu).toContain('z-index: var(--chat-config-popover-layer);');
  });
});
