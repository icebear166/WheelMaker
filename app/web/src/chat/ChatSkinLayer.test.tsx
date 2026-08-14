import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {ChatSkinLayer} from './ChatSkinLayer';

describe('ChatSkinLayer', () => {
  test('anchors the hidden decorative skin to the chat bottom-right with display controls', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(<ChatSkinLayer src="blob:skin" scale={1.35} opacity={0.42} />);
    });
    const tree = renderer?.root;
    expect(tree).toBeDefined();
    if (!tree) return;

    expect(tree.findByProps({'aria-hidden': 'true'}).props.className).toBe('chat-skin-layer');
    expect(tree.findByType('img').props.src).toBe('blob:skin');
    expect(tree.findByType('img').props.alt).toBe('');
    expect(tree.findByProps({'aria-hidden': 'true'}).props.style).toMatchObject({
      '--chat-skin-scale': '1.35',
      '--chat-skin-opacity': '0.42',
    });
  });
});
