# Wiki Root Documents Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the first WheelMaker wiki structure, move stable architecture and protocol knowledge out of the `docs/` root, preserve mixed source documents under `docs/references/`, and consolidate architecture review artifacts.

**Architecture:** `docs/wiki/` is the canonical home for current, stable project knowledge and uses summary-first topic indexes. Mixed, versioned, historical, or not-yet-implemented source material remains intact under `docs/references/`, while wiki pages extract only confirmed facts and link back to those sources. Existing historical plans and reviews keep their original prose; active repository guidance and tests are updated to canonical paths.

**Tech Stack:** Markdown, static HTML, PowerShell, Git, Go test tooling

---

### Task 1: Create documentation and wiki indexes

**Files:**
- Create: `docs/README.md`
- Create: `docs/wiki/wiki.md`
- Create: `docs/wiki/architecture/architecture.md`
- Create: `docs/wiki/protocols/protocols.md`
- Create: `docs/references/README.md`

- [x] **Step 1: Create the docs landing page**

Create `docs/README.md` with a first-line summary, links to the wiki, references, ADRs, scope documents, plans, reviews, handoffs, legacy superpowers artifacts, and README assets. State that stable current knowledge belongs in the wiki while dated or mixed source material belongs in references or work-product directories.

- [x] **Step 2: Create the wiki root index**

Create `docs/wiki/wiki.md` with this discovery skeleton:

```markdown
> 摘要：本页维护 WheelMaker 项目 wiki 的范围、目录规则和顶层索引。

# WheelMaker Wiki

## 顶层目录

- [`architecture/`](architecture/architecture.md)：系统架构、运行时职责以及 Session 生命周期与同步机制。
- [`protocols/`](protocols/protocols.md)：WheelMaker 使用和实现的 ACP、Registry 等协议边界。
```

- [x] **Step 3: Create topic indexes**

Create `docs/wiki/architecture/architecture.md` and `docs/wiki/protocols/protocols.md`. Each file must begin with `> 摘要：...`, contain its topic title, list every page created in later tasks, and define the topic boundary.

- [x] **Step 4: Create the references index**

Create `docs/references/README.md` explaining that files in this directory preserve complete versioned or mixed source material and are not automatically current implementation truth.

### Task 2: Migrate stable architecture knowledge

**Files:**
- Move: `docs/architecture-3.0.md` to `docs/wiki/architecture/server-runtime.md`
- Move: `docs/session-management-and-sync.zh-CN.md` to `docs/references/session-management-and-sync.zh-CN.md`
- Create: `docs/wiki/architecture/session-management-and-sync.md`
- Modify: `server/CLAUDE.md`
- Modify: `docs/openai-chat-agent-protocol.zh-CN.md`

- [x] **Step 1: Move the implemented runtime architecture page**

Move the complete Architecture 3.0 document to `docs/wiki/architecture/server-runtime.md`. Add this first line without changing its documented behavior:

```markdown
> 摘要：本页维护 WheelMaker App-only Session 运行时架构、组件职责和生命周期边界。
```

Record the former source path `docs/architecture-3.0.md` near the title.

- [x] **Step 2: Preserve the complete Session source**

Move the complete Session source document to `docs/references/session-management-and-sync.zh-CN.md` unchanged. This preserves section 8, which explicitly describes a review-stage design.

- [x] **Step 3: Extract stable Session knowledge into the wiki**

Create `docs/wiki/architecture/session-management-and-sync.md` from the source introduction and sections 1 through 7 only. Add this first line and a source link:

```markdown
> 摘要：本页维护 Session 数据模型、Turn 语义、持久化、同步和归档的当前稳定机制。
```

Do not copy section 8 (`Chat Turn 同步、状态与显示重构设计`) into the wiki.

- [x] **Step 4: Update active architecture references**

Update `server/CLAUDE.md` to link to `../docs/wiki/architecture/server-runtime.md`. Update the pending OpenAI Chat Agent design to reference the new architecture page and the preserved Codex bridge source path.

### Task 3: Migrate protocol knowledge and preserve mixed references

**Files:**
- Move: `docs/registry-protocol.md` to `docs/wiki/protocols/registry.md`
- Move: `docs/acp-protocol-full.zh-CN.md` to `docs/references/acp-protocol-full.zh-CN.md`
- Move: `docs/codex-app-server-acp-bridge.zh-CN.md` to `docs/references/codex-app-server-acp-bridge.zh-CN.md`
- Create: `docs/wiki/protocols/acp.md`
- Modify: `server/CLAUDE.md`
- Modify: `server/internal/hub/agent/agent_test.go`
- Modify: `docs/openai-chat-agent-protocol.zh-CN.md`
- Modify: `docs/references/codex-app-server-acp-bridge.zh-CN.md`

