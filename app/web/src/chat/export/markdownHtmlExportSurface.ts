import {buildStandaloneMarkdownHtmlDocument} from './markdownHtmlExport';

export function serializeMarkdownHtmlExportSurface(surface: Element, title: string): string {
  const documentNode = surface.querySelector('.markdown-html-export-document');
  if (!documentNode) {
    throw new Error('HTML export surface is unavailable.');
  }
  const body = documentNode.cloneNode(true) as HTMLElement;
  body.removeAttribute('data-markdown-export-pending');
  for (const pendingNode of Array.from(body.querySelectorAll('[data-markdown-export-pending]'))) {
    pendingNode.removeAttribute('data-markdown-export-pending');
  }
  return buildStandaloneMarkdownHtmlDocument({
    title,
    bodyHtml: body.innerHTML,
  });
}
