import {appDiagnosticStore, sanitizeAppDiagnosticDetails} from './appDiagnostics';
import type {AppDiagnosticLevel} from './appDiagnostics';

type WorkspaceDiagnosticLevel = Extract<AppDiagnosticLevel, 'info' | 'warn' | 'error'>;

export function logWorkspaceDiagnostic(
  level: WorkspaceDiagnosticLevel,
  event: string,
  details: Record<string, unknown> = {},
): void {
  appDiagnosticStore.record({
    category: 'workspace',
    level,
    event,
    details: sanitizeAppDiagnosticDetails(details),
  });
}

export function startWorkspaceDiagnosticSpan(
  event: string,
  details: Record<string, unknown> = {},
  now: () => number = () => Date.now(),
): (extraDetails?: Record<string, unknown>, level?: WorkspaceDiagnosticLevel) => void {
  const startedAt = now();
  let finished = false;
  return (extraDetails: Record<string, unknown> = {}, level: WorkspaceDiagnosticLevel = 'info') => {
    if (finished) {
      return;
    }
    finished = true;
    logWorkspaceDiagnostic(level, event, {
      ...details,
      ...extraDetails,
      durationMs: Math.max(0, Math.round(now() - startedAt)),
    });
  };
}
