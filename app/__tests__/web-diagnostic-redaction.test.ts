import {sanitizeAppDiagnosticDetails} from '../web/src/debug/appDiagnostics';
import {redactDiagnosticValue} from '../web/src/debug/redaction';
import {redactRegistryDebugEnvelope} from '../web/src/debug/registryDebug';

describe('unified diagnostic redaction', () => {
  test('normalizes keys, recursively redacts secrets, and preserves explicit statistics', () => {
    const input = {
      registryToken: 'registry-secret',
      nested: [{
        api_key: 'api-secret',
        'set-cookie': 'cookie-secret',
        errorDetails: {app_secret: 'app-secret', credential: 'credential-secret'},
      }],
      tokenCount: 12,
      inputTokens: 8,
      output_tokens: 4,
      accessCodeGeneration: 3,
    };

    expect(redactDiagnosticValue(input)).toEqual({
      registryToken: '[redacted]',
      nested: [{
        api_key: '[redacted]',
        'set-cookie': '[redacted]',
        errorDetails: {app_secret: '[redacted]', credential: '[redacted]'},
      }],
      tokenCount: 12,
      inputTokens: 8,
      output_tokens: 4,
      accessCodeGeneration: 3,
    });
    expect(input.registryToken).toBe('registry-secret');
  });

  test('terminates safely for cycles, excessive depth, and excessive node counts', () => {
    const cyclic: Record<string, unknown> = {authorization: 'Bearer secret'};
    cyclic.self = cyclic;

    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let index = 0; index < 32; index += 1) {
      deep.next = {};
      deep = deep.next as Record<string, unknown>;
    }

    const wide = Array.from({length: 10_100}, (_, index) => ({index}));
    expect(() => redactDiagnosticValue({cyclic, root, wide})).not.toThrow();
    expect(redactDiagnosticValue(cyclic)).toEqual({authorization: '[redacted]', self: '[redacted]'});
  });

  test('redacts app, native-style, config, error, and registry envelope payloads', () => {
    const details = sanitizeAppDiagnosticDetails({
      native: {cookie: 'native-secret'},
      config: {appSecret: 'config-secret'},
      error: {details: {nonce: 'error-secret'}},
    });
    expect(JSON.stringify(details)).not.toContain('secret');

    const envelope = redactRegistryDebugEnvelope({
      requestId: 1,
      type: 'request' as const,
      method: 'connect.init',
      payload: {
        token: 'connect-secret',
        speech: {apiKey: 'speech-secret'},
        tts: {authorization: 'tts-secret'},
      },
    });
    expect(JSON.stringify(envelope)).not.toContain('connect-secret');
    expect(JSON.stringify(envelope)).not.toContain('speech-secret');
    expect(JSON.stringify(envelope)).not.toContain('tts-secret');
  });
});
