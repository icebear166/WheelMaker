> 由 scope skill 于 2026-07-09 生成

# 统一附件预览架构

## 目标

当前附件预览只支持图片类型，非图片附件显示"Preview is being implemented"占位符。文件预览系统已支持Markdown、HTML、代码等多种类型。目标是统一两套预览架构，让附件预览复用文件预览的完整渲染逻辑，实现一次到位的多类型预览支持。

## 决策

1. **架构统一**：`ChatAttachmentPreviewViewer`复用`ChatFilePeekViewer`的渲染逻辑，共享类型检测和渲染器
2. **支持类型**：图片、Markdown、HTML、代码、纯文本、其他（fallback到代码高亮）
3. **数据加载**：统一附件和文件的读取协议，前端一视同仁处理
4. **大小限制**：文本附件最大20MB，超过显示"无法预览"
5. **编码处理**：UTF-8，解码失败显示错误提示
6. **样式交互**：与文件预览完全一致（代码高亮、Markdown渲染、HTML沙箱等）
7. **协议统一**：附件读取API的返回格式与`project.fs.read`一致（`{isBinary, mimeType, encoding, content}`），但API签名可以不同

## 架构

系统由以下单元组成：

- **PreviewWorkbenchState**：预览工作台状态管理，支持file、prompt-diff、attachment、port-relay四种标签类型
- **ChatFilePeekViewer**：文件预览组件，根据文件类型分发到对应渲染器
- **ChatAttachmentPreviewViewer**：附件预览组件，当前只处理图片，需扩展支持多类型
- **类型检测函数**：`isImageFile`、`isMarkdownPath`、`isHtmlPath`、`detectCodeLanguage`
- **渲染组件**：`MarkdownPreview`、`HtmlPreview`、`ShikiCodeBlock`

### 预览类型分发逻辑

```
1. 检查文件大小 > 20MB → 显示"无法预览"
2. isImageFile(path, mimeType) → 图片预览
3. isMarkdownPath(path) → MarkdownPreview
4. isHtmlPath(path) → HtmlPreview
5. detectCodeLanguage(path) → ShikiCodeBlock
6. 其他 → ShikiCodeBlock（clike语言）
```

## 流程

### 统一预览数据格式

附件和文件预览使用相同的数据格式：
```typescript
{
  isBinary: boolean;
  mimeType: string;
  encoding: 'base64' | 'utf-8';
  content: string; // base64编码（二进制）或UTF-8字符串（文本）
}
```

### 附件预览加载流程

1. 用户点击附件 → `openChatAttachmentPreview()`
2. 创建`AttachmentPreviewTab`（kind: 'file'）
3. 调用`readProjectSessionAttachment()`获取内容（返回统一格式）
4. 根据mimeType/文件扩展名分发到对应渲染器
5. 渲染预览内容

### 文件预览加载流程（参考）

1. 用户点击文件链接 → `openChatFilePeek()`
2. 创建`FilePreviewTab`
3. 调用`readProjectFile()`获取内容（返回统一格式）
4. 根据文件类型分发到对应渲染器
5. 渲染预览内容

## 验收标准

- [x] 支持Markdown附件预览（`.md`, `.markdown`）
- [x] 支持HTML附件预览（`.html`, `.htm`）
- [x] 支持代码附件预览（`.ts`, `.js`, `.json`, `.go`, `.py`, `.rs`, `.sh`等）
- [x] 支持纯文本附件预览（`.txt`, `.log`, 无扩展名）
- [x] 超过20MB的文本附件显示"无法预览"提示
- [x] 非UTF-8编码文件显示"无法解码"错误提示
- [x] 图片附件预览功能保持不变
- [x] 预览样式与文件预览完全一致（代码高亮、Markdown渲染、HTML沙箱等）
- [x] 附件读取API返回与文件读取相同的`{isBinary, mimeType, encoding, content}`格式
- [x] 前端统一处理附件和文件的预览逻辑，无差异化处理
- [x] 复用现有类型检测和渲染组件

### 测试

- 测试Markdown附件预览渲染
- 测试HTML附件预览渲染
- 测试代码附件预览渲染（多种语言）
- 测试纯文本附件预览渲染
- 测试超过20MB文件的错误提示
- 测试非UTF-8文件的错误提示
- 测试图片附件预览功能不受影响
- 测试未知文件类型的fallback处理

## 范围之外

- 不新增后端API端点（修改现有`session.attachment.read`返回格式）
- 不修改附件上传流程
- 不添加PDF、视频、音频等复杂类型预览
- 不支持多编码自动检测（仅UTF-8）
- 不添加预览交互功能（如搜索、跳转）
