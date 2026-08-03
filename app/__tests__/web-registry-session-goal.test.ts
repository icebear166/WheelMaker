import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import {RegistryMethods, RegistryProtocolVersion} from '../web/src/registry/registryMethods';
import {RegistryWorkspaceService} from '../web/src/registry/RegistryWorkspaceService';

describe('web Registry Session capabilities and Goal transport', () => {
  test('normalizes message lifecycle feature from a session summary', async () => {
    const request = jest.fn().mockResolvedValue({
      payload: {
        sessions: [
          {
            sessionId: 'session-valid',
            sessionFeatures: {messageLifecycle: {version: 1}},
          },
          {
            sessionId: 'session-invalid',
            sessionFeatures: {messageLifecycle: {version: 1.5}},
          },
        ],
      },
    });
    const repository = new RegistryRepository({request} as never);

    const sessions = await repository.listSessions('project-a');

    expect(sessions[0].sessionFeatures).toEqual({messageLifecycle: {version: 1}});
    expect(sessions[1].sessionFeatures).toBeUndefined();
  });

  test('normalizes Goal capability and snapshot from a session summary', async () => {
    const request = jest.fn().mockResolvedValue({
      payload: {
        sessions: [{
          sessionId: 'session-1',
          title: 'Goal',
          updatedAt: '2026-07-26T10:00:00Z',
          sessionActions: {goal: {supported: true}},
          goal: {
            sessionId: 'session-1',
            objective: 'ship',
            status: 'active',
            tokenBudget: null,
            tokensUsed: 42.8,
            timeUsedSeconds: 7.9,
            createdAt: 10.9,
            updatedAt: 11.9,
            runtimeThreadId: 'must-not-leak',
          },
        }],
      },
    });
    const repository = new RegistryRepository({request} as never);

    await expect(repository.listSessions('project-a')).resolves.toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        sessionActions: expect.objectContaining({goal: {supported: true, reason: undefined}}),
        goal: {
          sessionId: 'session-1',
          objective: 'ship',
          status: 'active',
          tokenBudget: null,
          tokensUsed: 42,
          timeUsedSeconds: 7,
          createdAt: 10,
          updatedAt: 11,
        },
      }),
    ]);
  });

  test('preserves explicit null in a Goal budget patch', async () => {
    const request = jest.fn().mockResolvedValue({
      payload: {
        ok: true,
        sessionId: 'session-1',
        goal: {
          sessionId: 'session-1',
          objective: 'ship',
          status: 'paused',
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 10,
          updatedAt: 11,
        },
      },
    });
    const repository = new RegistryRepository({request} as never);

    await repository.updateSessionGoal('project-a', 'session-1', {
      tokenBudget: null,
      status: 'paused',
    });

    expect(request).toHaveBeenCalledWith({
      method: RegistryMethods.SessionGoalUpdate,
      projectId: 'project-a',
      payload: {sessionId: 'session-1', tokenBudget: null, status: 'paused'},
      timeoutMs: 30000,
    });
    expect(RegistryProtocolVersion).toBe('2.7');
  });

  test('workspace delegates all project-scoped Goal controls', async () => {
    const goal = {
      sessionId: 'session-1',
      objective: 'ship',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 10,
      updatedAt: 11,
    };
    const repository = {
      createSessionGoal: jest.fn().mockResolvedValue({ok: true, sessionId: 'session-1', goal}),
      getSessionGoal: jest.fn().mockResolvedValue({ok: true, sessionId: 'session-1', goal}),
      updateSessionGoal: jest.fn().mockResolvedValue({ok: true, sessionId: 'session-1', goal}),
      stopSessionGoal: jest.fn().mockResolvedValue({ok: true, sessionId: 'session-1', goal}),
      clearSessionGoal: jest.fn().mockResolvedValue({ok: true, sessionId: 'session-1', cleared: true}),
    };
    const service = new RegistryWorkspaceService();
    Object.assign(service as unknown as {repository: unknown}, {repository});

    await service.createProjectSessionGoal('project-a', 'session-1', 'ship', null);
    await service.getProjectSessionGoal('project-a', 'session-1');
    await service.updateProjectSessionGoal('project-a', 'session-1', {status: 'active'});
    await service.stopProjectSessionGoal('project-a', 'session-1');
    await service.clearProjectSessionGoal('project-a', 'session-1');

    expect(repository.createSessionGoal).toHaveBeenCalledWith('project-a', 'session-1', 'ship', null);
    expect(repository.getSessionGoal).toHaveBeenCalledWith('project-a', 'session-1');
    expect(repository.updateSessionGoal).toHaveBeenCalledWith('project-a', 'session-1', {status: 'active'});
    expect(repository.stopSessionGoal).toHaveBeenCalledWith('project-a', 'session-1');
    expect(repository.clearSessionGoal).toHaveBeenCalledWith('project-a', 'session-1');
  });
});
