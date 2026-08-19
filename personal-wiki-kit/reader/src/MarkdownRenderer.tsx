import React, {useEffect, useMemo, useState} from 'react';
import ReactMarkdown, {type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {createHighlighterCore, type HighlighterCore} from '@shikijs/core';
import {createJavaScriptRegexEngine} from '@shikijs/engine-javascript';
import type {Heading} from './types';

let highlighterPromise: Promise<HighlighterCore> | null = null;
let mermaidSequence = 0;

const supportedLanguages = new Set([
  'bash',
  'c',
  'cpp',
  'css',
  'diff',
  'go',
  'html',
  'javascript',
  'json',
  'jsx',
  'markdown',
  'powershell',
  'python',
  'shellscript',
  'sql',
  'tsx',
  'typescript',
  'yaml',
]);

const languageAliases: Record<string, string> = {
  js: 'javascript',
  md: 'markdown',
  ps1: 'powershell',
  py: 'python',
  sh: 'shellscript',
  shell: 'shellscript',
  ts: 'typescript',
  yml: 'yaml',
};

export function MarkdownRenderer({body, headings, onNavigate}: {
  body: string;
  headings: Heading[];
  onNavigate: (id: string) => void;
}) {
  const components = useMemo(() => createComponents(headings, onNavigate), [headings, onNavigate]);
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
        skipHtml
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

function createComponents(headings: Heading[], onNavigate: (id: string) => void): Components {
  let headingIndex = 0;
  const heading = (depth: 2 | 3 | 4) => ({children}: React.HTMLAttributes<HTMLHeadingElement>) => {
    const expected = headings[headingIndex];
    headingIndex += 1;
    const Tag = `h${depth}` as 'h2' | 'h3' | 'h4';
    return <Tag id={expected?.slug}>{children}</Tag>;
  };
  return {
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    a: ({href, children, ...props}) => {
      if (href?.startsWith('/articles/')) {
        const id = href.slice('/articles/'.length).replace(/\/$/, '');
        return (
          <a
            {...props}
            href={`#/articles/${id}`}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(id);
            }}
          >
            {children}
          </a>
        );
      }
      const external = Boolean(href && /^https?:/i.test(href));
      return (
        <a {...props} href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>
          {children}
        </a>
      );
    },
    code: ({className, children}) => {
      const language = /language-([^\s]+)/.exec(className || '')?.[1]?.toLowerCase();
      const source = String(children).replace(/\n$/, '');
      if (!language) return <code>{children}</code>;
      if (language === 'mermaid') return <MermaidBlock source={source} />;
      return <ShikiBlock source={source} language={language} />;
    },
    img: ({src, alt}) => <img src={src} alt={alt || ''} loading="lazy" />,
  };
}

function ShikiBlock({source, language}: {source: string; language: string}) {
  const [html, setHTML] = useState('');
  const normalizedLanguage = languageAliases[language] || language;
  useEffect(() => {
    let active = true;
    setHTML('');
    void getHighlighter()
      .then((highlighter) => {
        if (!active) return;
        const lang = supportedLanguages.has(normalizedLanguage) ? normalizedLanguage : 'text';
        setHTML(highlighter.codeToHtml(source, {lang, theme: 'light-plus'}));
      })
      .catch(() => {
        if (active) setHTML('');
      });
    return () => {
      active = false;
    };
  }, [normalizedLanguage, source]);
  if (!html) {
    return (
      <pre className="code-fallback">
        <code>{source}</code>
      </pre>
    );
  }
  return <div className="shiki-frame" dangerouslySetInnerHTML={{__html: html}} />;
}

function MermaidBlock({source}: {source: string}) {
  const [html, setHTML] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const renderId = `wiki-mermaid-${++mermaidSequence}`;
    setHTML('');
    setError('');
    void import('mermaid')
      .then(({default: mermaid}) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: {
            primaryColor: '#e8eef5',
            primaryTextColor: '#17212b',
            primaryBorderColor: '#7d91a6',
            lineColor: '#60758a',
            secondaryColor: '#f3f6f8',
            tertiaryColor: '#ffffff',
            fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
          },
        });
        return mermaid.render(renderId, source);
      })
      .then(({svg}) => {
        if (active) setHTML(svg);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '图表渲染失败');
      });
    return () => {
      active = false;
    };
  }, [source]);
  if (error) return <div className="render-error">Mermaid：{error}</div>;
  if (!html) return <div className="render-pending">正在渲染图表…</div>;
  return <div className="mermaid-frame" dangerouslySetInnerHTML={{__html: html}} />;
}

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      themes: [import('@shikijs/themes/light-plus')],
      langs: [
        import('@shikijs/langs/bash'),
        import('@shikijs/langs/c'),
        import('@shikijs/langs/cpp'),
        import('@shikijs/langs/css'),
        import('@shikijs/langs/diff'),
        import('@shikijs/langs/go'),
        import('@shikijs/langs/html'),
        import('@shikijs/langs/javascript'),
        import('@shikijs/langs/json'),
        import('@shikijs/langs/jsx'),
        import('@shikijs/langs/markdown'),
        import('@shikijs/langs/powershell'),
        import('@shikijs/langs/python'),
        import('@shikijs/langs/shellscript'),
        import('@shikijs/langs/sql'),
        import('@shikijs/langs/tsx'),
        import('@shikijs/langs/typescript'),
        import('@shikijs/langs/yaml'),
      ],
    });
  }
  return highlighterPromise;
}
