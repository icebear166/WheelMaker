export type ChatRealtimeFlushScheduler = {
  schedule: (runtimeKey: string) => void;
  flushNow: () => void;
  dispose: () => void;
};

export function createChatRealtimeFlushScheduler(options: {
  requestFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
  flush: (runtimeKeys: readonly string[]) => void;
}): ChatRealtimeFlushScheduler {
  const pendingRuntimeKeys = new Set<string>();
  let frameHandle: number | null = null;
  let disposed = false;

  const flushPending = () => {
    frameHandle = null;
    if (disposed || pendingRuntimeKeys.size === 0) {
      pendingRuntimeKeys.clear();
      return;
    }
    const runtimeKeys = [...pendingRuntimeKeys];
    pendingRuntimeKeys.clear();
    options.flush(runtimeKeys);
  };

  return {
    schedule(runtimeKey) {
      if (disposed) {
        return;
      }
      pendingRuntimeKeys.add(runtimeKey);
      if (frameHandle === null) {
        frameHandle = options.requestFrame(flushPending);
      }
    },
    flushNow() {
      if (disposed) {
        return;
      }
      if (frameHandle !== null) {
        options.cancelFrame(frameHandle);
        frameHandle = null;
      }
      flushPending();
    },
    dispose() {
      disposed = true;
      pendingRuntimeKeys.clear();
      if (frameHandle !== null) {
        options.cancelFrame(frameHandle);
        frameHandle = null;
      }
    },
  };
}
