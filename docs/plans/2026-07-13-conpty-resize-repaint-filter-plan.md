# ConPTY Resize Repaint Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Windows terminal scrollback across repeated width and height changes without disabling terminal fit.

**Architecture:** Keep Hub and browser xterm resize/reflow behavior, but remove the redundant ConPTY resize repaint from the authoritative output stream. A Windows-only resize arm enables a streaming frame filter; normal output before or after the frame is preserved, while alternate-screen or hidden-cursor sessions remain fail-open.

**Tech Stack:** Go, ConPTY via `go-pty`, `xterm-go`, Registry terminal events, React xterm.js.

---

### Task 1: Streaming repaint filter

**Files:**
- Create: `server/internal/hub/terminal/conpty_repaint_filter.go`
- Modify: `server/internal/hub/terminal/manager_test.go`

- [x] **Step 1: Write failing filter tests**

Add tests that construct `conPTYResizeRepaintFilter`, call `Arm`, and feed a repaint framed by `\x1b[?25l\x1b[H` and `\x1b[?25h` in one-byte fragments. Assert that normal prefix/suffix bytes remain, the repaint disappears, and two pending resize frames are independently removed.

- [x] **Step 2: Verify RED**

Run: `go test ./internal/hub/terminal -run 'TestConPTYResizeRepaintFilter' -count=1`

Expected: compilation fails because `conPTYResizeRepaintFilter` does not exist.

- [x] **Step 3: Implement the minimum streaming filter**

Implement this API:

```go
type conPTYResizeRepaintFilter struct {
    pending  int
    dropping bool
    buffer   []byte
}

func (f *conPTYResizeRepaintFilter) Arm()
func (f *conPTYResizeRepaintFilter) Cancel()
func (f *conPTYResizeRepaintFilter) Filter(data []byte) []byte
```

Search for the exact start marker, discard through the cursor-show end marker, preserve partial marker prefixes between calls, and fail open if a candidate frame exceeds the configured bound.

- [x] **Step 4: Verify GREEN**

Run: `go test ./internal/hub/terminal -run 'TestConPTYResizeRepaintFilter' -count=1`

Expected: all filter tests pass.

### Task 2: Hub resize integration

**Files:**
- Modify: `server/internal/hub/terminal/manager.go`
- Modify: `server/internal/hub/terminal/screen.go`
- Modify: `server/internal/hub/terminal/manager_test.go`

- [x] **Step 1: Write failing manager tests**

Add a screen fake that can report whether the normal screen has a visible cursor. Resize a terminal, commit a framed repaint followed by normal bytes, and assert only the normal bytes reach the screen and `terminal.output`; assert resize failure cancels the arm and alternate-screen mode passes bytes unchanged.

- [x] **Step 2: Verify RED**

Run: `go test ./internal/hub/terminal -run 'TestManager.*ResizeRepaint' -count=1`

Expected: tests fail because Manager does not arm or apply the filter.

- [x] **Step 3: Integrate the filter**

Add the filter to each terminal session. On Windows, arm immediately before a safe normal-screen PTY resize and cancel on resize failure. In `commitOutput`, filter before writing the authoritative screen, assigning a sequence number, or publishing `terminal.output`; an empty filtered result produces no event.

- [x] **Step 4: Verify GREEN and package regression**

Run: `go test ./internal/hub/terminal -count=1`

Expected: package passes.

### Task 3: Real Windows ConPTY regression

**Files:**
- Modify: `server/internal/hub/terminal/pty_windows_test.go`
- Delete: `server/internal/hub/terminal/repeated_resize_debug_test.go`

- [x] **Step 1: Add the real regression test**

Run pwsh through the platform PTY, output 200 lines wider than the initial 80 columns, alternate eight width/height sizes, pass PTY bytes through the production filter, and assert the final Hub snapshot contains every numbered line once.

- [x] **Step 2: Verify the Windows regression repeatedly**

Run: `go test ./internal/hub/terminal -run 'TestWindowsConPTYRepeatedResizePreservesLongOutput' -count=10`

Expected: ten passes with no missing marker.

### Task 4: Final verification and integration

**Files:**
- No additional production files.

- [x] **Step 1: Run server verification**

Run: `go test ./...`

Expected: all Go packages pass.

- [x] **Step 2: Run repository checks**

Run: `git diff --check`

Expected: no whitespace errors.

- [x] **Step 3: Run isolated browser verification**

Start isolated Registry, Hub, Web, and browser processes. Create a pwsh terminal, emit numbered long lines, resize width and height repeatedly, and verify Hub snapshot and browser buffer contain all markers and retain the final prompt.

- [x] **Step 4: Commit and merge**

Commit the feature branch, merge it into the latest `main` in a clean worktree, rerun relevant verification, then execute the repository completion gate and push `main`.
