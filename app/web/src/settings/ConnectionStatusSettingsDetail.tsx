import React from 'react';

import {
  resolveRegistryConnectionStatus,
  resolveVoiceCapabilityStatus,
  resolveWebResourceConnectionStatus,
} from './connectionStatus';
import type {LocalHubReadStatus} from '../registry/localRead/LocalHubReadManager';
import type {NativeWebSourceState} from '../platform/native/webSource';
import type {RegistryHub} from '../types/registry';

type ConnectionStatusSettingsDetailProps = {
  webSourceState: NativeWebSourceState | null;
  connected: boolean;
  reconnecting: boolean;
  autoConnecting: boolean;
  address: string;
  speechEnabled: boolean;
  androidNativeHost: boolean;
  androidNativeAvailable: boolean;
  localHubReadEnabled: boolean;
  registryHubs: RegistryHub[];
  localHubReadStatuses: Record<string, LocalHubReadStatus>;
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
  localHubReadEnabled,
  registryHubs,
  localHubReadStatuses,
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
      <div className="settings-metadata-card">
        <div className="settings-metadata-line settings-metadata-line-tags">
          <span className="settings-metadata-title">Local Hub Read</span>
          <span className="agent-package-status">{localHubReadEnabled ? 'Enabled' : 'Disabled'}</span>
        </div>
        {registryHubs.length === 0 ? (
          <div className="settings-metadata-line">No hubs available.</div>
        ) : (
          registryHubs.map(hub => {
            const readStatus = localHubReadStatuses[hub.hubId] ?? 'Remote';
            return (
              <div key={`connection-hub:${hub.hubId}`} className="settings-metadata-line settings-metadata-line-tags">
                <span className="settings-metadata-title" title={hub.hubId}>{hub.hubId}</span>
                <span className={`chat-hub-read-tag ${readStatus.toLowerCase()}`}>{readStatus}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
