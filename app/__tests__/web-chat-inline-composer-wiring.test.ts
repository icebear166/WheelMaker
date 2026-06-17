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
