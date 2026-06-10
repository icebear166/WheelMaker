import type {RegistrySessionContentBlock} from '../../registry/registryTypes';
import {isProjectFileResourceLinkBlock} from './chatPromptAttachments';

export type ChatPromptInlinePart =
  | {type: 'text'; text: string}
  | {type: 'skill'; command: string; label: string}
  | {type: 'file'; label: string; path: string; name: string};

export type ChatPromptInlineSkill = {
  command: string;
  label: string;
};

export function buildChatPromptInlineParts(
  blocks: RegistrySessionContentBlock[],
  skills: ChatPromptInlineSkill[] = [],
): ChatPromptInlinePart[] {
  const text = promptTextFromBlocks(blocks);
  if (!text) {
    return [];
  }
  const files = blocks
    .filter(isProjectFileResourceLinkBlock)
    .map(block => ({
      path: cleanString(block.uri),
      name: cleanString(block.name) || fileNameFromPath(cleanString(block.uri)),
    }))
    .filter(file => file.path);
  const skillByCommand = new Map(
    skills
      .map(skill => [normalizeSkillCommand(skill.command), cleanString(skill.label)] as const)
      .filter(([command]) => command),
  );
  const parts: ChatPromptInlinePart[] = [];
  const usedFiles = new Set<number>();
  const pattern = /(^|[\s([{,;])(?:\/[A-Za-z0-9][A-Za-z0-9_-]*|@<[^>\r\n]+>|@[^\s)\]},;!?]+)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const prefix = match[1] ?? '';
    const start = match.index + prefix.length;
    const raw = text.slice(start, pattern.lastIndex);
    const replacement = inlinePartForRawToken(raw, files, usedFiles, skillByCommand);
    if (!replacement) {
      continue;
    }
    if (start > cursor) {
      parts.push({type: 'text', text: text.slice(cursor, start)});
    }
    parts.push(replacement);
    cursor = pattern.lastIndex;
  }

  if (cursor < text.length) {
    parts.push({type: 'text', text: text.slice(cursor)});
  }
  return mergeTextParts(parts.length > 0 ? parts : [{type: 'text', text}]);
}

function promptTextFromBlocks(blocks: RegistrySessionContentBlock[]): string {
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      return block.text;
    }
  }
  return '';
}

function inlinePartForRawToken(
  raw: string,
  files: {path: string; name: string}[],
  usedFiles: Set<number>,
  skillByCommand: Map<string, string>,
): ChatPromptInlinePart | null {
  if (raw.startsWith('/')) {
    const command = normalizeSkillCommand(raw);
    const label = skillByCommand.get(command) || skillLabelFromCommand(command);
    return label ? {type: 'skill', command, label} : null;
  }

  const label = raw.startsWith('@<') && raw.endsWith('>') ? raw.slice(2, -1) : raw.slice(1);
  const fileIndex = files.findIndex((file, index) => {
    if (usedFiles.has(index)) {
      return false;
    }
    return file.name === label || file.path === label || file.path.endsWith(`/${label}`);
  });
  if (fileIndex < 0) {
    return null;
  }
  usedFiles.add(fileIndex);
  const file = files[fileIndex];
  return {type: 'file', label, path: file.path, name: file.name};
}

function mergeTextParts(parts: ChatPromptInlinePart[]): ChatPromptInlinePart[] {
  const out: ChatPromptInlinePart[] = [];
  for (const part of parts) {
    if (part.type === 'text' && !part.text) {
      continue;
    }
    const previous = out[out.length - 1];
    if (part.type === 'text' && previous?.type === 'text') {
      previous.text += part.text;
    } else {
      out.push(part);
    }
  }
  return out;
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

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).pop() || normalized || 'file';
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
