import type {HubStoreSnapshot} from './hubStore';
import {selectComposerDiagnostic} from './hubSelectors';

describe('hub selectors', () => {
  test('does not report a missing-directory diagnostic from legacy sync statuses', () => {
    const snapshot = {
      hubs: {
        'hub-a': {
          hubId: 'hub-a',
          instanceId: 'instance-a',
          sections: {
            skills: {
              availability: 'available',
              updateStatus: 'idle',
              revision: 1,
              data: {
                projectLocalInventories: {
                  'hub-a:project': {
                    scope: {name: 'scope', sync: {status: 'agentsOnly'}},
                  },
                },
              },
            },
          },
        },
      },
    } as unknown as HubStoreSnapshot;

    expect(selectComposerDiagnostic(snapshot, 'hub-a:project')).toBe('');
  });
});
