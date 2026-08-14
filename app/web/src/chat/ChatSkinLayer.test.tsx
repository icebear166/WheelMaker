import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {ChatSkinLayer} from './ChatSkinLayer';

describe('ChatSkinLayer', () => {
  test('anchors the hidden decorative skin to the composer bottom-right with display controls', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(
        <ChatSkinLayer
          src="blob:skin"
          scale={0.75}
          opacity={0.42}
          anchorRight={60}
          anchorBottom={40}
          offset={24}
        />,
      );
    });
    const tree = renderer?.root;
    expect(tree).toBeDefined();
    if (!tree) return;

    const layer = tree.findByProps({'aria-hidden': 'true'});
    expect(layer.type).toBe('img');
    expect(layer.props.className).toBe('chat-skin-layer');
    expect(tree.findByType('img').props.src).toBe('blob:skin');
    expect(tree.findByType('img').props.alt).toBe('');
    expect(layer.props.style).toMatchObject({
      '--chat-skin-scale': '75%',
      '--chat-skin-opacity': '0.42',
      '--chat-skin-anchor-right': '60px',
      '--chat-skin-anchor-bottom': '40px',
      '--chat-skin-offset': '24px',
    });
  });
});
