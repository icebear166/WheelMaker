export type ClientUpdateState =
  | {status: 'checking'}
  | {status: 'current'; currentVersion: string}
  | {status: 'available'; currentVersion: string; latestVersion: string}
  | {status: 'failed'}
  | {status: 'updating'; meta: string};

export type ClientUpdateView = {
  meta: string;
  disabled: boolean;
  showDot: boolean;
};

export function clientUpdateView(state: ClientUpdateState): ClientUpdateView {
  switch (state.status) {
    case 'checking':
      return {meta: 'Checking…', disabled: true, showDot: false};
    case 'current':
      return {
        meta: `${state.currentVersion || 'Unknown'} · Current`,
        disabled: true,
        showDot: false,
      };
    case 'available':
      return {
        meta: `${state.currentVersion || 'Unknown'} → ${state.latestVersion}`,
        disabled: false,
        showDot: true,
      };
    case 'updating':
      return {meta: state.meta, disabled: true, showDot: false};
    case 'failed':
      return {meta: 'Retry', disabled: false, showDot: false};
  }
}
