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
 * Global TTS player singleton with generation-based invalidation and prefetch.
 * Only one playback session is active at a time.
 *
 * State machine:
 *   idle ──play()──> loading ──audio ready──> playing ──ended──> idle
 *     ↑                 │                      │
 *     └──stop()─────────┴──stop()──────────────┘
 *
 * Prefetch: while playing segment N, start fetching segment N+1.
 *
 * Stop safety: cleanup() resolves any pending playAudio() promise
 * so the loop can exit immediately and check the generation counter.
 */
class TTSPlayer {
  private audio: HTMLAudioElement | null = null;
  private blobUrls: string[] = [];
  private generation = 0;
  private state: TtsPlaybackState = 'idle';
  private listeners: Set<TtsPlaybackListener> = new Set();

  /** Pre-fetched audio URLs indexed by segment index */
  private prefetched: Map<number, string> = new Map();
  /** Pending fetch promises indexed by segment index */
  private pendingFetches: Map<number, Promise<string | null>> = new Map();

  /** Resolve callback for the current playAudio() promise, if waiting */
  private playAudioResolve: (() => void) | null = null;

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
    this.prefetched.clear();
    this.pendingFetches.clear();

    if (this.audio) {
      this.audio.onended = null;
      this.audio.onplaying = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }

    // Unblock any pending playAudio() so the loop can exit
    if (this.playAudioResolve) {
      const resolve = this.playAudioResolve;
      this.playAudioResolve = null;
      resolve();
    }
  }

  /**
   * Stop any current playback and invalidate pending async operations.
   */
  stop(): void {
    this.generation++;
    this.cleanup();
    this.setState('idle');
  }

  /**
   * Start pre-fetching a segment. Returns the blob URL or null if invalidated.
   * Deduplicates: if already fetching, returns the existing promise.
   */
  private prefetchSegment(
    index: number,
    segments: string[],
    settings: TtsSettings,
    gen: number,
  ): Promise<string | null> {
    // Already have it
    const cached = this.prefetched.get(index);
    if (cached) return Promise.resolve(cached);

    // Already fetching
    const pending = this.pendingFetches.get(index);
    if (pending) return pending;

    // Out of range
    if (index >= segments.length) return Promise.resolve(null);

    const fetchPromise = (async (): Promise<string | null> => {
      if (this.generation !== gen) return null;

      const result = await synthesizeSpeech({
        apiKey: settings.apiKey,
        model: settings.model,
        voice: settings.voice,
        text: segments[index],
      });

      if (this.generation !== gen) return null;
      if (!result.ok) {
        console.warn(`TTS segment ${index} failed: ${result.error}`);
        return null;
      }

      const blobUrl = audioBase64ToBlobUrl(result.audioBase64);
      this.blobUrls.push(blobUrl);
      this.prefetched.set(index, blobUrl);
      this.pendingFetches.delete(index);
      return blobUrl;
    })();

    this.pendingFetches.set(index, fetchPromise);
    return fetchPromise;
  }

  /**
   * Play text segments sequentially with prefetch.
   * Automatically stops any previous playback.
   */
  async play(segments: string[], settings: TtsSettings): Promise<void> {
    // Stop existing and get a new generation
    this.stop();
    const gen = this.generation;

    if (segments.length === 0 || !settings.enabled || !settings.apiKey) {
      return;
    }

    this.setState('loading');

    // Start fetching the first segment
    const firstUrl = await this.prefetchSegment(0, segments, settings, gen);
    if (this.generation !== gen) return;

    if (!firstUrl) {
      // First segment failed, try remaining
      for (let i = 1; i < segments.length; i++) {
        const url = await this.prefetchSegment(i, segments, settings, gen);
        if (this.generation !== gen) return;
        if (url) {
          await this.playFromSegment(i, segments, settings, gen, url);
          return;
        }
      }
      // All segments failed
      if (this.generation === gen) {
        this.cleanup();
        this.setState('idle');
      }
      return;
    }

    // Start playback from segment 0
    await this.playFromSegment(0, segments, settings, gen, firstUrl);
  }

  /**
   * Play starting from a given segment, with prefetch for the next segment.
   */
  private async playFromSegment(
    startIndex: number,
    segments: string[],
    settings: TtsSettings,
    gen: number,
    startUrl: string,
  ): Promise<void> {
    let currentIndex = startIndex;
    let currentUrl: string | null = startUrl;

    while (currentIndex < segments.length && this.generation === gen) {
      if (!currentUrl) {
        // Current segment failed, try next
        currentIndex++;
        if (currentIndex < segments.length) {
          currentUrl = await this.prefetchSegment(currentIndex, segments, settings, gen);
        }
        continue;
      }

      // Kick off prefetch for the next segment while current plays
      const nextIndex = currentIndex + 1;
      if (nextIndex < segments.length) {
        // Fire and forget - don't await
        this.prefetchSegment(nextIndex, segments, settings, gen).catch(() => {});
      }

      // Play current segment
      await this.playAudio(currentUrl, gen);
      if (this.generation !== gen) return;

      // Advance to next segment
      currentIndex++;
      currentUrl = currentIndex < segments.length
        ? (this.prefetched.get(currentIndex) ?? await this.prefetchSegment(currentIndex, segments, settings, gen))
        : null;
    }

    // All segments played
    if (this.generation === gen) {
      this.cleanup();
      this.setState('idle');
    }
  }

  private playAudio(url: string, gen: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.generation !== gen) {
        resolve();
        return;
      }

      // Store resolve so cleanup() can unblock us on stop()
      this.playAudioResolve = resolve;

      const audio = new Audio(url);
      this.audio = audio;

      const done = () => {
        this.playAudioResolve = null;
        this.audio = null;
        resolve();
      };

      audio.onplaying = () => {
        if (this.generation === gen) {
          this.setState('playing');
        }
      };

      audio.onended = done;
      audio.onerror = done;

      audio.play().catch(done);
    });
  }
}

/** Global singleton player */
export const ttsPlayer = new TTSPlayer();
