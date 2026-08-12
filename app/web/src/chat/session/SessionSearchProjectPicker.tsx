import React, {useEffect, useId, useRef} from 'react';
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

export function SessionSearchProjectPicker({
  projects,
  value,
  onChange,
}: SessionSearchProjectPickerProps) {
  const [open, setOpen, exiting] = useMenuExitFlag();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const menuId = `session-search-project-options-${useId().replace(/:/g, '')}`;
  const selectedProject = projects.find(project => project.projectId === value);

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
