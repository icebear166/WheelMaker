import {
  formatChatContextUsage,
  resolveChatReasoningSignal,
  splitChatComposerStatusOptions,
} from '../web/src/chat/session/chatComposerStatus';
import type { RegistrySessionConfigOption } from '../web/src/registry/registryTypes';

function option(
  partial: RegistrySessionConfigOption,
): RegistrySessionConfigOption {
  return partial;
}

describe('chat composer status helpers', () => {
  test('formats context usage with rounded-up percent and compact token counts', () => {
    expect(
      formatChatContextUsage({
        used: 19000,
        size: 258000,
        updatedAt: '2026-07-07T08:00:00Z',
      }),
    ).toEqual({
      percent: 8,
      percentText: '8%',
      usedText: '19k',
      sizeText: '258k',
      title: 'Context window: 8% used (19k / 258k tokens)',
    });
  });

  test('resolves reasoning effort into active signal bars from configured levels', () => {
    const signal = resolveChatReasoningSignal(
      option({
        id: 'reasoning_effort',
        name: 'Reasoning',
        currentValue: 'high',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'medium', name: 'Medium' },
          { value: 'high', name: 'High' },
        ],
      }),
    );

    expect(signal).toEqual({
      activeBars: 3,
      totalBars: 3,
      label: 'High',
      value: 'high',
    });
  });

  test('keeps usage model and reasoning visible while compacting secondary options', () => {
    const options: RegistrySessionConfigOption[] = [
      option({
        id: 'model',
        name: 'Model',
        currentValue: 'gpt-5.5',
        options: [{ value: 'gpt-5.5', name: 'GPT 5.5' }],
      }),
      option({
        id: 'reasoning_effort',
        name: 'Reasoning',
        currentValue: 'high',
        options: [{ value: 'high', name: 'High' }],
      }),
      option({ id: 'approval_preset', name: 'Access', currentValue: 'full' }),
      option({
        id: 'personality',
        name: 'Personality',
        currentValue: 'pragmatic',
      }),
    ];

    const compact = splitChatComposerStatusOptions(options, true);
    expect(compact.modelOption?.id).toBe('model');
    expect(compact.reasoningOption?.id).toBe('reasoning_effort');
    expect(compact.secondaryOptions).toEqual([]);
    expect(compact.overflowOptions.map(item => item.id)).toEqual([
      'approval_preset',
      'personality',
    ]);
    expect(compact.showOverflowToggle).toBe(true);

    const wide = splitChatComposerStatusOptions(options, false);
    expect(wide.modelOption?.id).toBe('model');
    expect(wide.reasoningOption?.id).toBe('reasoning_effort');
    expect(wide.secondaryOptions.map(item => item.id)).toEqual([
      'approval_preset',
      'personality',
    ]);
    expect(wide.overflowOptions).toEqual([]);
    expect(wide.showOverflowToggle).toBe(false);
  });
});
