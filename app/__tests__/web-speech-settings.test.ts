import fs from 'fs';
import path from 'path';
import {
  DEFAULT_SPEECH_SETTINGS,
  SPEECH_MODEL_OPTIONS,
  maskSpeechSettingsForExport,
  normalizeSpeechSettings,
} from '../web/src/features/speech/speechSettings';

describe('web speech settings', () => {
  test('defaults voice input off and targets Doubao streaming ASR 2.0 postpaid', () => {
    expect(DEFAULT_SPEECH_SETTINGS).toEqual({
      enabled: false,
      provider: 'volcengine',
      model: 'doubao-streaming-asr-2.0',
    });
    expect(SPEECH_MODEL_OPTIONS).toEqual([
      {
        id: 'doubao-streaming-asr-2.0',
        label: 'Doubao Streaming ASR 2.0',
        resourceId: 'volc.seedasr.sauc.duration',
      },
    ]);
  });

	test('normalizes non-secret speech settings and drops legacy keys', () => {
    expect(normalizeSpeechSettings({
      enabled: true,
      provider: 'bad',
      model: 'bad-model',
		volcengineApiKey: 'legacy-key-is-dropped',
    })).toEqual({
      enabled: true,
      provider: 'volcengine',
      model: 'doubao-streaming-asr-2.0',
    });

    expect(maskSpeechSettingsForExport({
      enabled: true,
      provider: 'volcengine',
      model: 'doubao-streaming-asr-2.0',
		volcengineApiKey: 'legacy-key-is-dropped',
    })).toEqual({
      enabled: true,
      provider: 'volcengine',
      model: 'doubao-streaming-asr-2.0',
    });
  });

	test('persists only non-secret speech settings', () => {
    const projectRoot = path.join(__dirname, '..');
    const persistence = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
      'utf8',
    );

    expect(persistence).toContain("from '../features/speech/speechSettings';");
    expect(persistence).toContain('DEFAULT_SPEECH_SETTINGS');
    expect(persistence).toContain('maskSpeechSettingsForExport');
    expect(persistence).toContain('normalizeSpeechSettings');
    expect(persistence).toContain('speechSettings: SpeechSettings;');
    expect(persistence).toContain("speechSettings: 'speechSettings',");
    expect(persistence).toContain('speechSettings: DEFAULT_SPEECH_SETTINGS,');
    expect(persistence).toContain('speechSettings: normalizeSpeechSettings(input.speechSettings),');
    expect(persistence).toContain('const rows = globalRowsForPatch(patch, next, now);');
    expect(persistence).toContain(
      '{k: GLOBAL_KEYS.speechSettings, v: serialize(this.state.global.speechSettings), updatedAt}',
    );
    expect(persistence).toContain('maskSpeechSettingsForExport');
    expect(persistence).toContain('redactGlobalDumpRows');
  });
});
