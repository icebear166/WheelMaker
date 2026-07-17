import fs from 'fs';
import path from 'path';

import {redactRegistryDebugEnvelope} from '../web/src/debug/registryDebug';
import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import {RegistryMethods} from '../web/src/registry/registryMethods';
import {
  DEFAULT_SERVER_SETTINGS,
  normalizeServerSettings,
  type ServerSettingsUpdate,
} from '../web/src/settings/serverSettings';

describe('server settings protocol', () => {
  test('normalizes non-secret snapshots without accepting malformed option values', () => {
    expect(normalizeServerSettings({
      voiceInput: {configured: 'yes', updatedAt: 123, model: 'other'},
      textToSpeech: {configured: true, updatedAt: '2026-07-14T01:02:03Z', model: 'mimo-v2-tts', voice: 'other'},
    })).toEqual({
      voiceInput: DEFAULT_SERVER_SETTINGS.voiceInput,
      textToSpeech: {
        configured: true,
        updatedAt: '2026-07-14T01:02:03Z',
        model: 'mimo-v2-tts',
        voice: DEFAULT_SERVER_SETTINGS.textToSpeech.voice,
      },
    });
  });

  test('uses the three exact methods and injects the selected client name', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({payload: DEFAULT_SERVER_SETTINGS})
      .mockResolvedValueOnce({payload: DEFAULT_SERVER_SETTINGS})
      .mockResolvedValueOnce({payload: {accessToken: 'speech-key', version: 'v1', model: 'doubao-streaming-asr-2.0'}});
    const connect = jest.fn().mockResolvedValue(undefined);
    const connectInit = jest.fn().mockResolvedValue(undefined);
    const repository = new RegistryRepository({connect, connectInit, request} as never);

    await repository.initialize('wss://example.test/ws', 'wheelmaker-android');
    await repository.getServerSettings();
    const update: ServerSettingsUpdate = {section: 'voiceInput', field: 'key', action: 'set', value: 'short'};
    await repository.updateServerSettings(update);
    await expect(repository.getAndroidSpeechCredential()).resolves.toEqual({
      accessToken: 'speech-key', version: 'v1', model: 'doubao-streaming-asr-2.0',
    });

    expect(connectInit).toHaveBeenCalledWith(expect.objectContaining({clientName: 'wheelmaker-android'}));
    expect(request.mock.calls.map(call => call[0].method)).toEqual([
      RegistryMethods.ServerConfigGet,
      RegistryMethods.ServerConfigUpdate,
      RegistryMethods.ServerAndroidSpeechCredentialGet,
    ]);
    expect(RegistryMethods.ServerConfigGet).toBe('server.config.get');
    expect(RegistryMethods.ServerConfigUpdate).toBe('server.config.update');
    expect(RegistryMethods.ServerAndroidSpeechCredentialGet).toBe('server.androidSpeechCredential.get');
  });

  test('chooses Android, Desktop, and Web names without user-agent inference', () => {
    const source = fs
      .readFileSync(path.join(__dirname, '..', 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8')
      .replace(/\r\n/g, '\n');
    const start = source.indexOf('const registryClientName');
    const end = source.indexOf('const workspaceStore', start);
    const selection = source.slice(start, end);
    expect(selection).toContain("isAndroidNativeSpeechHost()\n  ? 'wheelmaker-android'");
    expect(selection).toContain("getDesktopWindowBridge()\n    ? 'wheelmaker-desktop'");
    expect(selection).toContain(": 'wheelmaker-web'");
    expect(selection).not.toMatch(/userAgent|navigator\.platform/i);
  });

  test('redacts Android credential from both envelope and serialized debug JSON', () => {
    const redacted = redactRegistryDebugEnvelope({
      type: 'response' as const,
      method: 'server.androidSpeechCredential.get',
      payload: {accessToken: 'must-not-log', version: 'v1', model: 'doubao-streaming-asr-2.0'},
    });
    expect(redacted).toEqual(expect.objectContaining({
      payload: {accessToken: '[redacted]', version: 'v1', model: 'doubao-streaming-asr-2.0'},
    }));
    expect(JSON.stringify(redacted)).toContain('[redacted]');
    expect(JSON.stringify(redacted)).not.toContain('must-not-log');
  });
});

