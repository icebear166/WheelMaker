import {agentTagVariantClass} from './agentTagVariant';

describe('cx.deepseek agent color', () => {
  it('uses the native Codex variant', () => {
    expect(agentTagVariantClass('cx-deepseek')).toBe('wide-session-agent-0');
    expect(agentTagVariantClass('cx-deepseek')).toBe(agentTagVariantClass('codex'));
  });
});

describe('qoder agent color', () => {
  it('uses the mapped yellow variant', () => {
    expect(agentTagVariantClass('qoder')).toBe('wide-session-agent-7');
  });
});
