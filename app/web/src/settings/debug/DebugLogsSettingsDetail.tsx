import React, {useCallback, useEffect, useMemo, useState} from 'react';

import {
  appDiagnosticLevelsAtOrAbove,
  appDiagnosticStore,
  filterAppDiagnosticRecords,
  formatAppDiagnosticRecordLine,
  serializeAppDiagnosticRecords,
  type AppDiagnosticCategory,
  type AppDiagnosticLogLevel,
  type AppDiagnosticRecord,
} from '../../debug/appDiagnostics';
import {drainNativeWebDiagnosticsToAppLog} from '../../debug/nativeWebDiagnostics';
import {startWorkspaceDiagnosticSpan} from '../../debug/workspaceDiagnostics';
import type {
  RegistryDebugUploadLogPayload,
  RegistryDebugUploadLogResponse,
} from '../../types/registry';

type DebugLogsSettingsDetailProps = {
  logLevel: AppDiagnosticLogLevel;
  uploadDebugLog: (payload: RegistryDebugUploadLogPayload) => Promise<RegistryDebugUploadLogResponse>;
};

let lastSelectedDiagnosticCategory: AppDiagnosticCategory = 'http';

export function DebugLogsSettingsDetail({
  logLevel,
  uploadDebugLog,
}: DebugLogsSettingsDetailProps) {
  const [appDiagnosticRecords, setAppDiagnosticRecords] = useState<AppDiagnosticRecord[]>(() => appDiagnosticStore.getRecords());
  const [selectedDiagnosticCategory, setSelectedDiagnosticCategoryState] = useState<AppDiagnosticCategory>(
    () => lastSelectedDiagnosticCategory,
  );
  const [debugLogUploading, setDebugLogUploading] = useState(false);
  const [debugLogUploadMessage, setDebugLogUploadMessage] = useState('');

  const setSelectedDiagnosticCategory = useCallback((next: AppDiagnosticCategory) => {
    lastSelectedDiagnosticCategory = next;
    setSelectedDiagnosticCategoryState(next);
  }, []);

  useEffect(() => appDiagnosticStore.subscribe(setAppDiagnosticRecords), []);

  useEffect(() => {
    void drainNativeWebDiagnosticsToAppLog();
  }, [logLevel]);

  const records = useMemo(
    () => filterAppDiagnosticRecords(appDiagnosticRecords, {
      category: selectedDiagnosticCategory,
      levels: appDiagnosticLevelsAtOrAbove(logLevel),
    }),
    [appDiagnosticRecords, logLevel, selectedDiagnosticCategory],
  );

  const uploadDebugLogs = useCallback(async () => {
    await drainNativeWebDiagnosticsToAppLog();
    const records = filterAppDiagnosticRecords(appDiagnosticStore.getRecords(), {
      category: selectedDiagnosticCategory,
      levels: appDiagnosticLevelsAtOrAbove(logLevel),
    });
    if (records.length === 0 || debugLogUploading) {
      return;
    }
    const finish = startWorkspaceDiagnosticSpan('upload_debug_log', {
      category: selectedDiagnosticCategory,
      count: records.length,
    });
    setDebugLogUploading(true);
    setDebugLogUploadMessage('');
    try {
      const result = await uploadDebugLog({
        source: 'web',
        text: serializeAppDiagnosticRecords(records),
      });
      finish({ok: result.ok, fileName: result.fileName});
      setDebugLogUploadMessage(result.fileName ? `Uploaded ${result.fileName}` : 'Uploaded');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      finish({ok: false, error: message}, 'error');
      setDebugLogUploadMessage(message);
    } finally {
      setDebugLogUploading(false);
    }
  }, [debugLogUploading, logLevel, selectedDiagnosticCategory, uploadDebugLog]);

  return (
    <div className="debug-log-detail">
      <div className="debug-log-list" aria-live="polite">
        {records.length === 0 ? (
          <div className="debug-log-empty">No logs yet.</div>
        ) : (
          records.map(record => (
            <div
              key={record.id}
              className={`debug-log-line ${record.level}`}
              title={formatAppDiagnosticRecordLine(record)}
            >
              {formatAppDiagnosticRecordLine(record)}
            </div>
          ))
        )}
      </div>
      <div className="debug-log-detail-footer">
        <label className="debug-log-category-label">
          <span>Category</span>
          <select
            className="sidebar-setting-select"
            value={selectedDiagnosticCategory}
            onChange={event => setSelectedDiagnosticCategory(event.target.value as AppDiagnosticCategory)}
          >
            <option value="http">HTTP</option>
            <option value="workspace">Workspace</option>
            <option value="voice">Voice</option>
          </select>
        </label>
        <div className="debug-log-actions">
          <button
            type="button"
            className="settings-detail-action-btn"
            disabled={records.length === 0 || debugLogUploading}
            onClick={() => uploadDebugLogs().catch(() => undefined)}
          >
            {debugLogUploading ? 'Uploading...' : 'Upload Log'}
          </button>
          {debugLogUploadMessage ? (
            <span className="debug-log-upload-status">{debugLogUploadMessage}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
