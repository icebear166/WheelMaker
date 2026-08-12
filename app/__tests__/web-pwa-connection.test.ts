import {ForegroundConnectionSupervisor} from '../web/src/platform/pwa/connection';

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
