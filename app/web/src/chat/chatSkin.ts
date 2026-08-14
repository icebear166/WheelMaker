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
