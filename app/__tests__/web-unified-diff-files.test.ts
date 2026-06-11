import {splitUnifiedDiffFileBlocks} from '../web/src/git/unifiedDiffFiles';

describe('unified diff file blocks', () => {
  test('splits a multi-file unified diff into file-specific render blocks', () => {
    const content = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 111..222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,2 @@',
      '-old a',
      '+new a',
      ' same',
      'diff --git a/src/b.ts b/src/b.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/b.ts',
      '@@ -0,0 +1 @@',
      '+new b',
    ].join('\n');

    const blocks = splitUnifiedDiffFileBlocks(content);

    expect(blocks.map(block => block.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(blocks[0].diff).toContain('-old a');
    expect(blocks[0].diff).not.toContain('src/b.ts');
    expect(blocks[1].diff).toContain('+++ b/src/b.ts');
    expect(blocks[1].diff).toContain('+new b');
  });
});
