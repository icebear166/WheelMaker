// Pure text-extraction helpers for chat session messages.
// Extracted from ChatTurnView so search indexing can reuse them without
// importing React or the markdown rendering pipeline.

export function extractTextFromACPContent(content: unknown): string {
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

export function extractTextFromSessionTurnParam(param: unknown): string {
  if (typeof param === 'string') {
    return param.trim();
  }
  if (Array.isArray(param)) {
    const chunks = param
      .map(item => {
        if (!item || typeof item !== 'object') return '';
        const entry = item as Record<string, unknown>;
        return typeof entry.content === 'string' ? entry.content.trim() : '';
      })
      .filter(Boolean);
    return chunks.join('\n').trim();
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

export function msgText(method: string, param: Record<string, unknown>): string {
  if (method === 'prompt_request') {
    const blocks = Array.isArray(param.contentBlocks) ? param.contentBlocks : [];
    return extractTextFromACPContent(blocks);
  }
  if (method === 'prompt_done') {
    return typeof param.stopReason === 'string' ? param.stopReason : '';
  }
  return extractTextFromSessionTurnParam(param);
}
