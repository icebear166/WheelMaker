import {
  blobToDataUrl,
  outputResponseImage,
} from '../web/src/chat/export/responseImageOutput';

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

  test('shares response image through Android bridge when available', async () => {
    const native = {
      shareResponseImage: jest.fn(() => JSON.stringify({ok: true, status: 'shared'})),
    };
    const blob = new Blob(['png'], {type: 'image/png'});

    await expect(outputResponseImage({
      blob,
      fileName: 'response.png',
      download: jest.fn(),
      env: {WheelMakerAndroidNative: native} as unknown as Window,
    })).resolves.toEqual({ok: true, status: 'shared'});

    const raw = native.shareResponseImage.mock.calls[0][0];
    expect(JSON.parse(raw)).toMatchObject({
      fileName: 'response.png',
      dataUrl: 'data:image/png;base64,cG5n',
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
    await expect(outputResponseImage({
      blob: new Blob(['png'], {type: 'image/png'}),
      fileName: 'response.png',
      download: jest.fn(),
      env: {
        WheelMakerAndroidNative: {
          shareResponseImage: () => JSON.stringify({ok: false, status: 'share_failed', error: 'no target'}),
        },
      } as unknown as Window,
    })).resolves.toEqual({ok: false, status: 'share_failed', error: 'no target'});
  });

  test('converts blobs to data URLs', async () => {
    await expect(blobToDataUrl(new Blob(['png'], {type: 'image/png'}))).resolves.toBe(
      'data:image/png;base64,cG5n',
    );
  });
});
