import {
  SHARE_RAW_HTML_MAX_BYTES,
  compressShareContent,
  preflightShareEnvelope,
  utf8ByteLength,
} from '../web/src/shares/shareCompression';

describe('share compression', () => {
  test('counts UTF-8 bytes rather than JavaScript code units', () => {
    expect(utf8ByteLength('你好')).toBe(6);
  });

  test('gzip/base64 round trip produces an encoded payload', async () => {
    const result = await compressShareContent('<html><body>hello</body></html>');
    expect(result.rawBytes).toBeGreaterThan(0);
    expect(result.compressedBytes).toBeGreaterThan(0);
    expect(result.content).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  test('consumes compression output while writes are backpressured', async () => {
    let state = 0x12345678;
    let html = '';
    for (let index = 0; index < 64 * 1024; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      html += String.fromCharCode(33 + ((state >>> 0) % 94));
    }
    const result = await Promise.race([
      compressShareContent(html),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('compression did not drain output')), 500);
      }),
    ]);
    expect(result.compressedBytes).toBeGreaterThan(0);
  });

  test('rejects browsers without CompressionStream', async () => {
    const original = (globalThis as typeof globalThis & {CompressionStream?: unknown}).CompressionStream;
    Object.defineProperty(globalThis, 'CompressionStream', {value: undefined, configurable: true});
    await expect(compressShareContent('hello')).rejects.toThrow(/CompressionStream/);
    Object.defineProperty(globalThis, 'CompressionStream', {value: original, configurable: true});
  });

  test('rejects raw content over 16 MiB before compression', async () => {
    await expect(compressShareContent('x'.repeat(SHARE_RAW_HTML_MAX_BYTES + 1)))
      .rejects.toThrow(/16 MiB/);
  });

  test('preflights the complete Registry envelope', () => {
    const content = 'A'.repeat(1024);
    const payload = {
      projectId: 'hub:project', path: 'docs/readme.md', kind: 'markdown' as const,
      title: 'Readme', expiry: '1d' as const, encoding: 'gzip+base64' as const, content,
    };
    expect(preflightShareEnvelope(payload)).toBeGreaterThan(content.length);
    expect(() => preflightShareEnvelope({...payload, content: 'A'.repeat(17 * 1024 * 1024)}))
      .toThrow(/Registry message|16 MiB/);
  });
});
