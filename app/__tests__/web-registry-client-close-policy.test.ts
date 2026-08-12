import fs from 'fs';
import path from 'path';

import {RegistryClient} from '../web/src/registry/RegistryClient';

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
});
