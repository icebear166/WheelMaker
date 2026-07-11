import fs from 'fs';
import path from 'path';

const appRoot = path.resolve(__dirname, '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

describe('workspace visual foundation', () => {
  test('loads semantic tokens before every surface stylesheet', () => {
    const index = read('web/src/styles/index.css');
    const helper = read('testHelpers/webStyles.ts');
    expect(index.split('\n')[0]).toBe("@import './tokens.css';");
    expect(helper).toMatch(/const STYLE_ENTRY_ORDER = \[\s*'tokens\.css',/);
  });

  test('defines matching dark and light semantic token families', () => {
    const tokens = read('web/src/styles/tokens.css');
    for (const token of [
      '--surface-canvas',
      '--surface-panel',
      '--surface-raised',
      '--text-primary',
      '--text-secondary',
      '--border-subtle',
      '--accent-primary',
      '--state-danger',
      '--focus-ring-color',
      '--motion-standard',
    ]) {
      expect(tokens.match(new RegExp(`${token}:`, 'g'))).toHaveLength(2);
    }
    expect(tokens).toContain('.theme-light {');
  });

  test('anchors neutral runtime surfaces to the chat body palette', () => {
    const tokens = read('web/src/styles/tokens.css');

    expect(tokens).toContain('--surface-workspace-content: #1e1e1e;');
    expect(tokens).toContain('--surface-canvas: #1b1b1b;');
    expect(tokens).toContain('--surface-sidebar: #202020;');
    expect(tokens).toContain('--surface-panel: #242424;');
    expect(tokens).toContain('--surface-raised: #292929;');
    expect(tokens).toContain('--surface-overlay: #2e2e2e;');
    expect(tokens).toContain('--surface-workspace-content: #ffffff;');
    expect(tokens).toContain('--surface-canvas: #f3f3f3;');
    expect(tokens).toContain('--surface-sidebar: #f7f7f7;');
    expect(tokens).toContain('--surface-panel: #fafafa;');
    expect(tokens).toContain('--surface-raised: #f0f0f0;');
    expect(tokens).toContain('--surface-overlay: #ffffff;');
  });

  test('uses semantic tokens directly throughout the runtime chrome', () => {
    const runtimeStyles = [
      'web/src/styles/base.css',
      'web/src/styles/shell.css',
      'web/src/styles/surfaces.css',
      'web/src/styles/chat.css',
      'web/src/styles/code.css',
      'web/src/styles/settings.css',
      'web/src/styles/debug.css',
      'web/src/styles/portRelay.css',
    ].map(read).join('\n');
    const runtimeChrome = [
      'web/src/styles/shell.css',
      'web/src/styles/chat.css',
      'web/src/styles/debug.css',
      'web/src/styles/portRelay.css',
    ].map(read).join('\n');
    const tokens = read('web/src/styles/tokens.css');

    expect(tokens.match(/--surface-workspace-content:/g) ?? []).toHaveLength(2);
    expect(tokens.match(/--state-info:/g) ?? []).toHaveLength(2);
    expect(runtimeStyles).not.toMatch(/var\(--(?:bg|panel|panel-2|panel-3|text|muted|border|accent|danger)\)/);
    expect(runtimeChrome).not.toMatch(/#094771|#4fbf6b|#f46d6d|#d29922|#3fb950|#ff7b72|#18a999|#5eead4|#ff8a82/);
    expect(runtimeChrome).toContain('var(--accent-primary)');
    expect(runtimeChrome).toContain('var(--state-success)');
    expect(runtimeChrome).toContain('var(--state-warning)');
    expect(runtimeChrome).toContain('var(--state-danger)');
    expect(runtimeChrome).toContain('var(--state-info)');
  });

  test('keeps File and Git out of page-specific redesign work', () => {
    const index = read('web/src/styles/index.css');
    expect(index).toContain("@import './file.css';");
    expect(index).toContain("@import './git.css';");
    expect(read('web/src/styles/file.css')).not.toContain('workspace-ui-targeted-evolution');
    expect(read('web/src/styles/git.css')).not.toContain('workspace-ui-targeted-evolution');
  });

  test('defines keyboard focus, disabled, loading, empty and error feedback', () => {
    const base = read('web/src/styles/base.css');
    expect(base).toContain(':focus-visible');
    expect(base).toContain('outline: 2px solid var(--focus-ring-color);');
    expect(base).toContain('.button:disabled');
    expect(base).toContain('.feedback-state');
    expect(base).toContain('.feedback-state.error');
    expect(base).toContain('.feedback-state.loading');
  });

  test('maps existing workspace feedback hooks to semantic states', () => {
    const styles = [
      read('web/src/styles/base.css'),
      read('web/src/styles/chat.css'),
      read('web/src/styles/settings.css'),
    ].join('\n');
    for (const selector of [
      '.chat-empty-hint',
      '.wide-project-empty',
      '.mobile-project-session-error',
      '.session-search-error',
      '.empty-card',
      '.chat-loading-state',
    ]) {
      expect(styles).toContain(selector);
    }
    expect(styles).toContain('var(--state-danger)');
    expect(read('web/src/app/WorkspaceApp.tsx')).toContain('className="session-archive-progress" role="status"');
    expect(read('web/src/app/WorkspaceApp.tsx')).toContain('className="chat-loading-state" role="status"');
  });
});
