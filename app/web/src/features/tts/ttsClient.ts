import type {
  RegistryTTSSynthesizePayload,
  RegistryTTSSynthesizeResponse,
} from '../../registry/registryTypes';
import type {TtsModelId, TtsVoiceId} from '../../settings/serverSettings';

export type TtsRequestOptions = {
  model: TtsModelId;
  voice: TtsVoiceId;
  text: string;
};

export type TtsBackend = {
  synthesizeTTS: (payload: RegistryTTSSynthesizePayload) => Promise<RegistryTTSSynthesizeResponse>;
};

export type TtsResult =
  | {ok: true; audioBase64: string; format: string}
  | {ok: false; error: string};

export async function synthesizeSpeech(backend: TtsBackend, options: TtsRequestOptions): Promise<TtsResult> {
  if (!options.text.trim()) return {ok: false, error: 'Text is empty'};
  try {
    const result = await backend.synthesizeTTS(options);
    return {ok: true, audioBase64: result.audioBase64, format: result.format};
  } catch (err) {
    return {ok: false, error: err instanceof Error ? err.message : String(err)};
  }
}

export function audioBase64ToBlobUrl(base64: string): string {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  const blob = new Blob([bytes], {type: 'audio/wav'});
  return URL.createObjectURL(blob);
}
