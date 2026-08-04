> 由 scope skill 于 2026-08-04 生成

# Release 发布页配置归集与发布目录清理

## 目标

Release publishing 设置页（`app/web/src/settings/ReleasePublishSettings.tsx`）目前把 Server Hub 选择放在「Version release」卡片、Web Hub 选择放在「Temporary Web」卡片，实际操作中两者指向同一个 Hub，每次都要分别设置。同时 release server 的发布目录 `/srv/wheelmaker-release/public/releases/` 只增不减，页面无法看到空间占用，也无法清理残留目录。本次迭代把目标 Hub 配置统一收进顶部「Publishing source」卡片，并新增发布目录空间占用展示与一键清理能力。

## 决策

- **Q：Server Hub / Web Hub 如何归集？** A：两者是同一个点，合并为单个 Server Hub 字段，与 Auto pull 一起上移到「Publishing source」卡片；「Version release」卡只留 Desktop/Android 选项和发布按钮，「Temporary Web」卡只留说明和发布按钮（webHubId 使用顶部 Server Hub）。localStorage key 保持 `wheelmaker.settings.release-publish.v1`，加载时把旧 `webHubId` 合并迁移（`serverHubId || webHubId`），已有设置不丢失。
- **Q：清理针对哪个目录？** A：release server 远端的 `public/releases/`，不是发布 Hub 本地的 `.release-out/`。
- **Q：能否直接走 Server Hub 拿数据？** A：不能。发布目录只存在于 release server 机器；Server Hub 只拉取 stable 更新自己，不持有该目录。链路必须是 UI → Registry → 发布 Hub → release server。
- **Q：storage/prune 如何触达 release server？** A：release server 新增 token 鉴权 HTTPS 端点；发布 Hub 复用既有模式运行本地 node 脚本（读取 `~/.wheelmaker/release-server.json` token）调用端点。不用部署 SSH 私钥远程执行 `rm`。
- **Q：清理保留策略？** A：只保留 `stable.json` 引用的版本（stable 版本及其 Desktop/Android 指针版本——指针允许指向历史版本目录），其余 `v1.x` 目录全部删除；`releases.json` 在删除前先截断到只剩被保留版本的条目，历史列表不出现死链，`stable.json` 不变。`staging/`、`debug-web/` 本就有自动清理，不在范围内。（初版曾采用「只删两个元数据文件都不引用的孤儿目录」，因 `releases.json` 只增不减导致永远无可清理内容，2026-08-04 修订为只保 stable。）
- **Q：prune 返回什么？** A：不返回释放的字节数，只返回成功状态与删除的目录数量。
- **Q：占用展示到什么程度？** A：只显示两个数字——releases/ 总占用与可释放空间（无引用目录占用合计），不列版本明细。

## 架构

四层改动，沿用既有发布链路：

```text
ReleasePublishSettings.tsx（UI）
→ Registry 新增方法 release.storage.get / release.storage.prune
→ 发布 Hub cmd.release 新增 action storage / prune（同步返回，不走 job）
→ node scripts/release/ 新脚本（复用 release-server.json token 与 ReleaseServerApi）
→ release server 新端点 GET /api/storage、POST /api/prune
```

- **release server**（`server/internal/releaseserver`）：新增两个 `/api/` 端点，复用现有 Bearer token 鉴权。保留集 = `stable.json` 引用的全部版本（`stable.Version` 以及 Desktop/Android 指针版本）。storage 与 prune 都和 commit 共用同一把互斥锁（`commitMu`），避免把 commit 过程中尚未写入 `releases.json` 的新版本目录误判为可清理。
  - `GET /api/storage` → `{totalBytes, reclaimableBytes, orphanCount}`：遍历 `public/releases/` 下的版本目录，统计总占用与不属于保留集的目录占用及数量。
  - `POST /api/prune` → `{ok, removedCount}`：删除 `public/releases/` 下匹配 `v1.x` 命名且不属于保留集的目录；删除前先把 `releases.json` 截断到只剩保留集条目（失败方向安全：截断成功后删除失败只会留下次可清的孤儿目录）。`stable.json` 缺失或损坏、`releases.json` 读取失败时拒绝删除并返回错误。
