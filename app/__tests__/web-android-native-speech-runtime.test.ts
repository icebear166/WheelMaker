import {
  createAndroidNativeSpeechRuntime,
  getAndroidNativeSpeechBridge,
  isAndroidNativeSpeechHost,
  type AndroidNativeSpeechEvent,
} from '../web/src/platform/android/androidNativeSpeechRuntime';
import {createAndroidNativeMessageTestHost} from '../testUtils/androidNativeMessageTestHost';

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
		'speech.start': () => ({accepted: true, streamId: 'registry-speech-1'}),
		'speech.finish': () => ({accepted: true, streamId: 'registry-speech-1'}),
		'speech.cancel': () => ({accepted: true, streamId: 'registry-speech-1'}),
    });
    (globalThis as {window?: unknown}).window = {
      WheelMakerAndroidNative: target,
    };
    const runtime = createAndroidNativeSpeechRuntime();
    const events: AndroidNativeSpeechEvent[] = [];
    const unsubscribe = runtime?.onEvent(event => events.push(event));

    await expect(runtime?.start({
		streamId: 'registry-speech-1',
      provider: 'volcengine',
      audio: {format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1},
	})).resolves.toEqual({streamId: 'registry-speech-1'});
	await runtime?.finish('registry-speech-1');
	await runtime?.cancel('registry-speech-1', 'gesture');

    expect(requests[0]).toMatchObject({action: 'speech.start', payload: {
		streamId: 'registry-speech-1',
      provider: 'volcengine',
      audio: {format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1},
    }});
	expect(requests[1]).toMatchObject({action: 'speech.finish', payload: {streamId: 'registry-speech-1'}});
    expect(requests[2]).toMatchObject({
      action: 'speech.cancel',
		payload: {streamId: 'registry-speech-1', reason: 'gesture'},
    });

    const callback = (window as Window & {
      __wheelmakerAndroidSpeechEvent?: (event: unknown) => void;
    }).__wheelmakerAndroidSpeechEvent;
    callback?.({
		type: 'audio',
		streamId: 'registry-speech-1',
		pcm: 'AQID',
    });
    callback?.(JSON.stringify({
      type: 'status',
		streamId: 'registry-speech-1',
      status: 'recording',
    }));

    expect(events).toEqual([
		{type: 'audio', streamId: 'registry-speech-1', pcm: 'AQID'},
		{type: 'status', streamId: 'registry-speech-1', status: 'recording'},
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
		streamId: 'registry-speech-2',
      provider: 'volcengine',
      audio: {format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1},
    })).rejects.toThrow('Native speech is already active.');
  });
});
