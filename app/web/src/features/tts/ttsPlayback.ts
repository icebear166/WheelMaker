import { synthesizeSpeech, audioBase64ToBlobUrl } from './ttsClient';
import type { TtsSettings } from './ttsSettings';

export type TtsPlaybackState = 'idle' | 'loading' | 'playing';

export type TtsPlaybackListener = (state: TtsPlaybackState) => void;

const MAX_SEGMENT_CHARS = 300;

/**
 * Split cleaned text into segments by paragraphs.
 * Accumulates paragraphs until adding the next one would exceed maxChars.
 */
export function segmentText(text: string, maxChars: number = MAX_SEGMENT_CHARS): string[] {
  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) {
    return [];
  }

  const segments: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (current.length > 0 && current.length + paragraph.length + 2 > maxChars) {
      segments.push(current);
      current = paragraph;
    } else {
      current = current.length > 0 ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

/**
 * Global TTS player singleton.
 * Only one playback is allowed at a time.
 */
class TTSPlayer {
  private audio: HTMLAudioElement | null = null;
  private blobUrls: string[] = [];
  private aborted = false;
  private state: TtsPlaybackState = 'idle';
  private listeners: Set<TtsPlaybackListener> = new Set();

  get currentState(): TtsPlaybackState {
    return this.state;
  }

  subscribe(listener: TtsPlaybackListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(next: TtsPlaybackState): void {
    if (this.state === next) return;
    this.state = next;
    for (const listener of this.listeners) {
      try { listener(next); } catch { /* ignore */ }
    }
  }

  private cleanup(): void {
    for (const url of this.blobUrls) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls = [];
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }
  }

  /**
   * Stop any current playback.
   */
  stop(): void {
    this.aborted = true;
    this.cleanup();
    this.setState('idle');
  }

  /**
   * Play text segments sequentially.
   * Each segment is synthesized via TTS API, then played via HTMLAudioElement.
   * Automatically stops any previous playback.
   */
  async play(segments: string[], settings: TtsSettings): Promise<void> {
    // Stop any existing playback
    this.stop();
    this.aborted = false;

    if (segments.length === 0 || !settings.enabled || !settings.apiKey) {
      return;
    }

    this.setState('loading');

    for (let i = 0; i < segments.length; i++) {
      if (this.aborted) return;

      const result = await synthesizeSpeech({
        apiKey: settings.apiKey,
        model: settings.model,
        voice: settings.voice,
        text: segments[i],
      });

      if (this.aborted) return;

      if (!result.ok) {
        // Skip failed segment, continue with next
        console.warn(`TTS segment ${i} failed: ${result.error}`);
        continue;
      }

      const blobUrl = audioBase64ToBlobUrl(result.audioBase64);
      this.blobUrls.push(blobUrl);

      if (this.aborted) {
        URL.revokeObjectURL(blobUrl);
        return;
      }

      await this.playAudio(blobUrl);

      if (this.aborted) return;
    }

    this.cleanup();
    this.setState('idle');
  }

  private playAudio(url: string): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.aborted) {
        resolve();
        return;
      }

      const audio = new Audio(url);
      this.audio = audio;

      audio.onplaying = () => {
        this.setState('playing');
      };

      audio.onended = () => {
        this.audio = null;
        resolve();
      };

      audio.onerror = () => {
        this.audio = null;
        resolve();
      };

      audio.play().catch(() => {
        this.audio = null;
        resolve();
      });
    });
  }
}

/** Global singleton player */
export const ttsPlayer = new TTSPlayer();
