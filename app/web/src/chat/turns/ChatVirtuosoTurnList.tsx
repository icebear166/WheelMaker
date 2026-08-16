import React from 'react';
import {Virtuoso, type Components, type VirtuosoHandle} from 'react-virtuoso';
import type {ChatDisplayIndex, ChatDisplayIndexItem} from './chatDisplayIndex';
import {resolveChatDisplayScrollIndex} from './chatDisplayIndex';
import {resolveChatScrollBottomTop} from '../layout/chatScrollIntent';

const DEFAULT_AT_BOTTOM_THRESHOLD = 80;
const DEFAULT_BOTTOM_BUFFER = 0;

type ChatVirtuosoScrollBehavior = 'auto' | 'smooth';

type ChatVirtuosoContext = {
  bottomBuffer: number;
  rowGap: number;
};

export type ChatVirtuosoItem = {
  end: number;
  index: number;
  key: string;
  lane: number;
  size: number;
  start: number;
};

export type ChatVirtuosoTurnListHandle = {
  autoscrollToBottom: () => void;
  scrollToBottom: (behavior?: ChatVirtuosoScrollBehavior) => void;
  scrollToTop: (behavior?: ChatVirtuosoScrollBehavior) => void;
  scrollToTurnIndex: (turnIndex: number, behavior?: ChatVirtuosoScrollBehavior) => void;
};

export type ChatVirtuosoTurnListProps = {
  scrollRef: React.RefObject<HTMLElement | null>;
  displayIndex: ChatDisplayIndex;
  runtimeKey: string;
  overscan?: number;
  rowGap?: number;
  bottomBuffer?: number;
  atBottomThreshold?: number;
  onAtBottomChange?: (atBottom: boolean) => void;
  onVisibleTurnChange?: (turnIndex: number) => void;
  shouldAutoscroll?: () => boolean;
  renderItem: (item: ChatDisplayIndexItem, virtualItem: ChatVirtuosoItem) => React.ReactNode;
};

/**
 * First rendered row whose bottom edge crosses the viewport top — the row the
 * reader is currently looking at. Rows fully scrolled above (bottom at or
 * under the viewport top) are skipped; returns null when nothing is visible.
 */
export function findTopVisibleRowIndex(
  rows: Array<{index: number; bottom: number}>,
  viewportTop: number,
): number | null {
  for (const row of rows) {
    if (row.bottom > viewportTop + 1) {
      return row.index;
    }
  }
  return null;
}

const ChatVirtuosoList: Components<ChatDisplayIndexItem, ChatVirtuosoContext>['List'] =
  React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
    ({children, style, ...props}, ref) => (
      <div
        {...props}
        ref={ref}
        className="chat-virtuoso-list"
        style={style}
      >
        {children}
      </div>
    ),
  );

const ChatVirtuosoItem: Components<ChatDisplayIndexItem, ChatVirtuosoContext>['Item'] = ({
  children,
  context,
  item,
  style,
  ...props
}) => (
  <div
    {...props}
    className="chat-virtuoso-row"
    style={{
      ...style,
      paddingBottom: `${resolveItemRowGap(item, context.rowGap)}px`,
    }}
  >
    {children}
  </div>
);

const ChatVirtuosoFooter: Components<ChatDisplayIndexItem, ChatVirtuosoContext>['Footer'] = ({
  context,
}) => (
  <div
    aria-hidden="true"
    className="chat-virtuoso-footer"
    style={{
      height: `${context.bottomBuffer}px`,
    }}
  />
);

const ChatVirtuosoComponents: Components<ChatDisplayIndexItem, ChatVirtuosoContext> = {
  Footer: ChatVirtuosoFooter,
  Item: ChatVirtuosoItem,
  List: ChatVirtuosoList,
};

function resolveItemRowGap(item: ChatDisplayIndexItem | undefined, rowGap: number): number {
  return item?.compact ? Math.min(4, rowGap) : rowGap;
}

function resolveEstimatedItemHeight(item: ChatDisplayIndexItem | undefined, rowGap: number): number {
  return Math.max(1, Math.round((item?.estimatedHeight ?? 120) + resolveItemRowGap(item, rowGap)));
}

function resolveDefaultItemHeight(heightEstimates: number[], rowGap: number): number {
  if (heightEstimates.length === 0) {
    return resolveEstimatedItemHeight(undefined, rowGap);
  }
  const totalHeight = heightEstimates.reduce((sum, height) => sum + height, 0);
  return Math.max(1, Math.round(totalHeight / heightEstimates.length));
}

