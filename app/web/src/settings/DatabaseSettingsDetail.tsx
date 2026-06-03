import React from 'react';

type DatabaseSettingsDetailProps = {
  loading: boolean;
  error: string;
  dumpText: string;
};

export function DatabaseSettingsDetail({
  loading,
  error,
  dumpText,
}: DatabaseSettingsDetailProps) {
  return (
    <>
      {loading ? (
        <div className="muted block">Loading database...</div>
      ) : null}
      {error ? (
        <div className="error">Database error: {error}</div>
      ) : null}
      {!loading && !error ? (
        <pre className="settings-database-dump">{dumpText}</pre>
      ) : null}
    </>
  );
}
