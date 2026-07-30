import fs from 'fs';
import path from 'path';

import { applyDocumentTheme } from '../web/src/theme/documentTheme';

const appRoot = path.resolve(__dirname, '..');

function createClassList(initial: string[] = []) {
  const values = new Set(initial);
  return {
    values,
    classList: {
      toggle(token: string, force?: boolean) {
        const enabled = force ?? !values.has(token);
        if (enabled) {
          values.add(token);
        } else {
          values.delete(token);
        }
        return enabled;
      },
      remove(...tokens: string[]) {
        tokens.forEach(token => values.delete(token));
      },
    },
  };
}

describe('document theme propagation', () => {
  test('applies one workspace theme class to the document root and preserves unrelated classes', () => {
    const target = createClassList(['desktop-runtime']);

    const clearLightTheme = applyDocumentTheme(target, 'light');
    expect([...target.values].sort()).toEqual([
      'desktop-runtime',
      'theme-light',
    ]);

    clearLightTheme();
    const clearDarkTheme = applyDocumentTheme(target, 'dark');
    expect([...target.values].sort()).toEqual([
      'desktop-runtime',
      'theme-dark',
    ]);

    clearDarkTheme();
    expect([...target.values]).toEqual(['desktop-runtime']);
  });

  test('wires the persisted workspace theme to the document root before paint', () => {
    const workspaceApp = fs.readFileSync(
      path.join(appRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(workspaceApp).toContain(
      "import {applyDocumentTheme} from '../theme/documentTheme';",
    );
    expect(workspaceApp).toMatch(
      /useLayoutEffect\(\(\) => applyDocumentTheme\(document\.documentElement, themeMode\), \[themeMode\]\);/,
    );
  });
});
