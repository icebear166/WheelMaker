jest.mock('../web/src/code/shikiRenderer', () => ({
  DEFAULT_CODE_FONT: 'jetbrains',
  DEFAULT_CODE_FONT_SIZE: 13,
  DEFAULT_CODE_LINE_HEIGHT: 1.5,
  DEFAULT_CODE_TAB_SIZE: 2,
  DEFAULT_CODE_THEME: 'dark-plus',
  isCodeFontId: () => true,
  isCodeThemeId: () => true,
}));

import { WorkspaceController } from '../web/src/workspace/WorkspaceController';
import { WorkspaceStore } from '../web/src/workspace/WorkspaceStore';

describe('workspace lightweight project switching', () => {
  test('restores a preferred project without loading its root filesystem', async () => {
    const projects = [
      {projectId: 'p1', name: 'One', online: true, path: '/one'},
      {projectId: 'p2', name: 'Two', online: true, path: '/two'},
    ];
    const service = {
      connect: jest.fn().mockResolvedValue({
        projects,
        hubs: [{hubId: 'hub'}],
        selectedProjectId: 'p1',
      }),
      selectProjectLightweight: jest.fn().mockResolvedValue({
        projects,
        hubs: [{hubId: 'hub'}],
        selectedProjectId: 'p2',
      }),
    };
    const store = {
      selectProjectOnConnect: jest.fn(() => 'p2'),
      hydrateProject: jest.fn((projectId: string) => ({projectId})),
    };
    const controller = new WorkspaceController(service as any, store as any);

    await expect(controller.connect('ws://registry.example/ws')).resolves.toMatchObject({
      hydrated: {projectId: 'p2'},
    });
    expect(service.selectProjectLightweight).toHaveBeenCalledWith('p2');
  });

  test('switches project identity without loading root files', async () => {
    const service = {
      selectProjectLightweight: jest.fn().mockResolvedValue({
        projects: [
          { projectId: 'p1', name: 'One', online: true, path: '/one' },
          { projectId: 'p2', name: 'Two', online: true, path: '/two' },
        ],
        selectedProjectId: 'p2',
      }),
      listDirectory: jest.fn(),
    };
    const store = new WorkspaceStore({
      getProjectState: jest.fn((projectId: string) => ({
        selectedChatSessionId: '',
      })),
      getCachedFile: jest.fn((projectId: string, kind: string, path: string) => {
        if (projectId === 'p2' && kind === 'dir' && path === '.') {
          return {
            hash: 'root-hash',
            value: JSON.stringify([{ name: 'cached-root.ts', path: 'cached-root.ts', kind: 'file' }]),
          };
        }
        return null;
      }),
      patchProjectState: jest.fn(),
    } as any);
    const controller = new WorkspaceController(service as any, store);

    const result = await (controller as any).switchProjectLightweight('p2');

    expect(service.selectProjectLightweight).toHaveBeenCalledWith('p2');
    expect(service.listDirectory).not.toHaveBeenCalled();
    expect(result.hydrated.projectId).toBe('p2');
    expect(result.hydrated).toEqual({projectId: 'p2'});
    expect(result).not.toHaveProperty('rootEntries');
  });

  test('rememberGlobalState preserves chat selection while persisting workspace project', () => {
    const globalState = {
      selectedProjectId: 'p1',
      selectedChatProjectId: 'chat-project',
      selectedChatSessionId: 'chat-session',
    };
    const persistence = {
      getGlobalState: jest.fn(() => globalState),
      patchGlobalState: jest.fn((patch: Record<string, unknown>) => Object.assign(globalState, patch)),
    };
    const store = new WorkspaceStore(persistence as any);

    store.rememberGlobalState({ selectedProjectId: 'p2' } as any);

    expect(persistence.patchGlobalState).toHaveBeenCalledWith({ selectedProjectId: 'p2' });
    expect(globalState.selectedChatProjectId).toBe('chat-project');
    expect(globalState.selectedChatSessionId).toBe('chat-session');
  });
});
