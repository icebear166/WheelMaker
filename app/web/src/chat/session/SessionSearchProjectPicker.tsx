import React, {useCallback, useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import type {RegistryProject} from '../../registry/registryTypes';
import {focusFirstMenuItem, handleMenuKeyDown} from '../../common/menuKeyboardNavigation';
import {SessionIcon} from '../sessionlist/SessionIcon';
import {useMenuExitFlag} from '../sessionlist/menuExit';

export type SessionSearchProjectPickerProps = {
  projects: RegistryProject[];
  value: string;
  onChange: (projectId: string) => void;
};

function projectOptionClass(projectId: string): string {
  const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `session-search-project-option${safeId ? ` session-search-project-option-${safeId}` : ''}`;
}

const SESSION_SEARCH_PROJECT_MENU_WIDTH = 248;
const SESSION_SEARCH_PROJECT_MENU_MAX_HEIGHT = 360;
const SESSION_SEARCH_PROJECT_MENU_GUTTER = 12;
const SESSION_SEARCH_PROJECT_MENU_GAP = 6;

export type SessionSearchProjectMenuPlacementInput = {
  viewportWidth: number;
  viewportHeight: number;
  trigger: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
};

export type SessionSearchProjectMenuPlacement = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

export function resolveSessionSearchProjectMenuPlacement({
  viewportWidth,
  viewportHeight,
  trigger,
}: SessionSearchProjectMenuPlacementInput): SessionSearchProjectMenuPlacement {
  const gutter = SESSION_SEARCH_PROJECT_MENU_GUTTER;
  const width = Math.min(SESSION_SEARCH_PROJECT_MENU_WIDTH, Math.max(0, viewportWidth - gutter * 2));
  const rightLimit = Math.max(gutter, viewportWidth - gutter);
  const left = Math.min(
    Math.max(gutter, trigger.right - width),
    Math.max(gutter, rightLimit - width),
  );
  const desiredHeight = Math.min(
    SESSION_SEARCH_PROJECT_MENU_MAX_HEIGHT,
    Math.max(0, viewportHeight - gutter * 2),
  );
  const availableBelow = Math.max(0, viewportHeight - trigger.bottom - gutter);
  const availableAbove = Math.max(0, trigger.top - gutter);
  const openAbove = availableBelow < desiredHeight && availableAbove > availableBelow;
  const maxHeight = openAbove
    ? Math.min(desiredHeight, availableAbove)
    : Math.min(desiredHeight, availableBelow);
  const top = openAbove
    ? Math.max(gutter, trigger.top - SESSION_SEARCH_PROJECT_MENU_GAP - maxHeight)
    : Math.min(
      Math.max(gutter, viewportHeight - gutter - maxHeight),
      trigger.bottom + SESSION_SEARCH_PROJECT_MENU_GAP,
    );
  return {left, top, width, maxHeight};
}

export function SessionSearchProjectPicker({
  projects,
  value,
  onChange,
}: SessionSearchProjectPickerProps) {
  const [open, setOpen, exiting] = useMenuExitFlag();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<SessionSearchProjectMenuPlacement | null>(null);
  const menuId = `session-search-project-options-${useId().replace(/:/g, '')}`;
  const selectedProject = projects.find(project => project.projectId === value);

  const updateMenuPlacement = useCallback(() => {
    if (!triggerRef.current || typeof window === 'undefined') {
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPlacement(resolveSessionSearchProjectMenuPlacement({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      trigger: rect,
    }));
  }, []);

  const openMenu = () => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      restoreFocusRef.current = document.activeElement;
    } else {
      restoreFocusRef.current = triggerRef.current;
    }
    setOpen(true);
  };

  const closeMenu = (restoreFocus: boolean) => {
    setOpen(false);
    if (!restoreFocus) {
      return;
    }
    const target = restoreFocusRef.current ?? triggerRef.current;
    if (target && typeof target.focus === 'function') {
      target.focus();
    }
  };

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return undefined;
    }
    focusFirstMenuItem(menuRef.current);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      closeMenu(true);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }
    updateMenuPlacement();
    window.addEventListener('resize', updateMenuPlacement);
    document.addEventListener('scroll', updateMenuPlacement, true);
    return () => {
      window.removeEventListener('resize', updateMenuPlacement);
      document.removeEventListener('scroll', updateMenuPlacement, true);
    };
  }, [open, updateMenuPlacement]);

  const chooseProject = (projectId: string) => {
    onChange(projectId);
    closeMenu(false);
  };

  return (
    <div className="session-search-project-picker">
      <button
        ref={triggerRef}
        type="button"
        className="session-search-project-trigger"
        aria-label="Search project"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? closeMenu(true) : openMenu())}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            if (open) {
              event.preventDefault();
              closeMenu(true);
            }
            return;
          }
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) {
              openMenu();
            }
          }
        }}
      >
        <span className="session-search-project-label">
          {selectedProject?.name ?? 'All Projects'}
        </span>
        {selectedProject?.hubId ? (
          <span className="session-search-project-trigger-hub">{selectedProject.hubId}</span>
        ) : null}
        <SessionIcon name={open ? 'chevronUp' : 'chevronDown'} />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          className={`session-search-project-menu topbar-menu-surface${exiting ? ' sl-menu-exit' : ''}`}
          style={menuPlacement ? {
            position: 'fixed',
            left: menuPlacement.left,
            top: menuPlacement.top,
            width: menuPlacement.width,
            maxHeight: menuPlacement.maxHeight,
          } : undefined}
          role="listbox"
          aria-label="Search project"
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeMenu(true);
              return;
            }
            handleMenuKeyDown(event, menuRef.current);
          }}
        >
          <button
            type="button"
            className={`session-search-project-option session-search-project-option-all${value === '' ? ' selected' : ''}`}
            role="option"
            aria-selected={value === ''}
            onClick={() => chooseProject('')}
          >
            <span className="session-search-project-option-check" aria-hidden="true">
              {value === '' ? <SessionIcon name="check" /> : null}
            </span>
            <span className="session-search-project-option-copy">
              <span className="session-search-project-name">All Projects</span>
              <span className="session-search-project-hub">All hubs</span>
            </span>
          </button>
          {projects.map(project => {
            const selected = project.projectId === value;
            return (
              <button
                key={project.projectId}
                type="button"
                className={`${projectOptionClass(project.projectId)}${selected ? ' selected' : ''}`}
                role="option"
                aria-selected={selected}
                onClick={() => chooseProject(project.projectId)}
              >
                <span className="session-search-project-option-check" aria-hidden="true">
                  {selected ? <SessionIcon name="check" /> : null}
                </span>
                <span className="session-search-project-option-copy">
                  <span className="session-search-project-name">{project.name}</span>
                  <span className="session-search-project-hub">{project.hubId ?? 'Unknown hub'}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
