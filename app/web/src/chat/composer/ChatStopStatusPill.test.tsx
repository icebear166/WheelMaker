import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {ChatStopStatusPill} from './ChatStopStatusPill';

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(element);
  });
  return tree!;
}

describe('ChatStopStatusPill', () => {
  it('shows the pedaling bike while responding and fires onCancel', async () => {
    const onCancel = jest.fn();
    const tree = await render(<ChatStopStatusPill cancelling={false} onCancel={onCancel} />);
    const button = tree.root.findByType('button');
    expect(button.props.disabled).toBe(false);
    expect(button.props['aria-label']).toBe('Stop generating');
    expect(button.props.className).toBe('chat-stop-pill');
    const iconNames = tree.root.findAllByType('svg').map(svg => svg.props['data-icon-name']);
    expect(iconNames).toEqual(['bike', 'stop']);
    const a11yLabel = tree.root.findByProps({className: 'chat-stop-pill-a11y-label'});
    expect(a11yLabel.props.role).toBe('status');
    expect(a11yLabel.props['aria-live']).toBe('polite');
    expect(a11yLabel.children).toEqual(['Responding']);
    await act(async () => {
      button.props.onClick();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('freezes into the cancelling state as disabled', async () => {
    const tree = await render(<ChatStopStatusPill cancelling={true} onCancel={() => undefined} />);
    const button = tree.root.findByType('button');
    expect(button.props.disabled).toBe(true);
    expect(button.props['aria-busy']).toBe(true);
    expect(button.props.className).toBe('chat-stop-pill cancelling');
    expect(tree.root.findByProps({className: 'chat-stop-pill-a11y-label'}).children).toEqual(['Cancelling']);
  });
});