- **scripts**（`scripts/release/`）：`ReleaseServerApi` 增加 `storage()` / `prune()` 方法；新增脚本入口（如 `storage.mjs` / `prune.mjs`）读取发布 token、调用端点、把结果以 JSON 打印到 stdout 供 Hub 解析。
- **发布 Hub**（`server/internal/hub/tools/release.go` + `reporter.go`）：`cmd.release` 支持 `storage` / `prune` action，在 sourcePath 检出中运行对应脚本并解析 stdout 的 JSON 结果，同步响应；`reporter.go` 把两个新 Registry 方法映射到对应 action。
- **Registry / 协议**（`server/internal/protocol/registry_methods.go`、`server/internal/registry/server.go`）：新增 `release.storage.get`、`release.storage.prune` 方法常量与 descriptor，复用 `RegistryRouteReleasePublish` 路由。不修改 protocol version。
- **UI**（`ReleasePublishSettings.tsx`、`registryMethods.ts`、`RegistryRepository.ts`、`registryTypes.ts`、`WorkspaceApp.tsx`）：配置归集 + 新增「Release storage」卡片（位于「Temporary Web」之后、「Publish task」之前），含两个数字、刷新按钮、清理按钮；清理由 `AppConfirmDialog` 二次确认。

## 流程

- 占用查询：进入页面且 Publishing Hub 与 Source path 已配置时自动请求 `release.storage.get`，展示总占用与可释放空间；刷新按钮手动重查。
- 一键清理：点击清理 → 确认对话框（显示将删除的目录数）→ `release.storage.prune` → 成功后自动重新查询占用；失败在卡片内显示错误。
- 发布：版本发布与临时 Web 发布都从顶部 Server Hub 取目标 Hub，行为与现状一致（auto pull 仅作用于版本发布）。

## 验收标准

- 「Publishing source」卡片包含 Publishing Hub、Source path、Server Hub、Auto pull 四项；「Version release」「Temporary Web」卡片不再出现 Hub 选择，发布行为与归集前一致。
- 旧 localStorage 设置（含独立 webHubId）加载后自动合并，不丢失目标 Hub。
- 「Release storage」卡片在配置完整时自动显示 releases/ 总占用与可释放空间两个数字，可手动刷新。
- 清理按钮二次确认后删除所有非 stable 引用的版本目录；`stable.json`、stable 版本目录（含 Desktop/Android 指针指向的历史版本）、`staging/`、`debug-web/` 保持不变；`releases.json` 截断到只剩被保留版本的条目；清理后占用数字自动刷新。
- release server 端点在 token 缺失/错误时返回 401；`stable.json` 缺失或损坏时 prune 拒绝删除；命名不符合 `v1.x` 的目录永不被删除。
- 部署提示：release server 端点上线需要用 `scripts/release-server/deploy.mjs` 重新部署一次 release server。

### 测试

- release server：storage 统计（含保留/非保留目录混合）、prune 只保 stable 引用版本并截断 history、stable 缺失时拒绝、未授权拒绝，合并到现有 `server/internal/releaseserver` 测试文件。
- scripts：`ReleaseServerApi.storage/prune` 请求构造与错误处理，合并到 `release-server-api.test.mjs`；新脚本入口的参数与输出测试。
- Hub：`cmd.release` 新 action 的校验、脚本执行与 JSON 解析、失败路径，合并到 `tools_test.go`；`reporter.go` 方法映射测试。
- UI：`ReleasePublishSettings.test.tsx` 更新（配置归集、webHubId 迁移、storage 卡片加载/刷新/清理确认流程）。
- 不测：真实 release server 端到端联调（靠部署后人工验证）。

## 范围之外

- 不清理发布 Hub 本地 `.release-out/` 构建产物。
- 不修改 `staging/`、`debug-web/` 的既有自动清理逻辑。
- 不调整发布流程、版本号分配、`stable.json`/`releases.json` 结构。
- 不修改 protocol version。
- 不做按版本号/时间挑选保留对象的更细粒度清理策略（保留集固定为 stable.json 引用版本）。
