export const CHAT_SKIN_SCALE_MIN = 0.5;
export const CHAT_SKIN_SCALE_MAX = 2;
export const CHAT_SKIN_SCALE_DEFAULT = 1;
export const CHAT_SKIN_OPACITY_MIN = 0;
export const CHAT_SKIN_OPACITY_MAX = 1;
export const CHAT_SKIN_OPACITY_DEFAULT = 0.17;

function finiteNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function clampChatSkinScale(value: unknown): number {
  const numeric = finiteNumberOr(value, CHAT_SKIN_SCALE_DEFAULT);
  return Math.min(CHAT_SKIN_SCALE_MAX, Math.max(CHAT_SKIN_SCALE_MIN, numeric));
}

export function clampChatSkinOpacity(value: unknown): number {
  const numeric = finiteNumberOr(value, CHAT_SKIN_OPACITY_DEFAULT);
  return Math.min(CHAT_SKIN_OPACITY_MAX, Math.max(CHAT_SKIN_OPACITY_MIN, numeric));
}

export function revokeChatSkinObjectUrl(objectUrl: string | null | undefined): void {
  if (!objectUrl) return;
  URL.revokeObjectURL(objectUrl);
}

export function decodeChatSkinBlob(blob: Blob): Promise<string> {
  if (typeof URL.createObjectURL !== 'function') {
    return Promise.reject(new Error('This browser cannot create local image previews.'));
  }
  if (typeof Image === 'undefined') {
    return Promise.reject(new Error('This browser cannot decode local images.'));
  }

  const objectUrl = URL.createObjectURL(blob);
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      revokeChatSkinObjectUrl(objectUrl);
      reject(error);
    };
    image.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(objectUrl);
    };
    image.onerror = () => {
      fail(new Error('The selected file is not a browser-decodable image.'));
    };
    try {
      image.src = objectUrl;
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
