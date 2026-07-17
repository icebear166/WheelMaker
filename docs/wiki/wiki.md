> 摘要：本页维护 WheelMaker 项目 wiki 的范围、目录规则和顶层索引。

# WheelMaker Wiki

Wiki 只记录当前、稳定、跨任务仍然有效的项目知识。完整来源、历史材料和包含未落地方案的文档保存在 [`../references/`](../references/README.md)。

## 顶层目录

- [`architecture/`](architecture/architecture.md)：系统架构、运行时职责以及 Session 生命周期与同步机制。
- [`protocols/`](protocols/protocols.md)：WheelMaker 使用和实现的 ACP、Registry 等协议边界。
- [`release-and-build/`](release-and-build/release-and-build.md)：源码侧构建、公开发布以及目标机本地部署流程。

## 目录规则

- 每个目录都用同名说明页维护边界和页面索引。
- 每个页面第一行必须是 `> 摘要：...`，文件和目录名使用小写 kebab-case。
- 新增页面时更新所在目录索引；新增顶层目录时同时更新本页。
