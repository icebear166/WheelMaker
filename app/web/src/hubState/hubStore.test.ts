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

test('coalesces concurrent discovery without refreshing the Hub', async () => {
  const get = jest.fn(async () => hubState('hub-a', 'instance-a', {
    skills: section(1, {name: 'scope'}),
  }));
  const refresh = jest.fn();
  const store = new HubStore({get, refresh});
  await Promise.all([store.discover(['hub-a']), store.discover(['hub-a'])]);
  expect(get).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
  expect(store.getSection('hub-a', 'skills')?.revision).toBe(1);
});

test('isolates discovery failures and still loads the other Hubs', async () => {
  const get = jest.fn(async (hubId: string) => {
    if (hubId === 'hub-a') throw new Error('offline');
    return hubState(hubId, 'instance-b', {skills: section(1, {name: 'scope'})});
  });
  const store = new HubStore({get});

  await expect(store.discover(['hub-a', 'hub-b'])).resolves.toBeUndefined();

  expect(store.getHub('hub-a')).toBeUndefined();
  expect(store.getSection('hub-b', 'skills')?.revision).toBe(1);
});

test('rediscovers the same Hub ID after reconnect and replaces a changed instance', async () => {
  let instanceId = 'instance-a';
  const store = new HubStore({
    get: async hubId => hubState(hubId, instanceId, {
      wheelmakerUpdate: section(1, {installed: {version: instanceId === 'instance-a' ? 'v1' : 'v2'}}),
    }),
  });
  await store.discover(['hub-a']);
  instanceId = 'instance-b';

  await store.discover(['hub-a']);

  expect(store.getHub('hub-a')?.instanceId).toBe('instance-b');
  expect(store.getSection<{installed: {version: string}}>('hub-a', 'wheelmakerUpdate')?.data?.installed.version)
    .toBe('v2');
});

test('removes Hubs that are absent from the latest connection snapshot', async () => {
  const store = new HubStore({
    get: async hubId => hubState(hubId, `instance-${hubId}`, {}),
  });
  await store.discover(['hub-a', 'hub-b']);

  await store.discover(['hub-b']);

  expect(store.getHub('hub-a')).toBeUndefined();
  expect(store.getHub('hub-b')).toBeDefined();
});

test('does not restore a removed Hub when an older discovery finishes late', async () => {
  let resolveDiscovery: ((state: RegistryHubState) => void) | undefined;
  const store = new HubStore({
    get: () => new Promise(resolve => {
      resolveDiscovery = resolve;
    }),
  });

  const staleDiscovery = store.discover(['hub-a']);
  await store.discover([]);
  resolveDiscovery?.(hubState('hub-a', 'instance-old', {}));
  await staleDiscovery;

  expect(store.getHub('hub-a')).toBeUndefined();
});

test('starts a new discovery when the same Hub ID is removed and re-added', async () => {
  const resolvers: Array<(state: RegistryHubState) => void> = [];
  const get = jest.fn(() => new Promise<RegistryHubState>(resolve => {
    resolvers.push(resolve);
  }));
  const store = new HubStore({get});

  const staleDiscovery = store.discover(['hub-a']);
  await store.discover([]);
  const currentDiscovery = store.discover(['hub-a']);
  expect(get).toHaveBeenCalledTimes(2);

  resolvers[1](hubState('hub-a', 'instance-new', {}));
  await currentDiscovery;
  resolvers[0](hubState('hub-a', 'instance-old', {}));
  await staleDiscovery;

  expect(store.getHub('hub-a')?.instanceId).toBe('instance-new');
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

test('does not share nested section data with callers', () => {
  const data = {skills: [{name: 'scope'}]};
  const store = new HubStore();
  store.replace(hubState('hub-a', 'instance-a', {skills: section(1, data)}));
  data.skills[0].name = 'mutated-original';

  const first = store.getSection<typeof data>('hub-a', 'skills')!;
  expect(first.data?.skills[0].name).toBe('scope');
  first.data!.skills[0].name = 'mutated-snapshot';

  expect(store.getSection<typeof data>('hub-a', 'skills')?.data?.skills[0].name).toBe('scope');
});
