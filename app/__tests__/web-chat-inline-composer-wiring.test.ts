import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

describe('web chat inline composer capsule wiring', () => {
  test('uses rich composer tokens for inline skill and file capsules', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain("import { ChatRichComposer, type ChatRichComposerHandle } from '../chat/composer/ChatRichComposer';");
    expect(mainTsx).toContain('const [chatComposerTokens, setChatComposerTokens] = useState<ChatComposerToken[]>([]);');
    expect(mainTsx).toContain('const serializedComposer = serializeChatComposerTokens(sourceTokens);');
    expect(mainTsx).toContain('chatRichComposerRef.current?.insertSkill');
    expect(mainTsx).toContain('chatRichComposerRef.current?.insertFile');
    expect(mainTsx).not.toContain('className="chat-file-mention-chip"');
    expect(mainTsx).toContain('<ChatRichComposer');
    expect(stylesCss).toContain('.chat-rich-composer');
    expect(stylesCss).toContain('.chat-composer-capsule');
    const capsuleRuleStart = stylesCss.indexOf('.chat-composer-capsule,\n.chat-prompt-inline-capsule {');
    const capsuleRuleEnd = stylesCss.indexOf('}', capsuleRuleStart);
    const capsuleRule = stylesCss.slice(capsuleRuleStart, capsuleRuleEnd);
    expect(capsuleRule).toContain('gap: 1px;');
  });

  test('keeps file mention capsule labels readable without ellipsis', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);

    expect(stylesCss).toMatch(/\.chat-composer-capsule\.file,\s*\.chat-prompt-inline-capsule\.file \{[\s\S]*max-width: 100%;[\s\S]*white-space: normal;[\s\S]*\}/);
    expect(stylesCss).toMatch(/\.chat-composer-capsule\.file \.chat-composer-capsule-label,\s*\.chat-prompt-inline-capsule\.file \.chat-prompt-inline-capsule-label \{[\s\S]*overflow: visible;[\s\S]*text-overflow: clip;[\s\S]*overflow-wrap: anywhere;[\s\S]*\}/);
  });

  test('wires Goal into the composer with distinct capsule colors', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain("option.kind === 'skill' || option.name === '/goal'");
    expect(mainTsx).toContain("kind: command.name === '/goal' ? 'goal' : 'skill'");
    expect(stylesCss).toMatch(/\.chat-composer-capsule\.goal,\s*\.chat-prompt-inline-capsule\.goal \{[\s\S]*--chat-capsule-goal-text[\s\S]*--chat-capsule-goal-bg[\s\S]*\}/);
  });

  test('keeps long composer content inside the input scroll area', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);

    expect(stylesCss).toMatch(/\.chat-composer-input \{[\s\S]*max-height: 180px;[\s\S]*overflow-x: hidden;[\s\S]*overflow-y: auto;[\s\S]*\}/);
  });

  test('resets Lexical paragraph spacing inside the composer', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);

    expect(stylesCss).toMatch(/\.chat-rich-composer p \{[\s\S]*margin: 0;[\s\S]*\}/);
  });

  test('keeps Enter send ownership outside the Lexical composer', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const composerTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'composer', 'ChatRichComposer.tsx'));
    const composerCallStart = mainTsx.indexOf('                  <ChatRichComposer');
    const composerCallEnd = mainTsx.indexOf('/>', composerCallStart);
    const composerCall = mainTsx.slice(composerCallStart, composerCallEnd);

    expect(composerCallStart).toBeGreaterThanOrEqual(0);
    expect(composerCallEnd).toBeGreaterThan(composerCallStart);
    expect(composerCall).toContain('onKeyDown={event => {');
    expect(composerCall).not.toContain('onSend=');
    expect(composerTsx).not.toContain('KEY_ENTER_COMMAND');
    expect(composerTsx).not.toContain('onSend');
  });

  test('consumes Enter and Tab before resolving chat skill or file menu selection', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const fileMenuStart = mainTsx.indexOf('if (chatFileMentionMenuOpen) {');
    const fileEnterStart = mainTsx.indexOf("if ((event.key === 'Enter' || event.key === 'Tab')", fileMenuStart);
    const fileEnterEnd = mainTsx.indexOf("if (event.key === 'Escape')", fileEnterStart);
    const fileEnterBlock = mainTsx.slice(fileEnterStart, fileEnterEnd);
    const slashMenuStart = mainTsx.indexOf('if (chatSlashMenuVisible) {');
    const slashEnterStart = mainTsx.indexOf("if ((event.key === 'Enter' || event.key === 'Tab')", slashMenuStart);
    const slashEnterEnd = mainTsx.indexOf("if (event.key === 'Escape')", slashEnterStart);
    const slashEnterBlock = mainTsx.slice(slashEnterStart, slashEnterEnd);

    expect(fileMenuStart).toBeGreaterThanOrEqual(0);
    expect(fileEnterStart).toBeGreaterThan(fileMenuStart);
    expect(fileEnterEnd).toBeGreaterThan(fileEnterStart);
    expect(fileEnterBlock.indexOf('event.preventDefault();')).toBeLessThan(fileEnterBlock.indexOf('const activeResult'));
    expect(fileEnterBlock.indexOf('event.stopPropagation();')).toBeGreaterThan(fileEnterBlock.indexOf('event.preventDefault();'));
    expect(fileEnterBlock.indexOf('event.stopPropagation();')).toBeLessThan(fileEnterBlock.indexOf('const activeResult'));
    expect(fileEnterBlock.indexOf('event.preventDefault();')).toBeLessThan(fileEnterBlock.indexOf('if (!activeResult)'));
    expect(fileEnterBlock.indexOf('event.stopPropagation();')).toBeLessThan(fileEnterBlock.indexOf('if (!activeResult)'));

    expect(slashMenuStart).toBeGreaterThanOrEqual(0);
    expect(slashEnterStart).toBeGreaterThan(slashMenuStart);
    expect(slashEnterEnd).toBeGreaterThan(slashEnterStart);
    expect(slashEnterBlock.indexOf('event.preventDefault();')).toBeLessThan(slashEnterBlock.indexOf('if (!activeChatSlashCommand)'));
    expect(slashEnterBlock.indexOf('event.stopPropagation();')).toBeGreaterThan(slashEnterBlock.indexOf('event.preventDefault();'));
    expect(slashEnterBlock.indexOf('event.stopPropagation();')).toBeLessThan(slashEnterBlock.indexOf('if (!activeChatSlashCommand)'));
  });

  test('stops plain Enter send from reaching Lexical paragraph insertion', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const sendEnterStart = mainTsx.indexOf("const shouldSendChatOnEnter = event.key === 'Enter'");
    const sendEnterEnd = mainTsx.indexOf('sendChatMessage().catch(() => undefined);', sendEnterStart);
    const sendEnterBlock = mainTsx.slice(sendEnterStart, sendEnterEnd);

    expect(sendEnterStart).toBeGreaterThanOrEqual(0);
    expect(sendEnterEnd).toBeGreaterThan(sendEnterStart);
    expect(sendEnterBlock.indexOf('event.preventDefault();')).toBeLessThan(sendEnterBlock.indexOf('if (chatSendDisabled)'));
    expect(sendEnterBlock.indexOf('event.stopPropagation();')).toBeGreaterThan(sendEnterBlock.indexOf('event.preventDefault();'));
    expect(sendEnterBlock.indexOf('event.stopPropagation();')).toBeLessThan(sendEnterBlock.indexOf('if (chatSendDisabled)'));
  });
});

