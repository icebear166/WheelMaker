import type {RegistryShareCreatePayload} from '../registry/registryTypes';

export const SHARE_RAW_HTML_MAX_BYTES = 16 * 1024 * 1024;
export const SHARE_REGISTRY_MESSAGE_MAX_BYTES = 16 * 1024 * 1024;

export type ShareCompressedContent = {
  content: string;
  rawBytes: number;
  compressedBytes: number;
};

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export async function compressShareContent(html: string): Promise<ShareCompressedContent> {
  const rawBytes = utf8ByteLength(html);
  if (rawBytes > SHARE_RAW_HTML_MAX_BYTES) {
    throw new Error('Share HTML exceeds the 16 MiB limit.');
  }
  const CompressionStreamConstructor = (globalThis as typeof globalThis & {
    CompressionStream?: new (format: 'gzip') => CompressionStream;
  }).CompressionStream;
  if (!CompressionStreamConstructor) {
    throw new Error('This browser does not support CompressionStream; update the app before sharing.');
  }
  let compressed: Uint8Array;
  try {
    const stream = new CompressionStreamConstructor('gzip');
    const writer = stream.writable.getWriter();
    await writer.write(new TextEncoder().encode(html));
    await writer.close();
    compressed = new Uint8Array(await new Response(stream.readable).arrayBuffer());
  } catch (error) {
    throw new Error(`Unable to gzip share HTML: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    content: encodeBase64(compressed),
    rawBytes,
    compressedBytes: compressed.byteLength,
  };
}

export function preflightShareEnvelope(payload: RegistryShareCreatePayload): number {
  const envelope = JSON.stringify({
    // Reserve a wide request id so the preflight remains conservative for the
    // live RegistryClient sequence.
    requestId: 9999999999,
    type: 'request',
    method: 'share.create',
    payload,
  });
  const bytes = utf8ByteLength(envelope);
  if (bytes > SHARE_REGISTRY_MESSAGE_MAX_BYTES) {
    throw new Error('Share request exceeds the Registry 16 MiB message limit.');
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof btoa !== 'function') {
    throw new Error('This browser does not support base64 encoding; update the app before sharing.');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
