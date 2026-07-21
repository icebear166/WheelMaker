import type {RegistryChatMessage} from '../../registry/registryTypes';
import type {ChatPromptStatus} from './chatPromptStatus';
import {
  splitChatConfirmationReplyText,
  splitChatOptionReplyText,
} from '../chatOptionReplies';
import {promptAttachmentBlockCount} from '../composer/chatPromptAttachments';
import type {ChatPermissionState} from '../permission/chatPermissionState';

export type ChatDisplayIndexItem = {
  kind: 'turn' | 'tool-group' | 'pending' | 'queued';
  compact?: boolean;
  key: string;
  turnIndex: number;
  endTurnIndex: number;
  sourceIndex: number;
  sourceIndexes: number[];
  estimatedHeight: number;
};

export type ChatDisplayIndex = {
  items: ChatDisplayIndexItem[];
};

export type ChatTurnHeightMetrics = {
  contentWidth: number;
  textFontSize: number;
  textLineHeight: number;
  paragraphGap: number;
  promptFontSize: number;
  promptLineHeight: number;
  promptHorizontalPadding: number;
  promptVerticalPadding: number;
  promptGroupVerticalPadding: number;
  promptGroupGap: number;
  promptMaxWidth: number;
  toolLineHeight: number;
  thoughtCollapsedHeight: number;
  optionButtonMinHeight: number;
  optionButtonMaxWidth: number;
  confirmationButtonMinHeight: number;
  confirmationButtonMaxWidth: number;
  imageStripHeight: number;
  attachmentChipHeight: number;
};

export type ChatTurnHeightContext = {
  layoutMetrics?: Partial<ChatTurnHeightMetrics>;
  promptStatus?: ChatPromptStatus;
};

export type ChatDisplayIndexOptions = {
  shouldRender?: (message: RegistryChatMessage, promptStatus: ChatPromptStatus) => boolean;
  layoutMetrics?: Partial<ChatTurnHeightMetrics>;
  promptStatus?: (message: RegistryChatMessage) => ChatPromptStatus;
  pendingKey?: string;
  pendingEstimatedHeight?: number;
  queuedKeys?: string[];
  queuedEstimatedHeight?: number;
  permissionState?: ChatPermissionState;
};

export const DEFAULT_CHAT_TURN_HEIGHT_METRICS: ChatTurnHeightMetrics = {
  contentWidth: 720,
  textFontSize: 14,
  textLineHeight: 22,
  paragraphGap: 7,
  promptFontSize: 13,
  promptLineHeight: 18,
  promptHorizontalPadding: 24,
  promptVerticalPadding: 16,
  promptGroupVerticalPadding: 22,
  promptGroupGap: 8,
  promptMaxWidth: 920,
  toolLineHeight: 28,
  thoughtCollapsedHeight: 28,
  optionButtonMinHeight: 30,
  optionButtonMaxWidth: 560,
  confirmationButtonMinHeight: 32,
  confirmationButtonMaxWidth: 620,
  imageStripHeight: 232,
  attachmentChipHeight: 34,
};

function positiveTurnIndex(message: RegistryChatMessage): number {
  const turnIndex = Number(message.turnIndex ?? 0);
  return Number.isFinite(turnIndex) ? Math.max(0, Math.trunc(turnIndex)) : 0;
}

function displayKey(message: RegistryChatMessage): string {
  return `${message.sessionId}:${positiveTurnIndex(message)}:${message.method}`;
}

function sessionOperationId(message: RegistryChatMessage): string {
  if (message.method !== 'session_operation' || !message.param || typeof message.param !== 'object') {
    return '';
  }
  const operationId = (message.param as Record<string, unknown>).operationId;
  return typeof operationId === 'string' ? operationId.trim() : '';
}

