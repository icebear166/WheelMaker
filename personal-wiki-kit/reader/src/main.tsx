import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import 'katex/dist/katex.min.css';
import './styles.css';
import {App} from './App';

const root = document.getElementById('root');
if (!root) throw new Error('missing application root');
createRoot(root).render(<App />);
