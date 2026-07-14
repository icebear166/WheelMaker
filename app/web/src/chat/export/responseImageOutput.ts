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
  userActionToken?: string;
  env?: ResponseImageOutputEnv;
  download?: (blob: Blob, fileName: string) => void;
};

const ANDROID_UPDATE_REQUIRED_MESSAGE = 'Update the Android app to share response images.';
const DESKTOP_CLIPBOARD_UNAVAILABLE_MESSAGE = 'Image clipboard is unavailable in this desktop runtime.';
const ANDROID_IMAGE_CHUNK_BYTES = 128 * 1024;

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

function bytesToBase64(bytes: Uint8Array): string {
  const stringChunkBytes = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += stringChunkBytes) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + stringChunkBytes));
  }
  return btoa(binary);
}

export async function reserveResponseImageShare(
  env: ResponseImageOutputEnv = window as ResponseImageOutputEnv,
): Promise<string | undefined> {
  if (!env.WheelMakerAndroidNative) return undefined;
  const native = getAndroidNativeRpcFacade(env);
  if (!native) throw new Error(ANDROID_UPDATE_REQUIRED_MESSAGE);
  return native.reserveUserAction('image.share');
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
  userActionToken,
  env = window as ResponseImageOutputEnv,
  download = downloadBlobAsFile,
}: ResponseImageOutputOptions): Promise<ResponseImageOutputResult> {
  const nativeTarget = env.WheelMakerAndroidNative;
  if (nativeTarget) {
    const native = getAndroidNativeRpcFacade(env);
    if (!native) return {ok: false, status: 'unsupported', error: ANDROID_UPDATE_REQUIRED_MESSAGE};
    if (!userActionToken) {
      return {ok: false, status: 'authorization_required', error: 'Tap Share again to authorize image sharing.'};
    }
    let transferId = '';
    try {
      transferId = await native.beginResponseImageShare(fileName, blob.size, userActionToken);
      let index = 0;
      for (let offset = 0; offset < blob.size; offset += ANDROID_IMAGE_CHUNK_BYTES) {
        const buffer = await blob.slice(offset, offset + ANDROID_IMAGE_CHUNK_BYTES).arrayBuffer();
        const result = parseBridgeResult(await native.appendResponseImageShare(
          transferId,
          index,
          bytesToBase64(new Uint8Array(buffer)),
        ));
        if (!result.ok) throw new Error(result.error || result.status);
        index += 1;
      }
      return parseBridgeResult(await native.commitResponseImageShare(transferId));
    } catch (error) {
      if (transferId) await native.cancelResponseImageShare(transferId).catch(() => undefined);
      throw error;
    }
  }

  if (env.WheelMakerDesktop) {
    return copyResponseImageToClipboard(env, blob);
  }

  download(blob, fileName);
  return {ok: true, status: 'downloaded'};
}
