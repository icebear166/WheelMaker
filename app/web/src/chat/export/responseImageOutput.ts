import { downloadBlobAsFile } from './chatMarkdownImageExport';
import {
  getAndroidNativeRpcFacade,
  type AndroidNativeMessageTarget,
} from '../../platform/android/androidNativeMessageBridge';

export type ResponseImageOutputResult = {
  ok: boolean;
  status: string;
  error?: string;
};

type DesktopResponseImageBridge = {
  enabled?: boolean;
};

type ClipboardItemConstructor = new (items: Record<string, Blob>) => ClipboardItem;

type ResponseImageOutputEnv = Window & {
  WheelMakerAndroidNative?: AndroidNativeMessageTarget;
  WheelMakerDesktop?: DesktopResponseImageBridge;
};

type ResponseImageOutputOptions = {
  blob: Blob;
  fileName: string;
  env?: ResponseImageOutputEnv;
  download?: (blob: Blob, fileName: string) => void;
};

const ANDROID_UPDATE_REQUIRED_MESSAGE = 'Update the Android app to share response images.';
const DESKTOP_CLIPBOARD_UNAVAILABLE_MESSAGE = 'Image clipboard is unavailable in this desktop runtime.';

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

function resolveClipboardItemConstructor(env: ResponseImageOutputEnv): ClipboardItemConstructor | null {
  const clipboardItem = (env as unknown as {ClipboardItem?: ClipboardItemConstructor}).ClipboardItem;
  return typeof clipboardItem === 'function' ? clipboardItem : null;
}

async function copyResponseImageToClipboard(
  env: ResponseImageOutputEnv,
  blob: Blob,
): Promise<ResponseImageOutputResult> {
  const clipboardItem = resolveClipboardItemConstructor(env);
  const write = env.navigator?.clipboard?.write;
  if (!clipboardItem || typeof write !== 'function') {
    return {ok: false, status: 'unsupported', error: DESKTOP_CLIPBOARD_UNAVAILABLE_MESSAGE};
  }

  const mimeType = blob.type || 'image/png';
  const item = new clipboardItem({[mimeType]: blob});
  await write.call(env.navigator.clipboard, [item]);
  return {ok: true, status: 'copied'};
}

export async function outputResponseImage({
  blob,
  fileName,
  env = window as ResponseImageOutputEnv,
  download = downloadBlobAsFile,
}: ResponseImageOutputOptions): Promise<ResponseImageOutputResult> {
  const nativeTarget = env.WheelMakerAndroidNative;
  if (nativeTarget) {
    const native = getAndroidNativeRpcFacade(env);
    if (!native) return {ok: false, status: 'unsupported', error: ANDROID_UPDATE_REQUIRED_MESSAGE};
    const dataUrl = await blobToDataUrl(blob);
    return parseBridgeResult(await native.shareResponseImage(JSON.stringify({fileName, dataUrl})));
  }

  if (env.WheelMakerDesktop) {
    return copyResponseImageToClipboard(env, blob);
  }

  download(blob, fileName);
  return {ok: true, status: 'downloaded'};
}
