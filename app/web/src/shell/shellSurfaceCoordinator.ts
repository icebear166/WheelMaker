export type ShellSurfaceKind =
  | 'app-menu'
  | 'hub'
  | 'project'
  | 'prompt'
  | 'archive'
  | 'project-action'
  | 'project-session-action';

export type ShellSurfaceDrawerPolicy = 'keep' | 'close';

export type ShellSurface = {
  kind: ShellSurfaceKind;
  drawerPolicy: ShellSurfaceDrawerPolicy;
};

export type ShellSurfaceStore = {
  getSnapshot: () => ShellSurface | null;
  subscribe: (listener: () => void) => () => void;
  open: (surface: ShellSurface) => void;
  close: (kind?: ShellSurfaceKind) => void;
  reset: () => void;
};

export function createShellSurfaceStore(): ShellSurfaceStore {
  let snapshot: ShellSurface | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: ShellSurface | null) => {
    if (
      snapshot?.kind === next?.kind &&
      snapshot?.drawerPolicy === next?.drawerPolicy
    ) {
      return;
    }
    snapshot = next;
    listeners.forEach(listener => listener());
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open: surface => publish(surface),
    close: kind => {
      if (kind && snapshot?.kind !== kind) return;
      publish(null);
    },
    reset: () => publish(null),
  };
}

export const shellTransientSurfaceStore = createShellSurfaceStore();
