import React from 'react';
import { createRoot } from 'react-dom/client';
// Subset each weight to latin + latin-ext only. The all-subset CSS (e.g.
// 400.css) also pulls cyrillic/greek/vietnamese/hebrew/... in woff2+woff,
// which webpack emits as bundled assets; non-Latin glyphs fall back to the
// system stack anyway, so we ship only the subsets that can render here.
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-ext-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-ext-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-ext-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-ext-400.css';
import { App, workspaceAppReady } from './app/WorkspaceApp';
import { requestPersistentBrowserStorageOnStartup } from './platform/storagePersistence';
import './styles/index.css';

requestPersistentBrowserStorageOnStartup();

workspaceAppReady.then(() => {
  createRoot(document.getElementById('root')!).render(<App />);
}).catch(error => {
  const root = document.getElementById('root');
  if (!root) return;
  const message = error instanceof Error ? error.message : String(error);
  root.innerHTML = '';
  const box = document.createElement('div');
  box.style.cssText = 'padding:16px;color:#ff7b72;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;';
  box.textContent = `IndexedDB initialization failed: ${message}`;
  root.appendChild(box);
});
