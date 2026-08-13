import {renderShikiHtml} from './shikiRenderer';

const baseOptions = {
  code: 'const answer: number = 42;\n',
  language: 'ts',
  themeMode: 'dark' as const,
  codeTheme: 'auto-plus' as const,
  codeFont: 'consolas' as const,
  codeFontSize: 13,
  codeLineHeight: 1.5,
  codeTabSize: 2,
  wrap: true,
  lineNumbers: false,
  mode: 'block' as const,
};

describe('renderShikiHtml adaptive code theme', () => {
  test('emits light/dark CSS variables instead of fixed colors in adaptive mode', async () => {
    const html = await renderShikiHtml({...baseOptions, adaptiveCodeTheme: true});

    expect(html).toContain('--shiki-light:');
    expect(html).toContain('--shiki-dark:');
    expect(html).not.toMatch(/style="[^"]*color:#/);
  });

  test('keeps the dark-plus/light-plus pair regardless of codeTheme and themeMode', async () => {
    const monokai = await renderShikiHtml({
      ...baseOptions,
      codeTheme: 'monokai',
      adaptiveCodeTheme: true,
    });
    const light = await renderShikiHtml({
      ...baseOptions,
      themeMode: 'light',
      adaptiveCodeTheme: true,
    });

    expect(monokai).toContain('--shiki-light:');
    expect(monokai).toContain('--shiki-dark:');
    expect(monokai).toBe(light);
  });

  test('keeps single-theme fixed colors without the adaptive flag', async () => {
    const html = await renderShikiHtml(baseOptions);

    expect(html).toMatch(/color:#/);
    expect(html).not.toContain('--shiki-light:');
  });
});
