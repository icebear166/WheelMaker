import React from 'react';

// Glyph bodies are Lucide icon inner SVG nodes (24x24 viewBox, stroke-based,
// 1.5px stroke, round caps), same convention as sessionlist/SessionIcon.tsx.
// Verify/replace with `better-icons get lucide:<id>` output (strip fill attrs)
// if a shape looks off — ids noted per entry.
const GLYPHS = {
  // lucide:x
  x: (<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>),
  // lucide:check
  check: (<><path d="M20 6 9 17l-5-5" /></>),
  // lucide:chevron-up
  chevronUp: (<><path d="m18 15-6-6-6 6" /></>),
  // lucide:chevron-down
  chevronDown: (<><path d="m6 9 6 6 6-6" /></>),
  // lucide:chevron-right
  chevronRight: (<><path d="m9 18 6-6-6-6" /></>),
  // lucide:arrow-down
  arrowDown: (<><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>),
  // lucide:arrow-left
  arrowLeft: (<><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>),
  // lucide:corner-down-left
  cornerDownLeft: (<><path d="M20 4v7a4 4 0 0 1-4 4H4" /><path d="m9 10-5 5 5 5" /></>),
  // lucide:arrow-up-to-line
  arrowUpToLine: (<><path d="M5 3h14" /><path d="m18 13-6-6-6 6" /><path d="M12 7v14" /></>),
  // lucide:loader-circle
  loader: (<><path d="M21 12a9 9 0 1 1-6.219-8.56" /></>),
  // lucide:circle-x
  circleX: (<><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></>),
  // lucide:circle-check
  circleCheck: (<><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>),
  // lucide:circle
  circle: (<><circle cx="12" cy="12" r="10" /></>),
  // lucide:target
  target: (<><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>),
  // lucide:wrench
  wrench: (<><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" /></>),
  // lucide:circle-help
  help: (<><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>),
  // lucide:lightbulb
  lightbulb: (<><path d="M15 14c.2-1 .7-1.7 1.5-2.5C17.5 10.6 18 9.3 18 8a6 6 0 0 0-6 0c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /><path d="M9 18h6" /><path d="M10 22h4" /></>),
  // lucide:file
  file: (<><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /></>),
  // lucide:files
  files: (<><path d="M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" /><path d="M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z" /><path d="M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1" /></>),
  // lucide:image
  image: (<><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></>),
  // lucide:file-code
  fileCode: (<><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="m10 11.5L8 15l2 2.5" /><path d="m14 12.5 2 2.5-2 2.5" /></>),
  // lucide:file-diff
  fileDiff: (<><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M9 10h6" /><path d="M12 13V7" /><path d="M9 17h6" /></>),
  // lucide:refresh-cw
  refreshCw: (<><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></>),
  // lucide:square
  square: (<><rect width="18" height="18" x="3" y="3" rx="2" /></>),
  // mingcute:stop-fill (filled; crisper corners than a filled lucide:square)
  stop: (<><rect width="16" height="16" x="4" y="4" rx="2" /></>),
  // lucide:volume-2
  volume2: (<><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" /><path d="M16 9a5 5 0 0 1 0 6" /><path d="M19.364 18.364a9 9 0 0 0 0-12.728" /></>),
  // lucide:copy (verified via better-icons)
  copy: (<><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>),
  // lucide:clipboard
  clipboard: (<><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></>),
  // lucide:camera
  camera: (<><path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 0 10.004 4z" /><circle cx="12" cy="13" r="3" /></>),
  // lucide:code
  code: (<><path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" /></>),
  // lucide:folder-open
  folderOpen: (<><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" /></>),
  // lucide:share
  share: (<><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="m16 6-4-4-4 4" /><path d="M12 2v13" /></>),
  // lucide:share-2 (verified via better-icons)
  share2: (<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.59 13.51 6.83 3.98" /><path d="m15.41 6.51-6.82 3.98" /></>),
  // lucide:external-link
  externalLink: (<><path d="M15 3h6v6" /><path d="m10 14 11-11" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>),
  // lucide:message-square
  messageSquare: (<><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" /></>),
  // lucide:list-tree
  listTree: (<><path d="M8 5h13" /><path d="M13 12h8" /><path d="M13 19h8" /><path d="M3 10a2 2 0 0 0 2 2h3" /><path d="M3 5v12a2 2 0 0 0 2 2h3" /></>),
  // lucide:file-symlink
  fileSymlink: (<><path d="M4 11V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="m10 18 3-3-3-3" /></>),
  // lucide:layout-dashboard
  layoutDashboard: (<><rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" /></>),
  // lucide:zap
  zap: (<><path d="M15.914 4a1.5 1.5 0 0 0-2.474-1.561l-9 9A1.5 1.5 0 0 0 5.5 14h4.002a.5.5 0 0 1 .471.666L8.086 20a1.5 1.5 0 0 0 2.475 1.56l9-9A1.5 1.5 0 0 0 18.5 10h-3.997a.5.5 0 0 1-.472-.667z" /></>),
  // lucide:wand-sparkles
  wand: (<><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72z" /><path d="m14 7 3 3" /><path d="M5 6v4" /><path d="M19 14v4" /><path d="M10 2v2" /><path d="M7 8H3" /><path d="M21 16h-4" /><path d="M11 3H9" /></>),
  // lucide:mic
  mic: (<><path d="M12 19v3" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><rect width="6" height="13" x="9" y="2" rx="3" /></>),
  // lucide:send-horizontal
  send: (<><path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z" /><path d="M6 12h16" /></>),
  // lucide:paperclip
  paperclip: (<><path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" /></>),
  // lucide:eye
  eye: (<><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></>),
  // lucide:sparkles
  sparkles: (<><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" /><path d="M20 2v4" /><path d="M22 4h-4" /><circle cx="4" cy="20" r="2" /></>),
  // lucide:panel-right
  panelRight: (<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" /></>),
  // lucide:app-window
  appWindow: (<><rect width="20" height="16" x="2" y="4" rx="2" /><path d="M10 4v4" /><path d="M2 8h20" /><path d="M6 4v4" /></>),
  // lucide:command
  command: (<><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" /></>),
  // lucide:at-sign
  atSign: (<><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" /></>),
  // lucide:git-branch
  gitBranch: (<><path d="M15 6a9 9 0 0 0-9 9V3" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /></>),
} as const;

export type ChatIconName = keyof typeof GLYPHS;

export const CHAT_ICON_NAMES = Object.keys(GLYPHS) as ChatIconName[];

export type ChatIconProps = {
  name: ChatIconName;
  size?: number;
  /** Fill with currentColor instead of stroke (e.g. stop glyph). */
  filled?: boolean;
  spin?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Accessible label; when set, the svg is exposed instead of hidden. */
  ariaLabel?: string;
};

export function ChatIcon({name, size = 14, filled = false, spin = false, className, style, ariaLabel}: ChatIconProps) {
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
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
      data-icon-name={name}
      className={`sl-icon${spin ? ' sl-icon-spin' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      {GLYPHS[name]}
    </svg>
  );
}
