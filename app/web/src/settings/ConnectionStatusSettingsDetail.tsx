import React from 'react';

import {
  resolveRegistryConnectionStatus,
  resolveVoiceCapabilityStatus,
} from './connectionStatus';

type ConnectionStatusSettingsDetailProps = {
  connected: boolean;
  reconnecting: boolean;
  autoConnecting: boolean;
  baseURL: string;
  speechEnabled: boolean;
  androidNativeHost: boolean;
  androidNativeAvailable: boolean;
};

export function ConnectionStatusSettingsDetail({
  connected,
  reconnecting,
  autoConnecting,
  baseURL,
  speechEnabled,
  androidNativeHost,
  androidNativeAvailable,
}: ConnectionStatusSettingsDetailProps) {
  const registryStatus = resolveRegistryConnectionStatus({
    connected,
    reconnecting,
    autoConnecting,
    baseURL,
  });
  const voiceStatus = resolveVoiceCapabilityStatus({
    speechEnabled,
    androidNativeHost,
    androidNativeAvailable,
  });

  return (
    <div className="settings-metadata-list settings-connection-status-list">
      <div className="settings-metadata-card">
        <div className="settings-metadata-line settings-metadata-line-tags">
          <span className="settings-metadata-title">Registry</span>
          <span className="agent-package-status">{registryStatus.label}</span>
        </div>
        <div className="settings-metadata-line settings-connection-value" data-tooltip={registryStatus.detail}>
          {registryStatus.detail}
        </div>
      </div>
      <div className="settings-metadata-card">
        <div className="settings-metadata-line settings-metadata-line-tags">
          <span className="settings-metadata-title">Voice Input</span>
          <span className="agent-package-status">{voiceStatus.label}</span>
        </div>
        <div className="settings-metadata-line settings-connection-value" data-tooltip={voiceStatus.detail}>
          {voiceStatus.detail}
        </div>
      </div>
    </div>
  );
}
