import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {HtmlPreview} from '../web/src/preview/HtmlPreview';
import {
  htmlPreviewFormFields,
  htmlPreviewSourceKey,
  isHtmlPreviewAttachment,
  isHtmlPreviewPath,
  type HtmlPreviewSource,
} from '../web/src/preview/htmlPreviewSource';

describe('HTML preview source', () => {
  test.each<[HtmlPreviewSource, Array<[string, string]>]>([
    [
      {source: 'project-file', projectId: 'proj1', path: 'page.html'},
      [['source', 'project-file'], ['projectId', 'proj1'], ['path', 'page.html']],
    ],
    [
      {source: 'external-file', projectId: 'proj1', path: String.raw`C:\page.htm`},
      [['source', 'external-file'], ['projectId', 'proj1'], ['path', String.raw`C:\page.htm`]],
    ],
    [
      {
        source: 'session-attachment',
        projectId: 'proj1',
        sessionId: 'sess1',
        attachmentId: 'sha256-a',
      },
      [
        ['source', 'session-attachment'],
        ['projectId', 'proj1'],
        ['sessionId', 'sess1'],
        ['attachmentId', 'sha256-a'],
      ],
    ],
    [
      {
        source: 'session-attachment',
        projectId: 'proj1',
        sessionId: 'sess1',
        uri: 'file:///page.html',
      },
      [
        ['source', 'session-attachment'],
        ['projectId', 'proj1'],
        ['sessionId', 'sess1'],
        ['uri', 'file:///page.html'],
      ],
    ],
  ])('serializes only the source schema', (source, expected) => {
    expect(htmlPreviewFormFields(source)).toEqual(expected);
    expect(htmlPreviewSourceKey(source)).toBe(JSON.stringify(expected));
  });

  test('recognizes file extensions and attachment MIME types', () => {
    expect(isHtmlPreviewPath('demo.HTML')).toBe(true);
    expect(isHtmlPreviewPath('demo.htm')).toBe(true);
    expect(isHtmlPreviewPath('demo.html.txt')).toBe(false);
    expect(isHtmlPreviewAttachment('attachment.bin', 'text/html; charset=utf-8')).toBe(true);
    expect(isHtmlPreviewAttachment('attachment.txt', 'text/plain')).toBe(false);
  });
});

describe('HtmlPreview', () => {
  test('posts into a stable opaque-origin script sandbox and resubmits on source change', () => {
    const requestSubmit = jest.fn();
    const first: HtmlPreviewSource = {
      source: 'project-file',
      projectId: 'proj1',
      path: 'one.html',
    };
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <HtmlPreview
          endpoint="https://example.test/ws/preview/"
          csrfToken="csrf"
          source={first}
        />,
        {
          createNodeMock: element => element.type === 'form'
            ? {requestSubmit}
            : null,
        },
      );
    });
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    const iframe = renderer.root.findByType('iframe');
    const form = renderer.root.findByType('form');
    expect(form.props.method).toBe('post');
    expect(form.props.action).toBe('https://example.test/ws/preview/');
    expect(form.props.target).toBe(iframe.props.name);
    expect(form.props.hidden).toBe(true);
    expect(iframe.props.sandbox).toBe('allow-scripts');
    expect(iframe.props.referrerPolicy).toBe('no-referrer');
    expect(iframe.props.srcDoc).toBeUndefined();
    expect(String(iframe.props.sandbox)).not.toContain('allow-same-origin');

    const target = iframe.props.name;
    act(() => {
      renderer.update(
        <HtmlPreview
          endpoint="https://example.test/ws/preview/"
          csrfToken="csrf"
          source={{
            source: 'external-file',
            projectId: 'proj1',
            path: String.raw`C:\two.htm`,
          }}
        />,
      );
    });
    expect(requestSubmit).toHaveBeenCalledTimes(2);
    expect(renderer.root.findByType('iframe').props.name).toBe(target);

    const inputs = renderer.root.findAllByType('input')
      .map(input => [input.props.name, input.props.value]);
    expect(Object.fromEntries(inputs)).toEqual({
      source: 'external-file',
      projectId: 'proj1',
      path: String.raw`C:\two.htm`,
      csrfToken: 'csrf',
    });
    act(() => renderer.unmount());
  });

  test('waits for a CSRF token before submitting', () => {
    const requestSubmit = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <HtmlPreview
          endpoint="https://example.test/ws/preview/"
          csrfToken=""
          source={{source: 'project-file', projectId: 'proj1', path: 'one.html'}}
        />,
        {
          createNodeMock: element => element.type === 'form'
            ? {requestSubmit}
            : null,
        },
      );
    });
    expect(requestSubmit).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

});
