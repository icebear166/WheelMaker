import fs from 'fs';
import path from 'path';

describe('web context menu gesture style contract', () => {
  test('locally suppresses selection and callout after the selectable text reset', () => {
    const projectRoot = path.join(__dirname, '..');
    const settingsCss = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'styles', 'settings.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const targetSelector = "[data-context-menu-target='true']";
    const targetRuleIndex = settingsCss.indexOf(targetSelector);
    const selectableResetIndex = settingsCss.indexOf('.chat-main-message *');

    expect(targetRuleIndex).toBeGreaterThan(selectableResetIndex);
    const targetRule = settingsCss.slice(targetRuleIndex, settingsCss.indexOf('}', targetRuleIndex));
    expect(targetRule).toContain('-webkit-touch-callout: none;');
    expect(targetRule).toContain('-webkit-user-select: none;');
    expect(targetRule).toContain('user-select: none;');
    expect(targetRule).not.toContain('.chat-main-message');
    expect(targetRule).not.toContain('.wm-shiki-line-content');
    expect(targetRule).not.toContain('.terminal-xterm-surface');
  });
});
