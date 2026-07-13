import fs from 'fs';
import path from 'path';

import {migrateLegacyBackendSecrets} from '../web/src/settings/backendSecretSettings';
import {extractLegacyBackendSecrets} from '../web/src/workspace/WorkspacePersistence';

describe('backend secret settings', () => {
  test('extracts only the three explicitly supported legacy fields', () => {
    const legacy = extractLegacyBackendSecrets([
      {k: 'deepseekApiKey', v: JSON.stringify('old-deepseek'), updatedAt: 1},
      {k: 'speechSettings', v: JSON.stringify({enabled: true, volcengineApiKey: 'old-asr', unrelated: 'ignore'}), updatedAt: 1},
      {k: 'ttsSettings', v: JSON.stringify({enabled: true, model: 'mimo-v2.5-tts', apiKey: 'old-tts'}), updatedAt: 1},
      {k: 'unknownSecret', v: JSON.stringify('must-not-upload'), updatedAt: 1},
    ]);

    expect(legacy).toEqual({deepseek: 'old-deepseek', volcengineAsr: 'old-asr', mimoTts: 'old-tts'});
  });

  test('migrates only known unconfigured secrets and clears every resolved legacy value', async () => {
    const updateSecret = jest.fn().mockResolvedValue(undefined);
    const clearLegacySecret = jest.fn().mockResolvedValue(undefined);

    const result = await migrateLegacyBackendSecrets({
      legacy: {
        deepseek: 'old-deepseek',
        volcengineAsr: 'old-asr',
        mimoTts: 'old-tts',
      },
      statuses: [
        {kind: 'deepseek', configured: true, updatedAt: '2026-07-13T00:00:00Z'},
        {kind: 'volcengineAsr', configured: false},
        {kind: 'mimoTts', configured: false},
      ],
      updateSecret,
      clearLegacySecret,
    });

    expect(updateSecret).toHaveBeenCalledTimes(2);
    expect(updateSecret).toHaveBeenCalledWith({kind: 'volcengineAsr', action: 'set', value: 'old-asr'});
    expect(updateSecret).toHaveBeenCalledWith({kind: 'mimoTts', action: 'set', value: 'old-tts'});
    expect(clearLegacySecret.mock.calls.map(call => call[0])).toEqual([
      'deepseek',
      'volcengineAsr',
      'mimoTts',
    ]);
    expect(result.failures).toEqual([]);
  });

  test('retains a legacy value when its upload fails so retry remains possible', async () => {
    const clearLegacySecret = jest.fn().mockResolvedValue(undefined);
    const result = await migrateLegacyBackendSecrets({
      legacy: {deepseek: 'retry-secret'},
      statuses: [{kind: 'deepseek', configured: false}],
      updateSecret: jest.fn().mockRejectedValue(new Error('offline')),
      clearLegacySecret,
    });

    expect(clearLegacySecret).not.toHaveBeenCalled();
    expect(result.failures).toEqual([{kind: 'deepseek', message: 'offline'}]);
  });

  test('renders set-only editors without binding server values into inputs', () => {
    const root = path.resolve(__dirname, '..');
    const settings = fs.readFileSync(path.join(root, 'web/src/settings/SettingsRootContent.tsx'), 'utf8');

    expect(settings).toContain('Configured');
    expect(settings).toContain('Not configured');
    expect(settings).toContain('type="password"');
    expect(settings).not.toMatch(/value=\{[^}]*backendSecret[^}]*\.value/);
  });
});
