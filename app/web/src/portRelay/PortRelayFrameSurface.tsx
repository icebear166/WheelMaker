import React from 'react';
import {Icon} from '../common/Icon';

type PortRelayFrameMode = 'desktop' | 'mobile';

type PortRelayFrameSurfaceProps = {
  mode: PortRelayFrameMode;
  url: string;
  chrome?: boolean;
  onCloseChrome: () => void;
  onOpenInBrowser: () => void;
};

export function PortRelayFrameSurface({
  mode,
  url,
  chrome = false,
  onCloseChrome,
  onOpenInBrowser,
}: PortRelayFrameSurfaceProps) {
  return (
    <div className={`port-relay-frame-surface ${mode}`}>
      {chrome ? (
        <div className="chat-preview-toolbar">
          <button
            type="button"
            className="chat-preview-icon-button"
            onClick={onCloseChrome}
            data-tooltip={mode === 'mobile' ? 'Back' : 'Close preview'}
            aria-label={mode === 'mobile' ? 'Back' : 'Close preview'}
          >
            <Icon name={mode === 'mobile' ? 'arrowLeft' : 'x'} size={16} />
          </button>
          <div className="chat-preview-title" data-tooltip={url}>{url}</div>
          <button
            type="button"
            className="chat-preview-icon-button"
            onClick={onOpenInBrowser}
            data-tooltip="Open relay page in browser"
            aria-label="Open relay page in browser"
          >
            <Icon name="externalLink" size={16} />
          </button>
        </div>
      ) : null}
      <iframe
        data-tooltip="Port Relay"
        src={url}
        className="port-relay-frame"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
