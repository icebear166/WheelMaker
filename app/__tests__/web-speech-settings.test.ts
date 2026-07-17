import fs from 'fs';
import path from 'path';
import {
  DEFAULT_SERVER_SETTINGS,
  SPEECH_MODEL_OPTIONS,
  normalizeServerSettings,
} from '../web/src/settings/serverSettings';

describe('web server speech settings', () => {
  test('defaults voice input unconfigured and targets Doubao streaming ASR 2.0 postpaid', () => {
    expect(DEFAULT_SERVER_SETTINGS.voiceInput).toEqual({
      configured: false,
      model: 'doubao-streaming-asr-2.0',
    });
    expect(SPEECH_MODEL_OPTIONS).toEqual([{
      id: 'doubao-streaming-asr-2.0',
      label: 'Doubao Streaming ASR 2.0',
      resourceId: 'volc.seedasr.sauc.duration',
    }]);
  });

  test('normalizes only the non-secret server snapshot and derives feature availability from configured', () => {
    const settings = normalizeServerSettings({
      voiceInput: {configured: true, model: 'bad-model', accessToken: 'must-be-dropped'},
      textToSpeech: {configured: false, apiKey: 'must-be-dropped'},
    });

    expect(settings).toEqual({
      voiceInput: {configured: true, model: 'doubao-streaming-asr-2.0'},
      textToSpeech: {configured: false, model: 'mimo-v2.5-tts', voice: 'Mia'},
    });
    expect(settings.voiceInput.configured).toBe(true);
    expect(settings.textToSpeech.configured).toBe(false);
  });

  test('keeps server settings out of browser persistence', () => {
    const persistence = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
      'utf8',
    );

    expect(persistence).not.toContain("from '../features/speech/speechSettings'");
    expect(persistence).not.toContain("from '../features/tts/ttsSettings'");
    expect(persistence).not.toMatch(/speechSettings:\s*SpeechSettings/);
    expect(persistence).not.toMatch(/ttsSettings:\s*TtsSettings/);
    expect(persistence).not.toContain("speechSettings: 'speechSettings'");
    expect(persistence).not.toContain("ttsSettings: 'ttsSettings'");
  });
});
