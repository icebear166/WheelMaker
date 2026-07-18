# Frontend Architecture Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a standalone, evidence-based HTML report that maps WheelMaker's frontend architecture, directory and file distribution, feature surface, runtime behavior, risks, and a phased iteration roadmap.

**Architecture:** The report is a single offline HTML document under `code/`, with all CSS and JavaScript inline. Its content is derived from repository source counts, dependency graph inspection, build output, tests, and the current chat performance measurements. The document uses semantic sections, accessible navigation, a small interactive architecture backbone, responsive layouts, and print styles.

**Tech Stack:** HTML5, inline CSS, vanilla JavaScript, PowerShell/Node verification, existing webpack production build and repository analysis scripts.

---

## Task 1: Freeze the evidence baseline

**Files:**
- Read: `app/web/src/**`
- Read: `app/__tests__/**`
- Read: `app/web/webpack.config.js`
- Read: `app/package.json`

- [ ] Record the current branch and revision with `git rev-parse --short HEAD`.
- [ ] Count source files, lines, extensions, top-level modules, and largest files.
- [ ] Inspect relative imports for dependency hubs and cycles.
- [ ] Measure `WorkspaceApp.tsx` hook and dependency concentration.
- [ ] Run `npm run build:web` and `npm run report:web-assets` from `app/` for production bundle evidence.

## Task 2: Build the architecture and feature map

**Files:**
- Read: `app/web/src/main.tsx`
- Read: `app/web/src/app/WorkspaceApp.tsx`
- Read: `app/web/src/registry/RegistryClient.ts`
- Read: `app/web/src/registry/RegistryRepository.ts`
- Read: `app/web/src/registry/RegistryWorkspaceService.ts`
- Read: `app/web/src/workspace/**`
- Create: `code/frontend-architecture-report.html`

- [ ] Document the startup, command, event-stream, persistence, and platform-adapter flows.
- [ ] Map each top-level directory to its ownership and user-facing features.
- [ ] Map principal modules to their callers and downstream dependencies.
- [ ] Include a project-domain glossary for Registry, Hub, Session, Turn, Prompt, Preview, and Port Relay.

## Task 3: Turn findings into an iteration roadmap

**Files:**
- Modify: `code/frontend-architecture-report.html`

- [ ] Add a severity-ranked risk register with evidence, impact, and mitigation.
- [ ] Define 0–2 week, 2–6 week, 6–12 week, and 12+ week milestones.
- [ ] Attach measurable gates for root-component size, render latency, cache bounds, bundle size, test style, build, and type checking.
- [ ] Show the recommended target module boundaries and migration order.

## Task 4: Verify the standalone report

**Files:**
- Test: `code/frontend-architecture-report.html`

- [ ] Parse the HTML and verify unique IDs and internal anchor targets.
- [ ] Compile the inline JavaScript with `new Function`.
- [ ] Verify the report has no remote stylesheet, script, font, or image dependency.
- [ ] Check mobile breakpoints, keyboard focus styling, reduced-motion handling, and print styles by source inspection.
- [ ] Run `git diff --check` and review the final diff.

## Task 5: Deliver the documented baseline

- [ ] Stage all intended changes with `git add -A`.
- [ ] Commit the report and plan with a documentation-focused message.
- [ ] Push the current branch to `origin`.
