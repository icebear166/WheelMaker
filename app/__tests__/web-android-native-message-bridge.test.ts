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
    const client = createAndroidNativeMessageClient({
      WheelMakerAndroidNative: target,
      crypto: {randomUUID: () => 'request-1'},
    });

    const response = client.request('apk.install', {downloadUrl: 'https://example.com/app.apk'});
    expect(JSON.parse(posted[0])).toEqual({
      requestId: 'request-1',
      action: 'apk.install',
      payload: {downloadUrl: 'https://example.com/app.apk'},
    });
    target.onmessage?.({data: JSON.stringify({requestId: 'request-1', ok: true, result: {ok: true}})});
    await expect(response).resolves.toEqual({ok: true});
  });

  test('rejects oversized requests before posting them to Android', async () => {
    const postMessage = jest.fn();
    const client = createAndroidNativeMessageClient({
      WheelMakerAndroidNative: {postMessage},
      crypto: {randomUUID: () => 'oversized-request'},
    });

    await expect(client.request('image.share.chunk', {
      data: 'x'.repeat(512 * 1024),
    })).rejects.toThrow('exceeds the Android native message limit');
    expect(postMessage).not.toHaveBeenCalled();
  });

  test('continues handling replies when a previous message handler throws', async () => {
    const target: {postMessage(message: string): void; onmessage?: (event: {data: string}) => void} = {
      postMessage: () => undefined,
      onmessage: () => {
        throw new Error('old handler failed');
      },
    };
    const client = createAndroidNativeMessageClient({
      WheelMakerAndroidNative: target,
      crypto: {randomUUID: () => 'request-after-old-handler'},
    });

    const response = client.request('diagnostics.drain');
    target.onmessage?.({data: JSON.stringify({
      requestId: 'request-after-old-handler',
      ok: true,
      result: {records: []},
    })});
    await expect(response).resolves.toEqual({records: []});
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

  test('exposes deferred user actions and image transfer actions through the RPC facade', async () => {
    const {target, requests} = createAndroidNativeMessageTestHost({
      'userAction.reserve': () => ({token: 'grant-1'}),
      'image.share.begin': () => ({ok: true, status: 'ready', transferId: 'transfer-1'}),
      'image.share.chunk': () => ({ok: true, status: 'chunk_received'}),
      'image.share.commit': () => ({ok: true, status: 'shared'}),
      'image.share.cancel': () => ({ok: true, status: 'cancelled'}),
    });
    const facade = getAndroidNativeRpcFacade({WheelMakerAndroidNative: target});

    await expect(facade?.reserveUserAction('image.share')).resolves.toBe('grant-1');
    await expect(facade?.beginResponseImageShare('response.png', 3, 'grant-1')).resolves.toBe('transfer-1');
    await facade?.appendResponseImageShare('transfer-1', 0, 'cG5n');
    await facade?.commitResponseImageShare('transfer-1');
    await facade?.cancelResponseImageShare('transfer-1');

    expect(requests.map(request => request.action)).toEqual([
      'userAction.reserve',
      'image.share.begin',
      'image.share.chunk',
      'image.share.commit',
      'image.share.cancel',
    ]);
  });
});
