import fs from 'fs';
import path from 'path';
import {focusMenuItemAt} from '../web/src/common/menuKeyboardNavigation';

const root = path.join(__dirname, '..', 'web', 'src');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('focusMenuItemAt', () => {
  test('focuses the requested enabled item, clamping into range', () => {
    const items = [{focus: jest.fn()}, {focus: jest.fn()}, {focus: jest.fn()}];
    const container = {querySelectorAll: () => items} as unknown as HTMLElement;

    focusMenuItemAt(container, 1);
    expect(items[1].focus).toHaveBeenCalledTimes(1);

    focusMenuItemAt(container, 99);
    expect(items[2].focus).toHaveBeenCalledTimes(1);

    focusMenuItemAt(container, -3);
    expect(items[0].focus).toHaveBeenCalledTimes(1);
  });

  test('does nothing for an empty menu', () => {
    const container = {querySelectorAll: () => []} as unknown as HTMLElement;
    expect(() => focusMenuItemAt(container, 2)).not.toThrow();
  });
});

describe('menu keyboard navigation', () => {
  test('gives the new context and session menus roving focus controls', () => {
    const fileMenu = read('common/ContextMenu.tsx');
    const sessionMenu = read('chat/sessionlist/SessionMenu.tsx');

    expect(fileMenu).toContain("from './menuKeyboardNavigation'");
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
