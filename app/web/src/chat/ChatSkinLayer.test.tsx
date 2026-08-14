import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {ChatSkinLayer} from './ChatSkinLayer';

describe('ChatSkinLayer', () => {
  test('renders the skin below content as a hidden decorative layer', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(<ChatSkinLayer src="blob:skin" bottomOffset={96} />);
    });
    const tree = renderer?.root;
    expect(tree).toBeDefined();
    if (!tree) return;

    expect(tree.findByProps({'aria-hidden': 'true'}).props.className).toBe('chat-skin-layer');
    expect(tree.findByType('img').props.src).toBe('blob:skin');
    expect(tree.findByType('img').props.alt).toBe('');
  });
});
