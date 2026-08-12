import {useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react';

import type {RegistryChatMessage} from '../../registry/registryTypes';
import {
  buildChatSearchMatches,
  resolveChatSearchNavigationDelta,
  type ChatSearchMatch,
} from './chatSearchState';

export function resolveChatSearchMessages(input: {
  liveMessages: RegistryChatMessage[];
  archivedMessages: RegistryChatMessage[];
  archivedMode: boolean;
}): RegistryChatMessage[] {
  return input.archivedMode ? input.archivedMessages : input.liveMessages;
}

export type ChatSearchOpenRequest = {
  sourceKey: string;
  query: string;
  generation: number;
};

export function resolveChatSearchOpenRequest(input: {
  request: ChatSearchOpenRequest | null | undefined;
  sourceKey: string;
  lastConsumedGeneration: number;
}): {query: string; generation: number} | null {
  const request = input.request;
  const query = request?.query.trim() ?? '';
  if (
    !request ||
    request.sourceKey !== input.sourceKey ||
    request.generation <= input.lastConsumedGeneration ||
    !query
  ) {
    return null;
  }
  return {query, generation: request.generation};
}

export function useChatSearchController(input: {
  sourceKey: string;
  liveMessages: RegistryChatMessage[];
  archivedMessages: RegistryChatMessage[];
  archivedMode: boolean;
  scrollToMatch: (match: ChatSearchMatch) => void;
  openRequest?: ChatSearchOpenRequest | null;
  onOpenRequestConsumed?: (generation: number) => void;
}) {
  const {
    sourceKey,
    liveMessages,
    archivedMessages,
    archivedMode,
    scrollToMatch,
    openRequest,
    onOpenRequestConsumed,
  } = input;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastConsumedOpenRequestGenerationRef = useRef(0);
  const messages = resolveChatSearchMessages({liveMessages, archivedMessages, archivedMode});
  const matches = useMemo(
    () => buildChatSearchMatches(messages, query),
    [messages, query],
  );
  const matchedTurnIndexes = useMemo(
    () => new Set(matches.map(match => match.turnIndex)),
    [matches],
  );
  const activeMatch = open && matches.length > 0
    ? matches[activeIndex] ?? null
    : null;
  const activeTurnIndex = activeMatch?.turnIndex ?? null;

  const activate = useCallback((index: number) => {
    if (matches.length === 0) {
      return;
    }
    const nextIndex = (index + matches.length) % matches.length;
    setActiveIndex(nextIndex);
    scrollToMatch(matches[nextIndex]);
  }, [matches, scrollToMatch]);

  const navigate = useCallback((delta: 1 | -1) => {
    activate(activeIndex + delta);
  }, [activate, activeIndex]);

  const openSearch = useCallback(() => {
    setOpen(true);
    setActiveIndex(0);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  }, []);

  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
      return;
    }
    const delta = resolveChatSearchNavigationDelta(event);
    if (delta !== null && matches.length > 0) {
      event.preventDefault();
      navigate(delta);
    }
  }, [closeSearch, matches.length, navigate]);

  useEffect(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  }, [sourceKey]);

  useEffect(() => {
    const resolved = resolveChatSearchOpenRequest({
      request: openRequest,
      sourceKey,
      lastConsumedGeneration: lastConsumedOpenRequestGenerationRef.current,
    });
    if (!resolved) {
      return;
    }
    lastConsumedOpenRequestGenerationRef.current = resolved.generation;
    setQuery(resolved.query);
    setOpen(true);
    setActiveIndex(0);
    onOpenRequestConsumed?.(resolved.generation);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [onOpenRequestConsumed, openRequest, sourceKey]);

  useEffect(() => {
    setActiveIndex(current => Math.min(current, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  useEffect(() => {
    if (!open || matches.length === 0) {
      return;
    }
    setActiveIndex(0);
    const frameId = window.requestAnimationFrame(() => {
      scrollToMatch(matches[0]);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [matches, open, query, scrollToMatch]);

  return {
    open,
    query,
    setQuery,
    activeIndex,
    matches,
    matchedTurnIndexes,
    activeMatch,
    activeTurnIndex,
    inputRef,
    openSearch,
    closeSearch,
    navigate,
    handleInputKeyDown,
  };
}
