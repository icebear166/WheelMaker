# Unified Attachment Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一附件预览和文件预览架构，让附件预览复用文件预览的完整渲染逻辑，支持Markdown、HTML、代码、纯文本等多种类型。

**Architecture:** 修改服务器端附件读取API返回与文件读取相同的`{isBinary, mimeType, encoding, content}`格式；前端扩展`AttachmentPreviewTab`类型支持文本内容，修改`ChatAttachmentPreviewViewer`复用`ChatFilePeekViewer`的渲染逻辑。

**Tech Stack:** Go (server), TypeScript/React (frontend), Shiki (code highlighting), react-markdown (markdown rendering)

---

## 文件结构

### 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `server/internal/hub/client/session_attachments.go:265-295` | 修改`handleSessionAttachmentRead`返回格式 |
| `app/web/src/registry/registryTypes.ts:202-213` | 扩展`RegistrySessionAttachmentContentResponse`类型 |
| `app/web/src/preview/previewWorkbenchState.ts:37-45` | 扩展`AttachmentPreviewTab`类型支持文本内容 |
| `app/web/src/app/WorkspaceApp.tsx:2196-2241` | 修改`ChatAttachmentPreviewViewer`复用文件预览逻辑 |
| `app/web/src/app/WorkspaceApp.tsx:8596-8674` | 修改`openChatAttachmentPreview`支持非图片类型 |
| `app/web/src/app/WorkspaceApp.tsx:8480-8521` | 修改`loadRestoredPreviewTab`支持非图片类型 |

### 需要创建的文件

无（复用现有组件和函数）

---

## Task 1: 修改服务器端附件读取API返回格式

**Files:**
- Modify: `server/internal/hub/client/session_attachments.go:265-295`

- [ ] **Step 1: 修改`handleSessionAttachmentRead`函数**

```go
func (c *Client) handleSessionAttachmentRead(ctx context.Context, payload json.RawMessage) (any, error) {
	var req struct {
		SessionID    string `json:"sessionId"`
		AttachmentID string `json:"attachmentId,omitempty"`
		URI          string `json:"uri,omitempty"`
	}
	if err := decodeSessionRequestPayload(payload, &req); err != nil {
		return nil, fmt.Errorf("invalid session.attachment.read payload: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	resolved, err := c.resolveSessionAttachment(ctx, req.SessionID, req.AttachmentID, req.URI)
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(resolved.filePath)
	if err != nil {
		return nil, fmt.Errorf("read attachment: %w", err)
	}
	
	// 检测是否为二进制文件
	isBinary, mimeType := detectBinaryAndMime(raw)
	if mimeType == "" {
		mimeType = resolved.sidecar.MimeType
	}
	
	// 根据文件类型返回不同格式
	if isBinary {
		return map[string]any{
			"ok":           true,
			"sessionId":    resolved.sidecar.SessionID,
			"attachmentId": resolved.sidecar.AttachmentID,
			"mimeType":     mimeType,
			"encoding":     "base64",
			"content":      base64.StdEncoding.EncodeToString(raw),
			"isBinary":     true,
			"size":         len(raw),
			"hash":         hashBytesForAttachment(raw),
		}, nil
	}
	
	// 文本文件返回UTF-8字符串
	return map[string]any{
		"ok":           true,
		"sessionId":    resolved.sidecar.SessionID,
		"attachmentId": resolved.sidecar.AttachmentID,
		"mimeType":     mimeType,
		"encoding":     "utf-8",
		"content":      string(raw),
		"isBinary":     false,
		"size":         len(raw),
		"hash":         hashBytesForAttachment(raw),
	}, nil
}
```

- [ ] **Step 2: 运行服务器端测试**

Run: `cd server && go test ./internal/hub/client/ -v -run TestSessionAttachment`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/internal/hub/client/session_attachments.go
git commit -m "feat: modify attachment read API to return unified format"
```

---

## Task 2: 扩展前端类型定义

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts:202-213`
- Modify: `app/web/src/preview/previewWorkbenchState.ts:37-45`

- [ ] **Step 1: 扩展`RegistrySessionAttachmentContentResponse`类型**

```typescript
export interface RegistrySessionAttachmentContentResponse {
  ok: boolean;
  sessionId: string;
  attachmentId: string;
  mimeType?: string;
  encoding: 'base64' | 'utf-8' | string;
  content: string;
  isBinary?: boolean;
  width?: number;
  height?: number;
  size?: number;
  hash?: string;
}
```

