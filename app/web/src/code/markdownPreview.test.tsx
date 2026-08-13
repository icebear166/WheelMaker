import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

jest.mock('mermaid', () => ({
  __esModule: true,
  default: {
    initialize: jest.fn(),
    render: jest.fn().mockResolvedValue({svg: '<svg viewBox="0 0 100 50"><path /></svg>'}),
  },
}));
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('remark-gfm', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import {MermaidBlock, markdownCodeRenderer} from './markdownPreview';

async function renderMermaidBlock(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<MermaidBlock content="graph TD\nA-->B" themeMode="dark" />);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  return renderer!;
}

describe('MermaidBlock interactions', () => {
  it('zooms with the keyboard and restores the default viewport', async () => {
    const renderer = await renderMermaidBlock();
    const block = () => renderer.root.findByProps({className: 'mermaid-block'});
    const preventDefault = jest.fn();

    await act(async () => {
      block().props.onKeyDown({key: '+', preventDefault});
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(renderer.root.findByProps({className: 'mermaid-viewport'}).props.style.transform)
      .toContain('scale(1.2)');

    await act(async () => {
      block().props.onKeyDown({key: '0', preventDefault});
    });

    expect(renderer.root.findByProps({className: 'mermaid-viewport'}).props.style.transform)
      .toContain('scale(1)');
  });

  it('consumes wheel input for direct diagram zoom', async () => {
    const renderer = await renderMermaidBlock();
    const preventDefault = jest.fn();
    const block = renderer.root.findByProps({className: 'mermaid-block'});

    await act(async () => {
      block.props.onWheel({deltaY: -1, clientX: 40, clientY: 30, preventDefault});
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(renderer.root.findByProps({className: 'mermaid-viewport'}).props.style.transform)
      .toContain('scale(1.2)');
  });

  it('pans with arrow keys and left-button dragging', async () => {
    const renderer = await renderMermaidBlock();
    const preventDefault = jest.fn();
    const focus = jest.fn();
    const setPointerCapture = jest.fn();
    const releasePointerCapture = jest.fn();
    const currentTarget = {
      focus,
      setPointerCapture,
      releasePointerCapture,
      hasPointerCapture: () => true,
    };

    await act(async () => {
      renderer.root.findByProps({className: 'mermaid-block'}).props.onKeyDown({
        key: 'ArrowRight',
        preventDefault,
      });
    });
    expect(renderer.root.findByProps({className: 'mermaid-viewport'}).props.style.transform)
      .toContain('translate(40px, 0px)');

    await act(async () => {
      renderer.root.findByProps({className: 'mermaid-block'}).props.onPointerDown({
        button: 0,
        pointerId: 7,
        clientX: 10,
        clientY: 20,
        currentTarget,
        preventDefault,
      });
    });
    await act(async () => {
      renderer.root.findByProps({className: 'mermaid-block is-dragging'}).props.onPointerMove({
        pointerId: 7,
        clientX: 35,
        clientY: 45,
        preventDefault,
      });
    });

    expect(renderer.root.findByProps({className: 'mermaid-viewport'}).props.style.transform)
      .toContain('translate(65px, 25px)');
    expect(focus).toHaveBeenCalled();
    expect(setPointerCapture).toHaveBeenCalledWith(7);

    await act(async () => {
      renderer.root.findByProps({className: 'mermaid-block is-dragging'}).props.onPointerUp({
        pointerId: 7,
        currentTarget,
      });
    });

    expect(releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('opens a larger modal viewer without resetting the current viewport', async () => {
    const renderer = await renderMermaidBlock();
    const preventDefault = jest.fn();
    const block = renderer.root.findByProps({className: 'mermaid-block'});

    await act(async () => {
      block.props.onKeyDown({key: '+', preventDefault});
    });

    const expandButton = renderer.root.findByProps({
      'aria-label': 'Open Mermaid diagram viewer',
    });
    await act(async () => {
      expandButton.props.onClick({stopPropagation: jest.fn()});
    });

    const dialog = renderer.root.findByProps({role: 'dialog'});
    expect(dialog.props['aria-modal']).toBe(true);
    expect(renderer.root.findByProps({className: 'mermaid-modal-viewport'}).props.style.transform)
      .toContain('scale(1.2)');

    await act(async () => {
      dialog.props.onKeyDown({key: 'Escape', preventDefault, stopPropagation: jest.fn()});
    });

    expect(() => renderer.root.findByProps({role: 'dialog'})).toThrow();
    expect(renderer.root.findByProps({className: 'mermaid-viewport'}).props.style.transform)
      .toContain('scale(1.2)');
  });

  it('closes the modal when its backdrop is clicked', async () => {
    const renderer = await renderMermaidBlock();
    const expandButton = renderer.root.findByProps({
      'aria-label': 'Open Mermaid diagram viewer',
    });

    await act(async () => {
      expandButton.props.onClick({stopPropagation: jest.fn()});
    });

    const overlay = renderer.root.findByProps({className: 'mermaid-modal-overlay'});
    const backdrop = {};
    await act(async () => {
      overlay.props.onClick({target: backdrop, currentTarget: backdrop});
    });

    expect(() => renderer.root.findByProps({role: 'dialog'})).toThrow();
  });
});


const adaptiveCodeOptions = {
  className: 'language-ts',
  children: 'const answer: number = 42;\n',
  themeMode: 'dark' as const,
  codeTheme: 'auto-plus' as const,
  codeFont: 'consolas' as const,
  codeFontSize: 13,
  codeLineHeight: 1.5,
  codeTabSize: 2,
  wrap: true,
  lineNumbers: false,
  framed: true,
};

async function renderCodeRenderer(options: Parameters<typeof markdownCodeRenderer>[0]) {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<>{markdownCodeRenderer(options)}</>);
  });
  for (let i = 0; i < 100; i++) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    const wrap = renderer!.root.findAll(node => node.props?.dangerouslySetInnerHTML);
    if (wrap.some(node => !node.props['data-markdown-export-pending'])) return renderer!;
  }
  return renderer!;
}

describe('markdownCodeRenderer adaptive code theme', () => {
  it('renders fenced code with light/dark CSS variables in adaptive mode', async () => {
    const renderer = await renderCodeRenderer({...adaptiveCodeOptions, adaptiveCodeTheme: true});

    const wrap = renderer.root.findByProps({className: 'code-wrap wrap'});
    const html = wrap.props.dangerouslySetInnerHTML.__html as string;
    expect(html).toContain('--shiki-light:');
    expect(html).toContain('--shiki-dark:');

    act(() => renderer.unmount());
  });

  it('keeps fixed single-theme colors without the adaptive flag', async () => {
    const renderer = await renderCodeRenderer(adaptiveCodeOptions);

    const wrap = renderer.root.findByProps({className: 'code-wrap wrap'});
    const html = wrap.props.dangerouslySetInnerHTML.__html as string;
    expect(html).toMatch(/color:#/);
    expect(html).not.toContain('--shiki-light:');

    act(() => renderer.unmount());
  });

  it('bypasses chunked virtualization for large blocks in adaptive mode', async () => {
    const bigContent = `${'const x = 1;\n'.repeat(2100)}`;
    const adaptive = await renderCodeRenderer({
      ...adaptiveCodeOptions,
      children: bigContent,
      adaptiveCodeTheme: true,
    });
    const live = await renderCodeRenderer({
      ...adaptiveCodeOptions,
      children: bigContent,
    });

    expect(adaptive.root.findAll(node => node.props?.['data-chunk-sentinel'] !== undefined)).toHaveLength(0);
    expect(live.root.findAll(node => node.props?.['data-chunk-sentinel'] !== undefined).length)
      .toBeGreaterThan(0);

    act(() => adaptive.unmount());
    act(() => live.unmount());
  });
});
