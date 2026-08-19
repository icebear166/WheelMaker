---
title: 开始使用个人 Wiki
summary: 说明这个私人知识库保存什么、如何分类，以及本机工程映射为什么不进入 Git 仓库。
tags: [个人Wiki, 使用约定]
status: current
updated: 2026-08-18
confidence: verified
sources:
  - kind: documentation
    ref: Personal Wiki Kit public repository template
---

## 当前结论

这个仓库只保存经过确认、能够长期复用的知识。文章统一放在中性目录中，知识类型、二级分类和项目归属由三份 YAML 注册表集中管理，因此修改归属时不需要移动文章文件。

## 本机工程映射

工程路径属于每台电脑自己的环境，保存在用户目录下的 `project-routing.json`。多个本机工程可以映射到同一个 Wiki 项目；没有匹配的文章显示在“未指定项目”中。

## 发布边界

AI 可以提出候选，但必须获得当前对话中的明确批准才能写入。发布命令只暂存文章、注册表和获批附件，不会把原始对话、草稿、凭据或未知文件加入仓库。
