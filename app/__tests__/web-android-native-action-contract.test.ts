import fs from 'fs';
import path from 'path';

function quotedActions(source: string): string[] {
  return Array.from(source.matchAll(/"([a-zA-Z]+(?:\.[a-zA-Z]+)+)"/g), match => match[1]);
}

describe('Android native action contract', () => {
  test('keeps Web requests, Android policy, and Android dispatch aligned', () => {
    const root = path.join(__dirname, '..', '..');
    const webBridge = fs.readFileSync(
      path.join(root, 'app', 'web', 'src', 'platform', 'android', 'androidNativeMessageBridge.ts'),
      'utf8',
    );
    const deviceName = fs.readFileSync(
      path.join(root, 'app', 'web', 'src', 'registry', 'deviceName.ts'),
      'utf8',
    );
    const policy = fs.readFileSync(
      path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'java', 'com', 'wheelmaker', 'android', 'TrustedWebMessagePolicy.kt'),
      'utf8',
    );
    const dispatcher = fs.readFileSync(
      path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'java', 'com', 'wheelmaker', 'android', 'WheelMakerBridge.kt'),
      'utf8',
    );

    const policyBlock = policy.match(/val BUSINESS_ACTIONS = setOf\(([\s\S]*?)\n\s*\)/)?.[1] ?? '';
    const webActions = new Set([
      ...Array.from(webBridge.matchAll(/request\('([^']+)'/g), match => match[1]),
      ...Array.from(deviceName.matchAll(/\.request\('([^']+)'/g), match => match[1]),
    ]);
    const policyActions = new Set(quotedActions(policyBlock));
    const dispatchActions = new Set(
      Array.from(dispatcher.matchAll(/"([^"]+)"\s*->/g), match => match[1]),
    );

    expect([...webActions].sort()).toEqual([...policyActions].sort());
    expect([...dispatchActions].sort()).toEqual([...policyActions].sort());
  });
});
