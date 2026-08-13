export type ConnectionHooks = {
  connect: () => Promise<void> | void;
  disconnect: (reason: 'background' | 'offline' | 'stop') => void;
};

export type ForegroundConnectionSupervisorOptions = {
  reconnectDelayMs?: number;
  shouldDisconnectOnBackground?: () => boolean;
};

export class ForegroundConnectionSupervisor {
  private readonly reconnectDelayMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  constructor(
    private readonly hooks: ConnectionHooks,
    private readonly env: {
      document?: {hidden?: boolean; addEventListener?: (name: string, cb: () => void) => void; removeEventListener?: (name: string, cb: () => void) => void};
      window?: {addEventListener?: (name: string, cb: () => void) => void; removeEventListener?: (name: string, cb: () => void) => void};
      navigator?: {onLine?: boolean};
      setTimeoutImpl?: typeof setTimeout;
      clearTimeoutImpl?: typeof clearTimeout;
    } = {
      document: typeof document !== 'undefined' ? document : undefined,
      window: typeof window !== 'undefined' ? window : undefined,
      navigator: typeof navigator !== 'undefined' ? navigator : undefined,
      setTimeoutImpl: setTimeout,
      clearTimeoutImpl: clearTimeout,
    },
    private readonly options: ForegroundConnectionSupervisorOptions = {},
  ) {
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1200;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.env.document?.addEventListener?.('visibilitychange', this.handleVisibilityChange);
    this.env.window?.addEventListener?.('online', this.handleOnline);
    this.env.window?.addEventListener?.('offline', this.handleOffline);
    void this.tryConnect();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.clearReconnectTimer();
    this.env.document?.removeEventListener?.('visibilitychange', this.handleVisibilityChange);
    this.env.window?.removeEventListener?.('online', this.handleOnline);
    this.env.window?.removeEventListener?.('offline', this.handleOffline);
    this.hooks.disconnect('stop');
  }

  private readonly handleVisibilityChange = (): void => {
    if (!this.started) return;
    if (this.env.document?.hidden) {
      this.clearReconnectTimer();
      if (this.options.shouldDisconnectOnBackground?.() === false) {
        return;
      }
      this.hooks.disconnect('background');
      return;
    }
    void this.tryConnect();
  };

  private readonly handleOnline = (): void => {
    if (!this.started) return;
    void this.tryConnect();
  };

  private readonly handleOffline = (): void => {
    if (!this.started) return;
    this.clearReconnectTimer();
    this.hooks.disconnect('offline');
    this.scheduleRetry();
  };

  private isForeground(): boolean {
    return !this.env.document?.hidden;
  }

  private scheduleRetry(): void {
    if (!this.started || !this.isForeground() || this.reconnectTimer) {
      return;
    }
    const setTimeoutImpl = this.env.setTimeoutImpl ?? setTimeout;
    this.reconnectTimer = setTimeoutImpl(() => {
      this.reconnectTimer = null;
      void this.tryConnect();
    }, this.reconnectDelayMs);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    const clearTimeoutImpl = this.env.clearTimeoutImpl ?? clearTimeout;
    clearTimeoutImpl(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private async tryConnect(): Promise<void> {
    if (!this.started || !this.isForeground()) {
      return;
    }
    try {
      await this.hooks.connect();
      this.clearReconnectTimer();
    } catch {
      this.scheduleRetry();
    }
  }
}

export type ReconnectWatchdogHooks = {
  shouldReconnect: () => boolean;
  reconnect: () => void;
};

export type ReconnectWatchdogOptions = {
  minIntervalMs?: number;
  requestFrame?: (callback: (now: number) => void) => number;
  cancelFrame?: (handle: number) => void;
};

// Recovery driven by requestAnimationFrame: frames only run while the page is
// actually rendering, so the watchdog stays silent in the background and does
// not depend on visibilitychange/online events that some WebViews never
// dispatch after a resume.
export function startReconnectWatchdog(
  hooks: ReconnectWatchdogHooks,
  options: ReconnectWatchdogOptions = {},
): () => void {
  const requestFrame =
    options.requestFrame ??
    (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame.bind(globalThis) : undefined);
  const cancelFrame =
    options.cancelFrame ??
    (typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame.bind(globalThis) : undefined);
  if (!requestFrame || !cancelFrame) {
    return () => {};
  }
  const minIntervalMs = options.minIntervalMs ?? 1000;
  let frameHandle: number | null = null;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let stopped = false;

  const tick = (now: number): void => {
    if (stopped) return;
    frameHandle = requestFrame(tick);
    if (now - lastAttemptAt < minIntervalMs) return;
    if (!hooks.shouldReconnect()) return;
    lastAttemptAt = now;
    hooks.reconnect();
  };
  frameHandle = requestFrame(tick);

  return () => {
    stopped = true;
    if (frameHandle !== null) {
      cancelFrame(frameHandle);
    }
    frameHandle = null;
  };
}
