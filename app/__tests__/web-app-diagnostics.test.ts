import {
  appDiagnosticStore,
  createAppDiagnosticStore,
  filterAppDiagnosticRecords,
  formatAppDiagnosticRecordLine,
  serializeAppDiagnosticRecords,
} from '../web/src/debug/appDiagnostics';
import {drainNativeWebDiagnosticsToAppLog} from '../web/src/debug/nativeWebDiagnostics';
import {
  formatVoiceInputDiagnosticError,
  logVoiceInputDiagnostic,
} from '../web/src/features/speech/voiceInputDiagnostics';

describe('app diagnostics', () => {
  afterEach(() => {
    appDiagnosticStore.clear();
    jest.restoreAllMocks();
  });

  test('stores recent warning and error diagnostics by category', () => {
    const store = createAppDiagnosticStore(() => 1000);
    store.record({category: 'voice', level: 'debug', event: 'start_requested'});
    store.record({category: 'voice', level: 'warn', event: 'finish_without_stream'});
    store.record({category: 'voice', level: 'error', event: 'start_failed'});

    const records = filterAppDiagnosticRecords(store.getRecords(), {
      category: 'voice',
      levels: ['warn', 'error'],
    });

    expect(records.map(record => record.event)).toEqual([
      'finish_without_stream',
      'start_failed',
    ]);
  });

  test('formats workspace diagnostics as compact one-line records', () => {
    const store = createAppDiagnosticStore(() => new Date(2026, 0, 1, 0, 0, 1).getTime());
    store.record({
      category: 'workspace',
      level: 'info',
      event: 'select_session',
      details: {
        projectId: 'hub-a:app',
        sessionId: 'session-1',
        durationMs: 42,
        skipped: false,
      },
    });

    const [record] = store.getRecords();
    const line = formatAppDiagnosticRecordLine(record);

    expect(line).toBe(
      '00:00:01.000 info workspace select_session projectId=hub-a:app sessionId=session-1 durationMs=42 skipped=false',
    );
    expect(line).not.toContain('\n');
    expect(serializeAppDiagnosticRecords([record])).toBe(`${line}\n`);
  });

  test('voice diagnostics redact sensitive fields before storing and logging', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    logVoiceInputDiagnostic('warn', 'start_ignored', {
      apiKey: 'secret-key',
      streamId: 'stream-1',
      pcm: 'audio-data',
      connected: true,
    });

    const loggedPayload = warnSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(loggedPayload.apiKey).toBe('[redacted]');
    expect(loggedPayload.streamId).toBe('[redacted]');
    expect(loggedPayload.pcm).toBe('[omitted]');
    expect(loggedPayload.connected).toBe(true);
  });

  test('voice diagnostics do not record debug entries', () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);

    logVoiceInputDiagnostic('debug', 'start_requested', {
      connected: true,
    });

    expect(appDiagnosticStore.getRecords()).toEqual([]);
    expect(debugSpy).not.toHaveBeenCalled();
  });

  test('includes registry error details in voice diagnostic error messages', () => {
    const error = new Error('speech provider start failed') as Error & {details?: unknown};
    error.details = {error: 'speech provider unavailable'};

    expect(formatVoiceInputDiagnosticError(error)).toBe(
      'speech provider start failed: speech provider unavailable',
    );
  });

  test('drains native Web diagnostics into HTTP app diagnostics', async () => {
    const bridge = {
      drainWebDiagnostics: jest.fn(() => Promise.resolve({
        records: [
          {
            level: 'info',
            event: 'android_web',
            details: {
              nativeEvent: 'remote_asset_success',
              asset: 'index.html',
              status: 200,
            },
          },
        ],
      })),
    };

    const count = await drainNativeWebDiagnosticsToAppLog(bridge);

    expect(count).toBe(1);
    expect(appDiagnosticStore.getRecords()).toEqual([
      expect.objectContaining({
        category: 'http',
        level: 'info',
        event: 'android_web',
        details: {
          nativeEvent: 'remote_asset_success',
          asset: 'index.html',
          status: 200,
        },
      }),
    ]);
  });
});
