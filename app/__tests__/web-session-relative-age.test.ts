import fs from 'fs';
import path from 'path';

function loadFormatCompactRelativeAge(): (value: string) => string {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'web', 'src', 'app', 'WorkspaceApp.tsx'),
    'utf8',
  ).replace(/\r\n/g, '\n');
  const declarationStart = source.indexOf('function formatCompactRelativeAge');
  const bodyStart = source.indexOf('{', declarationStart);
  let depth = 0;
  let bodyEnd = -1;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        bodyEnd = index + 1;
        break;
      }
    }
  }
  const declaration = source
    .slice(declarationStart, bodyEnd)
    .replace('value: string', 'value')
    .replace('): string', ')');
  return new Function(`${declaration}; return formatCompactRelativeAge;`)() as (value: string) => string;
}

describe('formatCompactRelativeAge', () => {
  const now = Date.UTC(2026, 6, 24, 0, 0, 0);

  test('keeps every age label within the three-character 99m width contract', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const formatCompactRelativeAge = loadFormatCompactRelativeAge();
    expect(formatCompactRelativeAge(new Date(now - 59 * 60_000).toISOString())).toBe('59m');
    expect(formatCompactRelativeAge(new Date(now - 23 * 60 * 60_000).toISOString())).toBe('23h');
    expect(formatCompactRelativeAge(new Date(now - 29 * 24 * 60 * 60_000).toISOString())).toBe('29d');
    expect(formatCompactRelativeAge(new Date(now - 11 * 30 * 24 * 60 * 60_000).toISOString())).toBe('11M');
    expect(formatCompactRelativeAge(new Date(now - 120 * 12 * 30 * 24 * 60 * 60_000).toISOString())).toBe('99y');
    nowSpy.mockRestore();
  });
});
