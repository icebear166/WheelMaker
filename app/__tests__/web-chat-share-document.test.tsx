/** @jest-environment jsdom */

import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

jest.mock('rehype-raw', () => ({__esModule: true, default: () => undefined}));
jest.mock('rehype-sanitize', () => ({
  __esModule: true,
  default: () => undefined,
  defaultSchema: {attributes: {}, protocols: {}},
}));
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({children}: {children?: React.ReactNode}) => {
    const value = String(children ?? '');
    const match = value.match(/^(.*?)\*\*(.+?)\*\*(.*?)$/s);
    return match
      ? <>{match[1]}<strong>{match[2]}</strong>{match[3]}</>
      : <>{value}</>;
  },
}));
jest.mock('../web/src/code/markdownPreview', () => ({
  markdownCodeRenderer: () => null,
  markdownPreRenderer: () => null,
  useMarkdownCapabilityPlugins: () => ({pending: false, remarkPlugins: [], rehypePlugins: []}),
}));

import {ChatShareDocument} from '../web/src/chat/share/ChatShareDocument';
import {CHAT_SHARE_DOCUMENT_STYLE} from '../web/src/chat/share/chatShareDocumentStyle';
import type {ChatShareSnapshot} from '../web/src/chat/share/chatShareSnapshot';
import {serializeMarkdownHtmlExportSurface} from '../web/src/chat/export/markdownHtmlExportSurface';

function snapshot(scope: 'response' | 'session'): ChatShareSnapshot {
  const base = {
    scope,
    projectId: 'hub:project',
    sessionId: 'sess-1',
    title: 'Research <script>',
    capturedAt: '2026-08-11T08:30:00.000Z',
    presentation: {
      themeMode: 'dark' as const,
      codeTheme: 'tokyo-night' as const,
      codeFont: 'jetbrains-mono' as const,
      codeFontSize: 13,
      codeLineHeight: 1.6,
      codeTabSize: 2,
    },
  };
  if (scope === 'response') {
    return {
      ...base,
      terminalTurnIndex: 7,
      entries: [{
        role: 'assistant',
        markdown: '**Current answer**',
        attachments: [],
        startTurnIndex: 1,
        endTurnIndex: 7,
      }],
    };
  }
  return {
    ...base,
    entries: [
      {
        role: 'user',
        markdown: 'Review the report.',
        attachments: [
          {kind: 'file', label: 'report.pdf'},
          {kind: 'image', label: 'Image attachment'},
        ],
        startTurnIndex: 1,
        endTurnIndex: 4,
      },
      {
        role: 'assistant',
        markdown: 'Partial **answer**.',
        attachments: [],
        status: 'failed',
        startTurnIndex: 1,
        endTurnIndex: 4,
      },
    ],
  };
}

describe('chat share document', () => {
  test('keeps current responses on the standalone markdown body', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<ChatShareDocument snapshot={snapshot('response')} />);
    });

    const root = tree.root.findByProps({className: 'markdown-preview markdown-html-export-document wheelmaker-markdown-export'});
    expect(root).toBeTruthy();
    expect(tree.root.findByType('strong').children).toEqual(['Current answer']);
    expect(tree.root.findAllByProps({className: 'chat-share-header'})).toHaveLength(0);
  });

  test('renders ordered conversation roles, metadata, statuses, and attachment labels', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<ChatShareDocument snapshot={snapshot('session')} />);
    });

    expect(tree.root.findByProps({className: 'chat-share-title'}).children).toEqual(['Research <script>']);
    expect(tree.root.findByProps({className: 'chat-share-timestamp'}).props.dateTime).toBe('2026-08-11T08:30:00.000Z');
    expect(tree.root.findAllByProps({className: 'chat-share-role'}).map(node => node.children.join(''))).toEqual(['User', 'Assistant']);
    expect(tree.root.findByProps({className: 'chat-share-status failed'}).children).toEqual(['Failed']);
    expect(tree.root.findAllByProps({className: 'chat-share-attachment-label'}).map(node => node.children.join(''))).toEqual([
      'report.pdf',
      'Image attachment',
    ]);
  });

  test('serializes the same semantic document with conversation styles and no pending markers', () => {
    const markup = renderToStaticMarkup(<ChatShareDocument snapshot={snapshot('session')} />);
    const surface = document.createElement('div');
    surface.innerHTML = markup.replace(
      'class="markdown-preview',
      'data-markdown-export-pending="true" class="markdown-preview',
    );

    const html = serializeMarkdownHtmlExportSurface(surface, 'Research <script>', {
      additionalStyles: CHAT_SHARE_DOCUMENT_STYLE,
      bodyClassName: 'wheelmaker-chat-share',
    });

    expect(html).toContain('<title>Research &lt;script&gt;</title>');
    expect(html).toContain('class="wheelmaker-markdown-export wheelmaker-chat-share"');
    expect(html).toContain('.wheelmaker-chat-share .chat-share-entry {');
    expect(html).toContain('Research &lt;script&gt;');
    expect(html).toContain('User');
    expect(html).toContain('Assistant');
    expect(html).toContain('Failed');
    expect(html).toContain('report.pdf');
    expect(html).not.toContain('data-markdown-export-pending');
    expect(html).not.toContain('private-base64');
    expect(html).not.toContain('workspace');
  });
});
