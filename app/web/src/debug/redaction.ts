export const REDACTED_DIAGNOSTIC_VALUE = '[redacted]';

const MAX_REDACTION_DEPTH = 16;
const MAX_REDACTION_NODES = 10_000;

const REDACTION_ALLOWLIST = new Set([
  'accesscodegeneration',
  'cachedinputtokens',
  'inputtokens',
  'outputtokens',
  'reasoningtokens',
  'tokencount',
  'totaltokens',
]);

const SENSITIVE_KEY_SUFFIXES = [
  'authorization',
  'credential',
  'accesscode',
  'password',
  'setcookie',
  'appsecret',
  'apikey',
  'cookie',
  'secret',
  'token',
  'nonce',
  'csrf',
];

const OMITTED_PAYLOAD_KEYS = new Set(['pcm', 'base64']);

function normalizeDiagnosticKey(key: string): string {
  return key.trim().toLowerCase().replace(/[-_.]/g, '');
}

function isSensitiveDiagnosticKey(key: string): boolean {
  const normalized = normalizeDiagnosticKey(key);
  if (REDACTION_ALLOWLIST.has(normalized)) {
    return false;
  }
  return SENSITIVE_KEY_SUFFIXES.some(suffix => normalized.endsWith(suffix));
}

export function redactDiagnosticValue(
	value: unknown,
	additionalSensitiveKeys: readonly string[] = [],
): unknown {
  const seen = new WeakSet<object>();
	const extraSensitiveKeys = new Set(additionalSensitiveKeys.map(normalizeDiagnosticKey));
  let nodes = 0;

  const visit = (input: unknown, depth: number): unknown => {
    if (depth > MAX_REDACTION_DEPTH || nodes >= MAX_REDACTION_NODES) {
      return REDACTED_DIAGNOSTIC_VALUE;
    }
    nodes += 1;
    if (!input || typeof input !== 'object') {
      return input;
    }
    if (seen.has(input)) {
      return REDACTED_DIAGNOSTIC_VALUE;
    }
    seen.add(input);

    if (Array.isArray(input)) {
      return input.map(item => visit(item, depth + 1));
    }

    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
		if (isSensitiveDiagnosticKey(key) || extraSensitiveKeys.has(normalizeDiagnosticKey(key))) {
        output[key] = REDACTED_DIAGNOSTIC_VALUE;
      } else if (OMITTED_PAYLOAD_KEYS.has(normalizeDiagnosticKey(key))) {
        output[key] = '[omitted]';
      } else {
        output[key] = visit(item, depth + 1);
      }
    }
    return output;
  };

  return visit(value, 0);
}
