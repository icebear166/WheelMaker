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
