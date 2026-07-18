import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';

describe('web chat typography', () => {
  const projectRoot = path.join(__dirname, '..');

  const ruleBody = (stylesCss: string, selector: string): string => {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return stylesCss.match(new RegExp(`${escapedSelector} \\{([^}]*)\\}`))?.[1] ?? '';
  };

  test('removes configurable chat fonts from settings and persistence', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const settingsRootTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'),
      'utf8',
    );
    const persistence = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
      'utf8',
    );

    expect(mainTsx).not.toContain('chatFont');
    expect(settingsRootTsx).not.toContain('chatFont');
    expect(settingsRootTsx).not.toContain('Chat Font');
    expect(persistence).not.toContain('chatFont');
    expect(fs.existsSync(path.join(projectRoot, 'web', 'src', 'chat', 'chatTypography.ts'))).toBe(false);
  });

  test('uses fixed desktop and mobile font stacks for chat messages', () => {
    const stylesCss = readWebStyles(projectRoot);

    expect(stylesCss).toMatch(
      /\.chat-main-message \{[\s\S]*font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans CJK SC', 'Noto Sans', sans-serif;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /@media \(max-width: 900px\) \{[\s\S]*\.chat-main-message \{[\s\S]*font-family: 'Segoe UI', 'Microsoft YaHei', 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans CJK SC', 'Noto Sans', sans-serif;[\s\S]*font-size: 14px;[\s\S]*letter-spacing: 0;[\s\S]*\}/,
    );
    expect(stylesCss).not.toContain('--chat-message-font-family');
  });

  test('gives markdown text a softer hierarchy in both viewport modes', () => {
    const stylesCss = readWebStyles(projectRoot);
    const messageRule = ruleBody(stylesCss, '.chat-main-message');

    expect(stylesCss).toContain('--chat-message-text: #d4d4d4;');
    expect(messageRule).toContain('font-size: 13.5px;');
    expect(messageRule).toContain('line-height: 1.6;');
    expect(messageRule).toContain('letter-spacing: 0.01em;');
    expect(messageRule).toContain('color: var(--chat-message-text, var(--text-primary));');
    expect(stylesCss).toMatch(/\.chat-main-message strong \{[\s\S]*font-weight: 600;[\s\S]*\}/);
    expect(stylesCss).toMatch(
      /\.chat-main-message h1,[\s\S]*\.chat-main-message h6 \{[\s\S]*font-weight: 600;[\s\S]*letter-spacing: 0;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-main-message p,[\s\S]*\.chat-main-message table \{[\s\S]*margin: 0 0 10px 0;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(/\.chat-main-message li \+ li \{[\s\S]*margin-top: 6px;[\s\S]*\}/);
  });

  test('styles inline markdown code without affecting Shiki code blocks', () => {
    const stylesCss = readWebStyles(projectRoot);
    const inlineCodeRule = ruleBody(stylesCss, '.chat-main-message code:not(.wm-shiki-code)');

    expect(stylesCss).toContain('--chat-inline-code-background: #303030;');
    expect(stylesCss).toContain('--chat-inline-code-background: #ececec;');
    expect(inlineCodeRule).toContain('background: var(--chat-inline-code-background);');
    expect(inlineCodeRule).toContain('padding: 1px 5px;');
    expect(inlineCodeRule).toContain('border-radius: 4px;');
    expect(inlineCodeRule).toContain('letter-spacing: 0;');
    expect(stylesCss).not.toMatch(/\.chat-main-message \.wm-shiki-code \{[^}]*background:/);
  });

  test('uses quiet chat links with a medium-weight file affordance', () => {
    const stylesCss = readWebStyles(projectRoot);

    expect(stylesCss).toContain('--chat-link-text: #82b6df;');
    expect(stylesCss).toMatch(
      /\.chat-main-message a,[\s\S]*\.chat-main-message a:visited \{[\s\S]*color: var\(--chat-link-text\);[\s\S]*text-decoration: none;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-main-message a:hover,[\s\S]*\.chat-main-message a:focus-visible \{[\s\S]*text-decoration: underline;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-main-message \.chat-file-link \{[\s\S]*font-weight: 500;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(/\.chat-file-link-icon \{[\s\S]*font-size: 0\.88em;[\s\S]*\}/);
  });

  test('keeps composer typography independent from message typography', () => {
    const stylesCss = readWebStyles(projectRoot);

    expect(stylesCss).toMatch(
      /\.chat-composer-input \{[\s\S]*font: inherit;[\s\S]*font-size: 14px;[\s\S]*\}/,
    );
  });
});
