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

  test('keeps File and Git out of page-specific redesign work', () => {
    const index = read('web/src/styles/index.css');
    expect(index).toContain("@import './file.css';");
    expect(index).toContain("@import './git.css';");
    expect(read('web/src/styles/file.css')).not.toContain('workspace-ui-targeted-evolution');
    expect(read('web/src/styles/git.css')).not.toContain('workspace-ui-targeted-evolution');
  });
});
