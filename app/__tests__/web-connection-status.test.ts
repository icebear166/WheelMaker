import {
  resolveRegistryConnectionStatus,
  resolveVoiceCapabilityStatus,
} from '../web/src/settings/connectionStatus';

describe('connection settings status model', () => {
  test('describes registry connection state', () => {
    expect(resolveRegistryConnectionStatus({
      connected: true,
      reconnecting: false,
      autoConnecting: false,
      baseURL: 'https://registry.example/',
    })).toEqual({
      label: 'Connected',
      detail: 'https://registry.example/',
    });

    expect(resolveRegistryConnectionStatus({
      connected: false,
      reconnecting: true,
      autoConnecting: false,
      baseURL: 'https://registry.example/',
    }).label).toBe('Reconnecting');
  });

  test('describes voice capability source without falling back from Android native', () => {
    expect(resolveVoiceCapabilityStatus({
      speechEnabled: true,
      androidNativeHost: true,
      androidNativeAvailable: true,
    })).toEqual({
      label: 'Android Native',
      detail: 'APK microphone capture, direct Doubao connection',
    });

    expect(resolveVoiceCapabilityStatus({
      speechEnabled: true,
      androidNativeHost: true,
      androidNativeAvailable: false,
    })).toEqual({
      label: 'Unavailable',
      detail: 'Android native speech bridge is missing',
    });

    expect(resolveVoiceCapabilityStatus({
      speechEnabled: true,
      androidNativeHost: false,
      androidNativeAvailable: false,
    })).toEqual({
      label: 'Registry',
      detail: 'Registry speech bridge',
    });
  });
});
