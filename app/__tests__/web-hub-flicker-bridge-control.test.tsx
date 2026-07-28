import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {FlickerBridgeControl} from '../web/src/app/FlickerBridgeControl';
import {normalizeFlickerBridgeStatus} from '../web/src/app/flickerBridgeState';

test('switches Flicker Bridge mode and exposes the selected segment', async () => {
  const onSwitchMode = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <FlickerBridgeControl
        status={normalizeFlickerBridgeStatus({
          configured: true,
          supported: true,
          state: 'running',
          mode: 'v1',
          runningMode: 'v1',
          availableModes: ['v1', 'v2'],
        })}
        busy={false}
        onLifecycle={jest.fn()}
        onSwitchMode={onSwitchMode}
      />,
    );
  });

  const v1 = renderer.root.findByProps({'aria-label': 'Use Flicker Bridge V1'});
  const v2 = renderer.root.findByProps({'aria-label': 'Use Flicker Bridge V2'});
  expect(v1.props['aria-pressed']).toBe(true);
  expect(v1.props.disabled).toBe(true);
  expect(v2.props.disabled).toBe(false);
  act(() => v2.props.onClick());
  expect(onSwitchMode).toHaveBeenCalledWith('v2');
});

test('highlights the actual running mode without an inline status label', async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <FlickerBridgeControl
        status={normalizeFlickerBridgeStatus({
          configured: true,
          supported: true,
          state: 'running',
          mode: 'v1',
          runningMode: 'v2',
          availableModes: ['v1', 'v2'],
        })}
        busy={false}
        onLifecycle={jest.fn()}
        onSwitchMode={jest.fn()}
      />,
    );
  });

  const v1 = renderer.root.findByProps({'aria-label': 'Use Flicker Bridge V1'});
  const v2 = renderer.root.findByProps({'aria-label': 'Use Flicker Bridge V2'});
  expect(v1.props.className).toContain('selected');
  expect(v1.props.className).not.toContain('running');
  expect(v2.props.className).toContain('running');
  expect(renderer.root.findAllByProps({className: 'chat-hub-flicker-bridge-state'})).toHaveLength(0);
});

test('disables unavailable mode and all lifecycle actions while busy', async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <FlickerBridgeControl
        status={normalizeFlickerBridgeStatus({
          configured: true,
          supported: true,
          state: 'running',
          mode: 'v1',
          runningMode: 'v1',
          availableModes: ['v1'],
          modeErrors: {v2: 'Node.js 22 is required'},
        })}
        busy
        onLifecycle={jest.fn()}
        onSwitchMode={jest.fn()}
      />,
    );
  });

  expect(renderer.root.findByProps({'aria-label': 'Use Flicker Bridge V2'}).props).toMatchObject({
    disabled: true,
    title: 'Node.js 22 is required',
  });
  expect(renderer.root.findByProps({className: 'chat-hub-flicker-bridge-error'}).children)
    .toEqual(['V2 unavailable · Node.js 22 is required']);
  expect(renderer.root.findAllByType('button').every(button => button.props.disabled)).toBe(true);
});
