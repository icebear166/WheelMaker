import fs from 'fs';
import path from 'path';

import {
  createRegistrySpeechClient,
  isSpeechErrorEvent,
  isSpeechTranscriptEvent,
} from '../web/src/features/speech/registrySpeechClient';
import type {RegistryEnvelope} from '../web/src/registry/registryTypes';

describe('web speech settings', () => {
  test('speech settings and start DTO do not persist a Volcengine key', () => {
    const root = path.resolve(__dirname, '..');
    const settings = fs.readFileSync(path.join(root, 'web/src/settings/serverSettings.ts'), 'utf8');
    const types = fs.readFileSync(path.join(root, 'web/src/registry/registryTypes.ts'), 'utf8');
    expect(settings).not.toContain('volcengineApiKey');
    expect(types).not.toMatch(/RegistrySpeechStartPayload[\s\S]{0,300}apiKey/);
  });
});

describe('registry speech client', () => {
  test('sends speech requests and routes speech events', async () => {
    const events = new Set<(event: RegistryEnvelope) => void>();
    const requests: Array<{method: string; payload: unknown; timeoutMs?: number}> = [];
    const client = createRegistrySpeechClient({
      request: async args => {
        requests.push(args);
        if (args.method === 'speech.start') {
          return {
            type: 'response',
            method: 'speech.start',
            payload: {streamId: 'speech-1'},
          };
        }
        return {
          type: 'response',
          method: args.method,
          payload: {ok: true, streamId: 'speech-1'},
        };
      },
      onEvent: listener => {
        events.add(listener);
        return () => events.delete(listener);
      },
      onClose: () => () => undefined,
    });

    const transcripts: string[] = [];
    const unsubscribe = client.onTranscript(event => {
      transcripts.push(event.text);
    });

    const start = await client.start({
      provider: 'volcengine',
      audio: {format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1},
    });
    await client.chunk({streamId: start.streamId, seq: 1, pcm: 'AQID'});
    await client.finish({streamId: start.streamId});
    await client.cancel({streamId: start.streamId, reason: 'user'});

    expect(requests.map(item => item.method)).toEqual([
      'speech.start',
      'speech.chunk',
      'speech.finish',
      'speech.cancel',
    ]);

    for (const listener of events) {
      listener({
        type: 'event',
        method: 'speech.transcript',
        payload: {streamId: 'speech-1', text: 'hello', final: false},
      });
    }
    expect(transcripts).toEqual(['hello']);
    unsubscribe();
  });

  test('narrows speech event payloads', () => {
    expect(isSpeechTranscriptEvent({
      type: 'event',
      method: 'speech.transcript',
      payload: {streamId: 'speech-1', text: 'hello', final: true},
    })).toBe(true);
    expect(isSpeechErrorEvent({
      type: 'event',
      method: 'speech.error',
      payload: {streamId: 'speech-1', code: 'UNAVAILABLE', message: 'down', retryable: true},
    })).toBe(true);
  });
});
