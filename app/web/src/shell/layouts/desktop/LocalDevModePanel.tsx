import React, {useCallback, useEffect, useState} from 'react';
import {Icon, type IconName} from '../../../common/Icon';
import {
  getDesktopWindowBridge,
  openLocalDevPanelEvent,
  type DesktopLocalDevOperation,
  type DesktopLocalDevState,
} from '../../../platform/desktop/desktopRuntime';

const operations: Array<{operation: DesktopLocalDevOperation; label: string; icon: IconName; tone?: string}> = [
  {operation: 'build', label: 'Build', icon: 'package'},
  {operation: 'start', label: 'Start', icon: 'play'},
  {operation: 'stop', label: 'Stop', icon: 'square'},
  {operation: 'restart', label: 'Restart', icon: 'power'},
  {operation: 'open-directory', label: 'Open artifacts', icon: 'folderOpen'},
  {operation: 'exit', label: 'Exit Local Dev', icon: 'logOut', tone: 'danger'},
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function LocalDevModePanel() {
  const localDev = getDesktopWindowBridge()?.localDev;
  const [visible, setVisible] = useState(Boolean(localDev));
  const [state, setState] = useState<DesktopLocalDevState | null>(null);
  const [sourcePath, setSourcePath] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!localDev) return;
    let active = true;
    void localDev.getState().then(next => {
      if (!active) return;
      setState(next);
      setSourcePath(next.sourcePath);
    }).catch(error => active && setMessage(errorMessage(error)));
    return () => { active = false; };
  }, [localDev]);

  useEffect(() => {
    if (!localDev || typeof window.addEventListener !== 'function') return;
    const open = () => setVisible(true);
    window.addEventListener(openLocalDevPanelEvent, open);
    return () => window.removeEventListener(openLocalDevPanelEvent, open);
  }, [localDev]);

  const perform = useCallback(async (operation: DesktopLocalDevOperation) => {
    if (!localDev || busy) return;
    setBusy(operation);
    setMessage('');
    try {
      const next = await localDev.run(operation);
      setState(next);
      setSourcePath(next.sourcePath);
      setMessage(next.message ?? `${operation} completed`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy('');
    }
  }, [busy, localDev]);

  const saveSource = useCallback(async () => {
    if (!localDev || busy) return;
    setBusy('save');
    setMessage('');
    try {
      const next = await localDev.saveSource(sourcePath.trim());
      setState(next);
      setSourcePath(next.sourcePath);
      setMessage(next.message ?? 'Source directory saved');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy('');
    }
  }, [busy, localDev, sourcePath]);

  if (!localDev || !visible) return null;

  return (
    <aside className="local-dev-panel" aria-label="Local development" data-desktop-window-interactive={true}>
      <header className="local-dev-panel-header">
        <div>
          <span className="local-dev-eyebrow">Windows extension</span>
          <h2>Local development</h2>
        </div>
        <div className="local-dev-panel-heading-actions">
          <span className={`local-dev-status ${state?.running ? 'running' : ''}`} data-local-dev-status={true}>
            <span aria-hidden="true" />{state?.running ? 'Running' : 'Stopped'}
          </span>
          <button type="button" className="local-dev-close" aria-label="Close Local Dev panel" onClick={() => setVisible(false)}>
            <Icon name="x" />
          </button>
        </div>
      </header>

      <section className="local-dev-source">
        <label htmlFor="local-dev-source">WheelMaker source</label>
        <p>Choose the repository containing app, server, and scripts.</p>
        <div className="local-dev-source-row">
          <input
            id="local-dev-source"
            aria-label="WheelMaker source directory"
            value={sourcePath}
            spellCheck={false}
            onChange={event => setSourcePath(event.target.value)}
          />
          <button type="button" disabled={Boolean(busy)} onClick={saveSource}>Save</button>
        </div>
      </section>

      <section className="local-dev-actions" aria-label="Local Dev actions">
        {operations.map(item => (
          <button
            key={item.operation}
            type="button"
            className={item.tone === 'danger' ? 'danger' : undefined}
            data-local-dev-operation={item.operation}
            disabled={Boolean(busy)}
            onClick={() => void perform(item.operation)}
          >
            <Icon name={item.icon} filled={item.icon === 'square'} />
            <span>{busy === item.operation ? 'Working…' : item.label}</span>
          </button>
        ))}
      </section>

      <footer className="local-dev-panel-footer">
        <code>~/.wheelmaker/dev</code>
        {message ? <p role="status">{message}</p> : null}
      </footer>
    </aside>
  );
}
