export type DocumentThemeMode = 'dark' | 'light';

type DocumentThemeTarget = {
  classList: Pick<DOMTokenList, 'remove' | 'toggle'>;
};

const DOCUMENT_THEME_CLASSES = ['theme-dark', 'theme-light'] as const;

export function applyDocumentTheme(
  target: DocumentThemeTarget,
  themeMode: DocumentThemeMode,
): () => void {
  const themeClass = `theme-${themeMode}`;
  DOCUMENT_THEME_CLASSES.forEach(className => {
    target.classList.toggle(className, className === themeClass);
  });

  return () => target.classList.remove(themeClass);
}
