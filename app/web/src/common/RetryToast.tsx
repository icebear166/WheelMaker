import React from 'react';

import {Icon} from './Icon';

export function RetryToast({
  message,
  onRetry,
  onDismiss,
  preserveChatHubMenu = false,
}: {
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
  preserveChatHubMenu?: boolean;
}) {
  return (
    <div
      className="app-retry-toast"
      role="alert"
      aria-live="assertive"
      data-chat-hub-owned-overlay={preserveChatHubMenu ? 'true' : undefined}
    >
      <span className="app-retry-toast-message">{message}</span>
      <button type="button" onClick={onRetry} aria-label="Retry Skill action">Retry</button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss Skill error">
        <Icon name="x" />
      </button>
    </div>
  );
}
