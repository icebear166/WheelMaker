import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {SessionIcon, SESSION_ICON_NAMES} from './SessionIcon';

describe('SessionIcon', () => {
  it('renders an svg with glyph content for every registered name', async () => {
    for (const name of SESSION_ICON_NAMES) {
      let tree: ReactTestRenderer | undefined;
      await act(async () => {
        tree = create(<SessionIcon name={name} />);
      });
      const svg = tree!.root.findByType('svg');
      expect(svg.props.className).toContain('sl-icon');
      expect(svg.props['aria-hidden']).toBe('true');
      expect(svg.props['data-icon-name']).toBe(name);
      // glyph must not be empty
      expect(svg.props.children).toBeTruthy();
    }
    expect(SESSION_ICON_NAMES).toEqual(
      expect.arrayContaining(['import', 'archiveRestore', 'clock']),
    );
    expect(SESSION_ICON_NAMES).not.toContain('play');
    expect(SESSION_ICON_NAMES).not.toContain('messageSquareMore');
  });

  it('applies spin class and custom size', async () => {
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = create(<SessionIcon name="loader" spin size={16} />);
    });
    const svg = tree!.root.findByType('svg');
    expect(svg.props.className).toContain('sl-icon-spin');
    expect(svg.props.width).toBe(16);
  });
});
