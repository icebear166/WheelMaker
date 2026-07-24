type MarkdownPosition = {
  start?: {offset?: number};
  end?: {offset?: number};
};

type MarkdownNode = {
  type?: string;
  url?: string;
  position?: MarkdownPosition;
  children?: MarkdownNode[];
};

type MarkdownFile = {
  value?: unknown;
};

function rawNodeSource(node: MarkdownNode, source: string): string {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (
    typeof start !== 'number'
    || typeof end !== 'number'
    || start < 0
    || end <= start
  ) {
    return '';
  }
  return source.slice(start, end);
}

function rawLinkDestination(nodeSource: string): string {
  const destinationStart = nodeSource.indexOf('](');
  if (destinationStart < 0) return '';

  let cursor = destinationStart + 2;
  while (/\s/.test(nodeSource[cursor] ?? '')) cursor += 1;
  const enclosed = nodeSource[cursor] === '<';
  if (enclosed) cursor += 1;

  const start = cursor;
  let nestedParentheses = 0;
  while (cursor < nodeSource.length) {
    const character = nodeSource[cursor];
    if (enclosed) {
      if (character === '>') break;
    } else {
      if (/\s/.test(character)) break;
      if (character === '(') nestedParentheses += 1;
      if (character === ')') {
        if (nestedParentheses === 0) break;
        nestedParentheses -= 1;
      }
    }
    cursor += 1;
  }
  return nodeSource.slice(start, cursor);
}

function normalizeRawWindowsDestination(value: string): string {
  if (!/^(?:\/?[a-z]:[\\/]|\\\\)/i.test(value)) return '';
  return value.replaceAll('\\', '/').replace(/^\/([a-z]:\/)/i, '$1');
}

function visitMarkdownLinks(node: MarkdownNode, source: string): void {
  if (node.type === 'link') {
    const destination = normalizeRawWindowsDestination(
      rawLinkDestination(rawNodeSource(node, source)),
    );
    if (destination) node.url = destination;
  }
  for (const child of node.children ?? []) {
    visitMarkdownLinks(child, source);
  }
}

export function remarkWindowsFileLinks() {
  return (tree: MarkdownNode, file: MarkdownFile): void => {
    const source = typeof file.value === 'string' ? file.value : '';
    if (!source) return;
    visitMarkdownLinks(tree, source);
  };
}
