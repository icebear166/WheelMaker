export type CodeThemeAppearance = 'auto' | 'dark' | 'light';

export type CuratedCodeThemeId =
  | 'dark-plus'
  | 'light-plus'
  | 'material-theme-darker'
  | 'material-theme-lighter'
  | 'monokai'
  | 'tokyo-night';

export type CodeThemeId = 'auto-plus' | CuratedCodeThemeId;

export type CodeFontId =
  | 'consolas'
  | 'jetbrains-mono'
  | 'cascadia'
  | 'menlo';

export type CodeThemeOption = {
  id: CodeThemeId;
  label: string;
  appearance: CodeThemeAppearance;
};

export type CodeThemeOptionGroup = {
  label: string;
  options: CodeThemeOption[];
};

export type CodeFontOption = {
  id: CodeFontId;
  label: string;
  fontFamily: string;
};

export type DiffRenderLine = {
  code: string;
  lineNumber: number | null;
  oldLineNumber?: number | null;
  newLineNumber?: number | null;
  kind: 'context' | 'added' | 'removed' | 'empty';
  separator?: 'hunk' | 'file';
};

const AUTO_CODE_THEME_OPTION: CodeThemeOption = {
  id: 'auto-plus',
  label: 'Auto (Dark+/Light+)',
  appearance: 'auto',
};

const CURATED_CODE_THEME_OPTIONS: CodeThemeOption[] = [
  {id: 'dark-plus', label: 'Dark Plus', appearance: 'dark'},
  {id: 'light-plus', label: 'Light Plus', appearance: 'light'},
  {id: 'material-theme-darker', label: 'Material Theme Darker', appearance: 'dark'},
  {id: 'material-theme-lighter', label: 'Material Theme Lighter', appearance: 'light'},
  {id: 'tokyo-night', label: 'Tokyo Night', appearance: 'dark'},
  {id: 'monokai', label: 'Monokai', appearance: 'dark'},
];

export const CODE_THEME_OPTIONS: CodeThemeOption[] = [AUTO_CODE_THEME_OPTION, ...CURATED_CODE_THEME_OPTIONS];
export const CODE_THEME_OPTION_GROUPS: CodeThemeOptionGroup[] = [
  {
    label: 'Dark Themes',
    options: CURATED_CODE_THEME_OPTIONS.filter(item => item.appearance === 'dark'),
  },
  {
    label: 'Light Themes',
    options: CURATED_CODE_THEME_OPTIONS.filter(item => item.appearance === 'light'),
  },
];
export const DEFAULT_CODE_THEME: CodeThemeId = 'auto-plus';
export const DEFAULT_CODE_FONT: CodeFontId = 'consolas';
export const DEFAULT_CODE_FONT_SIZE = 13;
export const DEFAULT_CODE_LINE_HEIGHT = 1.5;
export const DEFAULT_CODE_TAB_SIZE = 2;
export const CODE_FONT_OPTIONS: CodeFontOption[] = [
  {id: 'consolas', label: 'Consolas', fontFamily: "Consolas, 'Courier New', monospace"},
  {id: 'jetbrains-mono', label: 'JetBrains Mono', fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace"},
  {id: 'cascadia', label: 'Cascadia Mono', fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace"},
  {id: 'menlo', label: 'Menlo / Monaco', fontFamily: "Menlo, Monaco, Consolas, 'Courier New', monospace"},
];

const VALID_CODE_THEME_IDS = new Set<string>(CODE_THEME_OPTIONS.map(item => item.id));

export function isCodeThemeId(value: string): value is CodeThemeId {
  return VALID_CODE_THEME_IDS.has(value);
}

export function isCodeFontId(value: string): value is CodeFontId {
  return CODE_FONT_OPTIONS.some(item => item.id === value);
}

export function resolveCodeFontFamily(codeFont: CodeFontId): string {
  return CODE_FONT_OPTIONS.find(item => item.id === codeFont)?.fontFamily ?? CODE_FONT_OPTIONS[0].fontFamily;
}
