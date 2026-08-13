import fs from 'fs';
import path from 'path';

import {REGISTRY_LIVENESS_PROBE_TIMEOUT_MS, RegistryClient} from '../web/src/registry/RegistryClient';

describe('web registry client close policy', () => {
  test('closes and rejects a websocket connection that is still opening', async () => {
    const originalWebSocket = globalThis.WebSocket;
    class PendingWebSocket {
      static readonly OPEN = 1;
      static readonly instances: PendingWebSocket[] = [];
      readyState = 0;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: ((event: {code: number; reason: string}) => void) | null = null;
      onmessage: (() => void) | null = null;
      send = jest.fn();
      close = jest.fn(() => {
        this.readyState = 3;
        this.finishClose();
      });

      constructor(_url: string) {
        PendingWebSocket.instances.push(this);
      }

      finishClose(): void {
        this.onclose?.({code: 1000, reason: 'client close'});
      }
    }
    (globalThis as typeof globalThis & {WebSocket: typeof PendingWebSocket}).WebSocket = PendingWebSocket;
    const client = new RegistryClient(8000);
    let connectPromise: Promise<void> | null = null;
    let socket: PendingWebSocket | null = null;

    try {
      connectPromise = client.connect('ws://registry.example/ws');
      socket = PendingWebSocket.instances[0];
      client.close();

      expect(socket.close).toHaveBeenCalledTimes(1);
      await expect(connectPromise).rejects.toThrow('registry websocket closed during connect');
    } finally {
      socket?.finishClose();
      await connectPromise?.catch(() => undefined);
      (globalThis as typeof globalThis & {WebSocket?: typeof WebSocket}).WebSocket = originalWebSocket;
    }
  });

  test('does not treat websocket error event as immediate disconnect', () => {
    const projectRoot = path.join(__dirname, '..');
    const clientTs = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'registry', 'RegistryClient.ts'), 'utf8');

    expect(clientTs).toContain('ws.onclose = () => this.handleSocketClosed(ws);');
    expect(clientTs).not.toContain('ws.onerror = () => this.handleSocketClosed(ws);');
  });

  test('aborting a request rejects it and removes the pending response slot', async () => {
    const originalWebSocket = globalThis.WebSocket;
    const send = jest.fn();
    (globalThis as typeof globalThis & {WebSocket: {OPEN: number}}).WebSocket = {OPEN: 1};
    const client = new RegistryClient(8000);
    Object.assign(client as unknown as {ws: unknown}, {
      ws: {readyState: 1, send},
    });
    const controller = new AbortController();

    try {
      const request = client.request({
        method: 'project.fs.read',
        projectId: 'hub:project',
        payload: {path: 'src/large.ts'},
        signal: controller.signal,
      });
      controller.abort();

      await expect(request).rejects.toMatchObject({name: 'AbortError'});
      expect(send).toHaveBeenCalledTimes(1);
      expect((client as unknown as {pending: Map<number, unknown>}).pending.size).toBe(0);
    } finally {
      (globalThis as typeof globalThis & {WebSocket?: typeof WebSocket}).WebSocket = originalWebSocket;
    }
  });

  function createHalfOpenWebSocketClass() {
    return class HalfOpenWebSocket {
      static readonly OPEN = 1;
      static instances: HalfOpenWebSocket[] = [];
      readyState = 0;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: ((event: {code: number; reason: string}) => void) | null = null;
      onmessage: ((event: {data: unknown}) => void) | null = null;
      readonly sent: string[] = [];
      readonly close = jest.fn(() => {
        this.readyState = 3;
      });

      constructor(_url: string) {
        HalfOpenWebSocket.instances.push(this);
      }

      send(raw: string): void {
        this.sent.push(raw);
      }

      open(): void {
        this.readyState = 1;
        this.onopen?.();
      }

      receive(message: Record<string, unknown>): void {
        this.onmessage?.({data: JSON.stringify(message)});
      }
    };
  }

  test('declares a half-open connection dead after an unanswered liveness probe and reconnects with a fresh socket', async () => {
    jest.useFakeTimers();
    const originalWebSocket = globalThis.WebSocket;
    const FakeWebSocket = createHalfOpenWebSocketClass();
    (globalThis as typeof globalThis & {WebSocket: unknown}).WebSocket = FakeWebSocket;
    const client = new RegistryClient(8000);
    const closed = jest.fn();
    client.onClose(closed);

    try {
      const connectPromise = client.connect('ws://registry.example/ws');
      const socket = FakeWebSocket.instances[0];
      socket.open();
      await connectPromise;

      // The socket never reports any event again, simulating a half-open TCP connection.
      const request = client.request({method: 'session.list', payload: {}, timeoutMs: 50});
      const requestExpectation = expect(request).rejects.toThrow('registry request timed out');
      await jest.advanceTimersByTimeAsync(50);
      await requestExpectation;

      // The timed-out request triggers a lightweight liveness probe.
      expect(socket.sent).toHaveLength(2);
      const probe = JSON.parse(socket.sent[1]) as {method?: string};
      expect(probe.method).toBe('server.config.get');
      expect(socket.close).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();

      // The probe goes unanswered too: the connection is declared dead and torn down.
      await jest.advanceTimersByTimeAsync(REGISTRY_LIVENESS_PROBE_TIMEOUT_MS);
      expect(socket.close).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledTimes(1);

      // The next connect builds a fresh socket instead of trusting the dead one.
      const reconnectPromise = client.connect('ws://registry.example/ws');
      expect(FakeWebSocket.instances).toHaveLength(2);
      FakeWebSocket.instances[1].open();
      await reconnectPromise;
    } finally {
      jest.useRealTimers();
      (globalThis as typeof globalThis & {WebSocket?: typeof WebSocket}).WebSocket = originalWebSocket;
    }
  });

  test('keeps the connection alive when the liveness probe receives a response', async () => {
    jest.useFakeTimers();
    const originalWebSocket = globalThis.WebSocket;
    const FakeWebSocket = createHalfOpenWebSocketClass();
    (globalThis as typeof globalThis & {WebSocket: unknown}).WebSocket = FakeWebSocket;
    const client = new RegistryClient(8000);
    const closed = jest.fn();
    client.onClose(closed);

    try {
      const connectPromise = client.connect('ws://registry.example/ws');
      const socket = FakeWebSocket.instances[0];
      socket.open();
      await connectPromise;

      // A slow request times out on an otherwise healthy connection.
      const request = client.request({method: 'session.list', payload: {}, timeoutMs: 50});
      const requestExpectation = expect(request).rejects.toThrow('registry request timed out');
      await jest.advanceTimersByTimeAsync(50);
      await requestExpectation;

      expect(socket.sent).toHaveLength(2);
      const probe = JSON.parse(socket.sent[1]) as {requestId?: number; method?: string};

      // Any envelope from the server proves the connection is alive.
      socket.receive({requestId: probe.requestId, type: 'response', method: probe.method, payload: {}});
      await jest.advanceTimersByTimeAsync(REGISTRY_LIVENESS_PROBE_TIMEOUT_MS + 1000);

      expect(socket.close).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();

      // The existing socket is still trusted, so connect() remains a no-op.
      await client.connect('ws://registry.example/ws');
      expect(FakeWebSocket.instances).toHaveLength(1);
    } finally {
      jest.useRealTimers();
      (globalThis as typeof globalThis & {WebSocket?: typeof WebSocket}).WebSocket = originalWebSocket;
    }
  });

  test('runs a single liveness probe when multiple requests time out together', async () => {
    jest.useFakeTimers();
    const originalWebSocket = globalThis.WebSocket;
    const FakeWebSocket = createHalfOpenWebSocketClass();
    (globalThis as typeof globalThis & {WebSocket: unknown}).WebSocket = FakeWebSocket;
    const client = new RegistryClient(8000);
    const closed = jest.fn();
    client.onClose(closed);

    try {
      const connectPromise = client.connect('ws://registry.example/ws');
      const socket = FakeWebSocket.instances[0];
      socket.open();
      await connectPromise;

      const first = client.request({method: 'session.list', payload: {}, timeoutMs: 50});
      const second = client.request({method: 'session.read', payload: {}, timeoutMs: 50});
      const firstExpectation = expect(first).rejects.toThrow('registry request timed out');
      const secondExpectation = expect(second).rejects.toThrow('registry request timed out');
      await jest.advanceTimersByTimeAsync(50);
      await firstExpectation;
      await secondExpectation;

      expect(socket.sent).toHaveLength(3);
      const probe = JSON.parse(socket.sent[2]) as {requestId?: number; method?: string};
      expect(probe.method).toBe('server.config.get');

      // Even an error envelope proves liveness: the connection stays up.
      socket.receive({requestId: probe.requestId, type: 'error', method: probe.method, payload: {code: 'denied', message: 'nope'}});
      await jest.advanceTimersByTimeAsync(REGISTRY_LIVENESS_PROBE_TIMEOUT_MS + 1000);

      expect(socket.close).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
      (globalThis as typeof globalThis & {WebSocket?: typeof WebSocket}).WebSocket = originalWebSocket;
    }
  });
});
