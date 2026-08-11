import type {PreviewFileLink} from '../preview/previewFileLink';
import type {
  RegistryFileDownloadPrepareResponse,
  RegistryFileDownloadSource,
} from '../registry/registryTypes';
import {
  getAndroidNativeRpcFacade,
  type AndroidNativeMessageEnvironment,
} from '../platform/android/androidNativeMessageBridge';

export type FileDownloadDocument = {
  baseURI: string;
  body?: {appendChild(node: unknown): unknown};
  createElement?: (tagName: string) => {
    href: string;
    download: string;
    rel: string;
    style: {display: string};
    click(): void;
    remove(): void;
  };
};

export type FileDownloadEnvironment = AndroidNativeMessageEnvironment & {
  document?: FileDownloadDocument;
};

export type ManagedFileDownloadRequest = {
  projectId: string;
  csrfToken: string;
  source: RegistryFileDownloadSource;
  prepare: (
    projectId: string,
    csrfToken: string,
    source: RegistryFileDownloadSource,
  ) => Promise<RegistryFileDownloadPrepareResponse>;
};

export function fileDownloadSourceForLink(link: PreviewFileLink): RegistryFileDownloadSource {
  if (link.relativePath !== null) {
    if (!link.relativePath) throw new Error('Project file path is unavailable.');
    return {kind: 'project-file', path: link.relativePath};
  }
  const path = link.absolutePath || link.path;
  if (!path) throw new Error('External file path is unavailable.');
  return {kind: 'external-file', path};
}

export function sessionAttachmentDownloadSource(input: {
  sessionId: string;
  attachmentId?: string;
  uri?: string;
}): RegistryFileDownloadSource | null {
  if (!input.sessionId) return null;
  if (input.attachmentId) {
    return {
      kind: 'session-attachment',
      sessionId: input.sessionId,
      attachmentId: input.attachmentId,
    };
  }
  if (input.uri) {
    return {
      kind: 'session-attachment',
      sessionId: input.sessionId,
      uri: input.uri,
    };
  }
  return null;
}

export function resolveRegistryDownloadURL(downloadPath: string, baseURI: string): string {
  const base = new URL(baseURI);
  if (
    !base.pathname.endsWith('/')
    || base.username
    || base.password
    || base.search
    || base.hash
  ) {
    throw new Error('Registry page base URL is invalid.');
  }
  const target = new URL(downloadPath, base);
  if (
    target.origin !== base.origin
    || target.username
    || target.password
    || target.search
    || target.hash
  ) {
    throw new Error('Registry download URL is not same-origin.');
  }
  const prefix = `${base.pathname}ws/download/`;
  const token = target.pathname.startsWith(prefix)
    ? target.pathname.slice(prefix.length)
    : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error('Registry download URL is invalid.');
  }
  return target.toString();
}

export function fileDownloadFailureMessage(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `Failed to download file: ${reason}`;
}

export async function startManagedFileDownload(
  request: ManagedFileDownloadRequest,
  environment: FileDownloadEnvironment = globalThis as FileDownloadEnvironment,
): Promise<RegistryFileDownloadPrepareResponse> {
  const native = environment.WheelMakerAndroidNative
    ? getAndroidNativeRpcFacade(environment)
    : null;
  const userActionToken = native
    ? await native.reserveUserAction('file.download')
    : '';
  const prepared = await request.prepare(request.projectId, request.csrfToken, request.source);
  const baseURI = environment.document?.baseURI;
  if (!baseURI) {
    throw new Error('Registry page base URL is unavailable.');
  }
  const url = resolveRegistryDownloadURL(prepared.downloadPath, baseURI);
  if (native) {
    await native.startFileDownload(
      url,
      prepared.fileName,
      prepared.mimeType,
      prepared.size,
      userActionToken,
    );
    return prepared;
  }

  const document = environment.document;
  if (!document?.createElement || !document.body) {
    throw new Error('Browser download is unavailable.');
  }
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = prepared.fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
  return prepared;
}
