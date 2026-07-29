import {
  applyFlickerBridgeHubStateEvent,
  normalizeFlickerBridgeStatus,
} from '../web/src/app/flickerBridgeState';

test('normalizes a Flicker Bridge lifecycle status', () => {
  expect(normalizeFlickerBridgeStatus({
    configured: true,
    supported: true,
    state: 'running',
    endpoint: 'http://127.0.0.1:17999',
    port: 17999,
    pid: 42,
    mode: 'v2',
    runningMode: 'v2',
    availableModes: ['v1', 'v2'],
    modeErrors: {},
  })).toEqual({
    configured: true,
    supported: true,
    state: 'running',
    endpoint: 'http://127.0.0.1:17999',
    port: 17999,
    pid: 42,
    error: undefined,
    mode: 'v2',
    runningMode: 'v2',
    availableModes: ['v1', 'v2'],
    modeErrors: {},
  });
});

test('applies a flickerBridge Hub state event to the matching hub only', () => {
  const next = applyFlickerBridgeHubStateEvent(
    {
      existing: normalizeFlickerBridgeStatus({configured: true, state: 'stopped'}),
    },
    {
      type: 'event',
      method: 'hub.state.updated',
      hubId: 'hub-a',
      payload: {
        sections: ['flickerBridge'],
        state: {
          hubId: 'hub-a',
          status: 'ready',
          sections: {
            flickerBridge: {
              status: 'ready',
              data: {
                configured: true,
                supported: true,
                state: 'running',
                endpoint: 'http://127.0.0.1:17999',
                port: 17999,
                pid: 123,
              },
            },
          },
        },
      },
    },
  );

  expect(next.existing.state).toBe('stopped');
  expect(next['hub-a']).toMatchObject({state: 'running', pid: 123});
});

test('ignores unrelated Hub state events', () => {
  const current = {
    'hub-a': normalizeFlickerBridgeStatus({configured: true, state: 'stopped'}),
  };
  expect(applyFlickerBridgeHubStateEvent(current, {
    type: 'event',
    method: 'hub.state.updated',
    hubId: 'hub-a',
    payload: {
      sections: ['tokenStats'],
      state: {hubId: 'hub-a', status: 'ready', sections: {}},
    },
  })).toBe(current);
});
