import {
  applyFlickerBridgeHubStateEvent,
  flickerBridgeActions,
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
  })).toEqual({
    configured: true,
    supported: true,
    state: 'running',
    endpoint: 'http://127.0.0.1:17999',
    port: 17999,
    pid: 42,
    error: undefined,
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

test('failed live process remains stoppable and restartable', () => {
  expect(flickerBridgeActions(normalizeFlickerBridgeStatus({
    configured: true,
    supported: true,
    state: 'failed',
    pid: 321,
  }))).toEqual({
    canStart: false,
    canStop: true,
    canRestart: true,
  });
});

test('failed reaped process offers only start', () => {
  expect(flickerBridgeActions(normalizeFlickerBridgeStatus({
    configured: true,
    supported: true,
    state: 'failed',
  }))).toEqual({
    canStart: true,
    canStop: false,
    canRestart: false,
  });
});
