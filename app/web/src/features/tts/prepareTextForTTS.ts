/**
 * Clean markdown text for TTS synthesis.
 * Strips code blocks, markdown syntax, etc.
 * Returns plain text suitable for speech synthesis.
 *
 * Note: thinking blocks (agent_thought_chunk) are already excluded
 * upstream by buildPromptDoneCopyRange, so no need to filter here.
 */
export function prepareTextForTTS(markdown: string): string {
  let text = markdown;

  // Remove fenced code blocks (```...```)
  text = text.replace(/```[\s\S]*?```/g, '');

  // Remove inline code backticks, keep content
  text = text.replace(/`([^`]*)`/g, '$1');

  // Remove image references ![alt](url)
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');

  // Extract link text from [text](url)
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Remove heading markers
  text = text.replace(/^#{1,6}\s+/gm, '');

  // Remove bold markers
  text = text.replace(/\*\*([^*]*)\*\*/g, '$1');
  text = text.replace(/__([^_]*)__/g, '$1');

  // Remove italic markers
  text = text.replace(/\*([^*]*)\*/g, '$1');
  text = text.replace(/_([^_]*)_/g, '$1');

  // Remove strikethrough markers
  text = text.replace(/~~([^~]*)~~/g, '$1');

  // Remove blockquote markers
  text = text.replace(/^>\s*/gm, '');

  // Remove horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, '');

  // Clean table markup: remove pipes, keep content
  text = text.replace(/^\|(.+)\|$/gm, (_match, content: string) => {
    return content
      .split('|')
      .map(cell => cell.trim())
      .filter(cell => !/^[-:]+$/.test(cell))
      .join(' ');
  });

  // Remove list markers (unordered)
  text = text.replace(/^[\s]*[-*+]\s+/gm, '');

  // Remove ordered list markers
  text = text.replace(/^[\s]*\d+\.\s+/gm, '');

  // Collapse multiple blank lines into one
  text = text.replace(/\n{3,}/g, '\n\n');

  // Trim
  text = text.trim();

  return text;
}
