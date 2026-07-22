> 本文件记录本项目跨会话生效的 Git 工作流偏好。

# Git Preferences

- 基线：使用 `main`。
- Branch/Worktree：仅落 spec 的任务创建 feature branch，并绑定创建项目根目录 `.worktree/<branch-name>`；不落 spec 的任务和 bug 修复沿用当前分支，同时确保 `.worktree/` 被 Git 忽略。
- Sync：开始任务前无需更新基线；提交前拉取远端并首选 rebase，冲突自动解决。
- Commit：完成后自动 commit。
- Merge：不创建 PR；分支任务完成后自动合入 `main` 并提交。
- Push：与 commit 绑定执行；分支合入 `main` 后也自动 push。
- Cleanup：push 后是否删除 branch/worktree 待确认；丢弃修改和 force push 必须再次确认。
- 最后更新：2026-07-23。
