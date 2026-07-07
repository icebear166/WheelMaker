import {
  chatConfigCurrentLabel,
  formatChatContextUsage,
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
      available: true,
      percent: 8,
      percentText: '8%',
      usedText: '19k',
      sizeText: '258k',
      title: 'Context window: 8% used (19k / 258k tokens)',
    });
  });

  test('keeps a neutral context usage affordance before Codex reports tokens', () => {
    expect(formatChatContextUsage(null)).toEqual({
      available: false,
      percent: 0,
      percentText: '--',
      usedText: '--',
      sizeText: '--',
      title: 'Context window usage will appear after Codex reports token usage',
    });
  });

  test('uses the reasoning effort option label as compact status text', () => {
    expect(
      chatConfigCurrentLabel(
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
      ),
    ).toBe('High');
  });

  test('falls back to the raw reasoning effort value when no label is configured', () => {
    expect(
      chatConfigCurrentLabel(
        option({
          id: 'reasoning_effort',
          name: 'Reasoning',
          currentValue: 'max',
        }),
      ),
    ).toBe('max');
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
      'personality',
      'approval_preset',
    ]);
    expect(compact.showOverflowToggle).toBe(true);

    const wide = splitChatComposerStatusOptions(options, false);
    expect(wide.modelOption?.id).toBe('model');
    expect(wide.reasoningOption?.id).toBe('reasoning_effort');
    expect(wide.secondaryOptions.map(item => item.id)).toEqual([
      'personality',
      'approval_preset',
    ]);
    expect(wide.overflowOptions).toEqual([]);
    expect(wide.showOverflowToggle).toBe(false);
  });

  test('keeps composer status controls on a single visual rhythm', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain('renderChatStatusEffort(chatConfigStatus.reasoningOption)');
    expect(mainTsx).not.toContain('chat-status-secondary-divider');
    expect(mainTsx).not.toContain('chatConfigIconClass(option)');
    expect(mainTsx).not.toContain('chat-status-signal-bar');
    expect(stylesCss).not.toContain('.chat-status-secondary-divider');
    expect(stylesCss).not.toContain('.chat-config-pill .codicon');
    expect(stylesCss).not.toContain('chat-status-signal-bar');
    expect(stylesCss).toMatch(/\.chat-status-model-button,\s*\.chat-status-effort-button \{[\s\S]*height: 24px;/);
    expect(cssRuleBlock(stylesCss, '.chat-status-model-control')).toContain('flex: 0 1 auto;');
    expect(cssRuleBlock(stylesCss, '.chat-status-model-button')).toContain('flex: 0 1 auto;');
    expect(cssRuleBlock(stylesCss, '.chat-status-effort-button')).toContain('flex: 0 0 auto;');
    expect(cssRuleBlock(stylesCss, '.chat-config-options-shell')).toContain('max-width: 100%;');
    expect(cssRuleBlock(stylesCss, '.chat-config-options-wrap')).toContain('flex: 1 1 auto;');
    expect(cssRuleBlock(stylesCss, '.chat-config-pill')).toContain('height: 24px;');
    expect(cssRuleBlock(stylesCss, '.chat-config-overflow-button')).toContain('height: 24px;');
    expect(cssRuleBlock(stylesCss, '.chat-context-usage::after')).toContain('inset: 2px;');
    expect(cssRuleBlock(stylesCss, '.chat-context-usage.pending::after')).toContain('inset: 2px;');
  });

  test('uses a custom context usage popover that can be opened on click', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain('const [chatContextUsageOpen, setChatContextUsageOpen] = useState(false);');
    expect(mainTsx).toContain('const chatContextUsageRef = useRef<HTMLDivElement | null>(null);');
    expect(mainTsx).toContain('if (target && chatContextUsageRef.current?.contains(target)) return;');
    expect(mainTsx).toContain('setChatContextUsageOpen(false);');
    expect(mainTsx).toContain("className={`chat-context-usage-anchor${chatContextUsageOpen ? ' open' : ''}`}");
    expect(mainTsx).toContain('className="chat-context-usage-popover"');
    expect(mainTsx).toContain('role="tooltip"');
    expect(mainTsx).toContain('aria-expanded={chatContextUsageOpen}');
    expect(mainTsx).toContain('aria-labelledby="chat-context-usage-label"');
    expect(mainTsx).toContain('className="chat-context-usage-a11y-label"');
    expect(mainTsx).not.toContain('aria-label={chatContextUsage.title}');
    expect(mainTsx).not.toContain('title={chatContextUsage.title}');
    expect(stylesCss).toContain('.chat-context-usage-popover {');
    expect(stylesCss).not.toContain('.chat-context-usage-popover::after');
    expect(stylesCss).toContain('.chat-context-usage-anchor:hover .chat-context-usage-popover,');
    expect(stylesCss).toContain(".chat-context-usage-anchor.open .chat-context-usage-popover {");
    expect(cssRuleBlock(stylesCss, '.chat-context-usage-popover')).toContain('position: fixed;');
    expect(cssRuleBlock(stylesCss, '.chat-context-usage-popover')).toContain('opacity: 0;');
    expect(cssRuleBlock(stylesCss, '.chat-context-usage-popover')).toContain('box-shadow:');
  });

  test('raises config popovers above the current task surface only while open', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain("chatConfigMenuOptionId || chatConfigOverflowOpen || chatContextUsageOpen ? ' config-menu-open' : ''");

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