function scrollElementToBottom(element: HTMLElement, behavior: ChatVirtuosoScrollBehavior): void {
  element.scrollTo({
    top: resolveChatScrollBottomTop({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }),
    behavior,
  });
}

const ChatVirtuosoTurnListInner = React.forwardRef<
  ChatVirtuosoTurnListHandle,
  ChatVirtuosoTurnListProps
>(function ChatVirtuosoTurnList({
  scrollRef,
  displayIndex,
  runtimeKey,
  overscan = 8,
  rowGap = 10,
  bottomBuffer = DEFAULT_BOTTOM_BUFFER,
  atBottomThreshold = DEFAULT_AT_BOTTOM_THRESHOLD,
  onAtBottomChange,
  onVisibleTurnChange,
  shouldAutoscroll,
  renderItem,
}: ChatVirtuosoTurnListProps, ref) {
  const virtuosoRef = React.useRef<VirtuosoHandle | null>(null);
  const tailLockSettleFrameRef = React.useRef<number | null>(null);
  const tailLockSettleFollowupFrameRef = React.useRef<number | null>(null);
  const turnScrollSettleFrameRef = React.useRef<number | null>(null);
  const displayIndexRef = React.useRef(displayIndex);
  displayIndexRef.current = displayIndex;
  const lastReportedVisibleTurnRef = React.useRef(-1);
  const [scrollParent, setScrollParent] = React.useState<HTMLElement | null>(null);
  const previousTailRef = React.useRef<{
    runtimeKey: string;
    key: string;
    itemCount: number;
  } | null>(null);
  const [entryKey, setEntryKey] = React.useState('');
  const itemCount = displayIndex.items.length;
  const tailKey = displayIndex.items[itemCount - 1]?.key ?? '';

  React.useEffect(() => {
    const previous = previousTailRef.current;
    previousTailRef.current = {runtimeKey, key: tailKey, itemCount};
    const appended =
      !!tailKey &&
      !!previous &&
      previous.runtimeKey === runtimeKey &&
      itemCount > previous.itemCount &&
      previous.key !== tailKey;
    if (!appended) {
      setEntryKey('');
      return undefined;
    }
    setEntryKey(tailKey);
    const timer = window.setTimeout(() => {
      setEntryKey(current => current === tailKey ? '' : current);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [itemCount, runtimeKey, tailKey]);

  React.useLayoutEffect(() => {
    let cancelled = false;
    let frameId = 0;
    let attempts = 0;

    const syncScrollParent = () => {
      if (cancelled) {
        return;
      }
      const nextScrollParent = scrollRef.current;
      setScrollParent(current => current === nextScrollParent ? current : nextScrollParent);
      if (!nextScrollParent && attempts < 3) {
        attempts += 1;
        frameId = window.requestAnimationFrame(syncScrollParent);
      }
    };

    syncScrollParent();
    return () => {
      cancelled = true;
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [runtimeKey, scrollRef]);

  const heightEstimates = React.useMemo(
    () => displayIndex.items.map(item => resolveEstimatedItemHeight(item, rowGap)),
    [displayIndex.items, rowGap],
  );
  const defaultItemHeight = React.useMemo(
    () => resolveDefaultItemHeight(heightEstimates, rowGap),
    [heightEstimates, rowGap],
  );
  const viewportIncrease = Math.max(0, Math.round(defaultItemHeight * Math.max(0, overscan)));
  const minOverscanItemCount = Math.max(1, Math.trunc(overscan));
  const virtuosoContext = React.useMemo<ChatVirtuosoContext>(
    () => ({
      bottomBuffer: Math.max(0, Math.round(bottomBuffer)),
      rowGap: Math.max(0, Math.round(rowGap)),
    }),
    [bottomBuffer, rowGap],
  );
  const initialTopMostItemIndex = React.useMemo(
    () => displayIndex.items.length > 0
      ? {index: 'LAST' as const, align: 'end' as const}
      : 0,
    [displayIndex.items.length],
  );

  const shouldAutoscrollNow = React.useCallback(
    () => shouldAutoscroll?.() ?? true,
    [shouldAutoscroll],
  );

  const cancelTurnScrollSettle = React.useCallback(() => {
    if (turnScrollSettleFrameRef.current !== null) {
      window.cancelAnimationFrame(turnScrollSettleFrameRef.current);
      turnScrollSettleFrameRef.current = null;
    }
  }, []);

  const handleAtBottomStateChange = React.useCallback(
    (atBottom: boolean) => {
      onAtBottomChange?.(atBottom);
    },
    [onAtBottomChange],
  );

  // Reports the turn that owns the row at the top of the viewport. Rows carry
  // virtuoso's data-index; overscan rows above the viewport are skipped by
  // their geometry, so rangeChanged (which includes overscan) is not usable.
  React.useEffect(() => {
    if (!scrollParent || !onVisibleTurnChange) {
      return undefined;
    }
    lastReportedVisibleTurnRef.current = -1;
    let frame = 0;
    const report = () => {
      frame = 0;
      if (typeof scrollParent.querySelectorAll !== 'function') {
        return;
      }
      const rows: Array<{index: number; bottom: number}> = [];
      scrollParent.querySelectorAll('.chat-virtuoso-row').forEach(row => {
        const raw = row.getAttribute('data-index');
        const index = raw === null ? Number.NaN : Number(raw);
        if (Number.isInteger(index)) {
          rows.push({index, bottom: row.getBoundingClientRect().bottom});
        }
      });
      const topIndex = findTopVisibleRowIndex(rows, scrollParent.getBoundingClientRect().top);
      const turnIndex = topIndex === null
        ? 0
        : displayIndexRef.current.items[topIndex]?.turnIndex ?? 0;
      if (turnIndex === lastReportedVisibleTurnRef.current) {
        return;
      }
      lastReportedVisibleTurnRef.current = turnIndex;
      onVisibleTurnChange(turnIndex);
    };
    const onScroll = () => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(report);
      }
    };
    report();
    scrollParent.addEventListener('scroll', onScroll, {passive: true});
    return () => {
      scrollParent.removeEventListener('scroll', onScroll);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [scrollParent, runtimeKey, onVisibleTurnChange]);

  const scrollToLastDisplayItem = React.useCallback(
    (behavior: ChatVirtuosoScrollBehavior = 'auto') => {
      if (displayIndex.items.length === 0) {
        return;
      }
      virtuosoRef.current?.scrollToIndex({
        index: 'LAST',
        align: 'end',
        behavior,
      });
    },
    [displayIndex.items.length],
  );

  const scrollToDisplayPosition = React.useCallback(
    (displayIndexPosition: number, behavior: ChatVirtuosoScrollBehavior = 'auto') => {
      cancelTurnScrollSettle();
      const location = {
        index: displayIndexPosition,
        align: 'start',
      } as const;
      virtuosoRef.current?.scrollToIndex({
        ...location,
        behavior,
      });
      turnScrollSettleFrameRef.current = window.requestAnimationFrame(() => {
        turnScrollSettleFrameRef.current = null;
        virtuosoRef.current?.scrollToIndex({
          ...location,
          behavior: 'auto',
        });
      });
    },
    [cancelTurnScrollSettle],
  );

  const scrollToTurnIndex = React.useCallback(
    (turnIndex: number, behavior: ChatVirtuosoScrollBehavior = 'auto') => {
      const displayIndexPosition = resolveChatDisplayScrollIndex(displayIndex, turnIndex);
      if (displayIndexPosition === null) {
        return;
      }
      scrollToDisplayPosition(displayIndexPosition, behavior);
    },
    [displayIndex, scrollToDisplayPosition],
  );

  // Turn indexes are 1-based (0 is the "no turn" sentinel), so jumping to the
  // top goes through the display index directly instead of scrollToTurnIndex.
  const scrollToTop = React.useCallback(
    (behavior: ChatVirtuosoScrollBehavior = 'auto') => {
      if (displayIndex.items.length === 0) {
        return;
      }
      scrollToDisplayPosition(0, behavior);
    },
    [displayIndex.items.length, scrollToDisplayPosition],
  );

  const settleScrollParentToBottom = React.useCallback(
    (behavior: ChatVirtuosoScrollBehavior = 'auto') => {
      if (!scrollParent) {
        return;
      }
      scrollElementToBottom(scrollParent, behavior);
      onAtBottomChange?.(true);
    },
    [onAtBottomChange, scrollParent],
  );

  const cancelTailLockSettle = React.useCallback(() => {
    if (tailLockSettleFrameRef.current !== null) {
      window.cancelAnimationFrame(tailLockSettleFrameRef.current);
      tailLockSettleFrameRef.current = null;
    }
    if (tailLockSettleFollowupFrameRef.current !== null) {
      window.cancelAnimationFrame(tailLockSettleFollowupFrameRef.current);
      tailLockSettleFollowupFrameRef.current = null;
    }
  }, []);

  const requestScrollToLastDisplayItem = React.useCallback(
    (
      behavior: ChatVirtuosoScrollBehavior = 'auto',
      options: {includeIndexScroll?: boolean; includeVirtuosoAutoscroll?: boolean} = {},
    ) => {
      cancelTurnScrollSettle();
      cancelTailLockSettle();
      tailLockSettleFrameRef.current = window.requestAnimationFrame(() => {
        tailLockSettleFrameRef.current = null;
        if (options.includeVirtuosoAutoscroll) {
          virtuosoRef.current?.autoscrollToBottom();
        }
        if (options.includeIndexScroll) {
          scrollToLastDisplayItem(behavior);
        }
        settleScrollParentToBottom(behavior);
        tailLockSettleFollowupFrameRef.current = window.requestAnimationFrame(() => {
          tailLockSettleFollowupFrameRef.current = null;
          if (options.includeIndexScroll) {
            scrollToLastDisplayItem('auto');
          }
          settleScrollParentToBottom('auto');
        });
      });
    },
    [cancelTailLockSettle, cancelTurnScrollSettle, scrollToLastDisplayItem, settleScrollParentToBottom],
  );

  const handleTotalListHeightChanged = React.useCallback(() => {
    if (shouldAutoscrollNow()) {
      requestScrollToLastDisplayItem('auto');
    }
  }, [
    requestScrollToLastDisplayItem,
    shouldAutoscrollNow,
  ]);

  React.useEffect(() => () => {
    cancelTailLockSettle();
    cancelTurnScrollSettle();
  }, [cancelTailLockSettle, cancelTurnScrollSettle]);

  React.useImperativeHandle(ref, () => ({
    autoscrollToBottom: () => {
      requestScrollToLastDisplayItem('auto', {
        includeIndexScroll: true,
        includeVirtuosoAutoscroll: true,
      });
    },
    scrollToBottom: (behavior: ChatVirtuosoScrollBehavior = 'auto') => {
      cancelTurnScrollSettle();
      scrollToLastDisplayItem(behavior);
      settleScrollParentToBottom(behavior);
      requestScrollToLastDisplayItem(behavior, {includeIndexScroll: true});
    },
    scrollToTop,
    scrollToTurnIndex,
  }), [requestScrollToLastDisplayItem, scrollToLastDisplayItem, scrollToTop, scrollToTurnIndex, settleScrollParentToBottom]);

  if (!scrollParent) {
    return (
      <div className="chat-virtuoso-list" data-scroll-parent-pending={true}>
        <div
          aria-hidden="true"
          className="chat-virtuoso-footer"
          style={{height: `${virtuosoContext.bottomBuffer}px`}}
        />
      </div>
    );
  }

  return (
    <Virtuoso<ChatDisplayIndexItem, ChatVirtuosoContext>
      ref={virtuosoRef}
      key={runtimeKey}
      customScrollParent={scrollParent}
      data={displayIndex.items}
      components={ChatVirtuosoComponents}
      context={virtuosoContext}
      defaultItemHeight={defaultItemHeight}
      heightEstimates={heightEstimates}
      initialTopMostItemIndex={initialTopMostItemIndex}
      alignToBottom={true}
      atBottomThreshold={atBottomThreshold}
      atBottomStateChange={handleAtBottomStateChange}
      computeItemKey={(index, item) => item.key}
      increaseViewportBy={{top: viewportIncrease, bottom: viewportIncrease}}
      minOverscanItemCount={{top: minOverscanItemCount, bottom: minOverscanItemCount}}
      followOutput={() => (shouldAutoscrollNow() ? 'auto' : false)}
      totalListHeightChanged={handleTotalListHeightChanged}
      itemContent={(index, displayItem) => {
        const size = heightEstimates[index] ?? defaultItemHeight;
        const content = renderItem(displayItem, {
          end: size,
          index,
          key: displayItem.key,
          lane: 0,
          size,
          start: 0,
        });
        return displayItem.key === entryKey
          ? <div className="chat-turn-entry">{content}</div>
          : content;
      }}
    />
  );
});

export const ChatVirtuosoTurnList = React.memo(ChatVirtuosoTurnListInner);
