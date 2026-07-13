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

export type TtsSettings = {
  enabled: boolean;
  model: TtsModelId;
  voice: TtsVoiceId;
};

export type TtsModelOption = {
  id: TtsModelId;
  label: string;
};

export type TtsVoiceOption = {
  id: TtsVoiceId;
  label: string;
};

export const TTS_MODEL_OPTIONS: TtsModelOption[] = [
  { id: 'mimo-v2-tts', label: 'MiMo v2 TTS' },
  { id: 'mimo-v2.5-tts', label: 'MiMo v2.5 TTS' },
  { id: 'mimo-v2.5-tts-voiceclone', label: 'MiMo v2.5 TTS Voice Clone' },
  { id: 'mimo-v2.5-tts-voicedesign', label: 'MiMo v2.5 TTS Voice Design' },
];

export const TTS_VOICE_OPTIONS: TtsVoiceOption[] = [
  { id: 'mimo_default', label: 'Default' },
  { id: '冰糖', label: '冰糖' },
  { id: '茉莉', label: '茉莉' },
  { id: '苏打', label: '苏打' },
  { id: '白桦', label: '白桦' },
  { id: 'Mia', label: 'Mia' },
  { id: 'Chloe', label: 'Chloe' },
  { id: 'Milo', label: 'Milo' },
  { id: 'Dean', label: 'Dean' },
];

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  enabled: false,
  model: 'mimo-v2.5-tts',
  voice: 'Mia',
};

function isTtsModelId(value: string): value is TtsModelId {
  return TTS_MODEL_OPTIONS.some(option => option.id === value);
}

function isTtsVoiceId(value: string): value is TtsVoiceId {
  return TTS_VOICE_OPTIONS.some(option => option.id === value);
}

export function normalizeTtsSettings(input: unknown): TtsSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return DEFAULT_TTS_SETTINGS;
  }
  const record = input as Partial<TtsSettings>;
  return {
    enabled: record.enabled === true,
    model: typeof record.model === 'string' && isTtsModelId(record.model)
      ? record.model
      : DEFAULT_TTS_SETTINGS.model,
    voice: typeof record.voice === 'string' && isTtsVoiceId(record.voice)
      ? record.voice
      : DEFAULT_TTS_SETTINGS.voice,
  };
}

export function maskTtsSettingsForExport(input: unknown): TtsSettings {
	return normalizeTtsSettings(input);
}
