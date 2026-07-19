export const FIXED_CHAT_COLUMN_WIDTH = 800;

export type FixedChatAlignmentInput = {
  /** Width of the chat-main area in px (window minus preview minus pinned sidebar). */
  mainWidth: number;
  /** Reserved width for the floating surface column on the left; 0 when no surface is visible. */
  surfaceReservedWidth: number;
  /** Minimum gutter kept on the right side of the column. */
  edgeGap: number;
  /** Conversation column width; defaults to the fixed 800px view. */
  columnWidth?: number;
};

/**
 * Continuous three-phase margin for the fixed-width chat column:
 * 1. centered while there is slack;
 * 2. docked to the surface reservation (right gutter shrinks first);
 * 3. overlapping the surface (fade mask) once the right gutter bottoms out.
 */
export function resolveFixedChatMarginLeft(input: FixedChatAlignmentInput): number {
  const columnWidth = input.columnWidth ?? FIXED_CHAT_COLUMN_WIDTH;
  const column = Math.min(columnWidth, input.mainWidth);
  const centered = (input.mainWidth - column) / 2;
  const rightMin = input.mainWidth - column - input.edgeGap;
  const docked = Math.min(input.surfaceReservedWidth, rightMin);
  const margin = Math.min(Math.max(centered, docked), rightMin);
  return Math.max(0, margin);
}
