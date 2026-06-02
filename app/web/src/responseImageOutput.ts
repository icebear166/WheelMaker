import { downloadBlobAsFile } from './chatMarkdownImageExport';

export type ResponseImageOutputResult = {
  ok: boolean;
  status: string;
  error?: string;
};

type AndroidResponseImageBridge = {
  shareResponseImage?: (rawJson: string) => string;
};

type ResponseImageOutputEnv = Window & {
  WheelMakerAndroidNative?: AndroidResponseImageBridge;
};

type ResponseImageOutputOptions = {
  blob: Blob;
  fileName: string;
  env?: ResponseImageOutputEnv;
  download?: (blob: Blob, fileName: string) => void;
};

const ANDROID_UPDATE_REQUIRED_MESSAGE = 'Update the Android app to share response images.';

function parseBridgeResult(raw: string | undefined): ResponseImageOutputResult {
  try {
    const parsed = JSON.parse(raw || '{}') as Partial<ResponseImageOutputResult>;
    return {
      ok: parsed.ok === true,
      status: typeof parsed.status === 'string' && parsed.status ? parsed.status : 'share_failed',
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
    };
  } catch {
    return {ok: false, status: 'share_failed', error: 'invalid_bridge_response'};
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then(buffer => {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
  });
}

export async function outputResponseImage({
  blob,
  fileName,
  env = window as ResponseImageOutputEnv,
  download = downloadBlobAsFile,
}: ResponseImageOutputOptions): Promise<ResponseImageOutputResult> {
  const native = env.WheelMakerAndroidNative;
  if (!native) {
    download(blob, fileName);
    return {ok: true, status: 'downloaded'};
  }
  if (typeof native.shareResponseImage !== 'function') {
    return {ok: false, status: 'unsupported', error: ANDROID_UPDATE_REQUIRED_MESSAGE};
  }
  const dataUrl = await blobToDataUrl(blob);
  return parseBridgeResult(native.shareResponseImage(JSON.stringify({fileName, dataUrl})));
}
