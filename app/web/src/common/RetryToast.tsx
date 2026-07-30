import React from 'react';

import {Icon} from './Icon';

export function RetryToast({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="app-retry-toast" role="alert" aria-live="assertive">
      <span className="app-retry-toast-message">{message}</span>
      <button type="button" onClick={onRetry} aria-label="Retry Skill action">Retry</button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss Skill error">
        <Icon name="x" />
      </button>
    </div>
  );
}
