import {
  outputMarkdownHtml,
  reserveMarkdownHtmlShare,
} from '../web/src/chat/export/markdownHtmlOutput';
import {createAndroidNativeMessageTestHost} from '../testUtils/androidNativeMessageTestHost';

describe('Markdown HTML output', () => {
  test('downloads the generated standalone document in a browser', async () => {
    const download = jest.fn();

    await expect(outputMarkdownHtml({
      html: '<h1>Hello</h1>',
      fileName: 'README.html',
      download,
      env: {} as Window,
    })).resolves.toEqual({ok: true, status: 'downloaded'});

    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({type: 'text/html;charset=utf-8'}),
      'README.html',
    );
  });

  test('places a named HTML file in the native desktop clipboard', async () => {
    const bridge = {
      enabled: true as const,
      beginHtmlFileClipboard: jest.fn(() => Promise.resolve('clipboard-transfer-1')),
      appendHtmlFileClipboard: jest.fn(() => Promise.resolve(JSON.stringify({ok: true, status: 'chunk_received'}))),
      commitHtmlFileClipboard: jest.fn(() => Promise.resolve(JSON.stringify({ok: true, status: 'copied'}))),
      cancelHtmlFileClipboard: jest.fn(() => Promise.resolve(JSON.stringify({ok: true, status: 'cancelled'}))),
    };
    const download = jest.fn();

    await expect(outputMarkdownHtml({
      html: '<h1>Hello</h1>',
      fileName: 'README.html',
      download,
      env: {WheelMakerDesktop: bridge} as unknown as Window,
    })).resolves.toEqual({ok: true, status: 'copied'});

    expect(bridge.beginHtmlFileClipboard).toHaveBeenCalledWith('README.html', 14);
    expect(bridge.appendHtmlFileClipboard).toHaveBeenCalledWith(
      'clipboard-transfer-1',
      0,
      'PGgxPkhlbGxvPC9oMT4=',
    );
    expect(bridge.commitHtmlFileClipboard).toHaveBeenCalledWith('clipboard-transfer-1');
    expect(download).not.toHaveBeenCalled();
  });

  test('shares a named HTML file through the Android system share chooser', async () => {
    const {target, requests} = createAndroidNativeMessageTestHost({
      'userAction.reserve': () => ({token: 'grant-html-1'}),
      'html.share.begin': () => ({ok: true, status: 'ready', transferId: 'html-transfer-1'}),
      'html.share.chunk': () => ({ok: true, status: 'chunk_received'}),
      'html.share.commit': () => ({ok: true, status: 'shared'}),
    });
    const env = {WheelMakerAndroidNative: target} as unknown as Window;
    const userActionToken = await reserveMarkdownHtmlShare(env);

    await expect(outputMarkdownHtml({
      html: '<h1>Hello</h1>',
      fileName: 'README.html',
      env,
      userActionToken,
    })).resolves.toEqual({ok: true, status: 'shared'});

    expect(requests).toEqual([
      expect.objectContaining({action: 'userAction.reserve', payload: {action: 'html.share'}}),
      expect.objectContaining({
        action: 'html.share.begin',
        payload: {fileName: 'README.html', size: 14, userActionToken: 'grant-html-1'},
      }),
      expect.objectContaining({
        action: 'html.share.chunk',
        payload: {transferId: 'html-transfer-1', index: 0, data: 'PGgxPkhlbGxvPC9oMT4='},
      }),
      expect.objectContaining({action: 'html.share.commit', payload: {transferId: 'html-transfer-1'}}),
    ]);
  });
});
