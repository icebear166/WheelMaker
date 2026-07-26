export type HtmlPreviewSource =
  | {source: 'project-file'; projectId: string; path: string}
  | {source: 'external-file'; projectId: string; path: string}
  | (
      {source: 'session-attachment'; projectId: string; sessionId: string} &
      (
        | {attachmentId: string; uri?: never}
        | {attachmentId?: never; uri: string}
      )
    );

export function isHtmlPreviewPath(path: string): boolean {
  return /\.html?$/i.test(path);
}

export function isHtmlPreviewAttachment(title: string, mimeType: string): boolean {
  return isHtmlPreviewPath(title) ||
    mimeType.split(';', 1)[0].trim().toLocaleLowerCase() === 'text/html';
}

export function htmlPreviewFormFields(source: HtmlPreviewSource): Array<[string, string]> {
  const fields: Array<[string, string]> = [
    ['source', source.source],
    ['projectId', source.projectId],
  ];
  if (source.source === 'project-file' || source.source === 'external-file') {
    fields.push(['path', source.path]);
  } else {
    fields.push(['sessionId', source.sessionId]);
    if (source.attachmentId) {
      fields.push(['attachmentId', source.attachmentId]);
    } else if (source.uri) {
      fields.push(['uri', source.uri]);
    }
  }
  return fields;
}

export function htmlPreviewSourceKey(source: HtmlPreviewSource): string {
  return JSON.stringify(htmlPreviewFormFields(source));
}