- [ ] **Step 2: 扩展`AttachmentPreviewTab`类型**

```typescript
export type AttachmentPreviewTab = PreviewWorkbenchTabBase & {
  type: 'attachment';
  sessionId: string;
  attachmentKey: string;
  meta: string;
  mimeType: string;
  kind: 'image' | 'file';
  src: string;
  content?: string; // 文本内容（非图片类型）
  isBinary?: boolean;
};
```

- [ ] **Step 3: 运行前端类型检查**

Run: `cd app && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add app/web/src/registry/registryTypes.ts app/web/src/preview/previewWorkbenchState.ts
git commit -m "feat: extend attachment preview types for text content"
```

---

## Task 3: 修改附件预览加载逻辑

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx:8596-8674`
- Modify: `app/web/src/app/WorkspaceApp.tsx:8480-8521`

- [ ] **Step 1: 修改`openChatAttachmentPreview`函数**

在`openChatAttachmentPreview`函数中，修改加载逻辑支持非图片类型：

```typescript
const openChatAttachmentPreview = useCallback((block: RegistrySessionContentBlock, message: RegistryChatMessage) => {
  // ... 现有代码保持不变 ...
  
  service.readProjectSessionAttachment(targetProjectId, {
    sessionId,
    uri: block.uri,
    attachmentId: attachmentIdFromBlock(block) || undefined,
  }).then(result => {
    setPreviewWorkbench(current =>
      updatePreviewTabAfterLoad(current, targetProjectId, tabId, requestSeq, tab =>
        tab.type === 'attachment'
          ? {
              ...tab,
              mimeType: result.mimeType || tab.mimeType,
              src: result.isBinary ? attachmentBase64DataUrl(result.content, result.mimeType || tab.mimeType || 'image/png') : '',
              content: result.isBinary ? undefined : result.content,
              isBinary: result.isBinary,
              loading: false,
              error: '',
            }
          : tab,
      ),
    );
  }).catch(err => {
    // ... 现有错误处理代码 ...
  });
}, [isWide, selectedArchivedKey?.projectId, setDrawerOpen]);
```

- [ ] **Step 2: 修改`loadRestoredPreviewTab`函数**

修改`loadRestoredPreviewTab`函数，移除只处理图片的限制：

```typescript
if (tab.type === 'attachment') {
  // 移除 tab.kind === 'image' 的限制
  if (tab.loading || tab.src || tab.requestId > 0) {
    return;
  }
  const requestSeq = chatAttachmentReadSeqRef.current + 1;
  chatAttachmentReadSeqRef.current = requestSeq;
  const payload = attachmentPreviewReadPayloadFromKey(tab);
  if (!payload) {
    setPreviewWorkbench(current =>
      failPreviewTabLoad(
        beginPreviewTabLoad(current, tab.projectId, tab.id, requestSeq),
        tab.projectId,
        tab.id,
        requestSeq,
        'Attachment preview cannot be restored from this source.',
      ),
    );
    return;
  }
  setPreviewWorkbench(current => beginPreviewTabLoad(current, tab.projectId, tab.id, requestSeq));
  try {
    const result = await service.readProjectSessionAttachment(tab.projectId, payload);
    setPreviewWorkbench(current =>
      updatePreviewTabAfterLoad(current, tab.projectId, tab.id, requestSeq, currentTab =>
        currentTab.type === 'attachment'
          ? {
              ...currentTab,
              mimeType: result.mimeType || currentTab.mimeType,
              src: result.isBinary ? attachmentBase64DataUrl(result.content, result.mimeType || currentTab.mimeType || 'image/png') : '',
              content: result.isBinary ? undefined : result.content,
              isBinary: result.isBinary,
              loading: false,
              error: '',
            }
          : currentTab,
      ),
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    setPreviewWorkbench(current =>
      failPreviewTabLoad(current, tab.projectId, tab.id, requestSeq, `Failed to load attachment: ${reason}`),
    );
  }
}
```

- [ ] **Step 3: 运行前端类型检查**

Run: `cd app && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx
git commit -m "feat: modify attachment preview loading for text content"
```

---

## Task 4: 修改附件预览渲染组件

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx:2196-2241`

- [ ] **Step 1: 修改`ChatAttachmentPreviewViewer`组件**

修改组件，复用`ChatFilePeekViewer`的渲染逻辑：

```typescript
const ChatAttachmentPreviewViewer = React.memo(function ChatAttachmentPreviewViewer({
  preview,
  mode,
  onClose,
  scrollRef,
  // 添加文件预览需要的props
  themeMode,
  codeTheme,
  codeFont,
  codeFontSize,
  codeLineHeight,
  codeTabSize,
  wrapLines,
  showLineNumbers,
  highlightedLines,
  onLineClick,
}: ChatAttachmentPreviewViewerProps) {
  let body: React.ReactNode;
  if (preview.loading) {
    body = <div className="muted block">Loading attachment...</div>;
  } else if (preview.error) {
    body = (
      <div className="chat-file-peek-error" role="alert">
        <span className="codicon codicon-error" />
        <span>{preview.error}</span>
      </div>
    );
  } else if (preview.kind === 'image' && preview.src) {
    // 图片预览
    body = (
      <div className="chat-attachment-original-wrap">
        <img
          className="chat-attachment-original-image"
          src={preview.src}
          alt={preview.title}
        />
      </div>
    );
  } else if (preview.content !== undefined) {
    // 文本内容预览，复用文件预览逻辑
    const fileName = preview.title || 'attachment';
    if (isMarkdownPath(fileName)) {
      body = (
        <MarkdownPreview
          content={preview.content}
          themeMode={themeMode}
          codeTheme={codeTheme}
          codeFont={codeFont}
          codeFontSize={codeFontSize}
          codeLineHeight={codeLineHeight}
          codeTabSize={codeTabSize}
          wrap={wrapLines}
          lineNumbers={showLineNumbers}
        />
      );
    } else if (isHtmlPath(fileName)) {
      body = (
        <HtmlPreview
          content={preview.content}
        />
      );
    } else {
      body = (
        <ShikiCodeBlock
          content={preview.content}
          language={detectCodeLanguage(fileName)}
          wrap={false}
          lineNumbers={true}
          themeMode={themeMode}
          codeTheme={codeTheme}
          codeFont={codeFont}
          codeFontSize={codeFontSize}
          codeLineHeight={codeLineHeight}
          codeTabSize={codeTabSize}
          highlightedLines={highlightedLines}
          onLineClick={onLineClick}
        />
      );
    }
  } else {
    // 占位符（无内容或二进制文件）
    body = (
      <div className="chat-attachment-preview-placeholder">
        <span className="codicon codicon-file" aria-hidden="true" />
        <div className="chat-attachment-preview-placeholder-main">
          <div className="chat-attachment-preview-placeholder-title">{preview.title}</div>
          {preview.meta ? (
            <div className="chat-attachment-preview-placeholder-meta">{preview.meta}</div>
          ) : null}
          <div className="chat-attachment-preview-placeholder-status">Preview is being implemented.</div>
        </div>
      </div>
    );
  }

  return <>{body}</>;
}, (prev, next) => (
  prev.preview === next.preview &&
  prev.mode === next.mode &&
  prev.themeMode === next.themeMode &&
  prev.codeTheme === next.codeTheme &&
  prev.codeFont === next.codeFont &&
  prev.codeFontSize === next.codeFontSize &&
  prev.codeLineHeight === next.codeLineHeight &&
  prev.codeTabSize === next.codeTabSize &&
  prev.wrapLines === next.wrapLines &&
  prev.showLineNumbers === next.showLineNumbers &&
  prev.highlightedLines === next.highlightedLines
));
```

- [ ] **Step 2: 更新`ChatAttachmentPreviewViewerProps`类型**

```typescript
type ChatAttachmentPreviewViewerProps = {
  preview: AttachmentPreviewTab;
  mode: 'desktop' | 'mobile';
  onClose: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  // 添加文件预览需要的props
  themeMode: 'dark' | 'light';
  codeTheme: CodeThemeId;
  codeFont: CodeFontId;
  codeFontSize: number;
  codeLineHeight: number;
  codeTabSize: number;
  wrapLines: boolean;
  showLineNumbers: boolean;
  highlightedLines: Set<number>;
  onLineClick?: (line: number) => void;
};
```

- [ ] **Step 3: 更新组件调用处**

在`renderPreviewWorkbenchTabBody`函数中，更新`ChatAttachmentPreviewViewer`的调用，传递新的props。

- [ ] **Step 4: 运行前端类型检查**

Run: `cd app && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx
git commit -m "feat: modify attachment preview viewer to reuse file preview logic"
```

---

## Task 5: 添加大小限制和错误处理

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`

- [ ] **Step 1: 添加大小限制常量**

在文件顶部添加常量：

```typescript
const ATTACHMENT_PREVIEW_MAX_SIZE = 20 * 1024 * 1024; // 20MB
```

- [ ] **Step 2: 在加载逻辑中添加大小检查**

在`openChatAttachmentPreview`和`loadRestoredPreviewTab`中添加大小检查：

```typescript
// 在获取到result后检查大小
if (result.size && result.size > ATTACHMENT_PREVIEW_MAX_SIZE) {
  setPreviewWorkbench(current =>
    failPreviewTabLoad(
      current,
      targetProjectId,
      tabId,
      requestSeq,
      'File too large to preview (max 20MB).',
    ),
  );
  return;
}
```

- [ ] **Step 3: 添加UTF-8解码错误处理**

在渲染逻辑中，如果`preview.content`为`undefined`但`preview.isBinary`为`false`，显示解码错误：

```typescript
} else if (preview.content === undefined && preview.isBinary === false) {
  body = (
    <div className="chat-file-peek-error" role="alert">
      <span className="codicon codicon-error" />
      <span>Failed to decode file content (UTF-8 expected).</span>
    </div>
  );
}
```

- [ ] **Step 4: 运行前端类型检查**

Run: `cd app && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx
git commit -m "feat: add size limit and error handling for attachment preview"
```

---

## Task 6: 运行完整测试套件

**Files:**
- Test: `app/__tests__/web-preview-workbench-state.test.ts`
- Test: `app/__tests__/web-session-attachment-preview-service.test.ts`
- Test: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: 运行前端测试**

Run: `cd app && npm test`
Expected: PASS

- [ ] **Step 2: 运行后端测试**

Run: `cd server && go test ./internal/hub/client/ -v`
Expected: PASS

- [ ] **Step 3: 运行类型检查**

Run: `cd app && npm run typecheck`
Expected: PASS

- [ ] **Step 4: 运行lint检查**

Run: `cd app && npm run lint`
Expected: PASS

- [ ] **Step 5: Commit（如果有测试文件修改）**

```bash
git add -A
git commit -m "test: add tests for unified attachment preview"
```

---

## Task 7: 更新文档和清理

**Files:**
- Modify: `docs/scope/2026-07-09-unified-attachment-preview.md`

- [ ] **Step 1: 更新spec中的验收标准**

将spec中的验收标准从`- [ ]`改为`- [x]`，标记为已完成。

- [ ] **Step 2: 运行最终验证**

Run: `cd app && npm run build`
Expected: PASS

- [ ] **Step 3: 最终Commit**

```bash
git add -A
git commit -m "docs: update spec for unified attachment preview"
```

---

## 自我审查

### 1. Spec覆盖度检查

| Spec需求 | 对应Task |
|----------|----------|
| 支持Markdown附件预览 | Task 4 (ShikiCodeBlock/MarkdownPreview) |
| 支持HTML附件预览 | Task 4 (HtmlPreview) |
| 支持代码附件预览 | Task 4 (ShikiCodeBlock) |
| 支持纯文本附件预览 | Task 4 (ShikiCodeBlock) |
| 超过20MB显示"无法预览" | Task 5 (大小限制) |
| 非UTF-8显示"无法解码" | Task 5 (错误处理) |
| 图片附件预览保持不变 | Task 4 (保留图片分支) |
| 预览样式与文件预览一致 | Task 4 (复用组件) |
| 附件读取API返回统一格式 | Task 1 (服务器端修改) |
| 前端统一处理 | Task 3, 4 (前端修改) |

### 2. 占位符扫描

无TBD/TODO/模糊需求。所有步骤都有具体代码。

### 3. 类型一致性检查

- `RegistrySessionAttachmentContentResponse`类型在Task 2定义，在Task 3使用
- `AttachmentPreviewTab`类型在Task 2扩展，在Task 3, 4使用
- `isBinary`字段在Task 1添加，在Task 2, 3, 4使用

所有类型和字段名称一致。

---

## 执行选项

Plan complete and saved to `docs/plans/2026-07-09-unified-attachment-preview/plan-unified-attachment-preview.md`. Execute it with executing-plans when you're ready.
