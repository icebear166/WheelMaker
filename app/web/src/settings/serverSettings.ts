export type SpeechModelId = 'doubao-streaming-asr-2.0';

export type TtsModelId =
  | 'mimo-v2-tts'
  | 'mimo-v2.5-tts'
  | 'mimo-v2.5-tts-voiceclone'
  | 'mimo-v2.5-tts-voicedesign';

export type TtsVoiceId =
  | 'mimo_default'
  | '冰糖'
  | '茉莉'
  | '苏打'
  | '白桦'
  | 'Mia'
  | 'Chloe'
  | 'Milo'
  | 'Dean';

export type ServerSettings = {
  voiceInput: {configured: boolean; updatedAt?: string; model: SpeechModelId};
  textToSpeech: {configured: boolean; updatedAt?: string; model: TtsModelId; voice: TtsVoiceId};
};

export type ServerSettingsUpdate = {
  section: 'voiceInput' | 'textToSpeech';
  field: 'key' | 'model' | 'voice';
  action: 'set' | 'clear';
  value?: string;
};

export const SPEECH_MODEL_OPTIONS: Array<{id: SpeechModelId; label: string; resourceId: string}> = [{
  id: 'doubao-streaming-asr-2.0',
  label: 'Doubao Streaming ASR 2.0',
  resourceId: 'volc.seedasr.sauc.duration',
}];

export const TTS_MODEL_OPTIONS: Array<{id: TtsModelId; label: string}> = [
  {id: 'mimo-v2-tts', label: 'MiMo v2 TTS'},
  {id: 'mimo-v2.5-tts', label: 'MiMo v2.5 TTS'},
  {id: 'mimo-v2.5-tts-voiceclone', label: 'MiMo v2.5 TTS Voice Clone'},
  {id: 'mimo-v2.5-tts-voicedesign', label: 'MiMo v2.5 TTS Voice Design'},
];

export const TTS_VOICE_OPTIONS: Array<{id: TtsVoiceId; label: string}> = [
  {id: 'mimo_default', label: 'Default'},
  {id: '冰糖', label: '冰糖'},
  {id: '茉莉', label: '茉莉'},
  {id: '苏打', label: '苏打'},
  {id: '白桦', label: '白桦'},
  {id: 'Mia', label: 'Mia'},
  {id: 'Chloe', label: 'Chloe'},
  {id: 'Milo', label: 'Milo'},
  {id: 'Dean', label: 'Dean'},
];

export const DEFAULT_SERVER_SETTINGS: ServerSettings = {
  voiceInput: {configured: false, model: 'doubao-streaming-asr-2.0'},
  textToSpeech: {configured: false, model: 'mimo-v2.5-tts', voice: 'Mia'},
};

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function updatedAtOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isTtsModelId(value: unknown): value is TtsModelId {
  return typeof value === 'string' && TTS_MODEL_OPTIONS.some(option => option.id === value);
}

function isTtsVoiceId(value: unknown): value is TtsVoiceId {
  return typeof value === 'string' && TTS_VOICE_OPTIONS.some(option => option.id === value);
}

export function normalizeServerSettings(value: unknown): ServerSettings {
  const root = recordOf(value);
  const voiceInput = recordOf(root.voiceInput);
  const textToSpeech = recordOf(root.textToSpeech);
  const voiceUpdatedAt = updatedAtOf(voiceInput.updatedAt);
  const ttsUpdatedAt = updatedAtOf(textToSpeech.updatedAt);
  return {
    voiceInput: {
      configured: voiceInput.configured === true,
      ...(voiceUpdatedAt ? {updatedAt: voiceUpdatedAt} : {}),
      model: voiceInput.model === 'doubao-streaming-asr-2.0'
        ? voiceInput.model
        : DEFAULT_SERVER_SETTINGS.voiceInput.model,
    },
    textToSpeech: {
      configured: textToSpeech.configured === true,
      ...(ttsUpdatedAt ? {updatedAt: ttsUpdatedAt} : {}),
      model: isTtsModelId(textToSpeech.model)
        ? textToSpeech.model
        : DEFAULT_SERVER_SETTINGS.textToSpeech.model,
      voice: isTtsVoiceId(textToSpeech.voice)
        ? textToSpeech.voice
        : DEFAULT_SERVER_SETTINGS.textToSpeech.voice,
    },
  };
}

