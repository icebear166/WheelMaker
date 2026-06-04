import fs from 'fs';
import path from 'path';

function listTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsxFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      out.push(fullPath);
    }
  }
  return out;
}

function sourceUsesJsx(source: string): boolean {
  return /<[A-Za-z][\w.:]*(?:\s|>|\/)/.test(source);
}

function sourceImportsReactValue(source: string): boolean {
  return (
    /^import\s+React(?:\s*,|\s+from)/m.test(source) ||
    /^import\s+\*\s+as\s+React\s+from\s+['"]react['"]/m.test(source)
  );
}

describe('web react runtime imports', () => {
  test('tsx files using JSX import React as a runtime value', () => {
    const srcRoot = path.join(__dirname, '..', 'web', 'src');
    const offenders = listTsxFiles(srcRoot)
      .filter(filePath => {
        const source = fs.readFileSync(filePath, 'utf8');
        return sourceUsesJsx(source) && !sourceImportsReactValue(source);
      })
      .map(filePath => path.relative(srcRoot, filePath).replace(/\\/g, '/'));

    expect(offenders).toEqual([]);
  });
});
