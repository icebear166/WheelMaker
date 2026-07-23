import React from 'react';

// Glyph bodies are Lucide icon inner SVG nodes (24x24 viewBox, stroke-based,
// 1.5px stroke, round caps). Verify/replace with `better-icons get lucide:<id>`
// output if a shape looks off — ids noted per entry.
const GLYPHS = {
  // lucide:plus
  plus: (<><path d="M5 12h14" /><path d="M12 5v14" /></>),
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
  // lucide:history
  history: (<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></>),
  // lucide:archive
  archive: (<><rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></>),
  // lucide:pencil
  pencil: (<><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></>),
  // lucide:refresh-cw
  refreshCw: (<><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></>),
  // lucide:trash-2
  trash: (<><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></>),
  // lucide:arrow-left
  arrowLeft: (<><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>),
  // lucide:settings (verified via better-icons)
  settings: (<><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 1 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /><circle cx="12" cy="12" r="3" /></>),
  // lucide:inbox
  inbox: (<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>),
  // lucide:loader-circle
  loader: (<><path d="M21 12a9 9 0 1 1-6.219-8.56" /></>),
  // lucide:circle-help
  help: (<><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>),
  // lucide:ban
  ban: (<><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></>),
  // lucide:sliders-horizontal (verified via better-icons)
  sliders: (<><path d="M10 5H3" /><path d="M12 19H3" /><path d="M14 3v4" /><path d="M16 17v4" /><path d="M21 12h-9" /><path d="M21 19h-5" /><path d="M21 5h-7" /><path d="M8 10v4" /><path d="M8 12H3" /></>),
} as const;

export type SessionIconName = keyof typeof GLYPHS;

export const SESSION_ICON_NAMES = Object.keys(GLYPHS) as SessionIconName[];

export type SessionIconProps = {
  name: SessionIconName;
  size?: number;
  /** Fill with currentColor instead of stroke (e.g. active pin state). */
  filled?: boolean;
  spin?: boolean;
  className?: string;
};

export function SessionIcon({name, size = 14, filled = false, spin = false, className}: SessionIconProps) {
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
      className={`sl-icon${spin ? ' sl-icon-spin' : ''}${className ? ` ${className}` : ''}`}
    >
      {GLYPHS[name]}
    </svg>
  );
}
