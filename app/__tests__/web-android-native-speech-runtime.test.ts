import {
  createAndroidNativeSpeechRuntime,
  getAndroidNativeSpeechBridge,
  isAndroidNativeSpeechHost,
  type AndroidNativeSpeechEvent,
} from '../web/src/platform/android/androidNativeSpeechRuntime';
import {createAndroidNativeMessageTestHost} from './androidNativeMessageTestHost';

describe('android native speech runtime', () => {
  afterEach(() => {
    delete (globalThis as {window?: unknown}).window;
  });

  test('detects only the Android WebMessage host', () => {
    (globalThis as {window?: unknown}).window = {
      WheelMakerAndroidNative: {
        getWebSourceState: jest.fn(),
      },
    };

    expect(isAndroidNativeSpeechHost()).toBe(false);
    expect(getAndroidNativeSpeechBridge()).toBeNull();

    const {target} = createAndroidNativeMessageTestHost({});
    (globalThis as {window?: unknown}).window = {
      WheelMakerAndroidNative: target,
    };

    expect(isAndroidNativeSpeechHost()).toBe(true);
    expect(getAndroidNativeSpeechBridge()).not.toBeNull();
  });

  test('starts native speech and routes async native events', async () => {
    const {target, requests} = createAndroidNativeMessageTestHost({
      'speech.start': () => ({accepted: true, streamId: 'android-speech-1'}),
      'speech.finish': () => ({accepted: true, streamId: 'android-speech-1'}),
      'speech.cancel': () => ({accepted: true, streamId: 'android-speech-1'}),
    });
    (globalThis as {window?: unknown}).window = {
      WheelMakerAndroidNative: target,
    };
    const runtime = createAndroidNativeSpeechRuntime();
    const events: AndroidNativeSpeechEvent[] = [];
    const unsubscribe = runtime?.onEvent(event => events.push(event));

    await expect(runtime?.start({
      provider: 'volcengine',
      model: 'doubao-streaming-asr-2.0',
      apiKey: 'secret-key',
      audio: {format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1},
    })).resolves.toEqual({streamId: 'android-speech-1'});
    await runtime?.finish('android-speech-1');
    await runtime?.cancel('android-speech-1', 'gesture');

    expect(requests[0]).toMatchObject({action: 'speech.start', payload: {
      provider: 'volcengine',
      model: 'doubao-streaming-asr-2.0',
      apiKey: 'secret-key',
      audio: {format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1},
    }});
    expect(requests[1]).toMatchObject({action: 'speech.finish', payload: {streamId: 'android-speech-1'}});
    expect(requests[2]).toMatchObject({
      action: 'speech.cancel',
      payload: {streamId: 'android-speech-1', reason: 'gesture'},
    });

    const callback = (window as Window & {
      __wheelmakerAndroidSpeechEvent?: (event: unknown) => void;
    }).__wheelmakerAndroidSpeechEvent;
    callback?.({
      type: 'transcript',
      streamId: 'android-speech-1',
      text: 'hello',
      final: false,
    });
    callback?.(JSON.stringify({
      type: 'status',
      streamId: 'android-speech-1',
      status: 'recording',
    }));

    expect(events).toEqual([
      {type: 'transcript', streamId: 'android-speech-1', text: 'hello', final: false},
      {type: 'status', streamId: 'android-speech-1', status: 'recording'},
    ]);
    unsubscribe?.();
  });

  test('rejects native command responses that were not accepted', async () => {
    const {target} = createAndroidNativeMessageTestHost({
      'speech.start': () => ({
          accepted: false,
          code: 'BUSY',
          message: 'Native speech is already active.',
        }),
    });
    (globalThis as {window?: unknown}).window = {
      WheelMakerAndroidNative: target,
    };

    const runtime = createAndroidNativeSpeechRuntime();

    await expect(runtime?.start({
      provider: 'volcengine',
      model: 'doubao-streaming-asr-2.0',
      apiKey: 'secret-key',
      audio: {format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1},
    })).rejects.toThrow('Native speech is already active.');
  });
});
