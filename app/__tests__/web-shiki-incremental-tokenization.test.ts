jest.mock('@shikijs/core', () => ({
  createHighlighterCore: jest.fn(async () => ({
    loadTheme: async () => undefined,
    loadLanguage: async () => undefined,
    codeToTokens: (code: string, options: {grammarState?: {inComment?: boolean}; tokenizeMaxLineLength?: number}) => {
      let inComment = options.grammarState?.inComment === true;
      const tokens = code.split('\n').map((line, lineIndex) => {
        const startsComment = line.includes('/*');
        const endsComment = line.includes('*/');
        const isComment = inComment || startsComment;
        if (startsComment && !endsComment) inComment = true;
        if (endsComment) inComment = false;
        return [{
          content: line,
          color: isComment ? '#comment' : '#code',
          fontStyle: 0,
          offset: lineIndex === 0 ? 0 : lineIndex,
        }];
      });
      return {
        tokens,
        fg: '#foreground',
        bg: '#background',
        themeName: 'test-theme',
        grammarState: {inComment},
      };
    },
  })),
}));
jest.mock('@shikijs/engine-javascript', () => ({
  createJavaScriptRegexEngine: jest.fn(() => ({})),
}));
jest.mock('@shikijs/themes/dark-plus', () => ({__esModule: true, default: {name: 'dark-plus'}}));
jest.mock('@shikijs/themes/light-plus', () => ({__esModule: true, default: {name: 'light-plus'}}));
jest.mock('@shikijs/langs/typescript', () => ({__esModule: true, default: {name: 'typescript'}}));

import {
  tokenizeShikiCode,
  tokenizeShikiCodeInChunks,
  type ShikiTokenChunk,
} from '../web/src/code/shikiRenderer';

jest.setTimeout(30_000);

function comparableTokens(chunks: ShikiTokenChunk[]) {
  return chunks.flatMap(chunk => chunk.tokens).map(line => line.map(token => ({
    content: token.content,
    color: token.color,
    fontStyle: token.fontStyle,
  })));
}

describe('incremental Shiki tokenization', () => {
  test('the virtualized viewer publishes chunks progressively and aborts stale jobs', () => {
    const shikiBlock = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'code', 'ShikiCodeBlock.tsx'),
      'utf8',
    );

    expect(shikiBlock).toContain('const CHUNK_SIZE = 50;');
    expect(shikiBlock).toContain('new AbortController()');
    expect(shikiBlock).toContain('tokenizeShikiCodeInChunks');
    expect(shikiBlock).toContain('onChunk: chunk =>');
    expect(shikiBlock).toContain('controller.abort();');
    expect(shikiBlock).toContain('data-chunk-sentinel={i}');
    expect(shikiBlock).not.toContain('const {tokenizeShikiCode} = await loadShikiRenderer();');
  });

  test('preserves grammar state across chunks and yields between batches', async () => {
    const code = [
      'const before = 1;',
      '/* a comment starts here',
      'and continues in another chunk',
      'until it ends here */',
      'const after = 2;',
    ].join('\n');
    const whole = await tokenizeShikiCode(code, 'typescript', 'dark', 'dark-plus');
    const chunks: ShikiTokenChunk[] = [];
    const yieldToMainThread = jest.fn(async () => undefined);

    await tokenizeShikiCodeInChunks(code, 'typescript', 'dark', 'dark-plus', {
      chunkLines: 2,
      onChunk: chunk => chunks.push(chunk),
      yieldToMainThread,
    });

    expect(chunks.map(chunk => chunk.startLine)).toEqual([0, 2, 4]);
    expect(comparableTokens(chunks)).toEqual(comparableTokens([{
      ...chunks[0],
      tokens: whole.tokens,
    }]));
    expect(yieldToMainThread).toHaveBeenCalledTimes(2);
  });

  test('stops before the next chunk when the caller aborts', async () => {
    const controller = new AbortController();
    const chunks: ShikiTokenChunk[] = [];

    await expect(tokenizeShikiCodeInChunks(
      Array.from({length: 20}, (_, index) => `const line${index} = ${index};`).join('\n'),
      'typescript',
      'dark',
      'dark-plus',
      {
        chunkLines: 2,
        signal: controller.signal,
        onChunk: chunk => {
          chunks.push(chunk);
          controller.abort();
        },
        yieldToMainThread: async () => undefined,
      },
    )).rejects.toMatchObject({name: 'AbortError'});
    expect(chunks).toHaveLength(1);
  });

  test('bounds tokenization work for a pathological long line', async () => {
    const code = `const value = "${'x'.repeat(25_000)}";`;
    const chunks: ShikiTokenChunk[] = [];

    await tokenizeShikiCodeInChunks(code, 'typescript', 'dark', 'dark-plus', {
      chunkLines: 50,
      onChunk: chunk => chunks.push(chunk),
      yieldToMainThread: async () => undefined,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].tokens[0].map(token => token.content).join('')).toBe(code);
    expect(chunks[0].tokens[0]).toHaveLength(1);
  });
});
import fs from 'fs';
import path from 'path';
