import {ForegroundConnectionSupervisor, startReconnectWatchdog} from '../web/src/platform/pwa/connection';

function createSupervisorEnv() {
  const documentListeners = new Map<string, () => void>();
  const windowListeners = new Map<string, () => void>();
  const env = {
    document: {
      hidden: false,
      addEventListener: (name: string, cb: () => void) => {
        documentListeners.set(name, cb);
      },
      removeEventListener: (name: string) => {
        documentListeners.delete(name);
      },
    },
    window: {
      addEventListener: (name: string, cb: () => void) => {
        windowListeners.set(name, cb);
      },
      removeEventListener: (name: string) => {
        windowListeners.delete(name);
      },
    },
    navigator: {onLine: true},
    setTimeoutImpl: setTimeout,
    clearTimeoutImpl: clearTimeout,
  };
  return {env, documentListeners, windowListeners};
}

describe('PWA foreground connection supervisor', () => {
  test('disconnects when the app enters background by default', () => {
    const {env, documentListeners} = createSupervisorEnv();
    const hooks = {
      connect: jest.fn(),
      disconnect: jest.fn(),
    };
    const supervisor = new ForegroundConnectionSupervisor(hooks, env);

    supervisor.start();
    env.document.hidden = true;
    documentListeners.get('visibilitychange')?.();

    expect(hooks.disconnect).toHaveBeenCalledWith('background');
  });

  test('keeps the registry connection during transient background while blocked', () => {
    const {env, documentListeners} = createSupervisorEnv();
    const hooks = {
      connect: jest.fn(),
      disconnect: jest.fn(),
    };
    const supervisor = new ForegroundConnectionSupervisor(hooks, env, {
      shouldDisconnectOnBackground: () => false,
    });

    supervisor.start();
    env.document.hidden = true;
    documentListeners.get('visibilitychange')?.();

    expect(hooks.disconnect).not.toHaveBeenCalledWith('background');
  });

  test('attempts reconnect when the app returns to foreground despite a stale offline hint', async () => {
    const {env, documentListeners, windowListeners} = createSupervisorEnv();
    const hooks = {
      connect: jest.fn(),
      disconnect: jest.fn(),
    };
    const supervisor = new ForegroundConnectionSupervisor(hooks, env);

    supervisor.start();
    hooks.connect.mockClear();
    env.document.hidden = true;
    documentListeners.get('visibilitychange')?.();
    env.navigator.onLine = false;
    windowListeners.get('offline')?.();
    env.document.hidden = false;
    documentListeners.get('visibilitychange')?.();
    await Promise.resolve();

    expect(hooks.disconnect).toHaveBeenNthCalledWith(1, 'background');
    expect(hooks.disconnect).toHaveBeenNthCalledWith(2, 'offline');
    expect(hooks.connect).toHaveBeenCalledTimes(1);
  });

  test('retries a failed foreground reconnect despite a stale offline hint', async () => {
    jest.useFakeTimers();
    try {
      const {env, documentListeners} = createSupervisorEnv();
      const hooks = {
        connect: jest.fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('resume failed'))
          .mockResolvedValueOnce(undefined),
        disconnect: jest.fn(),
      };
      const supervisor = new ForegroundConnectionSupervisor(hooks, env, {
        reconnectDelayMs: 10,
      });

      supervisor.start();
      await Promise.resolve();
      env.document.hidden = true;
      documentListeners.get('visibilitychange')?.();
      env.navigator.onLine = false;
      env.document.hidden = false;
      documentListeners.get('visibilitychange')?.();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(10);

      expect(hooks.connect).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  test('keeps retrying after an offline event while the app remains visible', async () => {
    jest.useFakeTimers();
    try {
      const {env, windowListeners} = createSupervisorEnv();
      const hooks = {
        connect: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn(),
      };
      const supervisor = new ForegroundConnectionSupervisor(hooks, env, {
        reconnectDelayMs: 10,
      });

      supervisor.start();
      await Promise.resolve();
      env.navigator.onLine = false;
      windowListeners.get('offline')?.();
      await jest.advanceTimersByTimeAsync(10);

      expect(hooks.disconnect).toHaveBeenCalledWith('offline');
      expect(hooks.connect).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('reconnect watchdog', () => {
  function createFrameDriver() {
    const callbacks = new Map<number, (now: number) => void>();
    let nextHandle = 1;
    return {
      requestFrame: (callback: (now: number) => void): number => {
        const handle = nextHandle++;
        callbacks.set(handle, callback);
        return handle;
      },
      cancelFrame: (handle: number): void => {
        callbacks.delete(handle);
      },
      step: (now: number): void => {
        const pending = Array.from(callbacks.values());
        callbacks.clear();
        for (const callback of pending) {
          callback(now);
        }
      },
    };
  }

  test('reconnects while the page renders disconnected, throttled to the minimum interval, until stopped', () => {
    const driver = createFrameDriver();
    const reconnect = jest.fn();
    const stop = startReconnectWatchdog(
      {shouldReconnect: () => true, reconnect},
      {minIntervalMs: 1000, requestFrame: driver.requestFrame, cancelFrame: driver.cancelFrame},
    );

    driver.step(0);
    driver.step(100);
    expect(reconnect).toHaveBeenCalledTimes(1);
    driver.step(1000);
    driver.step(1500);
    expect(reconnect).toHaveBeenCalledTimes(2);

    stop();
    driver.step(3000);
    expect(reconnect).toHaveBeenCalledTimes(2);
  });

  test('never reconnects while shouldReconnect is false', () => {
    const driver = createFrameDriver();
    const reconnect = jest.fn();
    const stop = startReconnectWatchdog(
      {shouldReconnect: () => false, reconnect},
      {minIntervalMs: 1000, requestFrame: driver.requestFrame, cancelFrame: driver.cancelFrame},
    );

    driver.step(0);
    driver.step(1000);
    driver.step(2000);

    expect(reconnect).not.toHaveBeenCalled();
    stop();
  });

  test('reconnects on the first frame after the page becomes reconnectable again', () => {
    let needed = false;
    const driver = createFrameDriver();
    const reconnect = jest.fn();
    const stop = startReconnectWatchdog(
      {shouldReconnect: () => needed, reconnect},
      {minIntervalMs: 1000, requestFrame: driver.requestFrame, cancelFrame: driver.cancelFrame},
    );

    driver.step(0);
    driver.step(1000);
    expect(reconnect).not.toHaveBeenCalled();

    needed = true;
    driver.step(2000);
    expect(reconnect).toHaveBeenCalledTimes(1);
    stop();
  });
});
