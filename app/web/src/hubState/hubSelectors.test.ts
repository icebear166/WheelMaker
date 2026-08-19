import type {HubStoreSnapshot} from './hubStore';
import {selectComposerDiagnostic, selectComposerSkills} from './hubSelectors';

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

  test('uses provider discovery instead of managed inventory for composer skills', () => {
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
                    managedOnly: {name: 'managed-only', agents: ['codex']},
                  },
                },
                effectiveSkills: {
                  'hub-a:project': {
                    codex: [{name: 'managed-only', description: 'management view'}],
                  },
                },
                discoveredSkills: {
                  'hub-a:project': {
                    kimi: [{name: 'kimi-skill', description: 'runtime view'}],
                  },
                },
              },
            },
          },
        },
      },
    } as unknown as HubStoreSnapshot;

    expect(selectComposerSkills(snapshot, 'hub-a:project', 'kimi')).toEqual([
      {name: 'kimi-skill', description: 'runtime view'},
    ]);
  });
});
