import fs from 'fs';
import path from 'path';

describe('server settings', () => {
  const root = path.resolve(__dirname, '..');

  test('renders voice and speech settings inside Chat in the approved row order', () => {
    const settings = fs.readFileSync(path.join(root, 'web/src/settings/SettingsRootContent.tsx'), 'utf8');
    const chat = settings.indexOf('<SettingsSection id="chat"');
    const code = settings.indexOf('<SettingsSection id="code"');
    const chatBlock = settings.slice(chat, code);

    expect(chat).toBeGreaterThanOrEqual(0);
    expect(code).toBeGreaterThan(chat);
    const voiceGroupStart = chatBlock.indexOf('settings-subsection-title">Voice Input');
    const speechGroupStart = chatBlock.indexOf('settings-subsection-title">Speech');
    expect(voiceGroupStart).toBeGreaterThanOrEqual(0);
    expect(speechGroupStart).toBeGreaterThan(voiceGroupStart);
    const voiceGroup = chatBlock.slice(voiceGroupStart, speechGroupStart);
    const speechGroup = chatBlock.slice(speechGroupStart);
    expect(voiceGroup.indexOf('label="Key"')).toBeLessThan(voiceGroup.indexOf('label="Model"'));
    expect(speechGroup.indexOf('label="Key"')).toBeLessThan(speechGroup.indexOf('label="Model"'));
    expect(speechGroup.indexOf('label="Model"')).toBeLessThan(speechGroup.indexOf('label="Voice"'));
    expect(voiceGroup).toMatch(/label="Key"[\s\S]*configured=\{serverSettings\.voiceInput\.configured\}/);
    expect(speechGroup).toMatch(/label="Key"[\s\S]*configured=\{serverSettings\.textToSpeech\.configured\}/);
    expect(chatBlock).not.toContain('DeepSeek');
  });

  test('renders set-only password editors and never binds a server secret value', () => {
    const editor = fs.readFileSync(path.join(root, 'web/src/common/SecretEditor.tsx'), 'utf8');
    const settings = fs.readFileSync(path.join(root, 'web/src/settings/SettingsRootContent.tsx'), 'utf8');

    expect(settings).toContain('SecretEditor');
    expect(editor).toContain('Configured');
    expect(editor).toContain('Not configured');
    expect(editor).toContain('type="password"');
    expect(editor).toContain("useState('')");
    expect(editor).not.toMatch(/(?:apiKey|accessToken|secret)\.value/);
    expect(editor).not.toContain('BackendSecretEditor');
    expect(editor).not.toContain('retryBackendSecretMigration');
  });
});
