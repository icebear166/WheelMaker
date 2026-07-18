import {createChatRealtimeFlushScheduler} from '../web/src/chat/turns/chatRealtimeFlush';

describe('chat realtime visible-message flush scheduling', () => {
  test('coalesces repeated runtime updates into one animation frame', () => {
    const callbacks = new Map<number, () => void>();
    const flushed: string[][] = [];
    let nextHandle = 1;
    let requestCount = 0;
    const scheduler = createChatRealtimeFlushScheduler({
      requestFrame: (callback) => {
        const handle = nextHandle;
        nextHandle += 1;
        requestCount += 1;
        callbacks.set(handle, callback);
        return handle;
      },
      cancelFrame: (handle) => {
        callbacks.delete(handle);
      },
      flush: (runtimeKeys) => {
        flushed.push([...runtimeKeys]);
      },
    });

    scheduler.schedule('runtime-a');
    scheduler.schedule('runtime-a');
    scheduler.schedule('runtime-b');

    expect(requestCount).toBe(1);
    expect(flushed).toEqual([]);
    callbacks.get(1)?.();
    expect(flushed).toEqual([['runtime-a', 'runtime-b']]);
  });

  test('can flush pending updates immediately and cancel the scheduled frame', () => {
    const callbacks = new Map<number, () => void>();
    const flushed: string[][] = [];
    const scheduler = createChatRealtimeFlushScheduler({
      requestFrame: (callback) => {
        callbacks.set(1, callback);
        return 1;
      },
      cancelFrame: (handle) => {
        callbacks.delete(handle);
      },
      flush: (runtimeKeys) => {
        flushed.push([...runtimeKeys]);
      },
    });

    scheduler.schedule('runtime-a');
    scheduler.flushNow();

    expect(callbacks.size).toBe(0);
    expect(flushed).toEqual([['runtime-a']]);
  });

  test('disposes a pending frame without publishing stale updates', () => {
    const callbacks = new Map<number, () => void>();
    const flushed: string[][] = [];
    let requestCount = 0;
    const scheduler = createChatRealtimeFlushScheduler({
      requestFrame: (callback) => {
        requestCount += 1;
        callbacks.set(requestCount, callback);
        return requestCount;
      },
      cancelFrame: (handle) => {
        callbacks.delete(handle);
      },
      flush: (runtimeKeys) => {
        flushed.push([...runtimeKeys]);
      },
    });

    scheduler.schedule('runtime-a');
    scheduler.dispose();
    scheduler.schedule('runtime-b');

    expect(callbacks.size).toBe(0);
    expect(requestCount).toBe(1);
    expect(flushed).toEqual([]);
  });
});
