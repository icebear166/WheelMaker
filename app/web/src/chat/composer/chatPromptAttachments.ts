import type {RegistrySessionContentBlock} from '../../registry/registryTypes';

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function promptAttachmentSizeLabel(size: unknown): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return '';
  }
  if (size < 1024) {
    return `${Math.round(size)} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function decodeUriSegment(segment: string): string {
  if (!segment) {
    return '';
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function fileNameFromUri(uri: string): string {
  const cleanUri = uri.split(/[?#]/, 1)[0] ?? '';
  const normalized = cleanUri.replace(/\\/g, '/');
  return decodeUriSegment(normalized.split('/').filter(Boolean).pop() ?? '');
}

function registryResourceLinkHasScheme(uri: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri.trim());
}

export function isProjectFileResourceLinkBlock(block: unknown): block is RegistrySessionContentBlock {
  if (!block || typeof block !== 'object') {
    return false;
  }
  const item = block as RegistrySessionContentBlock;
  const uri = cleanString(item.uri);
  return item.type === 'resource_link' && !!uri && !registryResourceLinkHasScheme(uri);
}

export function isPromptAttachmentContentBlock(block: unknown): block is RegistrySessionContentBlock {
  if (!block || typeof block !== 'object') {
    return false;
  }
  const item = block as RegistrySessionContentBlock;
  if (item.type === 'resource_link') {
    const uri = cleanString(item.uri);
    if (uri && !registryResourceLinkHasScheme(uri)) {
      return false;
    }
    return !!(uri || cleanString(item.name));
  }
  if (item.type === 'image') {
    return !!cleanString(item.uri);
  }
  return false;
}

export function promptAttachmentBlockCount(blocks: unknown): number {
  if (!Array.isArray(blocks)) {
    return 0;
  }
  return blocks.filter(isPromptAttachmentContentBlock).length;
}

export function chatPromptAttachmentLabel(block: RegistrySessionContentBlock, index: number): string {
  return cleanString(block.name) ||
    fileNameFromUri(cleanString(block.uri)) ||
    (block.type === 'image' ? `image-${index + 1}` : `attachment-${index + 1}`);
}

export function chatPromptAttachmentMeta(block: RegistrySessionContentBlock): string {
  return [
    cleanString(block.mimeType),
    promptAttachmentSizeLabel(block.size),
  ].filter(Boolean).join(' | ');
}
