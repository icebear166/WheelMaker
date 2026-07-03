import fs from 'fs';
import path from 'path';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ShikiCodeBlock } from '../web/src/code/ShikiCodeBlock';

describe('web shiki code fallback', () => {
  test('renders readable plain code while shiki is loading or unavailable', () => {
    const projectRoot = path.join(__dirname, '..');
    const shikiBlock = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'code', 'ShikiCodeBlock.tsx'), 'utf8');

    expect(shikiBlock).toContain('function renderPlainCodeFallbackHtml');
    expect(shikiBlock).toContain('escapeFallbackHtml(content || \' \')');
    expect(shikiBlock).toContain('const [renderFailed, setRenderFailed] = useState(false);');
    expect(shikiBlock).toContain('setRenderFailed(false);');
    expect(shikiBlock).toContain('setRenderFailed(true);');
    expect(shikiBlock).toContain('html || fallbackHtml');
    expect(shikiBlock).toContain("data-markdown-export-pending={html || renderFailed ? undefined : 'true'}");
    expect(shikiBlock).not.toContain("html || '<pre><code> </code></pre>'");
  });

  test('preloads shiki after startup without forcing it into the main bundle', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const shikiBlock = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'code', 'ShikiCodeBlock.tsx'), 'utf8');

    expect(mainTsx).toContain('preloadShikiRenderer');
    expect(mainTsx).toContain('window.requestIdleCallback');
    expect(shikiBlock).toContain("import('./shikiRenderer')");
    expect(mainTsx).not.toContain("from '../code/shikiRenderer'");
  });

  test('line clicks only fire from the line number gutter', async () => {
    const onLineClick = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        React.createElement(ShikiCodeBlock, {
          content: 'const value = 1;',
          language: 'typescript',
          wrap: false,
          lineNumbers: true,
          themeMode: 'dark',
          codeTheme: 'auto-plus',
          codeFont: 'consolas',
          codeFontSize: 13,
          codeLineHeight: 1.5,
          codeTabSize: 2,
          onLineClick,
        }),
      );
    });

    const codeWrap = renderer!.root.findByProps({className: 'code-wrap nowrap'});
    const lineElement = {dataset: {lineNumber: '1'}};
    const contentTarget = {
      closest: jest.fn((selector: string) =>
        selector === '[data-line-number]' ? lineElement : null,
      ),
    };
    codeWrap.props.onClick({
      target: contentTarget,
      nativeEvent: {} as MouseEvent,
    });
    expect(onLineClick).not.toHaveBeenCalled();

    const lineNumberTarget = {
      closest: jest.fn((selector: string) => {
        if (selector === '.wm-shiki-line-number') {
          return {
            closest: (parentSelector: string) =>
              parentSelector === '[data-line-number]' ? lineElement : null,
          };
        }
        if (selector === '[data-line-number]') {
          return lineElement;
        }
        return null;
      }),
    };
    codeWrap.props.onClick({
      target: lineNumberTarget,
      nativeEvent: {} as MouseEvent,
    });

    expect(onLineClick).toHaveBeenCalledTimes(1);
    expect(onLineClick).toHaveBeenCalledWith(1, expect.anything());
    renderer!.unmount();
  });
});
