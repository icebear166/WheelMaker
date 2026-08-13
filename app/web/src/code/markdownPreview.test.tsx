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

import {MermaidBlock} from './markdownPreview';

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
});
