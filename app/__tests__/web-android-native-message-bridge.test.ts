import {
  createAndroidNativeMessageClient,
  getAndroidNativeRpcFacade,
} from '../web/src/platform/android/androidNativeMessageBridge';
import {createAndroidNativeMessageTestHost} from '../testUtils/androidNativeMessageTestHost';

describe('Android native web message bridge', () => {
  test('sends the unified request envelope and resolves the matching reply', async () => {
    const posted: string[] = [];
    const target: {postMessage(message: string): void; onmessage?: (event: {data: string}) => void} = {
      postMessage: message => posted.push(message),
    };
    const listeners = new Map<string, () => void>();
    const client = createAndroidNativeMessageClient({
      WheelMakerAndroidNative: target,
      addEventListener: (name, listener) => listeners.set(name, listener),
      performance: {now: () => 321},
      crypto: {randomUUID: () => 'request-1'},
    });

    listeners.get('pointerdown')?.();
    const response = client.request('apk.install', {downloadUrl: 'https://example.com/app.apk'});
    expect(JSON.parse(posted[0])).toEqual({
      requestId: 'request-1',
      action: 'apk.install',
      payload: {downloadUrl: 'https://example.com/app.apk'},
      userGestureAt: 321,
    });
    target.onmessage?.({data: JSON.stringify({requestId: 'request-1', ok: true, result: {ok: true}})});
    await expect(response).resolves.toEqual({ok: true});
  });

  test('rejects native errors and ignores replies for other requests', async () => {
    const target: {postMessage(message: string): void; onmessage?: (event: {data: string}) => void} = {
      postMessage: () => undefined,
    };
    const client = createAndroidNativeMessageClient({
      WheelMakerAndroidNative: target,
      performance: {now: () => 0},
      crypto: {randomUUID: () => 'request-2'},
    });

    const response = client.request('diagnostics.drain');
    target.onmessage?.({data: JSON.stringify({requestId: 'other', ok: true, result: {}})});
    target.onmessage?.({data: JSON.stringify({requestId: 'request-2', ok: false, error: 'request_not_allowed'})});
    await expect(response).rejects.toThrow('request_not_allowed');
  });

  test('exposes origin-gated speech credential actions through the RPC facade', async () => {
    const {target, requests} = createAndroidNativeMessageTestHost({
      'speech.credentialState': () => ({configured: false, version: ''}),
      'speech.configureCredential': () => ({configured: true, version: 'v1'}),
      'speech.clearCredential': () => ({configured: false, version: ''}),
    });
    const facade = getAndroidNativeRpcFacade({WheelMakerAndroidNative: target});

    await facade?.getSpeechCredentialState();
    await facade?.configureSpeechCredential('secret-token', 'v1');
    await facade?.clearSpeechCredential();

    expect(requests).toEqual([
      expect.objectContaining({action: 'speech.credentialState', payload: {}}),
      expect.objectContaining({
        action: 'speech.configureCredential',
        payload: {accessToken: 'secret-token', version: 'v1'},
      }),
      expect.objectContaining({action: 'speech.clearCredential', payload: {}}),
    ]);
  });
});
