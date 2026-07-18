import React from 'react';

import {WHEELMAKER_RELEASE_BASE_URL} from './releaseChannel';
import type {RegistryReleasePublishResponse} from '../registry/registryTypes';

type Settings = {publisherHubId: string; sourcePath: string; serverHubId: string; autoPull: boolean; desktop: boolean; android: boolean; jobId: string; jobHubId: string};
const key = 'wheelmaker.settings.release-publish.v1';
const empty: Settings = {publisherHubId: '', sourcePath: '', serverHubId: '', autoPull: false, desktop: false, android: false, jobId: '', jobHubId: ''};

function load(): Settings { try { return {...empty, ...JSON.parse(window.localStorage.getItem(key) || '{}')}; } catch { return empty; } }

export function ReleasePublishSettings({hubIds, start, query}: {
  hubIds: string[];
  start: (hubId: string, input: Record<string, unknown>) => Promise<RegistryReleasePublishResponse>;
  query: (hubId: string, jobId: string) => Promise<RegistryReleasePublishResponse>;
}) {
  const [settings, setSettings] = React.useState<Settings>(load);
  const [job, setJob] = React.useState<RegistryReleasePublishResponse['job']>();
  const [error, setError] = React.useState('');
  const [pending, setPending] = React.useState(false);
  React.useEffect(() => { window.localStorage.setItem(key, JSON.stringify(settings)); }, [settings]);
  React.useEffect(() => {
    if (!settings.jobId || !settings.jobHubId) return;
    let stopped = false;
    const refresh = async () => { try { const result = await query(settings.jobHubId, settings.jobId); if (!stopped) { setJob(result.job); setError(result.ok ? '' : result.status); } } catch (value) { if (!stopped) setError(value instanceof Error ? value.message : String(value)); } };
    void refresh(); const timer = window.setInterval(() => void refresh(), 2_000); return () => { stopped = true; window.clearInterval(timer); };
  }, [query, settings.jobHubId, settings.jobId]);
  const update = (patch: Partial<Settings>) => setSettings(current => ({...current, ...patch}));
  const submit = async (kind: 'version' | 'debugWeb') => {
    if (!settings.publisherHubId || !settings.sourcePath || pending) return;
    setPending(true); setError('');
    try {
      const result = await start(settings.publisherHubId, {kind, sourcePath: settings.sourcePath, baseUrl: WHEELMAKER_RELEASE_BASE_URL, desktop: kind === 'version' && settings.desktop, android: kind === 'version' && settings.android, targetHubId: settings.serverHubId || undefined, autoPull: Boolean(settings.serverHubId && settings.autoPull)});
      if (!result.ok || !result.job) throw new Error(result.status || 'publish task was rejected');
      setJob(result.job); update({jobId: result.job.id, jobHubId: settings.publisherHubId});
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); } finally { setPending(false); }
  };
  const canStart = Boolean(settings.publisherHubId && settings.sourcePath) && !pending;
  return <div className="release-publish-page">
    <div className="release-publish-intro">Publish a version or the latest temporary Web build from a selected Hub.</div>
    <section className="release-publish-section" aria-label="Publish target">
      <div className="release-publish-section-title">Publish target</div>
      <div className="release-publish-fields">
        <label>Publishing Hub<select value={settings.publisherHubId} onChange={event => update({publisherHubId: event.target.value})}><option value="">Select Hub</option>{hubIds.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
        <label>Source path<input value={settings.sourcePath} onChange={event => update({sourcePath: event.target.value})} placeholder="Absolute source checkout path" /></label>
        <label>Server Hub<select value={settings.serverHubId} onChange={event => update({serverHubId: event.target.value, autoPull: event.target.value ? settings.autoPull : false})}><option value="">No automatic apply</option>{hubIds.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
        <label className="release-publish-check"><input type="checkbox" checked={settings.autoPull} disabled={!settings.serverHubId} onChange={event => update({autoPull: event.target.checked})} /> Auto pull after publish</label>
      </div>
    </section>
    <section className="release-publish-section" aria-label="Release options">
      <div className="release-publish-section-title">Release options</div>
      <div className="release-publish-options"><label><input type="checkbox" checked={settings.desktop} onChange={event => update({desktop: event.target.checked})} /> Include Desktop</label><label><input type="checkbox" checked={settings.android} onChange={event => update({android: event.target.checked})} /> Include Android</label></div>
      <div className="release-publish-actions"><button type="button" disabled={!canStart} onClick={() => void submit('version')}>Publish version</button><button type="button" disabled={!canStart} onClick={() => void submit('debugWeb')}>Publish temporary Web</button></div>
    </section>
    {job ? <section className="release-publish-section release-publish-job" aria-label="Publish task"><div className="release-publish-section-title">Publish task</div><pre>{job.status}{job.targetState ? ` · Server Hub: ${job.targetState}` : ''}{job.log ? `\n${job.log}` : ''}</pre></section> : null}
    {error ? <div className="settings-inline-error">{error}</div> : null}
  </div>;
}
