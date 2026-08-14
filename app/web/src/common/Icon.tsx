import React from 'react';

// Glyph bodies are Lucide icon inner SVG nodes (24x24 viewBox, stroke-based,
// 1.5px stroke, round caps). Geometry only — stroke/fill are applied once at the
// <svg> renderer level. Verify/replace shapes with `better-icons get lucide:<id>`
// output if one looks off — ids noted per entry.
const GLYPHS = {
  // lucide:plus
  plus: (<><path d="M5 12h14" /><path d="M12 5v14" /></>),
  // lucide:minus
  minus: (<><path d="M5 12h14" /></>),
  // lucide:x
  x: (<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>),
  // lucide:check
  check: (<><path d="M20 6 9 17l-5-5" /></>),
  // lucide:chevron-down
  chevronDown: (<><path d="m6 9 6 6 6-6" /></>),
  // lucide:chevron-up
  chevronUp: (<><path d="m18 15-6-6-6 6" /></>),
  // lucide:chevron-right
  chevronRight: (<><path d="m9 18 6-6-6-6" /></>),
  // lucide:search
  search: (<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>),
  // lucide:folder
  folder: (<><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></>),
  // lucide:folder-open
  folderOpen: (<><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" /></>),
  // lucide:pin (verified via better-icons)
  pin: (<><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></>),
  // lucide:panel-left
  panelLeft: (<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /></>),
  // lucide:panel-left-close
  panelLeftClose: (<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /><path d="m16 15-3-3 3-3" /></>),
  // lucide:import (verified via better-icons)
  import: (<><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" /></>),
  // lucide:clock (verified via better-icons)
  clock: (<><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>),
  // lucide:archive
  archive: (<><rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></>),
  // lucide:archive-restore (verified via better-icons)
  archiveRestore: (<><rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h2" /><path d="M20 8v11a2 2 0 0 1-2 2h-2" /><path d="m9 15 3-3 3 3" /><path d="M12 12v9" /></>),
  // lucide:pencil
  pencil: (<><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></>),
  // lucide:refresh-cw
  refreshCw: (<><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></>),
  // lucide:circle-arrow-up (verified via better-icons)
  circleArrowUp: (<><circle cx="12" cy="12" r="10" /><path d="m16 12-4-4-4 4" /><path d="M12 16V8" /></>),
  // lucide:power (verified via better-icons)
  power: (<><path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.77.04" /></>),
  // lucide:trash-2
  trash: (<><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></>),
  // lucide:arrow-left
  arrowLeft: (<><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>),
  // lucide:settings (verified via better-icons)
  settings: (<><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 1 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /><circle cx="12" cy="12" r="3" /></>),
  // lucide:sparkles
  sparkles: (<><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /><path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" /></>),
  // lucide:wand-sparkles
  wand: (<><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" /><path d="m14 7 3 3" /><path d="M5 6v4" /><path d="M19 14v4" /><path d="M10 2v2" /><path d="M7 8H3" /><path d="M21 16h-4" /><path d="M11 3H9" /></>),
  // lucide:inbox
  inbox: (<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>),
  // lucide:loader-circle
  loader: (<><path d="M21 12a9 9 0 1 1-6.219-8.56" /></>),
  // lucide:circle-help
  help: (<><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>),
  // lucide:ban
  ban: (<><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></>),
  // lucide:eye (verified via better-icons)
  eye: (<><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></>),
  // lucide:list (verified via better-icons)
  list: (<><path d="M3 5h.01" /><path d="M3 12h.01" /><path d="M3 19h.01" /><path d="M8 5h13" /><path d="M8 12h13" /><path d="M8 19h13" /></>),
  // lucide:arrow-right
  arrowRight: (<><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>),
  // lucide:circle
  circle: (<><circle cx="12" cy="12" r="10" /></>),
  // lucide:target
  target: (<><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>),
  // lucide:pause
  pause: (<><rect width="5" height="18" x="14" y="3" rx="1" /><rect width="5" height="18" x="5" y="3" rx="1" /></>),
  // lucide:play
  play: (<><path d="m6 3 14 9-14 9z" /></>),
  // lucide:square
  square: (<><rect width="18" height="18" x="3" y="3" rx="2" /></>),
  // lucide:eye-off
  eyeOff: (<><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" /><path d="m2 2 20 20" /></>),
  // lucide:layout-grid
  layoutGrid: (<><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></>),
  // lucide:terminal
  terminal: (<><path d="m4 17 6-6-6-6" /><path d="M12 19h8" /></>),
  // lucide:panel-right
  panelRight: (<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" /></>),
  // lucide:panel-right-open
  panelRightOpen: (<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" /><path d="m10 15-3-3 3-3" /></>),
  // lucide:panel-right-close
  panelRightClose: (<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" /><path d="m8 9 3 3-3 3" /></>),
  // lucide:maximize
  maximize: (<><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></>),
  // lucide:app-window
  appWindow: (<><rect width="20" height="16" x="2" y="4" rx="2" /><path d="M10 4v4" /><path d="M2 8h20" /><path d="M6 4v4" /></>),
  // lucide:history
  history: (<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></>),
  // lucide:list-checks
  listChecks: (<><path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /><path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" /></>),
  // lucide:info (verified via better-icons)
  info: (<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>),
  // lucide:link (verified via better-icons)
  link: (<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>),

  // --- settings glyphs ---
  // lucide:moon
  moon: (<><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" /></>),
  // lucide:sun
  sun: (<><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></>),
  // lucide:palette
  palette: (<><g><path d="M12 22a1 1 0 0 1 0-20a10 9 0 0 1 10 9a5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" /><circle cx="13.5" cy="6.5" r=".5" /><circle cx="17.5" cy="10.5" r=".5" /><circle cx="6.5" cy="12.5" r=".5" /><circle cx="8.5" cy="7.5" r=".5" /></g></>),
  // lucide:message-circle
  messageCircle: (<><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092a10 10 0 1 0-4.777-4.719" /></>),
  // lucide:server
  server: (<><g><rect x="2" y="2" rx="2" ry="2" /><rect x="2" y="14" rx="2" ry="2" /><path d="M6 6h.01M6 18h.01" /></g></>),
  // lucide:radio-tower
  radioTower: (<><g><path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9m2.9 2.8a6.14 6.14 0 0 0-.8 7.5" /><circle cx="12" cy="9" r="2" /><path d="M16.2 4.8c2 2 2.26 5.11.8 7.47M19.1 1.9a9.96 9.96 0 0 1 0 14.1m-9.6 2h5M8 22l4-11l4 11" /></g></>),
  // lucide:code
  code: (<><path d="m16 18l6-6l-6-6M8 6l-6 6l6 6" /></>),
  // lucide:bug
  bug: (<><g><path d="M12 20v-9m2-4a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4zm.12-3.12L16 2" /><path d="M21 21a4 4 0 0 0-3.81-4M21 5a4 4 0 0 1-3.55 3.97M22 13h-4M3 21a4 4 0 0 1 3.81-4M3 5a4 4 0 0 0 3.55 3.97M6 13H2M8 2l1.88 1.88M9 7.13V6a3 3 0 1 1 6 0v1.13" /></g></>),
  // lucide:activity
  activity: (<><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" /></>),
  // lucide:keyboard
  keyboard: (<><g><path d="M10 8h.01M12 12h.01M14 8h.01M16 12h.01M18 8h.01M6 8h.01M7 16h10m-9-4h.01" /><rect x="2" y="4" rx="2" /></g></>),
  // lucide:bell
  bell: (<><path d="M10.268 21a2 2 0 0 0 3.464 0m-10.47-5.674A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></>),
  // lucide:mic
  mic: (<><g><path d="M12 19v3m7-12v2a7 7 0 0 1-14 0v-2" /><rect x="9" y="2" rx="3" /></g></>),
  // lucide:volume-2
  volume2: (<><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298zM16 9a5 5 0 0 1 0 6m3.364 3.364a9 9 0 0 0 0-12.728" /></>),
  // lucide:bot
  bot: (<><g><path d="M12 8V4H8" /><rect x="4" y="8" rx="2" /><path d="M2 14h2m16 0h2m-7-1v2m-6-2v2" /></g></>),
  // lucide:user-round (filled persona mark)
  userRound: (<><g><circle fill="currentColor" cx="12" cy="8" r="5" /><path fill="currentColor" d="M20 21a8 8 0 0 0-16 0" /></g></>),
  // lucide:key-round
  keyRound: (<><g><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" /><circle cx="16.5" cy="7.5" r=".5" /></g></>),
  // lucide:swatch-book
  swatchBook: (<><g><path d="M11 17a4 4 0 0 1-8 0V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2Z" /><path d="M16.7 13H19a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7m0-4h.01" /><path d="m11 8l2.3-2.3a2.4 2.4 0 0 1 3.404.004L18.6 7.6a2.4 2.4 0 0 1 .026 3.434L9.9 19.8" /></g></>),
  // lucide:type
  type: (<><path d="M12 4v16M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2M9 20h6" /></>),
  // lucide:a-arrow-up
  aArrowUp: (<><path d="m14 11l4-4l4 4m-4 5V7M2 16l4.039-9.69a.5.5 0 0 1 .923 0L11 16m-7.696-3h6.392" /></>),
  // lucide:move-vertical
  moveVertical: (<><path d="M12 2v20m-4-4l4 4l4-4M8 6l4-4l4 4" /></>),
  // lucide:indent-increase
  indentIncrease: (<><path d="M21 12H11m10 6H11M21 6H11M3 8l4 4l-4 4" /></>),
  // lucide:image (verified via better-icons)
  image: (<><rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></>),
  // lucide:scaling (verified via better-icons)
  scaling: (<><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M14 15H9v-5" /><path d="M16 3h5v5" /><path d="M21 3 9 15" /></>),
  // lucide:contrast (verified via better-icons)
  contrast: (<><circle cx="12" cy="12" r="10" /><path d="M12 18a6 6 0 0 0 0-12z" /></>),
  // lucide:move-horizontal (verified via better-icons)
  moveHorizontal: (<><path d="m18 8 4 4-4 4" /><path d="M2 12h20" /><path d="m6 8-4 4 4 4" /></>),
  // lucide:filter
  filter: (<><path d="M22 3H2l8 9.46V19l4 2v-8.54z" /></>),
  // lucide:scroll-text
  scrollText: (<><g><path d="M15 12h-5m5-4h-5m9 9V5a2 2 0 0 0-2-2H4" /><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" /></g></>),
  // lucide:upload-cloud
  uploadCloud: (<><g><path d="M12 13v8m-8-6.101A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /><path d="m8 17l4-4l4 4" /></g></>),
  // lucide:database
  database: (<><g><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14a9 3 0 0 0 18 0V5" /><path d="M3 12a9 3 0 0 0 18 0" /></g></>),
  // lucide:log-out
  logOut: (<><path d="m16 17l5-5l-5-5m5 5H9m0 9H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /></>),
  // lucide:laptop
  laptop: (<><path d="M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2zm2.054 10.987H3.946" /></>),
  // lucide:cloud-download
  cloudDownload: (<><g><path d="M12 13v8l-4-4m4 4l4-4" /><path d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284" /></g></>),
  // lucide:package
  package: (<><g><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73zm1 .27V12" /><path d="M3.29 7L12 12l8.71-5M7.5 4.27l9 5.15" /></g></>),
  // octicon:mcp-24
  // lucide:plug-zap (verified via better-icons; stroke style to match the set)
  mcp: (<><path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6l-2.3 2.3a2.4 2.4 0 0 0 0 3.4ZM2 22l3-3m2.5-5.5L10 11m.5 5.5L13 14m5-11l-4 4h6l-4 4" /></>),
  // lucide:scan-line
  scanLine: (<><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M7 12h10" /></>),
  // lucide:smartphone
  smartphone: (<><g><rect x="5" y="2" rx="2" ry="2" /><path d="M12 18h.01" /></g></>),
  // lucide:server-cog
  serverCog: (<><g><path d="m10.852 14.772l-.383.923m2.679-.923a3 3 0 1 0-2.296-5.544l-.383-.923m2.679.923l.383-.923" /><path d="m13.53 15.696l-.382-.924a3 3 0 1 1-2.296-5.544m3.92 1.624l.923-.383m-.923 2.679l.923.383" /><path d="M4.5 10H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-.5m-15 4H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-.5M6 18h.01M6 6h.01m3.218 4.852l-.923-.383m.923 2.679l-.923.383" /></g></>),
  // lucide:eraser
  eraser: (<><path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21m-7.752-9.91l8.828 8.828" /></>),
  // lucide:copy (verified via better-icons)
  copy: (<><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>),
  // lucide:external-link
  externalLink: (<><path d="M15 3h6v6m-11 5L21 3m-3 10v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>),
  // lucide:circle-alert
  circleAlert: (<><g><circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" /></g></>),
  // lucide:file
  file: (<><g><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /></g></>),
  // lucide:file-code
  fileCode: (<><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="m10 11.5L8 15l2 2.5" /><path d="m14 12.5 2 2.5-2 2.5" /></>),
  // lucide:file-diff
  fileDiff: (<><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M9 10h6" /><path d="M12 13V7" /><path d="M9 17h6" /></>),
  // lucide:files
  files: (<><path d="M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" /><path d="M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z" /><path d="M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1" /></>),
  // lucide:paperclip
  paperclip: (<><path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" /></>),
  // lucide:ellipsis
  ellipsis: (<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>),
  // lucide:locate-fixed
  locateFixed: (<><path d="M2 12h3" /><path d="M19 12h3" /><path d="M12 2v3" /><path d="M12 19v3" /><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="3" /></>),
  // lucide:share
  share: (<><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="m16 6-4-4-4 4" /><path d="M12 2v13" /></>),
  // lucide:panel-top
  panelTop: (<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /></>),
  // lucide:panel-top-open
  panelTopOpen: (<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="m15 14-3 3-3-3" /></>),
  // lucide:git-branch
  gitBranch: (<><path d="M15 6a9 9 0 0 0-9 9V3" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /></>),
  // lucide:list-collapse (verified via better-icons)
  listCollapse: (<><path d="M10 5h11" /><path d="M10 12h11" /><path d="M10 19h11" /><path d="m3 10 3-3-3-3" /><path d="m3 22 3-3-3-3" /></>),
  // lucide:unfold-horizontal (verified via better-icons)
  unfoldHorizontal: (<><path d="m16 7 5 5-5 5" /><path d="m8 7-5 5 5 5" /></>),
} as const;

export type IconName = keyof typeof GLYPHS;

export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];

export type IconProps = {
  name: IconName;
  size?: number;
  /** Fill with currentColor instead of stroke (e.g. active pin state). */
  filled?: boolean;
  spin?: boolean;
  className?: string;
  style?: React.CSSProperties;
};

export function Icon({name, size = 14, filled = false, spin = false, className, style}: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon-name={name}
      className={`sl-icon${spin ? ' sl-icon-spin' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      {GLYPHS[name]}
    </svg>
  );
}
