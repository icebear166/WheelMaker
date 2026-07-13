export type ConnectionStatusLine = {
  label: string;
  detail: string;
};

export function resolveRegistryConnectionStatus({
  connected,
  reconnecting,
  autoConnecting,
  baseURL,
}: {
  connected: boolean;
  reconnecting: boolean;
  autoConnecting: boolean;
  baseURL: string;
}): ConnectionStatusLine {
  if (connected) {
    return {
      label: 'Connected',
      detail: baseURL || 'Page base URL unavailable',
    };
  }
  if (reconnecting) {
    return {
      label: 'Reconnecting',
      detail: baseURL || 'Page base URL unavailable',
    };
  }
  if (autoConnecting) {
    return {
      label: 'Connecting',
      detail: baseURL || 'Page base URL unavailable',
    };
  }
  return {
    label: 'Disconnected',
    detail: baseURL || 'Page base URL unavailable',
  };
}

export function resolveVoiceCapabilityStatus({
  speechEnabled,
  androidNativeHost,
  androidNativeAvailable,
}: {
  speechEnabled: boolean;
  androidNativeHost: boolean;
  androidNativeAvailable: boolean;
}): ConnectionStatusLine {
  if (!speechEnabled) {
    return {
      label: 'Disabled',
      detail: 'Voice input is off',
    };
  }
  if (androidNativeAvailable) {
    return {
      label: 'Android Native',
      detail: 'APK microphone capture, direct Doubao connection',
    };
  }
  if (androidNativeHost) {
    return {
      label: 'Unavailable',
      detail: 'Android native speech bridge is missing',
    };
  }
  return {
    label: 'Registry',
    detail: 'Registry speech bridge',
  };
}
