import React, {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {autoUpdate, computePosition, flip, offset, shift} from '@floating-ui/react';
import {shellTransientSurfaceStore} from '../shell/shellSurfaceCoordinator';

const HOVER_DELAY_MS = 300;
const EXIT_DURATION_MS = 120;

type TooltipContent = {anchor: Element; text: string};

function resolveAnchor(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest('[data-tooltip]') : null;
}

// Global singleton tooltip: any element carrying a `data-tooltip` attribute gets a
// styled hover/focus hint. Visual-only — accessible names stay on the element's own
// aria-label. Disabled on touch devices ((hover: none)), mirroring native title reach.
export function GlobalTooltip(): React.JSX.Element | null {
  const shellSurface = useSyncExternalStore(
    shellTransientSurfaceStore.subscribe,
    shellTransientSurfaceStore.getSnapshot,
    shellTransientSurfaceStore.getSnapshot,
  );
  const [content, setContent] = useState<TooltipContent | null>(null);
  const [open, setOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<TooltipContent | null>(null);
  contentRef.current = content;
  const pendingAnchorRef = useRef<Element | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverQueryRef = useRef<MediaQueryList | null>(null);

  // Cached MediaQueryList (.matches updates live); constructing a query per
  // mouseover would add avoidable work to the hottest event path. jsdom has no
  // matchMedia; treat as hover-capable so tests exercise the hover path.
  const hoverCapable = useCallback(() => {
    if (typeof window.matchMedia !== 'function') return true;
    if (!hoverQueryRef.current) hoverQueryRef.current = window.matchMedia('(hover: hover)');
    return hoverQueryRef.current.matches;
  }, []);

  const clearHoverTimer = useCallback(() => {
    pendingAnchorRef.current = null;
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const clearExitTimer = useCallback(() => {
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  const show = useCallback((anchor: Element) => {
    const text = anchor.getAttribute('data-tooltip');
    if (!text) return;
    clearHoverTimer();
    clearExitTimer();
    setExiting(false);
    setContent(prev => (prev?.anchor === anchor && prev.text === text ? prev : {anchor, text}));
  }, [clearHoverTimer, clearExitTimer]);

  const hide = useCallback(() => {
    clearHoverTimer();
    if (!contentRef.current) return;
    clearExitTimer();
    setExiting(true);
    exitTimerRef.current = setTimeout(() => {
      setContent(null);
      setExiting(false);
      exitTimerRef.current = null;
    }, EXIT_DURATION_MS);
  }, [clearHoverTimer, clearExitTimer]);

  useEffect(() => {
    const onMouseOver = (event: MouseEvent) => {
      if (!hoverCapable()) return;
      const anchor = resolveAnchor(event.target);
      if (!anchor || anchor === contentRef.current?.anchor || anchor === pendingAnchorRef.current) return;
      clearHoverTimer();
      // Switch instantly while another tooltip is visible; otherwise require hover intent.
      if (contentRef.current) {
        show(anchor);
        return;
      }
      pendingAnchorRef.current = anchor;
      hoverTimerRef.current = setTimeout(() => show(anchor), HOVER_DELAY_MS);
    };
    const onMouseOut = (event: MouseEvent) => {
      const anchor = resolveAnchor(event.target);
      if (!anchor) return;
      if (event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget)) return;
      if (anchor === contentRef.current?.anchor) {
        hide();
      } else if (anchor === pendingAnchorRef.current) {
        clearHoverTimer();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!hoverCapable()) return;
      const anchor = resolveAnchor(event.target);
      if (anchor) show(anchor);
    };
    const onFocusOut = (event: FocusEvent) => {
      const anchor = resolveAnchor(event.target);
      if (!anchor) return;
      if (event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget)) return;
      if (anchor === contentRef.current?.anchor) hide();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    const onPointerDown = () => hide();
    const onScroll = () => hide();

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('scroll', onScroll, true);
      clearHoverTimer();
      clearExitTimer();
    };
  }, [show, hide, hoverCapable, clearHoverTimer, clearExitTimer]);

  useEffect(() => {
    if (!shellSurface) return;
    clearHoverTimer();
    clearExitTimer();
    setContent(null);
    setOpen(false);
    setExiting(false);
  }, [clearExitTimer, clearHoverTimer, shellSurface]);

  // Enter transition: mount hidden, flip to visible on the next frame.
  useEffect(() => {
    if (!content) {
      setOpen(false);
      return;
    }
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [content]);

  // Position against the anchor; recompute on resize/anchor movement. Scroll hides
  // instead, so ancestor scroll tracking stays off.
  useEffect(() => {
    const node = nodeRef.current;
    if (!content || !node) return;
    const update = () => {
      void computePosition(content.anchor, node, {
        placement: 'top',
        strategy: 'fixed',
        middleware: [offset(6), flip(), shift({padding: 8})],
      }).then(({x, y, placement}) => {
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        const side = placement.split('-')[0];
        node.style.transformOrigin = side === 'top' ? 'bottom center' : 'top center';
        node.dataset.placement = side === 'top' ? 'top' : 'bottom';
      });
    };
    update();
    return autoUpdate(content.anchor, node, update, {ancestorScroll: false});
  }, [content]);

  if (!content || shellSurface) return null;
  return createPortal(
    <div ref={nodeRef} role="tooltip" className={`sl-tooltip${open && !exiting ? ' visible' : ''}`}>
      {content.text}
    </div>,
    document.body,
  );
}
