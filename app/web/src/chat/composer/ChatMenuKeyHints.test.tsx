import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {ChatMenuKeyHints} from './ChatMenuKeyHints';

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(element);
  });
  return tree!;
}

describe('ChatMenuKeyHints', () => {
  it('renders each hint as kbd + label', async () => {
    const tree = await render(
      <ChatMenuKeyHints hints={[['↑↓', 'Select'], ['↵', 'Apply'], ['esc', 'Close']]} />,
    );
    const kbds = tree.root.findAllByType('kbd');
    expect(kbds.map(kbd => kbd.children.join(''))).toEqual(['↑↓', '↵', 'esc']);
    const root = tree.root.findByProps({className: 'chat-menu-footer'});
    expect(root).toBeDefined();
  });
});