- [x] **Step 1: Move the Registry protocol without changing its version**

Move the complete Registry 2.6 document to `docs/wiki/protocols/registry.md`. Add this first line and record the former source path:

```markdown
> 摘要：本页维护 WheelMaker Registry 2.6 的消息封装、方法域、路由、认证和版本约束。
```

Do not change the protocol version or any protocol payload.

- [x] **Step 2: Preserve ACP and Codex bridge source documents**

Move the complete ACP reference and Codex bridge document into `docs/references/`. Preserve their unstable, deprecated, historical, and phase-specific sections as source material rather than presenting them as current wiki facts.

- [x] **Step 3: Create the stable ACP wiki page**

Create `docs/wiki/protocols/acp.md` with this first line:

```markdown
> 摘要：本页维护 WheelMaker 采用 ACP 时的稳定协议边界、生命周期和兼容策略。
```

Summarize only the confirmed JSON-RPC lifecycle, capability gating, Session/Prompt flow, tool lifecycle, path rules, and the compatibility fields verified in `server/internal/protocol/acp.go`. Link to `../../references/acp-protocol-full.zh-CN.md` for the complete dated reference and explicitly exclude its unstable, historical, and stale normalize-layer notes from current implementation truth.

- [x] **Step 4: Update active ACP and bridge references**

Update `server/CLAUDE.md` to link to `../docs/wiki/protocols/acp.md`. Update `agent_test.go` resource-link fixture and expected rendered path to `docs/references/acp-protocol-full.zh-CN.md`. Update links between the OpenAI Chat Agent design, the preserved Codex bridge source, and the ACP wiki/reference pages.

### Task 4: Consolidate architecture review artifacts

**Files:**
- Move: `docs/architecture-review-feishu-im-retirement-zh-2026-05-27.html` to `docs/reviews/architecture-review-feishu-im-retirement-zh-2026-05-27.html`
- Move: `docs/architecture-review-operation-protocols-2026-05-26.html` to `docs/reviews/architecture-review-operation-protocols-2026-05-26.html`

- [x] **Step 1: Verify exact move targets**

Confirm both source files exist and neither destination exists. Do not alter the locally ignored `docs/architecture-review-workspace-web-ui-2026-06-04.html`; its visible text differs from the tracked file already under `docs/reviews/`.

- [x] **Step 2: Move the two tracked review files**

Move the Feishu/IM retirement and operation protocol review HTML files into `docs/reviews/` without modifying their historical contents.

### Task 5: Verify the migration

**Files:**
- Verify: `docs/README.md`
- Verify: `docs/wiki/**/*.md`
- Verify: `docs/references/**/*`
- Verify: `docs/reviews/**/*`
- Verify: `server/CLAUDE.md`
- Verify: `server/internal/hub/agent/agent_test.go`

- [x] **Step 1: Validate wiki discovery rules**

Run a PowerShell check that asserts every wiki Markdown file begins with `> 摘要：`, contains a Markdown title, every wiki directory has its same-name index page, and every page appears in its directory index.

- [x] **Step 2: Validate local Markdown links**

Run a repository Markdown-link check over changed Markdown files. Expected result: no missing relative link target.

- [x] **Step 3: Validate old active paths are removed**

Run:

```powershell
rg -n --fixed-strings -e '../docs/architecture-3.0.md' -e '../docs/acp-protocol-full.zh-CN.md' server/CLAUDE.md
rg -n --fixed-strings 'D:/Code/WheelMaker/docs/acp-protocol-full.zh-CN.md' server/internal/hub/agent/agent_test.go
```

Expected result: both commands return no matches.

- [x] **Step 4: Run the affected Go package test**

Run:

```powershell
go test ./internal/hub/agent
```

from `server/`. Expected result: exit code 0.

- [x] **Step 5: Validate the final diff**

Run `git diff --check`, inspect `git diff --stat`, inspect `git status --short`, and confirm no security or release document content was changed by this migration.

### Task 6: Commit and push

**Files:**
- Commit all verified migration files

- [x] **Step 1: Execute the repository completion gate**

Run this exact tail sequence with no intervening commands:

```powershell
git add -A
git commit -m "docs: organize root documents into wiki"
git push origin main
```

Expected result: the commit succeeds and `origin/main` advances to the new commit.
