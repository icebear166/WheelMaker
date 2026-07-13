import type {
  RegistrySecretKind,
  RegistrySecretStatus,
  RegistrySecretUpdatePayload,
} from '../registry/registryTypes';

export type LegacyBackendSecrets = Partial<Record<RegistrySecretKind, string>>;

export type BackendSecretMigrationFailure = {
  kind: RegistrySecretKind;
  message: string;
};

const KNOWN_SECRET_KINDS: readonly RegistrySecretKind[] = [
  'deepseek',
  'volcengineAsr',
  'mimoTts',
];

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function migrateLegacyBackendSecrets(input: {
  legacy: LegacyBackendSecrets;
  statuses: RegistrySecretStatus[];
  updateSecret: (payload: RegistrySecretUpdatePayload) => Promise<void>;
  clearLegacySecret: (kind: RegistrySecretKind) => Promise<void>;
}): Promise<{failures: BackendSecretMigrationFailure[]}> {
  const statusByKind = new Map(input.statuses.map(status => [status.kind, status]));
  const failures: BackendSecretMigrationFailure[] = [];

  for (const kind of KNOWN_SECRET_KINDS) {
    const value = (input.legacy[kind] ?? '').trim();
    if (!value) continue;
    try {
      if (statusByKind.get(kind)?.configured !== true) {
        await input.updateSecret({kind, action: 'set', value});
      }
      await input.clearLegacySecret(kind);
    } catch (error) {
      failures.push({kind, message: errorMessage(error)});
    }
  }

  return {failures};
}

export const backendSecretLabel = (kind: RegistrySecretKind): string => {
  switch (kind) {
    case 'deepseek': return 'DeepSeek API Key';
    case 'volcengineAsr': return 'Volcengine ASR Access Token';
    case 'mimoTts': return 'MiMo TTS API Key';
  }
};

export const backendSecretKinds = KNOWN_SECRET_KINDS;
