import React from 'react';

import {
  resolveRegistryConnectionStatus,
  resolveVoiceCapabilityStatus,
  resolveWebResourceConnectionStatus,
} from './connectionStatus';
import type {NativeWebSourceState} from '../platform/native/webSource';

type ConnectionStatusSettingsDetailProps = {
  webSourceState: NativeWebSourceState | null;
  connected: boolean;
  reconnecting: boolean;
  autoConnecting: boolean;
  address: string;
  speechEnabled: boolean;
  androidNativeHost: boolean;
  androidNativeAvailable: boolean;
};

export function ConnectionStatusSettingsDetail({
  webSourceState,
  connected,
  reconnecting,
  autoConnecting,
  address,
  speechEnabled,
  androidNativeHost,
  androidNativeAvailable,
}: ConnectionStatusSettingsDetailProps) {
  const webStatus = resolveWebResourceConnectionStatus(webSourceState);
  const registryStatus = resolveRegistryConnectionStatus({
    connected,
    reconnecting,
    autoConnecting,
    address,
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
        <div className="settings-metadata-line settings-connection-value" title={registryStatus.detail}>
          {registryStatus.detail}
        </div>
      </div>
      <div className="settings-metadata-card">
        <div className="settings-metadata-line settings-metadata-line-tags">
          <span className="settings-metadata-title">Web Resources</span>
          <span className="agent-package-status">{webStatus.label}</span>
        </div>
        <div className="settings-metadata-line settings-connection-value" title={webStatus.detail}>
          {webStatus.detail}
        </div>
        {webStatus.remoteUrl ? (
          <div className="settings-metadata-line settings-connection-value" title={webStatus.remoteUrl}>
            Remote URL: {webStatus.remoteUrl}
          </div>
        ) : null}
      </div>
      <div className="settings-metadata-card">
        <div className="settings-metadata-line settings-metadata-line-tags">
          <span className="settings-metadata-title">Voice Input</span>
          <span className="agent-package-status">{voiceStatus.label}</span>
        </div>
        <div className="settings-metadata-line settings-connection-value" title={voiceStatus.detail}>
          {voiceStatus.detail}
        </div>
      </div>
    </div>
  );
}
