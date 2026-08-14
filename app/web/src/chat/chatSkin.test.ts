import {decodeChatSkinBlob, revokeChatSkinObjectUrl} from './chatSkin';

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
});
