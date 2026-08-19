import {
  chatConfigCurrentLabel,
  formatChatContextUsage,
  splitChatComposerStatusOptions,
} from '../web/src/chat/session/chatComposerStatus';
import type {RegistrySessionConfigOption} from '../web/src/registry/registryTypes';

function option(partial: RegistrySessionConfigOption): RegistrySessionConfigOption {
  return partial;
}

describe('chat composer status helpers', () => {
  test('formats context usage with rounded-up percent and compact token counts', () => {
    expect(
      formatChatContextUsage({used: 19000, size: 258000, updatedAt: '2026-07-07T08:00:00Z'}),
    ).toEqual({
      available: true,
      percent: 8,
      percentText: '8%',
      usedText: '19k',
      sizeText: '258k',
      summaryText: '19K/258K 8%',
      title: 'Context window: 8% used (19k / 258k tokens)',
    });
  });

  test('omits context usage before the agent reports tokens', () => {
    expect(formatChatContextUsage(null)).toBeNull();
  });

  test.each([
    {
      name: 'uses an option label',
      option: option({
        id: 'reasoning_effort',
        name: 'Reasoning',
        currentValue: 'high',
        options: [
          {value: 'low', name: 'Low'},
          {value: 'medium', name: 'Medium'},
          {value: 'high', name: 'High'},
        ],
      }),
      expected: 'High',
    },
    {
      name: 'capitalizes a raw value',
      option: option({id: 'reasoning_effort', name: 'Reasoning', currentValue: 'max'}),
      expected: 'Max',
    },
    {
      name: 'normalizes a stale lowercase label',
      option: option({
        id: 'reasoning_effort',
        name: 'Reasoning',
        currentValue: 'high',
        options: [{value: 'high', name: 'high'}],
      }),
      expected: 'High',
    },
  ])('$name', ({option: configOption, expected}) => {
    expect(chatConfigCurrentLabel(configOption)).toBe(expected);
  });

  test('keeps core options visible and moves secondary options to overflow when compact', () => {
    const options: RegistrySessionConfigOption[] = [
      option({
        id: 'model',
        name: 'Model',
        currentValue: 'gpt-5.5',
        options: [{value: 'gpt-5.5', name: 'GPT 5.5'}],
      }),
      option({
        id: 'reasoning_effort',
        name: 'Reasoning',
        currentValue: 'high',
        options: [{value: 'high', name: 'High'}],
      }),
      option({id: 'approval_preset', name: 'Access', currentValue: 'full'}),
      option({id: 'fast_mode', category: 'speed', name: 'Fast', currentValue: 'on'}),
      option({id: 'personality', name: 'Personality', currentValue: 'pragmatic'}),
    ];

    const compact = splitChatComposerStatusOptions(options, true);
    expect(compact.coreOptions.map(item => item.kind)).toEqual(['model', 'effort', 'fast']);
    expect(compact.secondaryOptions).toEqual([]);
    expect(compact.overflowOptions.map(item => item.id)).toEqual([
      'personality',
      'approval_preset',
    ]);
    expect(compact.showOverflowToggle).toBe(true);

    const wide = splitChatComposerStatusOptions(options, false);
    expect(wide.coreOptions.map(item => item.kind)).toEqual(['model', 'effort', 'fast']);
    expect(wide.secondaryOptions.map(item => item.id)).toEqual([
      'personality',
      'approval_preset',
    ]);
    expect(wide.overflowOptions).toEqual([]);
    expect(wide.showOverflowToggle).toBe(false);
  });

  test('degrades the core selector to the available config columns', () => {
    const model = option({id: 'model', name: 'Model', currentValue: 'gpt-5.6'});
    const effort = option({id: 'reasoning_effort', name: 'Reasoning', currentValue: 'high'});
    const fast = option({id: 'fast_mode', name: 'Fast', currentValue: 'off'});

    expect(splitChatComposerStatusOptions([model, effort], false).coreOptions.map(item => item.kind)).toEqual([
      'model',
      'effort',
    ]);
    expect(splitChatComposerStatusOptions([model], false).coreOptions.map(item => item.kind)).toEqual(['model']);
    expect(splitChatComposerStatusOptions([effort], false).coreOptions.map(item => item.kind)).toEqual(['effort']);
    expect(splitChatComposerStatusOptions([fast], false).coreOptions.map(item => item.kind)).toEqual(['fast']);
    expect(splitChatComposerStatusOptions([], false).coreOptions).toEqual([]);
  });
});
