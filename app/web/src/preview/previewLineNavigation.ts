export type PreviewLineMode = 'code' | 'markdown';

function sourceLineRange(node: unknown): {start: number; end: number} | null {
  const position = (node as {
    position?: {
      start?: {line?: unknown};
      end?: {line?: unknown};
    };
  } | null)?.position;
  const start = Number(position?.start?.line);
  const end = Number(position?.end?.line);
  if (!Number.isFinite(start) || start <= 0) return null;
  return {
    start,
    end: Number.isFinite(end) && end >= start ? end : start,
  };
}

export function markdownSourceTargetProps(node: unknown, targetLine?: number | null) {
  const range = sourceLineRange(node);
  if (!range) return {};
  const isTarget = !!targetLine && targetLine >= range.start && targetLine <= range.end;
  return {
    'data-source-line-start': String(range.start),
    'data-source-line-end': String(range.end),
    'data-source-line-target': isTarget ? 'true' : undefined,
  };
}

type PreviewLineElement = {
  dataset?: Record<string, string | undefined>;
  getBoundingClientRect: () => {top: number; height: number};
};

type PreviewLineContainer = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  getBoundingClientRect: () => {top: number};
  querySelector: (selector: string) => unknown;
  querySelectorAll: (selector: string) => ArrayLike<unknown>;
};

export function findPreviewLineTarget(
  container: Pick<PreviewLineContainer, 'querySelector' | 'querySelectorAll'>,
  line: number,
  mode: PreviewLineMode,
): PreviewLineElement | null {
  const normalizedLine = Math.max(1, Math.trunc(line));
  if (mode === 'code') {
    return container.querySelector(
      `.code-wrap [data-line-number="${normalizedLine}"]`,
    ) as PreviewLineElement | null;
  }

  const candidates = Array.from(
    container.querySelectorAll('[data-source-line-start][data-source-line-end]'),
  ) as PreviewLineElement[];
  return candidates.reduce<{
    element: PreviewLineElement;
    span: number;
  } | null>((best, candidate) => {
    const start = Number(candidate.dataset?.sourceLineStart);
    const end = Number(candidate.dataset?.sourceLineEnd);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      normalizedLine < start ||
      normalizedLine > end
    ) {
      return best;
    }
    const span = end - start;
    return !best || span < best.span ? {element: candidate, span} : best;
  }, null)?.element ?? null;
}

function centerPreviewLine(
  container: PreviewLineContainer,
  target: PreviewLineElement,
): void {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const delta =
    targetRect.top -
    containerRect.top -
    container.clientHeight / 2 +
    targetRect.height / 2;
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  container.scrollTop = Math.min(
    maxScrollTop,
    Math.max(0, container.scrollTop + delta),
  );
}

function approximatePreviewLine(
  container: PreviewLineContainer,
  line: number,
  content: string,
  mode: PreviewLineMode,
  lineHeight: number,
): void {
  const normalizedLine = Math.max(1, Math.trunc(line));
  const totalLines = Math.max(1, content.split('\n').length);
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  if (mode === 'markdown') {
    const ratio = Math.min(
      1,
      Math.max(0, (normalizedLine - 1) / Math.max(1, totalLines - 1)),
    );
    container.scrollTop = Math.round(maxScrollTop * ratio);
    return;
  }

  const targetLine = Math.min(normalizedLine, totalLines);
  const centeredTop =
    (targetLine - 1) * Math.max(1, lineHeight) -
    container.clientHeight / 2 +
    Math.max(1, lineHeight) / 2;
  container.scrollTop = Math.min(maxScrollTop, Math.max(0, Math.round(centeredTop)));
}

export function jumpToPreviewLineNow(options: {
  container: PreviewLineContainer;
  line: number;
  content: string;
  mode: PreviewLineMode;
  lineHeight: number;
}): boolean {
  const target = findPreviewLineTarget(options.container, options.line, options.mode);
  if (target) {
    centerPreviewLine(options.container, target);
    return true;
  }
  approximatePreviewLine(
    options.container,
    options.line,
    options.content,
    options.mode,
    options.lineHeight,
  );
  return false;
}

export function schedulePreviewLineJump(options: {
  getContainer: () => unknown;
  isCurrent: () => boolean;
  line: number;
  content: string;
  mode: PreviewLineMode;
  lineHeight: number;
  maxAttempts?: number;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  resolveTarget?: (container: unknown) => unknown;
  onMiss?: (container: unknown, attempt: number) => void;
  approximate?: boolean;
  onFinish?: (exact: boolean) => void;
}): () => void {
  const requestFrame = options.requestFrame ?? window.requestAnimationFrame.bind(window);
  const cancelFrame = options.cancelFrame ?? window.cancelAnimationFrame.bind(window);
  const maxAttempts = Math.max(1, options.maxAttempts ?? 120);
  let frameHandle: number | null = null;
  let cancelled = false;
  let attempt = 0;

  const run = () => {
    frameHandle = null;
    if (cancelled || !options.isCurrent()) {
      return;
    }
    const container = options.getContainer() as PreviewLineContainer | null;
    if (!container) {
      if (attempt < maxAttempts) {
        attempt += 1;
        frameHandle = requestFrame(run);
      } else {
        options.onFinish?.(false);
      }
      return;
    }

    const customTarget = options.resolveTarget?.(container) as PreviewLineElement | null | undefined;
    const exactTarget = customTarget ?? (
      options.resolveTarget
        ? null
        : findPreviewLineTarget(container, options.line, options.mode)
    );
    if (exactTarget) {
      centerPreviewLine(container, exactTarget);
      options.onFinish?.(true);
      return;
    }
    options.onMiss?.(container, attempt);
    if (options.approximate !== false) {
      approximatePreviewLine(
        container,
        options.line,
        options.content,
        options.mode,
        options.lineHeight,
      );
    }
    if (attempt < maxAttempts) {
      attempt += 1;
      frameHandle = requestFrame(run);
    } else {
      options.onFinish?.(false);
    }
  };

  frameHandle = requestFrame(run);
  return () => {
    cancelled = true;
    if (frameHandle !== null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
  };
}
