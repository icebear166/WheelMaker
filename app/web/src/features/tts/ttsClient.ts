import { TTS_API_BASE, type TtsModelId, type TtsVoiceId } from './ttsSettings';

export type TtsRequestOptions = {
  apiKey: string;
  model: TtsModelId;
  voice: TtsVoiceId;
  text: string;
};

export type TtsResult =
  | { ok: true; audioBase64: string; format: string }
  | { ok: false; error: string };

/**
 * Call MiMo TTS API to synthesize speech from text.
 * Returns base64-encoded audio data.
 */
export async function synthesizeSpeech(options: TtsRequestOptions): Promise<TtsResult> {
  const { apiKey, model, voice, text } = options;
  if (!apiKey) {
    return { ok: false, error: 'TTS API key is not configured' };
  }
  if (!text.trim()) {
    return { ok: false, error: 'Text is empty' };
  }

  const url = `${TTS_API_BASE}/chat/completions`;
  const body = {
    model,
    messages: [
      { role: 'user' as const, content: '请朗读以下文本' },
      { role: 'assistant' as const, content: text },
    ],
    modalities: ['text', 'audio'],
    audio: { voice, format: 'wav' },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return { ok: false, error: `TTS API error ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    const audioData = data?.choices?.[0]?.message?.audio?.data;
    if (typeof audioData !== 'string' || !audioData) {
      return { ok: false, error: 'TTS API returned no audio data' };
    }

    return { ok: true, audioBase64: audioData, format: 'wav' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `TTS request failed: ${message}` };
  }
}

/**
 * Convert base64-encoded WAV to a blob URL suitable for HTMLAudioElement.
 */
export function audioBase64ToBlobUrl(base64: string): string {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}
