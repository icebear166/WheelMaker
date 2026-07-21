// Rehype-style plugin that wraps chat-search matches in <mark class="chat-search-match">.
// Walks hast text nodes; skips code/pre content so syntax highlighting stays intact.
// Implemented as a dependency-free recursive walker (hast nodes are plain objects).

import {splitChatSearchHighlightSegments} from './chatSearchState';

type HastTextNode = {type: 'text'; value: string};
type HastElementNode = {
  type: 'element';
  tagName: string;
  properties?: Record<string, unknown>;
  children: HastNode[];
};
type HastNode = HastTextNode | HastElementNode | {type: string; children?: HastNode[]};

const SKIPPED_TAGS = new Set(['code', 'pre', 'script', 'style']);

function highlightChildren(node: HastNode, query: string): void {
  const holder = node as {children?: HastNode[]};
  if (!Array.isArray(holder.children)) {
    return;
  }
  const nextChildren: HastNode[] = [];
  for (const child of holder.children) {
    if (child.type === 'text' && typeof (child as HastTextNode).value === 'string') {
      const segments = splitChatSearchHighlightSegments((child as HastTextNode).value, query);
      for (const segment of segments) {
        if (segment.match) {
          nextChildren.push({
            type: 'element',
            tagName: 'mark',
            properties: {className: ['chat-search-match']},
            children: [{type: 'text', value: segment.text}],
          } as HastElementNode);
        } else {
          nextChildren.push({type: 'text', value: segment.text} as HastTextNode);
        }
      }
      continue;
    }
    if (child.type === 'element' && !SKIPPED_TAGS.has((child as HastElementNode).tagName)) {
      highlightChildren(child, query);
    }
    nextChildren.push(child);
  }
  holder.children = nextChildren;
}

export function createChatSearchHighlightPlugin(query: string) {
  const normalizedQuery = query.trim();
  return function chatSearchHighlightPlugin() {
    return (tree: HastNode) => {
      if (normalizedQuery) {
        highlightChildren(tree, normalizedQuery);
      }
    };
  };
}
