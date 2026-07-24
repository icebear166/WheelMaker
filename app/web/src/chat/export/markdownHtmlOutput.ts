import {downloadBlobAsFile} from './chatMarkdownImageExport';
import {
  getAndroidNativeRpcFacade,
  type AndroidNativeMessageTarget,
} from '../../platform/android/androidNativeMessageBridge';

export type MarkdownHtmlOutputResult = {
  ok: boolean;
  status: string;
  error?: string;
};

type DesktopMarkdownHtmlBridge = {
  enabled?: boolean;
  beginHtmlFileClipboard?: (fileName: string, size: number) => Promise<string> | string;
  appendHtmlFileClipboard?: (transferId: string, index: number, data: string) => Promise<string> | string;
  commitHtmlFileClipboard?: (transferId: string) => Promise<string> | string;
  cancelHtmlFileClipboard?: (transferId: string) => Promise<string> | string;
};

type MarkdownHtmlOutputEnv = Window & {
  WheelMakerAndroidNative?: AndroidNativeMessageTarget;
  WheelMakerDesktop?: DesktopMarkdownHtmlBridge;
};

type MarkdownHtmlOutputOptions = {
  html: string;
  fileName: string;
  userActionToken?: string;
  env?: MarkdownHtmlOutputEnv;
  download?: (blob: Blob, fileName: string) => void;
};

const ANDROID_UPDATE_REQUIRED_MESSAGE = 'Update the Android app to share HTML documents.';
const DESKTOP_CLIPBOARD_UNAVAILABLE_MESSAGE = 'HTML file clipboard is unavailable in this desktop runtime.';
const HTML_CHUNK_BYTES = 128 * 1024;

function parseBridgeResult(raw: string | undefined): MarkdownHtmlOutputResult {
  try {
    const parsed = JSON.parse(raw || '{}') as Partial<MarkdownHtmlOutputResult>;
    return {
      ok: parsed.ok === true,
      status: typeof parsed.status === 'string' && parsed.status ? parsed.status : 'output_failed',
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
    };
  } catch {
    return {ok: false, status: 'output_failed', error: 'invalid_bridge_response'};
  }
}

function parseTransferId(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {transferId?: unknown};
    if (typeof parsed.transferId === 'string' && parsed.transferId) {
      return parsed.transferId;
    }
  } catch {
    // Desktop bridge returns the transfer id directly.
  }
  if (raw) return raw;
  throw new Error('Native bridge returned no transfer id.');
}

function bytesToBase64(bytes: Uint8Array): string {
  const stringChunkBytes = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += stringChunkBytes) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + stringChunkBytes));
  }
  return btoa(binary);
}

async function streamHtmlBlob({
  blob,
  begin,
  append,
  commit,
  cancel,
  fileName,
}: {
  blob: Blob;
  fileName: string;
  begin: (fileName: string, size: number) => Promise<string>;
  append: (transferId: string, index: number, data: string) => Promise<string>;
  commit: (transferId: string) => Promise<string>;
  cancel: (transferId: string) => Promise<void>;
}): Promise<MarkdownHtmlOutputResult> {
  let transferId = '';
  try {
    transferId = parseTransferId(await begin(fileName, blob.size));
    let index = 0;
    for (let offset = 0; offset < blob.size; offset += HTML_CHUNK_BYTES) {
      const buffer = await blob.slice(offset, offset + HTML_CHUNK_BYTES).arrayBuffer();
      const result = parseBridgeResult(await append(
        transferId,
        index,
        bytesToBase64(new Uint8Array(buffer)),
      ));
      if (!result.ok) throw new Error(result.error || result.status);
      index += 1;
    }
    return parseBridgeResult(await commit(transferId));
  } catch (error) {
    if (transferId) await cancel(transferId).catch(() => undefined);
    throw error;
  }
}

export async function reserveMarkdownHtmlShare(
  env: MarkdownHtmlOutputEnv = window as MarkdownHtmlOutputEnv,
): Promise<string | undefined> {
  if (!env.WheelMakerAndroidNative) return undefined;
  const native = getAndroidNativeRpcFacade(env);
  if (!native) throw new Error(ANDROID_UPDATE_REQUIRED_MESSAGE);
  return native.reserveUserAction('html.share');
}

async function outputToAndroidShare(
  env: MarkdownHtmlOutputEnv,
  blob: Blob,
  fileName: string,
  userActionToken?: string,
): Promise<MarkdownHtmlOutputResult> {
  const native = getAndroidNativeRpcFacade(env);
  if (!native) return {ok: false, status: 'unsupported', error: ANDROID_UPDATE_REQUIRED_MESSAGE};
  if (!userActionToken) {
    return {
      ok: false,
      status: 'authorization_required',
      error: 'Tap Share again to authorize HTML document sharing.',
    };
  }
  return streamHtmlBlob({
    blob,
    fileName,
    begin: (name, size) => native.beginMarkdownHtmlShare(name, size, userActionToken),
    append: (transferId, index, data) => native.appendMarkdownHtmlShare(transferId, index, data),
    commit: transferId => native.commitMarkdownHtmlShare(transferId),
    cancel: async transferId => {
      await native.cancelMarkdownHtmlShare(transferId);
    },
  });
}

async function outputToDesktopClipboard(
  bridge: DesktopMarkdownHtmlBridge,
  blob: Blob,
  fileName: string,
): Promise<MarkdownHtmlOutputResult> {
  if (
    !bridge.beginHtmlFileClipboard ||
    !bridge.appendHtmlFileClipboard ||
    !bridge.commitHtmlFileClipboard ||
    !bridge.cancelHtmlFileClipboard
  ) {
    return {ok: false, status: 'unsupported', error: DESKTOP_CLIPBOARD_UNAVAILABLE_MESSAGE};
  }
  return streamHtmlBlob({
    blob,
    fileName,
    begin: async (name, size) => bridge.beginHtmlFileClipboard!(name, size),
    append: async (transferId, index, data) => bridge.appendHtmlFileClipboard!(transferId, index, data),
    commit: async transferId => bridge.commitHtmlFileClipboard!(transferId),
    cancel: async transferId => {
      await bridge.cancelHtmlFileClipboard!(transferId);
    },
  });
}

export async function outputMarkdownHtml({
  html,
  fileName,
  userActionToken,
  env = window as MarkdownHtmlOutputEnv,
  download = downloadBlobAsFile,
}: MarkdownHtmlOutputOptions): Promise<MarkdownHtmlOutputResult> {
  const blob = new Blob([html], {type: 'text/html;charset=utf-8'});
  if (env.WheelMakerAndroidNative) {
    return outputToAndroidShare(env, blob, fileName, userActionToken);
  }
  if (env.WheelMakerDesktop) {
    return outputToDesktopClipboard(env.WheelMakerDesktop, blob, fileName);
  }
  download(blob, fileName);
  return {ok: true, status: 'downloaded'};
}
