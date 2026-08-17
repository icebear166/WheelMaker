/**
 * @jest-environment jsdom
 */
import {
  createPreviewWorkbenchChannel,
  type PreviewWorkbenchChannelFactory,
  type PreviewWorkbenchMessage,
} from './previewWorkbenchChannel';

type FakePort = {
  addEventListener: (type: 'message', listener: (event: {data: unknown}) => void) => void;
  removeEventListener: (type: 'message', listener: (event: {data: unknown}) => void) => void;
  postMessage: (message: unknown) => void;
  close: () => void;
  dispatch: (message: unknown) => void;
};

const portsByName = new Map<string, Set<FakePort>>();

const fakeChannelFactory: PreviewWorkbenchChannelFactory = name => {
  const listeners = new Set<(event: {data: unknown}) => void>();
  const port: FakePort = {
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    postMessage: message => {
      for (const peer of portsByName.get(name) ?? []) {
        if (peer === port) continue;
        peer.dispatch(message);
      }
    },
    close: () => {
      portsByName.get(name)?.delete(port);
      listeners.clear();
    },
    dispatch: () => undefined,
  };
  port.dispatch = message => {
    for (const listener of listeners) listener({data: message});
  };
  const ports = portsByName.get(name) ?? new Set<FakePort>();
  ports.add(port);
  portsByName.set(name, ports);
  return port;
};

afterEach(() => {
  portsByName.clear();
});

describe('preview workbench channel', () => {
  test('round-trips ready, intent and lightweight scroll messages through the typed channel', () => {
    const first = createPreviewWorkbenchChannel({channelFactory: fakeChannelFactory});
    const second = createPreviewWorkbenchChannel({channelFactory: fakeChannelFactory});
    const received: PreviewWorkbenchMessage[] = [];
    second.subscribe(message => received.push(message));

    first.post({kind: 'preview-ready', version: 1, instanceId: 'detached-1'});
    first.post({kind: 'preview-intent', version: 1, intent: {kind: 'dock'}});
    first.post({kind: 'preview-scroll', version: 1, scrollTop: 144});

    expect(received).toEqual([
      {kind: 'preview-ready', version: 1, instanceId: 'detached-1'},
      {kind: 'preview-intent', version: 1, intent: {kind: 'dock'}},
      {kind: 'preview-scroll', version: 1, scrollTop: 144},
    ]);
  });

  test('separate channel names do not receive each other’s messages', () => {
    const first = createPreviewWorkbenchChannel({name: 'preview-a', channelFactory: fakeChannelFactory});
    const second = createPreviewWorkbenchChannel({name: 'preview-b', channelFactory: fakeChannelFactory});
    const received: PreviewWorkbenchMessage[] = [];
    second.subscribe(message => received.push(message));

    first.post({kind: 'preview-ready', version: 1, instanceId: 'detached-a'});

    expect(received).toEqual([]);
  });

  test('close removes the subscription and ignores messages after close', () => {
    const channel = createPreviewWorkbenchChannel({channelFactory: fakeChannelFactory});
    const listener = jest.fn();
    channel.subscribe(listener);
    channel.close();
    channel.post({kind: 'preview-ready', version: 1, instanceId: 'detached-1'});

    expect(listener).not.toHaveBeenCalled();
  });
});