describe('composer menu exclusivity', () => {
  test('all composer popups share one menu state', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain('const [chatComposerMenu, setChatComposerMenu, chatComposerMenuExiting] = useChatComposerMenu();');
    expect(mainTsx).toContain("const chatPromptMenuOpen = chatComposerMenu.id === 'slash';");
    expect(mainTsx).toContain("const chatFileMentionMenuOpen = chatComposerMenu.id === 'file-mention';");
    expect(mainTsx).toContain("const chatAttachmentTrayOpen = chatComposerMenu.id === 'attachment-tray';");
    expect(mainTsx).toContain("const chatContextUsageOpen = chatComposerMenu.id === 'context-usage';");
    expect(mainTsx).toContain("const chatCoreConfigMenuOpen = chatComposerMenu.id === 'core-config';");
    expect(mainTsx).toContain("const chatConfigOverflowOpen = chatComposerMenu.id === 'config-overflow';");
    expect(mainTsx).not.toContain('const [chatPromptMenuOpen, setChatPromptMenuOpen] = useState(false);');
    expect(mainTsx).not.toContain('const [chatCoreConfigMenuOpen, setChatCoreConfigMenuOpen] = useState(false);');
    expect(mainTsx).not.toContain('workspaceUiState.mobile.chatConfigOverflowOpen');
  });

  test('every composer popup renders with exit flag and entrance animation', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    const exitFlag = "chatComposerMenuExiting ? ' sl-menu-exit' : ''";
    const occurrences = mainTsx.split(exitFlag).length - 1;
    // The always-mounted context-usage tooltip is deliberately excluded: it
    // has its own visibility model, and the shared exit/enter animations made
    // it flash whenever an unrelated composer menu closed.
    expect(occurrences).toBeGreaterThanOrEqual(5);

    for (const cls of [
      'chat-slash-menu',
      'chat-file-mention-menu',
      'chat-core-config-menu',
      'chat-config-value-menu',
      'chat-context-usage-popover',
      'chat-attachment-action-tray',
    ]) {
      expect(stylesCss).toContain(`.${cls}`);
    }
    expect(stylesCss).toMatch(/\.chat-slash-menu,\s*\n\.chat-file-mention-menu,\s*\n\.chat-core-config-menu,\s*\n\.chat-config-value-menu,\s*\n\.chat-attachment-action-tray \{[\s\S]*animation: sl-menu-in 140ms var\(--ease-out\);[\s\S]*\}/);
    expect(stylesCss).not.toMatch(/\.chat-context-usage-popover,\s*\n\.chat-attachment-action-tray \{[\s\S]*animation: sl-menu-in/);
    expect(stylesCss).toContain('.chat-composer.menu-open');
    expect(stylesCss).not.toContain('.chat-composer.config-menu-open');
    expect(stylesCss).not.toContain('.chat-composer.trigger-menu-open');
  });

  test('slash menu renders grouped sections with display names without slash prefix', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain('groupChatSlashMenuOptions(chatSlashMenuOptions)');
    expect(mainTsx).toContain('chat-slash-section');
    expect(mainTsx).toContain('chatSlashOptionDisplayName(option.name)');
    expect(mainTsx).not.toContain('<span className="chat-slash-name">{option.name}</span>');
  });

  test('slash and file-mention menus share the same geometry', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    for (const cls of ['.chat-slash-menu', '.chat-file-mention-menu']) {
      const start = stylesCss.indexOf(`${cls} {`);
      const end = stylesCss.indexOf('}', start);
      const rule = stylesCss.slice(start, end);
      expect(rule).toContain('left: 0;');
      expect(rule).toContain('right: 0;');
      expect(rule).toContain('bottom: calc(100% + 8px);');
      expect(rule).toContain('border-radius: 8px;');
      expect(rule).toContain('max-height: min(42vh, 280px);');
      expect(rule).not.toContain('background');
      expect(rule).not.toContain('backdrop-filter');
    }
    expect(stylesCss).not.toContain('chat-file-mention-shortcut-tip');
    expect(mainTsx).not.toContain('chat-file-mention-shortcut-tip');
    expect(stylesCss).toContain('.chat-menu-footer');
    expect(mainTsx.split('<ChatMenuKeyHints').length - 1).toBeGreaterThanOrEqual(2);
    // Keyboards hints only render on wide layouts; touch has no keyboard.
    expect(mainTsx.split('{isWide ? <ChatMenuKeyHints').length - 1).toBe(2);
  });

  test('composer frame uses the shared floating panel material', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const chatCss = readSourceText(path.join(projectRoot, 'web', 'src', 'styles', 'chat.css'));

    const frameStart = stylesCss.indexOf('.chat-composer-frame {');
    const frameEnd = stylesCss.indexOf('}', frameStart);
    const frameRule = stylesCss.slice(frameStart, frameEnd);
    expect(frameRule).toContain('border-radius: 8px;');
    expect(frameRule).toContain('var(--shadow-floating)');
    expect(frameRule).toContain('inset 0 1px 0');
    expect(chatCss).not.toContain('#79c0ff');
    expect(chatCss).not.toContain('#1f6feb');
    expect(chatCss).not.toContain('rgba(248, 81, 73');
    expect(chatCss).not.toContain('chatStopBreath');
    expect(stylesCss).toContain('inset: var(--chat-composer-input-pad-block) var(--chat-composer-input-pad-inline) auto');
  });

  test('composer placeholder uses the Lexical placeholder slot', () => {
    const projectRoot = path.join(__dirname, '..');
    const composerTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'composer', 'ChatRichComposer.tsx'));

    expect(composerTsx).toContain('placeholder={');
    expect(composerTsx).not.toContain('placeholder={null}');
    expect(composerTsx).not.toContain('chat-rich-composer:not(:empty)');
  });

  test('chat module no longer references icon font classes', () => {
    const projectRoot = path.join(__dirname, '..');
    const chatDir = path.join(projectRoot, 'web', 'src', 'chat');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.tsx')) {
          if (readSourceText(full).includes('codicon')) {
            offenders.push(path.relative(projectRoot, full));
          }
        }
      }
    };
    walk(chatDir);
    expect(offenders).toEqual([]);

    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const composerStart = mainTsx.indexOf('className={`chat-composer');
    const composerEnd = mainTsx.indexOf('</ChatSurface>', composerStart);
    expect(mainTsx.slice(composerStart, composerEnd)).not.toContain('codicon');

    const voiceTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'features', 'speech', 'VoiceInputButton.tsx'));
    expect(voiceTsx).not.toContain('codicon');
  });

  test('composer motion polish: drop hint text, attachment exit, capsule transition', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('Drop files to attach');
    expect(mainTsx).toContain('chatAttachmentRemovingId');
    expect(stylesCss).toContain('.chat-composer-drop-hint');
    expect(stylesCss).toMatch(/\.chat-attachment-preview \{[\s\S]*animation: chat-attachment-in var\(--motion-standard\) var\(--ease-out\)/);
    expect(stylesCss).toContain('.chat-attachment-preview.removing');
    expect(stylesCss).toMatch(/\.chat-composer-capsule,\s*\n\.chat-prompt-inline-capsule \{[\s\S]*transition: box-shadow var\(--motion-fast\)/);
    expect(stylesCss).toMatch(/\.chat-composer-toolbar \{[\s\S]*min-height: 30px;/);
    expect(stylesCss).toMatch(/\.voice-recording-bar \{[\s\S]*min-height: 30px;/);
  });
});
