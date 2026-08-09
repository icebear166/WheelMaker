declare const __dirname: string;
declare function require(moduleName: string): unknown;

const {readFileSync} = require('fs') as {
  readFileSync(path: string, encoding: 'utf8'): string;
};
const {resolve} = require('path') as {
  resolve(...paths: string[]): string;
};

function read(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf8');
}

describe('P0 motion contracts', () => {
  it('uses one tokenized exit duration for shared menu surfaces', () => {
    const sessionListCss = read('sessionlist.css');
    const chatCss = read('chat.css');
    const menuExit = read('../chat/sessionlist/menuExit.ts');

    expect(menuExit).toMatch(/MENU_EXIT_MS\s*=\s*120/);
    expect(sessionListCss).toContain(
      'animation: sl-menu-out var(--motion-fast) var(--ease-out) forwards;',
    );
    expect(sessionListCss).toContain(
      'animation: sl-sheet-overlay-out var(--motion-fast) var(--ease-out) forwards;',
    );
    expect(chatCss).toContain(
      'animation: mobile-sheet-slide-down var(--motion-fast) var(--ease-out) forwards;',
    );
  });

  it('derives anchored project popover origin from its placement', () => {
    const sessionListCss = read('sessionlist.css');
    const workspaceApp = read('../app/WorkspaceApp.tsx');

    expect(sessionListCss).toContain(
      'transform-origin: var(--sl-popover-origin, top center);',
    );
    expect((workspaceApp.match(/--sl-popover-origin/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('animates transient notices and desktop dialogs with reduced-motion coverage', () => {
    const shellCss = read('shell.css');
    const usageCss = read('usage.css');

    expect(shellCss).toContain(
      'animation: app-toast-in var(--motion-standard) var(--ease-out) both;',
    );
    expect(shellCss).toContain(
      'animation: app-dialog-in var(--motion-standard) var(--ease-out) both;',
    );
    expect(shellCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.app-toast,[\s\S]*\.app-retry-toast/,
    );
    expect(usageCss).toContain(
      'animation: usage-dialog-in var(--motion-standard) var(--ease-out) both;',
    );
    expect(usageCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.usage-mobile-overlay,[\s\S]*\.usage-history-overlay/,
    );
  });
});
