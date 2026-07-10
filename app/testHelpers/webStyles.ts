import fs from 'fs';
import path from 'path';

const STYLE_ENTRY_ORDER = [
  'tokens.css',
  'base.css',
  'shell.css',
  'settings.css',
  'portRelay.css',
  'debug.css',
  'file.css',
  'git.css',
  'chat.css',
  'code.css',
  'surfaces.css',
] as const;

export function readWebStyles(projectRoot: string): string {
  const stylesRoot = path.join(projectRoot, 'web', 'src', 'styles');
  return STYLE_ENTRY_ORDER.map((fileName) =>
    fs.readFileSync(path.join(stylesRoot, fileName), 'utf8').replace(/\r\n/g, '\n'),
  ).join('\n');
}
