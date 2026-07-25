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
  it('shows responding state and fires onCancel', async () => {
    const onCancel = jest.fn();
    const tree = await render(<ChatStopStatusPill cancelling={false} onCancel={onCancel} />);
    const button = tree.root.findByType('button');
    expect(button.props.disabled).toBe(false);
    expect(button.props['aria-label']).toBe('Stop generating');
    expect(button.props.className).toBe('chat-stop-button');
    expect(tree.root.findByProps({className: 'chat-stop-status-indicator'}).props.role).toBe('status');
    expect(tree.root.findByProps({className: 'chat-stop-status-dot'}).props['aria-hidden']).toBe('true');
    expect(tree.root.findByProps({className: 'chat-stop-status-label'}).children).toEqual(['Responding']);
    await act(async () => {
      button.props.onClick();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows cancelling state as disabled with spinner', async () => {
    const tree = await render(<ChatStopStatusPill cancelling={true} onCancel={() => undefined} />);
    const button = tree.root.findByType('button');
    expect(button.props.disabled).toBe(true);
    expect(button.props['aria-busy']).toBe(true);
    expect(tree.root.findByProps({className: 'chat-stop-status-label'}).children).toEqual(['Cancelling']);
    const svg = tree.root.findByType('svg');
    expect(svg.props.className).toContain('sl-icon-spin');
  });
});
