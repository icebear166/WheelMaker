import React, { useCallback, useEffect, useRef, useState } from 'react';

import { ChatIcon } from '../chat/ChatIcon';
import { writeTextToClipboard } from '../platform/clipboard';

const COPIED_FEEDBACK_MS = 1200;

export type CodeBlockFrameProps = {
  language: string;
  content: string;
  children: React.ReactNode;
};

export function CodeBlockFrame({ language, content, children }: CodeBlockFrameProps) {
  const [copied, setCopied] = useState(false);
  const feedbackTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
  }, []);

  const handleCopy = useCallback(() => {
    writeTextToClipboard(content)
      .then(() => {
        setCopied(true);
        if (feedbackTimerRef.current !== null) {
          window.clearTimeout(feedbackTimerRef.current);
        }
        feedbackTimerRef.current = window.setTimeout(() => {
          feedbackTimerRef.current = null;
          setCopied(false);
        }, COPIED_FEEDBACK_MS);
      })
      .catch(() => undefined);
  }, [content]);

  return (
    <div className="code-frame">
      <div className="code-frame-header">
        <span className="code-frame-language">{language || 'text'}</span>
        <button
          type="button"
          className="code-frame-copy"
          aria-label={copied ? 'Copied' : 'Copy code'}
          title={copied ? 'Copied' : 'Copy code'}
          onClick={handleCopy}
        >
          <ChatIcon name={copied ? 'check' : 'copy'} size={14} />
        </button>
      </div>
      <div className="code-frame-body">
        {children}
      </div>
    </div>
  );
}
