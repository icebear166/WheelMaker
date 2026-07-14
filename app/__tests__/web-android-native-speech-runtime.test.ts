import {
  createAndroidNativeSpeechRuntime,
  getAndroidNativeSpeechBridge,
  isAndroidNativeSpeechAuthenticationError,
  isAndroidNativeSpeechHost,
  synchronizeAndroidSpeechCredential,
  type AndroidNativeSpeechEvent,
  type AndroidNativeSpeechRuntime,
} from '../web/src/platform/android/androidNativeSpeechRuntime';
import {DEFAULT_SERVER_SETTINGS} from '../web/src/settings/serverSettings';
import {createAndroidNativeMessageTestHost} from '../testUtils/androidNativeMessageTestHost';

describe('android native speech runtime', () => {
  afterEach(() => {
    delete (globalThis as {window?: unknown}).window;
  });

  test('detects only the Android WebMessage host', () => {
    (globalThis as {window?: unknown}).window = {
      WheelMakerAndroidNative: {getWebSourceState: jest.fn()},
    };
    expect(isAndroidNativeSpeechHost()).toBe(false);
    expect(getAndroidNativeSpeechBridge()).toBeNull();

    const {target} = createAndroidNativeMessageTestHost({});
    (globalThis as {window?: unknown}).window = {WheelMakerAndroidNative: target};
    expect(isAndroidNativeSpeechHost()).toBe(true);
    expect(getAndroidNativeSpeechBridge()).not.toBeNull();
  });

  test('starts direct native speech without a Registry stream and routes transcripts', async () => {
    const {target, requests} = createAndroidNativeMessageTestHost({
      'userAction.reserve': () => ({token: 'speech-grant-1'}),
      'speech.start': () => ({accepted: true, streamId: 'android-speech-1'}),
      'speech.finish': () => ({accepted: true, streamId: 'android-speech-1'}),
      'speech.cancel': () => ({accepted: true, streamId: 'android-speech-1'}),
      'speech.credentialState': () => ({configured: true, version: 'v1'}),
      'speech.configureCredential': () => ({configured: true, version: 'v1'}),
      'speech.clearCredential': () => ({configured: false, version: ''}),
    });
    (globalThis as {window?: unknown}).window = {WheelMakerAndroidNative: target};
    const runtime = createAndroidNativeSpeechRuntime();
    const events: AndroidNativeSpeechEvent[] = [];
    const unsubscribe = runtime?.onEvent(event => events.push(event));

    const userActionToken = await runtime?.reserveStart();
    await expect(runtime?.start({
      provider: 'volcengine',
      model: 'doubao-streaming-asr-2.0',
      audio: {format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1},
    }, userActionToken ?? '')).resolves.toEqual({streamId: 'android-speech-1'});
    await runtime?.finish('android-speech-1');
    await runtime?.cancel('android-speech-1', 'gesture');

    expect(requests[0]).toMatchObject({
      action: 'userAction.reserve',
      payload: {action: 'speech.start'},
    });
    expect(requests[1]).toMatchObject({action: 'speech.start', payload: {
      provider: 'volcengine',
      model: 'doubao-streaming-asr-2.0',
      audio: {format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1},
      userActionToken: 'speech-grant-1',
    }});
    expect(requests[1].payload).not.toHaveProperty('streamId');

    const callback = (window as Window & {
      __wheelmakerAndroidSpeechEvent?: (event: unknown) => void;
    }).__wheelmakerAndroidSpeechEvent;
    callback?.({type: 'transcript', streamId: 'android-speech-1', text: 'hello', final: true});
    callback?.({type: 'status', streamId: 'android-speech-1', status: 'recording'});

    expect(events).toEqual([
      {type: 'transcript', streamId: 'android-speech-1', text: 'hello', final: true},
      {type: 'status', streamId: 'android-speech-1', status: 'recording'},
    ]);
    unsubscribe?.();
  });

  test('synchronizes an unchanged credential only once and clears missing configuration', async () => {
    let state = {configured: false, version: ''};
    const runtime = {
      credentialState: jest.fn(async () => state),
      configureCredential: jest.fn(async (_accessToken: string, version: string) => {
        state = {configured: true, version};
        return state;
      }),
      clearCredential: jest.fn(async () => {
        state = {configured: false, version: ''};
        return state;
      }),
    } as unknown as AndroidNativeSpeechRuntime;
    const loadCredential = jest.fn(async () => ({
      accessToken: 'secret-token',
      version: 'v1',
      model: 'doubao-streaming-asr-2.0' as const,
    }));
    const configured = {
      ...DEFAULT_SERVER_SETTINGS,
      voiceInput: {configured: true, updatedAt: 'v1', model: 'doubao-streaming-asr-2.0' as const},
    };

    await synchronizeAndroidSpeechCredential(runtime, configured, loadCredential);
    await synchronizeAndroidSpeechCredential(runtime, configured, loadCredential);
    expect(loadCredential).toHaveBeenCalledTimes(1);
    expect(runtime.configureCredential).toHaveBeenCalledTimes(1);

    await synchronizeAndroidSpeechCredential(runtime, DEFAULT_SERVER_SETTINGS, loadCredential);
    expect(runtime.clearCredential).toHaveBeenCalledTimes(1);
  });

  test('recognizes provider authentication errors without treating network failures as auth', () => {
    expect(isAndroidNativeSpeechAuthenticationError('DOUBAO_45000001')).toBe(true);
    expect(isAndroidNativeSpeechAuthenticationError('UNAUTHORIZED')).toBe(true);
    expect(isAndroidNativeSpeechAuthenticationError('UNAVAILABLE')).toBe(false);
  });
});
