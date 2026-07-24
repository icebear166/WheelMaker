import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {CHAT_ICON_NAMES, ChatIcon} from './ChatIcon';

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(element);
  });
  return tree!;
}

describe('ChatIcon', () => {
  it('renders every registered glyph as an svg', async () => {
    const tree = await render(
      <>
        {CHAT_ICON_NAMES.map(name => (
          <ChatIcon key={name} name={name} />
        ))}
      </>,
    );
    expect(tree.root.findAllByType('svg')).toHaveLength(CHAT_ICON_NAMES.length);
  });

  it('renders stroke style with spin class', async () => {
    const tree = await render(<ChatIcon name="loader" spin size={16} />);
    const svg = tree.root.findByType('svg');
    expect(svg.props.className).toContain('sl-icon-spin');
    expect(svg.props.stroke).toBe('currentColor');
    expect(svg.props.strokeWidth).toBe(1.5);
    expect(svg.props.width).toBe(16);
  });

  it('supports filled rendering for stop-style glyphs', async () => {
    const tree = await render(<ChatIcon name="square" filled />);
    const svg = tree.root.findByType('svg');
    expect(svg.props.fill).toBe('currentColor');
    expect(svg.props.stroke).toBe('none');
  });

  it('exposes aria-label and drops aria-hidden when labelled', async () => {
    const tree = await render(<ChatIcon name="loader" spin ariaLabel="Submitting" />);
    const svg = tree.root.findByType('svg');
    expect(svg.props['aria-label']).toBe('Submitting');
    expect(svg.props['aria-hidden']).toBeUndefined();
  });
});
