import {
  outputResponseImage,
  reserveResponseImageShare,
} from '../web/src/chat/export/responseImageOutput';
import {createAndroidNativeMessageTestHost} from '../testUtils/androidNativeMessageTestHost';

describe('response image output', () => {
  afterEach(() => {
    delete (globalThis as {window?: unknown}).window;
  });

  test('downloads response image outside Android native host', async () => {
    const download = jest.fn();
    const blob = new Blob(['png'], {type: 'image/png'});

    await expect(outputResponseImage({
      blob,
      fileName: 'response.png',
      download,
      env: {} as Window,
    })).resolves.toEqual({ok: true, status: 'downloaded'});

    expect(download).toHaveBeenCalledWith(blob, 'response.png');
  });

  test('copies response image to clipboard inside desktop native host', async () => {
    const write = jest.fn(() => Promise.resolve());
    const download = jest.fn();
    const blob = new Blob(['png'], {type: 'image/png'});
    const ClipboardItemMock = jest.fn(function ClipboardItem(items: Record<string, Blob>) {
      return {items};
    });

    await expect(outputResponseImage({
      blob,
      fileName: 'response.png',
      download,
      env: {
        WheelMakerDesktop: {enabled: true},
        ClipboardItem: ClipboardItemMock,
        navigator: {clipboard: {write}},
      } as unknown as Window,
    })).resolves.toEqual({ok: true, status: 'copied'});

    expect(download).not.toHaveBeenCalled();
    expect(ClipboardItemMock).toHaveBeenCalledWith({'image/png': blob});
    expect(write).toHaveBeenCalledWith([expect.objectContaining({
      items: {'image/png': blob},
    })]);
  });

  test('reports unsupported desktop image clipboard without downloading', async () => {
    const download = jest.fn();

    await expect(outputResponseImage({
      blob: new Blob(['png'], {type: 'image/png'}),
      fileName: 'response.png',
      download,
      env: {WheelMakerDesktop: {enabled: true}} as unknown as Window,
    })).resolves.toEqual({
      ok: false,
      status: 'unsupported',
      error: 'Image clipboard is unavailable in this desktop runtime.',
    });

    expect(download).not.toHaveBeenCalled();
  });

  test('shares response image through Android bridge when available', async () => {
    const {target, requests} = createAndroidNativeMessageTestHost({
      'userAction.reserve': () => ({token: 'grant-1'}),
      'image.share.begin': () => ({ok: true, status: 'ready', transferId: 'transfer-1'}),
      'image.share.chunk': () => ({ok: true, status: 'chunk_received'}),
      'image.share.commit': () => ({ok: true, status: 'shared'}),
    });
    const blob = new Blob(['png'], {type: 'image/png'});
    const env = {WheelMakerAndroidNative: target} as unknown as Window;
    const userActionToken = await reserveResponseImageShare(env);

    await expect(outputResponseImage({
      blob,
      fileName: 'response.png',
      download: jest.fn(),
      env,
      userActionToken,
    })).resolves.toEqual({ok: true, status: 'shared'});

    expect(requests).toEqual([
      expect.objectContaining({action: 'userAction.reserve', payload: {action: 'image.share'}}),
      expect.objectContaining({
        action: 'image.share.begin',
        payload: {fileName: 'response.png', size: 3, userActionToken: 'grant-1'},
      }),
      expect.objectContaining({
        action: 'image.share.chunk',
        payload: {transferId: 'transfer-1', index: 0, data: 'cG5n'},
      }),
      expect.objectContaining({action: 'image.share.commit', payload: {transferId: 'transfer-1'}}),
    ]);
  });

  test('streams images larger than the native message limit in bounded chunks', async () => {
    const {target, requests, messages} = createAndroidNativeMessageTestHost({
      'userAction.reserve': () => ({token: 'grant-large'}),
      'image.share.begin': () => ({ok: true, status: 'ready', transferId: 'transfer-large'}),
      'image.share.chunk': () => ({ok: true, status: 'chunk_received'}),
      'image.share.commit': () => ({ok: true, status: 'shared'}),
    });
    const env = {WheelMakerAndroidNative: target} as unknown as Window;
    const blob = new Blob([new Uint8Array(400 * 1024)], {type: 'image/png'});
    const userActionToken = await reserveResponseImageShare(env);

    await expect(outputResponseImage({
      blob,
      fileName: 'large.png',
      env,
      userActionToken,
    })).resolves.toEqual({ok: true, status: 'shared'});

    expect(requests.filter(request => request.action === 'image.share.chunk')).toHaveLength(4);
    expect(Math.max(...messages.map(message => message.length))).toBeLessThanOrEqual(512 * 1024);
  });

  test('cancels a partial Android transfer after a chunk failure', async () => {
    const {target, requests} = createAndroidNativeMessageTestHost({
      'userAction.reserve': () => ({token: 'grant-failure'}),
      'image.share.begin': () => ({ok: true, status: 'ready', transferId: 'transfer-failure'}),
      'image.share.chunk': payload => {
        if (payload.index === 1) throw new Error('chunk failed');
        return {ok: true, status: 'chunk_received'};
      },
      'image.share.cancel': () => ({ok: true, status: 'cancelled'}),
    });
    const env = {WheelMakerAndroidNative: target} as unknown as Window;
    const userActionToken = await reserveResponseImageShare(env);

    await expect(outputResponseImage({
      blob: new Blob([new Uint8Array(200 * 1024)], {type: 'image/png'}),
      fileName: 'failure.png',
      env,
      userActionToken,
    })).rejects.toThrow('chunk failed');

    expect(requests.at(-1)).toMatchObject({
      action: 'image.share.cancel',
      payload: {transferId: 'transfer-failure'},
    });
  });

  test('asks users to update old Android APKs without falling back to blob download', async () => {
    const download = jest.fn();

    await expect(outputResponseImage({
      blob: new Blob(['png'], {type: 'image/png'}),
      fileName: 'response.png',
      download,
      env: {WheelMakerAndroidNative: {}} as unknown as Window,
    })).resolves.toEqual({
      ok: false,
      status: 'unsupported',
      error: 'Update the Android app to share response images.',
    });

    expect(download).not.toHaveBeenCalled();
  });

  test('returns Android bridge failures to the caller', async () => {
    const {target} = createAndroidNativeMessageTestHost({
      'userAction.reserve': () => ({token: 'grant-no-target'}),
      'image.share.begin': () => ({ok: true, status: 'ready', transferId: 'transfer-no-target'}),
      'image.share.chunk': () => ({ok: true, status: 'chunk_received'}),
      'image.share.commit': () => ({ok: false, status: 'share_failed', error: 'no target'}),
    });
    const env = {WheelMakerAndroidNative: target} as unknown as Window;
    const userActionToken = await reserveResponseImageShare(env);
    await expect(outputResponseImage({
      blob: new Blob(['png'], {type: 'image/png'}),
      fileName: 'response.png',
      download: jest.fn(),
      env,
      userActionToken,
    })).resolves.toEqual({ok: false, status: 'share_failed', error: 'no target'});
  });
});
