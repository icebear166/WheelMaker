import {agentTagVariantClass} from './agentTagVariant';

describe('cx.deepseek agent color', () => {
  it('uses the native Codex variant', () => {
    expect(agentTagVariantClass('cx-deepseek')).toBe('wide-session-agent-0');
    expect(agentTagVariantClass('cx-deepseek')).toBe(agentTagVariantClass('codex'));
  });
});
