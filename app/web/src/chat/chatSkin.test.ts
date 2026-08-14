import {
  clampChatSkinOffset,
  clampChatSkinOpacity,
  clampChatSkinScale,
  decodeChatSkinBlob,
  prepareChatSkinImage,
  resolveChatSkinAnchor,
  resolveChatSkinImageSize,
  revokeChatSkinObjectUrl,
} from './chatSkin';

describe('chat skin image helpers', () => {
  const originalImage = globalThis.Image;
  let imageMode: 'load' | 'error' = 'load';

  beforeEach(() => {
    imageMode = 'load';
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: jest.fn(() => 'blob:chat-skin'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: jest.fn(),
    });
    Object.defineProperty(globalThis, 'Image', {
      configurable: true,
      value: jest.fn(() => {
        const image = {
          onerror: null as ((event: Event) => void) | null,
          onload: null as (() => void) | null,
        } as HTMLImageElement;
        Object.defineProperty(image, 'src', {
          configurable: true,
          set: () => {
            queueMicrotask(() => {
              if (imageMode === 'load') {
                image.onload?.(new Event('load'));
              } else {
                image.onerror?.(new Event('error'));
              }
            });
          },
        });
        return image;
      }),
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'Image', {
      configurable: true,
      value: originalImage,
    });
  });

  test('resolves after the browser loads the candidate image', async () => {
    await expect(decodeChatSkinBlob(new Blob(['skin'], {type: 'image/png'}))).resolves.toBe('blob:chat-skin');
  });

  test('clamps skin display settings to safe visual ranges', () => {
    expect(clampChatSkinScale(-0.1)).toBe(0);
    expect(clampChatSkinScale(2)).toBe(1);
    expect(clampChatSkinOpacity(-1)).toBe(0);
    expect(clampChatSkinOpacity(2)).toBe(1);
    expect(clampChatSkinOffset(-1000)).toBe(-320);
    expect(clampChatSkinOffset(1000)).toBe(320);
  });

  test('resolves the composer bottom-right distance from the chat surface', () => {
    expect(resolveChatSkinAnchor(
      {right: 1000, bottom: 800},
      {right: 940, bottom: 760},
    )).toEqual({right: 60, bottom: 40});
    expect(resolveChatSkinAnchor(null, null)).toEqual({right: 0, bottom: 0});
  });

  test('rejects after the browser cannot decode the candidate image', async () => {
    imageMode = 'error';

    await expect(decodeChatSkinBlob(new Blob(['not-an-image']))).rejects.toThrow();
  });

  test('revokes only non-empty object URLs', () => {
    revokeChatSkinObjectUrl('blob:chat-skin');
    revokeChatSkinObjectUrl('');

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:chat-skin');
  });

  test('keeps small skin images at native size and caps the longest edge', () => {
    expect(resolveChatSkinImageSize(800, 600)).toEqual({width: 800, height: 600});
    expect(resolveChatSkinImageSize(4000, 2000)).toEqual({width: 1280, height: 640});
    expect(resolveChatSkinImageSize(900, 3000)).toEqual({width: 384, height: 1280});
    expect(resolveChatSkinImageSize(0, 0)).toEqual({width: 0, height: 0});
  });

  test('returns the original blob when canvas preprocessing is unavailable', async () => {
    const blob = new Blob(['skin'], {type: 'image/png'});

    await expect(prepareChatSkinImage(blob)).resolves.toBe(blob);
  });
});
