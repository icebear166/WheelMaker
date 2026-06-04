import React from 'react';
import { createRoot } from 'react-dom/client';
import '@vscode/codicons/dist/codicon.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import { App, workspaceAppReady } from './app/WorkspaceApp';
import './styles.css';

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