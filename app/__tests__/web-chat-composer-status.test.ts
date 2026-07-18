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
      summaryText: '19K/258K 8%',
      title: 'Context window: 8% used (19k / 258k tokens)',
    });
  });

  test('omits context usage before the agent reports tokens', () => {
    expect(formatChatContextUsage(null)).toBeNull();
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

  test('capitalizes a raw reasoning effort value when no label is configured', () => {
    expect(
      chatConfigCurrentLabel(
        option({
          id: 'reasoning_effort',
          name: 'Reasoning',
          currentValue: 'max',
        }),
      ),
    ).toBe('Max');
  });

  test('capitalizes a stale lowercase reasoning effort display name', () => {
    expect(
      chatConfigCurrentLabel(
        option({
          id: 'reasoning_effort',
          name: 'Reasoning',
          currentValue: 'high',
          options: [{ value: 'high', name: 'high' }],
        }),
      ),
    ).toBe('High');
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
      option({ id: 'fast_mode', category: 'speed', name: 'Fast', currentValue: 'on' }),
      option({
        id: 'personality',
        name: 'Personality',
        currentValue: 'pragmatic',
      }),
    ];

    const compact = splitChatComposerStatusOptions(options, true);
    expect(compact.modelOption?.id).toBe('model');
    expect(compact.reasoningOption?.id).toBe('reasoning_effort');
    expect(compact.fastOption?.id).toBe('fast_mode');
    expect(compact.coreOptions.map(item => item.kind)).toEqual(['model', 'effort', 'fast']);
    expect(compact.secondaryOptions).toEqual([]);
    expect(compact.overflowOptions.map(item => item.id)).toEqual([
      'personality',
      'approval_preset',
    ]);
    expect(compact.showOverflowToggle).toBe(true);

    const wide = splitChatComposerStatusOptions(options, false);
    expect(wide.modelOption?.id).toBe('model');
    expect(wide.reasoningOption?.id).toBe('reasoning_effort');
    expect(wide.fastOption?.id).toBe('fast_mode');
    expect(wide.coreOptions.map(item => item.kind)).toEqual(['model', 'effort', 'fast']);
    expect(wide.secondaryOptions.map(item => item.id)).toEqual([
      'personality',
      'approval_preset',
    ]);
    expect(wide.overflowOptions).toEqual([]);
    expect(wide.showOverflowToggle).toBe(false);
  });

  test('degrades the core selector to the available config columns', () => {
    const model = option({ id: 'model', name: 'Model', currentValue: 'gpt-5.6' });
    const effort = option({ id: 'reasoning_effort', name: 'Reasoning', currentValue: 'high' });
    const fast = option({ id: 'fast_mode', name: 'Fast', currentValue: 'off' });

    expect(splitChatComposerStatusOptions([model, effort], false).coreOptions.map(item => item.kind)).toEqual(['model', 'effort']);
    expect(splitChatComposerStatusOptions([model], false).coreOptions.map(item => item.kind)).toEqual(['model']);
    expect(splitChatComposerStatusOptions([effort], false).coreOptions.map(item => item.kind)).toEqual(['effort']);
    expect(splitChatComposerStatusOptions([fast], false).coreOptions.map(item => item.kind)).toEqual(['fast']);
    expect(splitChatComposerStatusOptions([], false).coreOptions).toEqual([]);
  });

  test('keeps composer status controls on a single visual rhythm', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain('renderChatCoreConfigSelector()');
    expect(mainTsx).not.toContain('chat-status-secondary-divider');
    expect(mainTsx).not.toContain('chatConfigIconClass(option)');
    expect(mainTsx).not.toContain('chat-status-signal-bar');
    expect(stylesCss).not.toContain('.chat-status-secondary-divider');
    expect(stylesCss).not.toContain('.chat-config-pill .codicon');
    expect(stylesCss).not.toContain('chat-status-signal-bar');
    expect(cssRuleBlock(stylesCss, '.chat-core-config-trigger')).toContain('height: 24px;');
    expect(cssRuleBlock(stylesCss, '.chat-config-options-shell')).toContain('max-width: 100%;');
    expect(cssRuleBlock(stylesCss, '.chat-config-options-wrap')).toContain('flex: 1 1 auto;');
    expect(cssRuleBlock(stylesCss, '.chat-config-pill')).toContain('height: 24px;');
    expect(cssRuleBlock(stylesCss, '.chat-config-overflow-button')).toContain('height: 24px;');
    expect(stylesCss).not.toContain('.chat-context-usage::after');
    const contextUsageRule = cssRuleBlock(stylesCss, '.chat-context-usage');
    expect(contextUsageRule).toContain('--chat-context-ring-width: 1.5px;');
    expect(contextUsageRule).toContain('--chat-context-used-color: color-mix(in srgb, var(--text-primary) 72%, #ffffff);');
    expect(contextUsageRule).toContain('--chat-context-rest-color: color-mix(in srgb, var(--text-secondary) 48%, transparent);');
    expect(contextUsageRule).toContain('aspect-ratio: 1 / 1;');
    expect(contextUsageRule).toContain('var(--chat-context-used-color) var(--chat-context-used)');
    expect(contextUsageRule).toContain('var(--chat-context-rest-color) 0');
    expect(contextUsageRule).toContain('-webkit-mask: radial-gradient(');
    expect(contextUsageRule).toContain('mask: radial-gradient(');
    expect(contextUsageRule).toContain('transparent calc(100% - var(--chat-context-ring-width))');
    expect(contextUsageRule).not.toContain('var(--accent)');
    const contextUsageHoverRule = cssRuleBlock(stylesCss, '.chat-context-usage:hover,\n.chat-context-usage:focus-visible,\n.chat-context-usage-anchor.open .chat-context-usage');
    expect(contextUsageHoverRule).toContain('outline: 3px solid color-mix(in srgb, var(--text-primary) 9%, transparent);');
    expect(contextUsageHoverRule).not.toContain('var(--accent)');
    expect(stylesCss).not.toContain('.chat-context-usage.pending');
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
    expect(mainTsx).toContain('{chatContextUsage.summaryText}');
    expect(mainTsx).not.toContain('const popoverValue = `${chatContextUsage.percentText} used`;');
    expect(mainTsx).not.toContain('const popoverDetail = `${chatContextUsage.usedText} of ${chatContextUsage.sizeText} tokens`;');
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

    expect(mainTsx).toContain("chatCoreConfigMenuOpen || chatConfigMenuOptionId || chatConfigOverflowOpen || chatContextUsageOpen ? ' config-menu-open' : ''");

    const planLayer = zIndexValue(cssRuleBlock(stylesCss, '.chat-plan-surface.desktop'));
    const openComposerLayer = zIndexValue(cssRuleBlock(stylesCss, '.chat-composer.config-menu-open'));
    expect(planLayer).toBeGreaterThan(0);
    expect(openComposerLayer).toBeGreaterThan(planLayer);

    const overflowMenu = cssRuleBlock(stylesCss, '.chat-config-overflow-menu');
    const valueMenu = cssRuleBlock(stylesCss, '.chat-config-value-menu');
    const coreMenu = cssRuleBlock(stylesCss, '.chat-core-config-menu');
    expect(overflowMenu).toContain('z-index: var(--chat-config-popover-layer);');
    expect(valueMenu).toContain('z-index: var(--chat-config-popover-layer);');
    expect(coreMenu).toContain('z-index: var(--chat-config-popover-layer);');
    expect(overflowMenu).toContain('background: color-mix(in srgb, var(--surface-overlay) 98%, var(--surface-panel));');
    expect(valueMenu).toContain('background: color-mix(in srgb, var(--surface-overlay) 98%, var(--surface-panel));');
  });

  test('raises composer trigger menus above the current task surface only while open', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain("chatSlashMenuVisible || chatFileMentionMenuOpen ? ' trigger-menu-open' : ''");

    const planLayer = zIndexValue(cssRuleBlock(stylesCss, '.chat-plan-surface.desktop'));
    const openComposerLayer = zIndexValue(cssRuleBlock(stylesCss, '.chat-composer.trigger-menu-open'));
    expect(planLayer).toBeGreaterThan(0);
    expect(openComposerLayer).toBeGreaterThan(planLayer);

    const slashMenu = cssRuleBlock(stylesCss, '.chat-slash-menu');
    const fileMentionMenu = cssRuleBlock(stylesCss, '.chat-file-mention-menu');
    expect(slashMenu).toContain('z-index: 36;');
    expect(fileMentionMenu).toContain('z-index: 37;');
    expect(slashMenu).toContain('background: color-mix(in srgb, var(--surface-overlay) 98%, var(--surface-panel));');
    expect(fileMentionMenu).toContain('background: color-mix(in srgb, var(--surface-overlay) 98%, var(--surface-panel));');
  });

  test('keeps temporary chat glass readable when backdrop sampling degrades', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const marker = '/* workspace-ui-temporary-layers */';
    const temporaryLayerStyles = stylesCss.slice(stylesCss.indexOf(marker));

    expect(stylesCss.indexOf(marker)).toBeGreaterThanOrEqual(0);
    [
      '.chat-plan-surface.desktop',
      '.chat-plan-surface.mobile.expanded',
      '.chat-recent-sessions-surface.desktop',
      '.chat-config-overflow-menu',
      '.chat-config-value-menu',
      '.chat-core-config-menu',
      '.chat-context-usage-popover',
      '.chat-slash-menu',
      '.chat-file-mention-menu',
      '.chat-title-project-menu',
      '.chat-title-prompt-menu',
      '.chat-hub-popover',
      '.chat-quick-switch-menu',
      '.session-archive-menu',
      '.project-session-action-menu',
      '.wide-project-action-popover',
    ].forEach(selector => expect(temporaryLayerStyles).toContain(selector));
    expect(temporaryLayerStyles).toContain(
      '--workspace-temporary-layer-background: color-mix(in srgb, var(--surface-overlay) 82%, transparent);',
    );
    expect(temporaryLayerStyles).toContain(
      '--workspace-temporary-layer-filter: blur(12px) saturate(1.08);',
    );
    expect(temporaryLayerStyles).toContain('background: var(--workspace-temporary-layer-background);');
    expect(temporaryLayerStyles).toContain('backdrop-filter: var(--workspace-temporary-layer-filter);');
    expect(temporaryLayerStyles).toContain('-webkit-backdrop-filter: var(--workspace-temporary-layer-filter);');
    expect(temporaryLayerStyles).toContain(
      'inset 0 1px 0 color-mix(in srgb, var(--text-primary) 8%, transparent);',
    );
  });

  test('renders a compact core config trigger and independently scrolling columns', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain("const [chatCoreConfigMenuOpen, setChatCoreConfigMenuOpen] = useState(false);");
    expect(mainTsx).toContain('className="chat-core-config-trigger"');
    expect(mainTsx).toContain('className="chat-core-config-separator" aria-hidden="true">/</span>');
    expect(mainTsx).toContain("fastEnabled ? (");
    expect(mainTsx).toContain('className="codicon codicon-zap chat-core-config-fast"');
    expect(mainTsx).toContain('className="chat-core-config-menu"');
    expect(mainTsx).toContain('className="chat-core-config-columns"');
    expect(mainTsx).toContain('className={`chat-core-config-column ${item.kind}`}');
    expect(mainTsx).toContain('className="chat-core-config-values"');
    expect(mainTsx).toContain('handleChatConfigOptionChange(item.option, value.value)');
    expect(mainTsx).not.toContain("invokeChatSessionAction('fast')");
    expect(cssRuleBlock(stylesCss, '.chat-core-config-values')).toContain('overflow-y: auto;');
    expect(cssRuleBlock(stylesCss, '.chat-core-config-trigger')).not.toContain('max-width:');
    expect(stylesCss).toContain('.chat-config-options-shell.compact .chat-core-config-model');
  });

  test('sizes each core config column to its longest label plus a reserved checkmark', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const menuRule = cssRuleBlock(stylesCss, '.chat-core-config-menu');
    const columnsRule = cssRuleBlock(stylesCss, '.chat-core-config-columns');
    const optionRule = cssRuleBlock(stylesCss, '.chat-core-config-option');

    expect(mainTsx).not.toContain('const gridTemplateColumns =');
    expect(mainTsx).not.toContain('--chat-core-config-columns');
    expect(mainTsx).toContain('chat-core-config-check${selected ? \' visible\' : \'\'}');
    expect(menuRule).toContain('width: max-content;');
    expect(menuRule).toContain('max-width: calc(100vw - 24px);');
    expect(menuRule).not.toContain('680px');
    expect(columnsRule).toContain('grid-auto-columns: max-content;');
    expect(optionRule).toContain('grid-template-columns: max-content 12px;');
  });

  test('closes the core config panel immediately after selecting any value', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const rendererStart = mainTsx.indexOf('const renderChatCoreConfigSelector = () => {');
    const rendererEnd = mainTsx.indexOf('const chatReadOnlyPreview =', rendererStart);
    const renderer = mainTsx.slice(rendererStart, rendererEnd);

    expect(renderer).toMatch(/onClick=\{\(\) => \{\s*closeChatCoreConfigMenu\(true\);\s*handleChatConfigOptionChange\(item\.option, value\.value\)/);
  });

  test('moves compact More Options into the core panel and switches the panel content', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const rendererStart = mainTsx.indexOf('const renderChatCoreConfigSelector = () => {');
    const rendererEnd = mainTsx.indexOf('const chatReadOnlyPreview =', rendererStart);
    const renderer = mainTsx.slice(rendererStart, rendererEnd);

    expect(renderer).toContain('chatComposerStatusCompact && chatConfigOverflowOptions.length > 0');
    expect(renderer).toContain('className="chat-core-config-footer"');
    expect(renderer).toContain('className="chat-core-config-more-button"');
    expect(renderer).toContain('role="menuitem"');
    expect(renderer).toContain('More Options');
    expect(renderer).toContain('setChatConfigOverflowOpen(true);');
    expect(renderer).toContain('chatConfigOverflowOpen ? (');
    expect(renderer).toContain('className="chat-core-config-more"');
    expect(renderer).toMatch(/className=\{`chat-config-value-option\$\{selected \? ' selected' : ''\}`\}[\s\S]*?role="menuitemradio"[\s\S]*?aria-checked=\{selected\}/);
    expect(mainTsx).not.toContain('className="chat-config-overflow-anchor"');
    expect(cssRuleBlock(stylesCss, '.chat-core-config-footer')).toContain('justify-content: flex-end;');
  });

  test('returns focus to the core config trigger after choosing an option', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const rendererStart = mainTsx.indexOf('const renderChatCoreConfigSelector = () => {');
    const rendererEnd = mainTsx.indexOf('const chatReadOnlyPreview =', rendererStart);
    const renderer = mainTsx.slice(rendererStart, rendererEnd);

    expect(mainTsx).toContain('const chatCoreConfigTriggerRef = useRef<HTMLButtonElement | null>(null);');
    expect(mainTsx).toContain('chatCoreConfigTriggerRef.current?.focus();');
    expect(renderer).toContain('ref={chatCoreConfigTriggerRef}');
    expect(renderer.match(/closeChatCoreConfigMenu\(true\);/g)).toHaveLength(2);
  });

  test('releases the chat page opacity animation after entry so temporary layers can sample their backdrop', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const chatPageRule = cssRuleBlock(stylesCss, '.workspace-right > .content:has(> .chat-title-bar)');

    expect(chatPageRule).toContain(
      'animation: workspacePageEnter var(--motion-standard) var(--ease-out);',
    );
    expect(chatPageRule).not.toMatch(/\b(?:both|forwards)\b/);
  });

  test('restores the translucent glass recipe only for desktop temporary layers', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const marker = '/* workspace-ui-temporary-layers */';
    const temporaryLayerStyles = stylesCss.slice(stylesCss.indexOf(marker));
    const desktopOverride = temporaryLayerStyles.slice(
      temporaryLayerStyles.indexOf('@media (min-width: 900px)'),
    );

    expect(desktopOverride).toContain('.chat-plan-surface.desktop');
    expect(desktopOverride).toContain('.chat-recent-sessions-surface.desktop');
    expect(desktopOverride).toContain('.chat-slash-menu');
    expect(desktopOverride).toContain('.chat-config-overflow-menu');
    expect(desktopOverride).toContain(
      '--workspace-temporary-layer-background: color-mix(in srgb, var(--surface-overlay) 58%, transparent);',
    );
    expect(desktopOverride).not.toContain(
      '--workspace-temporary-layer-background: color-mix(in srgb, var(--surface-overlay) 82%, transparent);',
    );
  });

  test('separates desktop edge glass from content and aligns both masks to measured text bounds', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const temporaryLayerStyles = stylesCss.slice(stylesCss.indexOf('/* workspace-ui-temporary-layers */'));

    expect(temporaryLayerStyles).toContain('@property --chat-edge-hidden-alpha');
    expect(temporaryLayerStyles).toContain('.chat-edge-surface-glass,\n.chat-edge-surface-content {');
    expect(temporaryLayerStyles).toContain('--chat-edge-hidden-alpha: 0%;');
    expect(temporaryLayerStyles).not.toContain('--chat-edge-hidden-alpha: 3%;');
    expect(temporaryLayerStyles).toContain('var(--chat-edge-fade-start)');
    expect(temporaryLayerStyles).toContain('var(--chat-edge-fade-end)');
    expect(temporaryLayerStyles).toContain('rgb(0 0 0 / var(--chat-edge-hidden-alpha))');
    expect(temporaryLayerStyles).toContain('transition: --chat-edge-hidden-alpha 180ms var(--ease-out);');
    expect(temporaryLayerStyles).toContain(".chat-recent-sessions-surface.desktop:is(:hover, :focus-within) {");
    expect(temporaryLayerStyles).not.toContain(".chat-plan-surface.desktop:is(:hover, :focus-within)");
    expect(temporaryLayerStyles).not.toContain(".chat-function-surface.desktop:is(:hover, :focus-within)");
    expect(temporaryLayerStyles).toContain('--chat-edge-hidden-alpha: 100%;');
    expect(temporaryLayerStyles).toContain('.chat-edge-surface-glass {');
    expect(cssRuleBlock(temporaryLayerStyles, '.chat-edge-surface-glass')).toContain(
      'backdrop-filter: var(--workspace-temporary-layer-filter);',
    );
    expect(temporaryLayerStyles).toContain('@media (prefers-reduced-transparency: reduce)');
    const reducedTransparency = temporaryLayerStyles.slice(
      temporaryLayerStyles.indexOf('@media (prefers-reduced-transparency: reduce)'),
      temporaryLayerStyles.indexOf('@media (prefers-reduced-motion: reduce)'),
    );
    expect(reducedTransparency).not.toContain('--chat-edge-hidden-alpha: 100%;');
    expect(temporaryLayerStyles).toContain(
      '@media (prefers-reduced-motion: reduce) {\n  .chat-edge-surface-glass,\n  .chat-edge-surface-content {',
    );
    expect(cssRuleBlock(stylesCss, '.chat-plan-surface.desktop')).not.toContain('backdrop-filter: blur(4px);');
  });
});
