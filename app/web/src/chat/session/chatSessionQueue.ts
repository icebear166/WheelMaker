import type {
  RegistryChatMessage,
  RegistrySessionQueueItem,
  RegistrySessionQueueSnapshot,
} from '../../registry/registryTypes';

export type ChatSessionQueuesByKey = Record<string, RegistrySessionQueueSnapshot>;

function cloneQueueItem(item: RegistrySessionQueueItem): RegistrySessionQueueItem {
  if (item.kind === 'prompt') {
    return {
      ...item,
      blocks: item.blocks.map(block => ({...block})),
    };
  }
  return {...item};
}

function cloneQueue(queue: RegistrySessionQueueSnapshot): RegistrySessionQueueSnapshot {
  return {
    ...queue,
    ...(queue.activeItem ? {activeItem: cloneQueueItem(queue.activeItem)} : {}),
    ...(queue.waitingItems
      ? {waitingItems: queue.waitingItems.map(cloneQueueItem)}
      : {}),
  };
}

export function mergeChatSessionQueueProjection(
  current: RegistrySessionQueueSnapshot | undefined,
  incoming: RegistrySessionQueueSnapshot | undefined,
): RegistrySessionQueueSnapshot | undefined {
  if (!incoming?.generation) return current;
  if (!current || current.generation !== incoming.generation) return cloneQueue(incoming);
  if (incoming.revision <= current.revision) return current;
  return cloneQueue(incoming);
}

export function fullQueueSnapshot(
  queue: RegistrySessionQueueSnapshot | undefined,
): RegistrySessionQueueSnapshot | undefined {
  if (!queue) return undefined;
  if (queue.activeItem || Array.isArray(queue.waitingItems) || queue.waitingCount === 0) {
    return cloneQueue(queue);
  }
  return undefined;
}

export function queueDisplayItems(
  queue: RegistrySessionQueueSnapshot | undefined,
  transcriptItemIDs: ReadonlySet<string> = new Set<string>(),
): RegistrySessionQueueItem[] {
  const activeItem = queue?.activeItem;
  const representedByTranscript = !!activeItem &&
    transcriptItemIDs.has(activeItem.itemId) &&
    (
      activeItem.status === 'cancelling' ||
      (activeItem.kind === 'compact' && activeItem.status === 'running')
    );
  const activeDisplay = activeItem && (
    activeItem.status === 'failed' ||
    activeItem.status === 'cancelling' ||
    activeItem.kind === 'compact'
  ) && !representedByTranscript
    ? [activeItem]
    : [];
  return [...activeDisplay, ...(queue?.waitingItems ?? [])].map(cloneQueueItem);
}

export function queueTranscriptItemIDs(
  messages: RegistryChatMessage[],
): Set<string> {
  const itemIDs = new Set<string>();
  for (const message of messages) {
    const rawID = message.method === 'prompt_request'
      ? message.param.clientMessageId
      : message.method === 'session_operation'
        ? message.param.operationId
        : undefined;
    if (typeof rawID !== 'string') continue;
    const itemID = rawID.trim();
    if (itemID) itemIDs.add(itemID);
  }
  return itemIDs;
}

export function makeSessionQueueItemID(): string {
  const runtimeCrypto = globalThis.crypto as Crypto | undefined;
  if (typeof runtimeCrypto?.randomUUID === 'function') {
    return runtimeCrypto.randomUUID();
  }
  return `queue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function buildQueuePromptMessage(
  sessionId: string,
  item: RegistrySessionQueueItem,
  turnIndex: number,
): RegistryChatMessage {
  const blocks = item.kind === 'prompt'
    ? item.blocks.map(block => ({...block}))
    : [];
  return {
    sessionId,
    turnIndex,
    method: 'prompt_request',
    param: {
      contentBlocks: blocks,
      createdAt: item.createdAt,
      queuedPromptId: item.itemId,
      queueStatus: item.status,
    },
    finished: false,
  };
}