function normalizeMetrics(input: Partial<ChatTurnHeightMetrics> | undefined): ChatTurnHeightMetrics {
  const base = DEFAULT_CHAT_TURN_HEIGHT_METRICS;
  const metrics = {...base, ...(input ?? {})};
  return {
    ...metrics,
    contentWidth: Math.max(240, Math.round(metrics.contentWidth)),
    textFontSize: Math.max(8, metrics.textFontSize),
    textLineHeight: Math.max(10, metrics.textLineHeight),
    paragraphGap: Math.max(0, metrics.paragraphGap),
    promptFontSize: Math.max(8, metrics.promptFontSize),
    promptLineHeight: Math.max(10, metrics.promptLineHeight),
  };
}

function clampHeight(value: number): number {
  return Math.max(24, Math.min(8000, Math.round(value)));
}

function isPromptStartMethod(method: string): boolean {
  return method === 'prompt_request' || method === 'user_message_chunk';
}

function isToolCallMethod(method: string): boolean {
  return method === 'tool_call';
}

function extractTextFromACPContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const chunks: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.text === 'string' && entry.text.trim()) {
      chunks.push(entry.text.trim());
    }
  }
  return chunks.join('\n').trim();
}

function extractTextFromParam(param: unknown): string {
  if (typeof param === 'string') {
    return param.trim();
  }
  if (Array.isArray(param)) {
    return param
      .map(item => {
        if (!item || typeof item !== 'object') return '';
        const entry = item as Record<string, unknown>;
        return typeof entry.content === 'string' ? entry.content.trim() : '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (!param || typeof param !== 'object') {
    return '';
  }
  const input = param as Record<string, unknown>;
  if (typeof input.text === 'string') {
    return input.text.trim();
  }
  if (typeof input.output === 'string') {
    return input.output.trim();
  }
  if (typeof input.cmd === 'string') {
    return input.cmd.trim();
  }
  if (Array.isArray(input.contentBlocks)) {
    return extractTextFromACPContent(input.contentBlocks);
  }
  return '';
}

function messageText(message: RegistryChatMessage): string {
  const param = message.param ?? {};
  if (message.method === 'prompt_request') {
    const blockText = extractTextFromACPContent(param.contentBlocks);
    return blockText || extractTextFromParam(param);
  }
  if (message.method === 'prompt_done') {
    const stopReason = typeof param.stopReason === 'string' ? param.stopReason.trim() : '';
    const resultMessage = typeof param.message === 'string' ? param.message.trim() : '';
    return [stopReason, resultMessage].filter(Boolean).join('\n');
  }
  return extractTextFromParam(param);
}

function imageBlockCount(message: RegistryChatMessage): number {
  const blocks = message.param?.contentBlocks;
  if (!Array.isArray(blocks)) {
    return 0;
  }
  return blocks.filter(item => {
    if (!item || typeof item !== 'object') return false;
    const block = item as Record<string, unknown>;
    return block.type === 'image' && typeof block.data === 'string' && block.data.trim();
  }).length;
}

function textWidthUnits(text: string): number {
  let units = 0;
  for (const char of text) {
    if (/\s/.test(char)) {
      units += 0.35;
    } else if (/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char)) {
      units += 1;
    } else if (/[\dA-Z]/.test(char)) {
      units += 0.66;
    } else if (/[il.,:;|!]/.test(char)) {
      units += 0.32;
    } else {
      units += 0.56;
    }
  }
  return units;
}

function stripMarkdownMarkers(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+\.\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/[*_`~[\]()]/g, '');
}

function estimateWrappedRows(text: string, width: number, fontSize: number): number {
  const maxUnits = Math.max(8, width / Math.max(1, fontSize));
  const lines = text.split(/\r?\n/);
  return lines.reduce((sum, rawLine) => {
    const line = stripMarkdownMarkers(rawLine);
    if (!line.trim()) {
      return sum + 1;
    }
    return sum + Math.max(1, Math.ceil(textWidthUnits(line) / maxUnits));
  }, 0);
}

function estimateMarkdownTextHeight(text: string, metrics: ChatTurnHeightMetrics): number {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }
  const blocks = normalized.split(/\r?\n\s*\r?\n/).filter(block => block.trim());
  if (blocks.length === 0) {
    return 0;
  }
  const rows = blocks.reduce(
    (sum, block) => sum + estimateWrappedRows(block, metrics.contentWidth, metrics.textFontSize),
    0,
  );
  return rows * metrics.textLineHeight + Math.max(0, blocks.length - 1) * metrics.paragraphGap;
}

function estimateOptionLineHeight(text: string, metrics: ChatTurnHeightMetrics): number {
  const width = Math.max(120, Math.min(metrics.contentWidth, metrics.optionButtonMaxWidth) - 42);
  const rows = estimateWrappedRows(text, width, metrics.textFontSize);
  return Math.max(metrics.optionButtonMinHeight, rows * metrics.textLineHeight * 0.9 + 12) + 6;
}

function estimateConfirmationLineHeight(text: string, metrics: ChatTurnHeightMetrics): number {
  const width = Math.max(120, Math.min(metrics.contentWidth, metrics.confirmationButtonMaxWidth) - 48);
  const rows = estimateWrappedRows(text, width, metrics.textFontSize);
  return Math.max(metrics.confirmationButtonMinHeight, rows * metrics.textLineHeight * 0.95 + 10) + 6;
}

function estimateAssistantTextHeight(text: string, metrics: ChatTurnHeightMetrics): number {
  const optionParts = splitChatOptionReplyText(text);
  if (optionParts.some(part => part.type === 'option')) {
    return optionParts.reduce((sum, part) => {
      if (part.type === 'markdown') {
        return sum + estimateMarkdownTextHeight(part.text, metrics);
      }
      return sum + estimateOptionLineHeight(part.reply.text, metrics);
    }, 0);
  }
  const confirmationParts = splitChatConfirmationReplyText(text);
  if (confirmationParts.some(part => part.type === 'confirmation')) {
    return confirmationParts.reduce((sum, part) => {
      if (part.type === 'markdown') {
        return sum + estimateMarkdownTextHeight(part.text, metrics);
      }
      return sum + estimateConfirmationLineHeight(part.reply.sentence, metrics);
    }, 0);
  }
  return estimateMarkdownTextHeight(text, metrics);
}

function estimatePromptStartHeight(
  message: RegistryChatMessage,
  context: ChatTurnHeightContext,
  metrics: ChatTurnHeightMetrics,
): number {
  const text = messageText(message);
  const promptWidth = Math.max(
    120,
    Math.min(metrics.contentWidth, metrics.promptMaxWidth) - metrics.promptHorizontalPadding - 2,
  );
  const textRows = text ? estimateWrappedRows(text, promptWidth, metrics.promptFontSize) : 0;
  const textHeight = textRows > 0
    ? textRows * metrics.promptLineHeight + metrics.promptVerticalPadding + 2
    : 0;
  const statusHeight = context.promptStatus ? 18 : 0;
  const rowHeight = Math.max(textHeight, statusHeight);
  const images = imageBlockCount(message);
  const imageRows = images > 0
    ? Math.ceil(images / Math.max(1, Math.floor(metrics.contentWidth / 288)))
    : 0;
  const imageHeight = imageRows > 0 ? imageRows * metrics.imageStripHeight : 0;
  const attachmentBlocks = promptAttachmentBlockCount(message.param?.contentBlocks);
  const attachmentRows = attachmentBlocks > 0
    ? Math.ceil(attachmentBlocks / Math.max(1, Math.floor(metrics.contentWidth / 252)))
    : 0;
  const attachmentHeight = attachmentRows > 0
    ? attachmentRows * metrics.attachmentChipHeight
    : 0;
  const deliveryHeight = context.promptStatus === 'undelivered' ? 22 : 0;
  const visibleSections = [rowHeight, imageHeight, attachmentHeight, deliveryHeight].filter(height => height > 0);
  const gaps = Math.max(0, visibleSections.length - 1) * metrics.promptGroupGap;
  return clampHeight(
    metrics.promptGroupVerticalPadding +
      visibleSections.reduce((sum, height) => sum + height, 0) +
      gaps,
  );
}

function promptDoneHasResultLine(message: RegistryChatMessage): boolean {
  const stopReason = typeof message.param?.stopReason === 'string'
    ? message.param.stopReason.trim().toLowerCase()
    : '';
  return stopReason === 'cancelled' ||
    stopReason === 'canceled' ||
    stopReason === 'interrupted' ||
    stopReason === 'failed' ||
    stopReason === 'error';
}

export function estimateChatTurnHeight(
  message: RegistryChatMessage,
  context: ChatTurnHeightContext = {},
): number {
  const metrics = normalizeMetrics(context.layoutMetrics);
  if (isPromptStartMethod(message.method)) {
    return estimatePromptStartHeight(message, context, metrics);
  }
  if (message.method === 'session_operation') {
    return 44;
  }
  if (message.method === 'permission_request') {
    return 36;
  }
  if (message.method === 'prompt_done') {
    return clampHeight(38 + (promptDoneHasResultLine(message) ? 18 : 0));
  }
  if (isToolCallMethod(message.method)) {
    return clampHeight(metrics.toolLineHeight);
  }
  if (message.method === 'agent_thought_chunk') {
    return clampHeight(metrics.thoughtCollapsedHeight);
  }
  if (message.method === 'agent_plan') {
    return clampHeight(0);
  }
  const text = messageText(message);
  return clampHeight(estimateAssistantTextHeight(text, metrics));
}

type ChatTurnHeightCacheEntry = {
  layoutMetrics: Partial<ChatTurnHeightMetrics> | undefined;
  promptStatus: ChatPromptStatus;
  estimatedHeight: number;
};

const chatTurnHeightCache = new WeakMap<RegistryChatMessage, ChatTurnHeightCacheEntry>();

function cachedChatTurnHeight(
  message: RegistryChatMessage,
  layoutMetrics: Partial<ChatTurnHeightMetrics> | undefined,
  promptStatus: ChatPromptStatus,
): number {
  const cached = chatTurnHeightCache.get(message);
  if (
    cached &&
    cached.layoutMetrics === layoutMetrics &&
    cached.promptStatus === promptStatus
  ) {
    return cached.estimatedHeight;
  }
  const estimatedHeight = estimateChatTurnHeight(message, {layoutMetrics, promptStatus});
  chatTurnHeightCache.set(message, {layoutMetrics, promptStatus, estimatedHeight});
  return estimatedHeight;
}

export function buildChatDisplayIndex(
  messages: RegistryChatMessage[],
  options: ChatDisplayIndexOptions = {},
): ChatDisplayIndex {
  const sorted = messages
    .map((message, sourceIndex) => ({message, sourceIndex}))
    .filter(item => positiveTurnIndex(item.message) > 0);
  for (let index = 1; index < sorted.length; index += 1) {
    if (positiveTurnIndex(sorted[index - 1].message) > positiveTurnIndex(sorted[index].message)) {
      sorted.sort((left, right) => positiveTurnIndex(left.message) - positiveTurnIndex(right.message));
      break;
    }
  }
  const items: ChatDisplayIndexItem[] = [];
  const metrics = normalizeMetrics(options.layoutMetrics);
  const latestOperationSourceIndex = new Map<string, number>();
  for (const item of sorted) {
    const operationId = sessionOperationId(item.message);
    if (operationId) {
      latestOperationSourceIndex.set(operationId, item.sourceIndex);
    }
  }
  let activeToolGroup: ChatDisplayIndexItem | null = null;
  for (const item of sorted) {
    const turnIndex = positiveTurnIndex(item.message);
    if (item.message.method === 'permission_response' && options.permissionState?.hiddenTurnIndexes.has(turnIndex)) {
      continue;
    }
    if (item.message.method === 'permission_request') {
      const permission = options.permissionState?.byRequestTurnIndex.get(turnIndex);
      if (!permission || permission.status === 'pending') {
        continue;
      }
    }
    if (item.message.method === 'agent_plan') {
      continue;
    }
    const operationId = sessionOperationId(item.message);
    if (operationId && latestOperationSourceIndex.get(operationId) !== item.sourceIndex) {
      continue;
    }
    const promptStatus = options.promptStatus?.(item.message) ?? null;
    const terminalPermission = item.message.method === 'permission_request' &&
      options.permissionState?.byRequestTurnIndex.get(turnIndex)?.status !== 'pending';
    if (!operationId && !terminalPermission && options.shouldRender && !options.shouldRender(item.message, promptStatus)) {
      continue;
    }
    if (isToolCallMethod(item.message.method)) {
      if (activeToolGroup) {
        activeToolGroup.endTurnIndex = turnIndex;
        activeToolGroup.sourceIndexes.push(item.sourceIndex);
      } else {
        activeToolGroup = {
          kind: 'tool-group',
          compact: true,
          key: `${item.message.sessionId}:${turnIndex}:tool-group`,
          turnIndex,
          endTurnIndex: turnIndex,
          sourceIndex: item.sourceIndex,
          sourceIndexes: [item.sourceIndex],
          estimatedHeight: clampHeight(metrics.toolLineHeight),
        };
        items.push(activeToolGroup);
      }
      continue;
    }
    activeToolGroup = null;
    const estimatedHeight = cachedChatTurnHeight(
      item.message,
      options.layoutMetrics,
      promptStatus,
    );
    items.push({
      kind: 'turn',
      ...(item.message.method === 'agent_thought_chunk' || item.message.method === 'permission_request' ? {compact: true} : {}),
      key: displayKey(item.message),
      turnIndex,
      endTurnIndex: turnIndex,
      sourceIndex: item.sourceIndex,
      sourceIndexes: [item.sourceIndex],
      estimatedHeight,
    });
  }
  const pendingKey = options.pendingKey?.trim();
  if (pendingKey) {
    items.push({
      kind: 'pending',
      key: pendingKey,
      turnIndex: 0,
      endTurnIndex: 0,
      sourceIndex: -1,
      sourceIndexes: [],
      estimatedHeight: Math.max(56, Math.trunc(options.pendingEstimatedHeight ?? 120)),
    });
  }
  for (const queuedKey of options.queuedKeys ?? []) {
    const key = queuedKey.trim();
    if (!key) continue;
    items.push({
      kind: 'queued',
      key,
      turnIndex: 0,
      endTurnIndex: 0,
      sourceIndex: -1,
      sourceIndexes: [],
      estimatedHeight: Math.max(72, Math.trunc(options.queuedEstimatedHeight ?? 128)),
    });
  }
  return {items};
}

export function chatDisplayItemContainsTurn(
  item: ChatDisplayIndexItem,
  turnIndex: number,
): boolean {
  const targetTurnIndex = Number.isFinite(turnIndex) ? Math.max(0, Math.trunc(turnIndex)) : 0;
  return targetTurnIndex > 0 &&
    targetTurnIndex >= item.turnIndex &&
    targetTurnIndex <= item.endTurnIndex;
}

export function resolveActiveToolGroupKey(
  displayIndex: ChatDisplayIndex,
  promptRunning: boolean,
): string {
  if (!promptRunning) {
    return '';
  }
  for (let index = displayIndex.items.length - 1; index >= 0; index -= 1) {
    const item = displayIndex.items[index];
    if (item.kind === 'pending' || item.kind === 'queued') {
      continue;
    }
    return item.kind === 'tool-group' ? item.key : '';
  }
  return '';
}

export function resolveChatDisplayScrollIndex(displayIndex: ChatDisplayIndex, turnIndex: number): number | null {
  const targetTurnIndex = Number.isFinite(turnIndex) ? Math.max(0, Math.trunc(turnIndex)) : 0;
  if (targetTurnIndex <= 0 || displayIndex.items.length === 0) {
    return null;
  }
  const exactIndex = displayIndex.items.findIndex(item =>
    chatDisplayItemContainsTurn(item, targetTurnIndex),
  );
  if (exactIndex >= 0) {
    return exactIndex;
  }
  const followingIndex = displayIndex.items.findIndex(item => item.turnIndex > targetTurnIndex);
  if (followingIndex >= 0) {
    return followingIndex;
  }
  return displayIndex.items.length - 1;
}
