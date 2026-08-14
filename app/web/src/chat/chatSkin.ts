export const CHAT_SKIN_SCALE_MIN = 0;
export const CHAT_SKIN_SCALE_MAX = 1;
export const CHAT_SKIN_SCALE_DEFAULT = 1;
export const CHAT_SKIN_OPACITY_MIN = 0;
export const CHAT_SKIN_OPACITY_MAX = 1;
export const CHAT_SKIN_OPACITY_DEFAULT = 0.17;
export const CHAT_SKIN_OFFSET_MIN = -320;
export const CHAT_SKIN_OFFSET_MAX = 320;
export const CHAT_SKIN_OFFSET_DEFAULT = 0;
// Stored skins are downscaled to this edge and get the softening filter baked
// in, so rendering stays cheap and IndexedDB payloads stay small.
export const CHAT_SKIN_IMAGE_MAX_EDGE = 1280;
const CHAT_SKIN_IMAGE_FILTER = 'blur(1.5px) saturate(0.82)';

export type ChatSkinAnchor = {
  right: number;
  bottom: number;
};

type ChatSkinRectEdges = {
  right: number;
  bottom: number;
};

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

export function clampChatSkinOffset(value: unknown): number {
  const numeric = finiteNumberOr(value, CHAT_SKIN_OFFSET_DEFAULT);
  return Math.min(CHAT_SKIN_OFFSET_MAX, Math.max(CHAT_SKIN_OFFSET_MIN, numeric));
}

export function resolveChatSkinAnchor(
  chatMainRect: ChatSkinRectEdges | null,
  composerRect: ChatSkinRectEdges | null,
): ChatSkinAnchor {
  if (!chatMainRect || !composerRect) {
    return {right: 0, bottom: 0};
  }
  return {
    right: Math.round(chatMainRect.right - composerRect.right),
    bottom: Math.round(chatMainRect.bottom - composerRect.bottom),
  };
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

export function resolveChatSkinImageSize(
  width: number,
  height: number,
): {width: number; height: number} {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 0;
  const longestEdge = Math.max(safeWidth, safeHeight);
  if (longestEdge === 0) {
    return {width: 0, height: 0};
  }
  const ratio = Math.min(1, CHAT_SKIN_IMAGE_MAX_EDGE / longestEdge);
  return {
    width: Math.max(1, Math.round(safeWidth * ratio)),
    height: Math.max(1, Math.round(safeHeight * ratio)),
  };
}

// Downscales the picked image and bakes the softening filter into the stored
// blob. Falls back to the untouched blob whenever canvas processing is
// unavailable, so selection never fails because of preprocessing.
export async function prepareChatSkinImage(blob: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return blob;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return blob;
  }
  try {
    const {width, height} = resolveChatSkinImageSize(bitmap.width, bitmap.height);
    if (!width || !height) return blob;
    const needsResize = width !== bitmap.width || height !== bitmap.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return blob;
    const canBakeFilter = 'filter' in context;
    if (!needsResize && !canBakeFilter) return blob;
    if (canBakeFilter) {
      context.filter = CHAT_SKIN_IMAGE_FILTER;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    const prepared = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(result => resolve(result), 'image/webp', 0.86);
    });
    return prepared ?? blob;
  } catch {
    return blob;
  } finally {
    bitmap.close();
  }
}
