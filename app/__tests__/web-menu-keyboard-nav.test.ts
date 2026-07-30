import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', 'web', 'src');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('menu keyboard navigation', () => {
  test('gives the new context and session menus roving focus controls', () => {
    const fileMenu = read('chat/ChatFileLinkContextMenu.tsx');
    const sessionMenu = read('chat/sessionlist/SessionMenu.tsx');

    expect(fileMenu).toContain("from '../common/menuKeyboardNavigation'");
    expect(fileMenu).toContain('focusFirstMenuItem(menuRef.current);');
    expect(fileMenu).toContain('handleMenuKeyDown(event, menuRef.current)');
    expect(fileMenu).toContain('previouslyFocusedRef.current?.focus();');
    expect(sessionMenu).toContain("from '../../common/menuKeyboardNavigation'");
    expect(sessionMenu).toContain('focusFirstMenuItem(menuRef.current);');
    expect(sessionMenu).toContain('handleMenuKeyDown(event, menuRef.current)');
    expect(sessionMenu).toContain('previouslyFocusedRef.current?.focus();');
    expect(sessionMenu).toContain('data-menu-close="true"');
    const navigation = read('common/menuKeyboardNavigation.ts');
    expect(navigation).toContain('button:not(:disabled):not([data-menu-close])');
  });

  test('gives the shared application menu the same arrow-key behavior', () => {
    const desktopMenu = read('shell/WheelMakerAppMenu.tsx');

    expect(desktopMenu).toContain("from '../common/menuKeyboardNavigation'");
    expect(desktopMenu).toContain('focusFirstMenuItem(menuRef.current);');
    expect(desktopMenu).toContain('handleMenuKeyDown(event, menuRef.current)');
  });
});
