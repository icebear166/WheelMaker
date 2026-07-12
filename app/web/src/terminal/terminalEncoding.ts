const BASE64_CHUNK_SIZE = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + BASE64_CHUNK_SIZE));
    for (let index = 0; index < chunk.length; index += 1) {
      binary += String.fromCharCode(chunk[index]);
    }
  }
  return globalThis.btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
