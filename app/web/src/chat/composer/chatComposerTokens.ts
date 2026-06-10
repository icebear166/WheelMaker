import type {RegistrySessionContentBlock} from '../../registry/registryTypes';

export type ChatComposerTextToken = {
  type: 'text';
  text: string;
};

export type ChatComposerSkillToken = {
  type: 'skill';
  id: string;
  command: string;
  label: string;
};

export type ChatComposerFileToken = {
  type: 'file';
  id: string;
  path: string;
  name: string;
  label: string;
};

export type ChatComposerToken =
  | ChatComposerTextToken
  | ChatComposerSkillToken
  | ChatComposerFileToken;

export type ChatComposerSlashCommand = {
  command: string;
  label: string;
};

export type SerializedChatComposerTokens = {
  text: string;
  blocks: RegistrySessionContentBlock[];
};

export function normalizeChatComposerTokens(tokens: ChatComposerToken[]): ChatComposerToken[] {
  const out: ChatComposerToken[] = [];
  for (const token of tokens) {
    if (token.type === 'text') {
      if (!token.text) {
        continue;
      }
      const previous = out[out.length - 1];
      if (previous?.type === 'text') {
        previous.text += token.text;
      } else {
        out.push({type: 'text', text: token.text});
      }
      continue;
    }
    if (token.type === 'skill') {
      const command = normalizeSkillCommand(token.command);
      if (!command) {
        continue;
      }
      out.push({
        ...token,
        command,
        label: token.label.trim() || skillLabelFromCommand(command),
      });
      continue;
    }
    const path = normalizeProjectPath(token.path);
    if (!path) {
      continue;
    }
    out.push({
      ...token,
      path,
      name: token.name.trim() || fileNameFromPath(path),
      label: token.label.trim(),
    });
  }
  return out;
}

export function chatComposerHasSendableTokens(tokens: ChatComposerToken[]): boolean {
  return normalizeChatComposerTokens(tokens).some(token => {
    if (token.type === 'text') {
      return token.text.trim().length > 0;
    }
    return true;
  });
}

export function serializeChatComposerTokens(tokens: ChatComposerToken[]): SerializedChatComposerTokens {
  const normalized = applyFileLabels(normalizeChatComposerTokens(tokens));
  const text = normalized.map(token => {
    if (token.type === 'text') {
      return token.text;
    }
    if (token.type === 'skill') {
      return token.command;
    }
    return fileReferenceText(token.label || token.name || fileNameFromPath(token.path));
  }).join('');
  const blocks: RegistrySessionContentBlock[] = text ? [{type: 'text', text}] : [];
  const seenPaths = new Set<string>();
  for (const token of normalized) {
    if (token.type !== 'file') {
      continue;
    }
    if (seenPaths.has(token.path)) {
      continue;
    }
    seenPaths.add(token.path);
    blocks.push({
      type: 'resource_link',
      uri: token.path,
      name: token.name || fileNameFromPath(token.path),
    });
  }
  return {text, blocks};
}

export function tokenizeKnownChatSlashCommands(
  text: string,
  commands: ChatComposerSlashCommand[],
): ChatComposerToken[] {
  const byCommand = new Map(
    commands
      .map(item => [normalizeSkillCommand(item.command), item.label.trim()] as const)
      .filter(([command]) => command),
  );
  if (byCommand.size === 0 || !text.includes('/')) {
    return normalizeChatComposerTokens([{type: 'text', text}]);
  }

  const parts: ChatComposerToken[] = [];
  const pattern = /(^|[\s([{,;])\/[A-Za-z0-9][A-Za-z0-9_-]*(?=$|[\s)\]},;.!?])/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const prefix = match[1] ?? '';
    const commandStart = match.index + prefix.length;
    const rawCommand = text.slice(commandStart, pattern.lastIndex);
    const command = normalizeSkillCommand(rawCommand);
    const label = byCommand.get(command);
    if (!label) {
      continue;
    }
    if (commandStart > cursor) {
      parts.push({type: 'text', text: text.slice(cursor, commandStart)});
    }
    parts.push({
      type: 'skill',
      id: `skill:${command}:${commandStart}`,
      command,
      label,
    });
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) {
    parts.push({type: 'text', text: text.slice(cursor)});
  }
  return normalizeChatComposerTokens(parts.length > 0 ? parts : [{type: 'text', text}]);
}

function applyFileLabels(tokens: ChatComposerToken[]): ChatComposerToken[] {
  const uniquePaths = Array.from(new Set(
    tokens
      .filter((token): token is ChatComposerFileToken => token.type === 'file')
      .map(token => token.path),
  ));
  const pathLabels = shortestUniqueFileLabels(uniquePaths);
  const labelsByPath = new Map(uniquePaths.map((path, index) => [path, pathLabels[index]]));

  return tokens.map(token => {
    if (token.type !== 'file') {
      return token;
    }
    const label = labelsByPath.get(token.path) || token.name || fileNameFromPath(token.path);
    return {...token, label};
  });
}

function shortestUniqueFileLabels(paths: string[]): string[] {
  const normalized = paths.map(normalizeProjectPath);
  return normalized.map((path, index) => {
    const pathParts = path.split('/').filter(Boolean);
    for (let length = 1; length <= pathParts.length; length += 1) {
      const suffix = pathParts.slice(-length).join('/');
      const unique = normalized.every((other, otherIndex) => {
        if (otherIndex === index) {
          return true;
        }
        const otherParts = other.split('/').filter(Boolean);
        return otherParts.slice(-length).join('/') !== suffix;
      });
      if (unique) {
        return includeUsefulParentForGenericSuffix(pathParts, length);
      }
    }
    return path;
  });
}

function includeUsefulParentForGenericSuffix(pathParts: string[], suffixLength: number): string {
  const suffixParts = pathParts.slice(-suffixLength);
  const firstSegment = suffixParts[0] ?? '';
  if (firstSegment === 'src' && suffixLength < pathParts.length) {
    return pathParts.slice(-(suffixLength + 1)).join('/');
  }
  return suffixParts.join('/');
}

function fileReferenceText(label: string): string {
  return /\s/.test(label) ? `@<${label}>` : `@${label}`;
}

function normalizeSkillCommand(command: string): string {
  const value = command.trim();
  if (!value) {
    return '';
  }
  return value.startsWith('/') ? value : `/${value}`;
}

function skillLabelFromCommand(command: string): string {
  return normalizeSkillCommand(command)
    .replace(/^\//, '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function normalizeProjectPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');
}

function fileNameFromPath(path: string): string {
  const normalized = normalizeProjectPath(path);
  return normalized.split('/').filter(Boolean).pop() || normalized || 'file';
}
