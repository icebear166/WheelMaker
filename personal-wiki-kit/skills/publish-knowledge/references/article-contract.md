# 文章合同

## 文件与注册

- 文章必须位于 `content/articles/{id}.md`，`id` 使用小写 kebab-case，并保持稳定。
- 每篇文章必须在 `content/registry/articles.yaml` 中恰好有一个同 ID 注册项。
- 注册项保存 `section`、`category`、`projects` 和 `order`；这些字段不得重复写入文章头部。
- 无项目归属使用 `projects: []`，不得写入保留值 `unassigned`。

## 文章头部

只允许以下 YAML 字段：

```yaml
title: 清晰稳定的标题
summary: 十到二百四十字的独立摘要
tags: [关键词]
status: current
updated: 2026-08-18
confidence: confirmed
sources:
  - kind: verification
    ref: 可核对的依据
```

- `status` 固定为 `current`。
- `confidence` 只允许 `verified`、`confirmed`、`provisional`。
- `sources.kind` 只允许 `repository`、`documentation`、`decision`、`verification`。
- `sources.ref` 描述可核对依据，不保存令牌、密码、私钥、会话或秘密地址。

## 正文

- 从可靠结论开始，再写适用边界、机制、依据和必要示例。
- 使用二到四级标题；不要在标题中手写锚点。
- 内部文章链接使用 `/articles/{id}`，附件使用 `/attachments/{path}`。
- 不写原始 HTML，不嵌入脚本，不引用仓库外本地路径。
- 附件只在确有必要且已获批准时加入；不得留下未被文章引用的附件。
- 不保存原始对话、草稿、收件箱材料或无法独立理解的任务记录。

## 分类变更

- 修改文章知识归属或项目归属时，只改文章注册项。
- 修改总目录、二级目录或项目定义时，先把定义变化及受影响文章列成独立候选并获得明确批准。
- 同一知识类型和分类内的 `order` 必须唯一；项目、知识类型和分类 ID 均须引用现有注册定义。
