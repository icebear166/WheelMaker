import {
  createShellSurfaceStore,
  type ShellSurface,
} from './shellSurfaceCoordinator';

describe('shell surface coordinator', () => {
  test('replaces the active surface without coupling drawer policy to the group', () => {
    const store = createShellSurfaceStore();
    const hubSurface: ShellSurface = {kind: 'hub', drawerPolicy: 'keep'};
    const appMenuSurface: ShellSurface = {kind: 'app-menu', drawerPolicy: 'close'};

    store.open(hubSurface);
    expect(store.getSnapshot()).toEqual(hubSurface);

    store.open(appMenuSurface);
    expect(store.getSnapshot()).toEqual(appMenuSurface);
    expect(store.getSnapshot()?.drawerPolicy).toBe('close');
  });

  test('only the owning surface can close itself', () => {
    const store = createShellSurfaceStore();
    store.open({kind: 'project', drawerPolicy: 'close'});

    store.close('hub');
    expect(store.getSnapshot()?.kind).toBe('project');

    store.close('project');
    expect(store.getSnapshot()).toBeNull();
  });
});
