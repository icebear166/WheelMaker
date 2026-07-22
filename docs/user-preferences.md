> 摘要：记录本项目中用户对 Git 分支、worktree、提交、推送、合并和清理动作的工作流偏好。

# User Preferences

## Git: 开始工程前

- 基线分支：`main`
- 是否默认拉 feature branch：默认创建；落 spec 的任务必须创建 feature branch；不落 spec 的任务和 bug 修复不创建
- 必须拉新分支的场景：落 spec 的任务
- 可以沿用当前分支的场景：不落 spec 的任务、bug 修复
- 开始前是否更新基线：可以不更新

## Git: Worktree

- 是否默认创建 worktree：与创建 feature branch 绑定；创建分支时同时创建
- worktree 位置：项目根目录下的 `.worktree/`
- worktree 命名：默认使用分支名；具体命名细则待确认
- 复用或清理规则：待确认

## Git: 完成功能后

- 是否默认 commit：是
- commit 粒度：待确认
- commit message 风格：待确认
- 是否默认 push：是；与 commit 绑定执行
- 是否默认创建 PR：否
- 是否允许合并主干：是；分支完成后自动合入 `main`，并提交、推送
- 是否删除分支：待确认
- 是否删除 worktree：待确认

## 必须再次确认

- 删除 branch：待确认
- 删除 worktree：待确认
- 丢弃改动：必须再次确认
- force push：必须再次确认
- 合并主干：已授权在分支完成后自动合入 `main`；其他情形待确认

## 备注

- 提交前先拉取远端更新，优先使用 rebase；发生冲突时自动解决。
- `.worktree/` 已加入 `.gitignore`。
- 最后更新：2026-07-22
