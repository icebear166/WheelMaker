import {createAndroidNativeMessageTestHost} from '../../../testUtils/androidNativeMessageTestHost';
import type {AndroidNativeMessageTarget} from '../platform/android/androidNativeMessageBridge';
import {
  fileDownloadSourceForLink,
  resolveRegistryDownloadURL,
  sessionAttachmentDownloadSource,
  startManagedFileDownload,
} from './fileDownload';

test('normalizes project, external, and persisted attachment sources', () => {
  expect(fileDownloadSourceForLink({
    path: 'docs/report.txt', absolutePath: 'C:/repo/docs/report.txt',
    relativePath: 'docs/report.txt', line: 3,
  })).toEqual({kind: 'project-file', path: 'docs/report.txt'});
  expect(fileDownloadSourceForLink({
    path: 'C:/outside/report.txt', absolutePath: 'C:/outside/report.txt',
    relativePath: null, line: null,
  })).toEqual({kind: 'external-file', path: 'C:/outside/report.txt'});
  expect(sessionAttachmentDownloadSource({
    sessionId: 'session-1', attachmentId: 'sha256-id', uri: 'file:///ignored.txt',
  })).toEqual({kind: 'session-attachment', sessionId: 'session-1', attachmentId: 'sha256-id'});
  expect(sessionAttachmentDownloadSource({sessionId: '', uri: 'file:///draft.txt'})).toBeNull();
});

test('accepts only an exact same-origin Registry capability URL', () => {
  expect(resolveRegistryDownloadURL(
    '/wheelmaker/download/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
    'https://registry.example/wheelmaker/',
  )).toBe('https://registry.example/wheelmaker/download/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789');
  for (const path of [
    'https://evil.example/wheelmaker/download/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
    '/download/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
    '/wheelmaker/download/token/extra',
    '/wheelmaker/download/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789?x=1',
  ]) {
    expect(() => resolveRegistryDownloadURL(path, 'https://registry.example/wheelmaker/')).toThrow();
  }
});

test('launches a browser download without fetching file bytes', async () => {
  const clicked: string[] = [];
  const removed: string[] = [];
  const appendChild = jest.fn();
  const anchor = {
    href: '', download: '', rel: '', style: {display: ''},
    click: () => clicked.push(anchor.href),
    remove: () => removed.push(anchor.href),
  };
  const prepare = jest.fn().mockResolvedValue({
    ok: true,
    downloadPath: '/wheelmaker/download/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
    fileName: 'report.txt',
    mimeType: 'text/plain',
    size: 42,
  });

  await startManagedFileDownload({
    projectId: 'hub:project', csrfToken: 'csrf',
    source: {kind: 'project-file', path: 'report.txt'}, prepare,
  }, {
    document: {
      baseURI: 'https://registry.example/wheelmaker/',
      body: {appendChild},
      createElement: () => anchor,
    },
  });

  expect(prepare).toHaveBeenCalledWith('hub:project', 'csrf', {kind: 'project-file', path: 'report.txt'});
  expect(appendChild).toHaveBeenCalledWith(anchor);
  expect(clicked).toEqual(['https://registry.example/wheelmaker/download/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789']);
  expect(removed).toHaveLength(1);
});

test('reserves Android user action before prepare and launches the native download', async () => {
  const order: string[] = [];
  const {target, requests} = createAndroidNativeMessageTestHost({
    'userAction.reserve': () => {
      order.push('reserve');
      return {token: 'grant-1'};
    },
    'file.download.start': () => {
      order.push('native');
      return {ok: true};
    },
  });
  const prepare = jest.fn(async () => {
    order.push('prepare');
    return {
      ok: true,
      downloadPath: '/download/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
      fileName: 'report.txt', mimeType: 'text/plain', size: 42,
    };
  });

  await startManagedFileDownload({
    projectId: 'hub:project', csrfToken: 'csrf',
    source: {kind: 'project-file', path: 'report.txt'}, prepare,
  }, {
    WheelMakerAndroidNative: target as unknown as AndroidNativeMessageTarget,
    document: {baseURI: 'https://registry.example/'},
  });

  expect(order).toEqual(['reserve', 'prepare', 'native']);
  expect(requests.at(-1)).toMatchObject({
    action: 'file.download.start',
    payload: {
      url: 'https://registry.example/download/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
      fileName: 'report.txt', mimeType: 'text/plain', size: 42,
      userActionToken: 'grant-1',
    },
  });
});
