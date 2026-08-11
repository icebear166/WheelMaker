import {splitChatSearchHighlightSegments} from './chatSearchState';

const GENERATED_MARK_SELECTOR = 'mark[data-chat-search-generated="true"]';

function unwrapGeneratedMark(mark: HTMLElement): void {
  const parent = mark.parentNode;
  if (!parent) {
    return;
  }
  while (mark.firstChild) {
    parent.insertBefore(mark.firstChild, mark);
  }
  parent.removeChild(mark);
}

export function clearChatSearchGeneratedMarks(root: HTMLElement): void {
  for (const mark of Array.from(root.querySelectorAll<HTMLElement>(GENERATED_MARK_SELECTOR))) {
    unwrapGeneratedMark(mark);
  }
}

export function applyChatSearchCodeHighlights(root: HTMLElement, query: string): void {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return;
  }

  const ownerDocument = root.ownerDocument;
  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const parent = textNode.parentElement;
    if (!parent || !parent.closest('code') || parent.closest('mark')) {
      continue;
    }
    const segments = splitChatSearchHighlightSegments(textNode.nodeValue ?? '', normalizedQuery);
    if (!segments.some(segment => segment.match)) {
      continue;
    }
    const fragment = ownerDocument.createDocumentFragment();
    for (const segment of segments) {
      if (!segment.match) {
        fragment.appendChild(ownerDocument.createTextNode(segment.text));
        continue;
      }
      const mark = ownerDocument.createElement('mark');
      mark.className = 'chat-search-match';
      mark.dataset.chatSearchGenerated = 'true';
      mark.textContent = segment.text;
      fragment.appendChild(mark);
    }
    textNode.parentNode?.replaceChild(fragment, textNode);
  }
}

export function applyChatSearchActiveMatch(root: HTMLElement, occurrenceIndex: number): void {
  const marks = Array.from(root.querySelectorAll<HTMLElement>('mark.chat-search-match'));
  for (const mark of marks) {
    mark.classList.remove('chat-search-match-active');
  }
  if (occurrenceIndex >= 0) {
    marks[occurrenceIndex]?.classList.add('chat-search-match-active');
  }
}
