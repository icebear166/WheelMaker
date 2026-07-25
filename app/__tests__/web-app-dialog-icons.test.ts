import fs from 'fs';
import path from 'path';

describe('application dialog icons', () => {
  test('uses the shared Lucide icon renderer instead of the codicon font', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'shell', 'AppDialogs.tsx'),
      'utf8',
    );

    expect(source).toContain("import {Icon, type IconName} from '../common/Icon';");
    expect(source).toContain('function resolveConfirmIcon(target: ConfirmTarget): IconName');
    expect(source).toContain('<Icon name={confirmIcon}');
    expect(source).not.toContain('codicon');
  });
});
