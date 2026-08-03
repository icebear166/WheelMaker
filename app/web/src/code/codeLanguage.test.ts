import {detectCodeLanguage} from './codeLanguage';

test.each([
  ['src/a.ts', 'typescript'],
  ['src/a.tsx', 'tsx'],
  ['script.ps1', 'powershell'],
  ['README.md', 'markdown'],
  ['unknown.bin', 'clike'],
])('maps %s to %s', (path, language) => {
  expect(detectCodeLanguage(path)).toBe(language);
});
