import {HubStore} from './hubStore';
import {selectWheelmakerUpdate} from './hubSelectors';
import type {
  RegistryEnvelope,
  RegistryHubState,
  RegistryHubStateSection,
} from '../registry/registryTypes';

function section<T>(revision: number, data: T): RegistryHubStateSection<T> {
  return {availability: 'ready', updateStatus: 'idle', revision, data};
}

function hubState(
  hubId: string,
  instanceId: string,
  sections: RegistryHubState['sections'],
): RegistryHubState {
  return {hubId, instanceId, sections};
}

function updated(
  hubId: string,
  instanceId: string,
  sections: RegistryHubState['sections'],
): RegistryEnvelope {
  return {
    type: 'event',
    method: 'hub.state.updated',
    hubId,
    payload: {instanceId, sections, reason: 'test'},
  };
}

test('replaces an older process instance and rejects older section revisions', () => {
  const store = new HubStore();
  store.replace(hubState('hub-a', 'instance-a', {skills: section(3, {name: 'old'})}));
  store.ingest(updated('hub-a', 'instance-a', {skills: section(2, {name: 'stale'})}));
  expect(store.getSection<{name: string}>('hub-a', 'skills')?.data).toEqual({name: 'old'});

  store.ingest(updated('hub-a', 'instance-b', {skills: section(1, {name: 'new-process'})}));
  expect(store.getSection<{name: string}>('hub-a', 'skills')?.data).toEqual({name: 'new-process'});
});

test('coalesces refresh calls while a section is queued or updating', async () => {
  const request = jest.fn(async () => ({
    accepted: true,
    updates: [{section: 'skills', updateId: 'skills:1', status: 'queued'}],
    state: hubState('hub-a', 'instance-a', {}),
  }));
  const store = new HubStore({refresh: request});
  await Promise.all([
    store.refresh('hub-a', ['skills']),
    store.refresh('hub-a', ['skills']),
  ]);
  expect(request).toHaveBeenCalledTimes(1);
});

test('discovers a Hub with get once and does not refresh it', async () => {
  const get = jest.fn(async () => hubState('hub-a', 'instance-a', {
    skills: section(1, {name: 'scope'}),
  }));
  const refresh = jest.fn();
  const store = new HubStore({get, refresh});
  await store.discover(['hub-a']);
  await store.discover(['hub-a']);
  expect(get).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
  expect(store.getSection('hub-a', 'skills')?.revision).toBe(1);
});

test('wheelmaker selector keeps the installed version while refreshing', () => {
  const state = hubState('hub-a', 'instance-a', {
    wheelmakerUpdate: {
      ...section(4, {
        ok: true,
        status: 'ready',
        hubId: 'hub-a',
        installed: {version: 'v1.2.3'},
        canRequestUpdate: true,
      }),
      updateStatus: 'updating',
    },
  });
  expect(selectWheelmakerUpdate(state)?.installed?.version).toBe('v1.2.3');
});
