import {hasMessageLifecycleFeature} from './chatSessionState';

describe('hasMessageLifecycleFeature', () => {
  it('enables negotiated third-party sessions', () => {
    expect(hasMessageLifecycleFeature({
      agentType: 'third-party',
      sessionFeatures: {messageLifecycle: {version: 1}},
    })).toBe(true);
  });

  it('does not use provider fallback for current sessions', () => {
    expect(hasMessageLifecycleFeature({agentType: 'codex'})).toBe(false);
    expect(hasMessageLifecycleFeature({agentType: 'cx-deepseek'})).toBe(false);
  });

  it('keeps provider fallback only for explicitly historical sessions', () => {
    expect(hasMessageLifecycleFeature({agentType: 'codex'}, true)).toBe(true);
    expect(hasMessageLifecycleFeature({agentType: 'third-party'}, true)).toBe(false);
  });
});
