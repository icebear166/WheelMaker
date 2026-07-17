> 由 scope skill 于 2026-07-17 生成

# 统一 Android 发布与更新元数据

## 目标

将 Android APK 纳入现有预编译发布流程，使本地 Windows 发布和手动 GitHub Action 都能按需构建、签名并把 APK 发布到公共 `wheelmaker-release` 的同一个 `v1.x` Release。所有构建使用同一版本推导和输出结构；目标机部署继续只处理 Hub 与 Web，Android 由 App 内更新入口独立下载。同步整理源码侧构建缓存、旧迁移目录、目标机 staging，以及 Web 中依赖旧更新模型的显示和查询流程。

## 决策

- Android 是与 Desktop 同级的可选发布产物。`publish-release.bat` 依次询问是否包含 Desktop、是否包含 Android、是否 public 发布；两个可选产物默认均不构建。非交互入口增加 `--with-android`，Action 增加默认关闭的 `with_android`。
- 无论是否 public，发布器都先读取公共 `stable.json`，将当前 `v1.x` 的 `x` 加一作为本次版本。所有产物写入 `.release-out/v1.x/`，不再生成 `local-<sha>` 版本。
- Android 使用主发布版本：`v1.24` 对应 `versionName=1.24`、`versionCode=24`。本地构建与 public 构建不使用不同的 Android 版本规则。
- public 发布时，APK 与 `android-release.json` 上传到本次 `v1.x` GitHub Release，并更新 `stable.androidApk`。本次未选择 Android 时沿用旧指针；从未发布过 Android 时省略该字段。
- `deploy.mjs` 不下载、不校验、不安装 Android，但必须接受带有 `androidApk` 的合法 stable 文档。
- Android App 的更新页不再查询私有源码仓库的 latest release，改为读取公共 `stable.json.androidApk`。
- Android keystore 和包含 store password、alias、key password 的签名配置直接提交到 `mobile/android/signing/`；本地发布与 Action 均读取仓库内容，不依赖本地环境变量或 GitHub Secrets。源码仓库当前公开所带来的凭据暴露风险由用户明确接受，仓库可见性后续由用户自行改为 private。
- 删除独立 Android BAT、PowerShell 发布器及其专用测试；Android 构建、签名、校验和发布由统一 release MJS 负责。
- 源码侧最终产物只放 `.release-out/`。可复用构建缓存放 `.release-work/cache/`，单次工作区放 `.release-work/tmp/` 并在成功或失败后清理。
- `migrate-uninstall` 删除整个旧 `~/.wheelmaker/build/`、`mobile/`、`tmp/`、`cache/go-build/`、`update-now.signal` 与退役的 restart/status wrapper。位于其他盘符根目录的旧 Android 工作区由用户手动清理。
- 目标机部署无论成功或失败都删除 `~/.wheelmaker/staging/<job-id>/`；`lock.json` 只在活动任务期间存在，完成后仅保留 `status.json` 和日志。
- Web 全局读取一次 stable、发布状态和 release 历史；每个 Hub 只报告本机 `release.json` 与更新任务状态。Hub 端查询不再为每个 Hub 重复拉取 stable 或发布状态。
- Registry 主机始终同时运行 Hub，即使没有项目也必须出现在 Hub 列表中。各 Hub 更新任务独立执行，不增加 Registry 标识或特殊顺序；“Update All”可分别下发任务。
- Web 和目标机更新不依赖本地 Git、源码目录、分支、dirty 或 ahead/behind 状态。Web 仍可通过 HTTPS 查询公共 GitHub Releases API，以展示最近的发布历史。
- NPM agent package 更新保持现有按 Hub 管理的独立流程，不并入 WheelMaker 二进制发布。
- 选择 Android 后，APK 构建、签名或校验失败会使整次发布失败；不得发布部分 Hub/Web 产物，也不得更新 stable。

## 架构

统一发布器负责版本分配、共享 Web 构建、三平台 Hub 交叉编译、可选 Desktop、可选 Android、资产校验以及 public 发布。源码侧目录边界如下：

```text
WheelMaker/
  .release-out/
    v1.24/
      web-source/
      wheelmaker-v1.24-windows-amd64/
      wheelmaker-v1.24-linux-amd64/
      wheelmaker-v1.24-darwin-arm64/
      desktop/                         # 可选
      android/                         # 可选
        WheelMakerAndroid.apk
        android-release.json
  .release-work/
    cache/
      webpack/
      go-build/
      go-mod/
      gradle/
    tmp/
  mobile/android/signing/
    release.p12
    signing.properties
```

`stable.json` 继续是公共发布控制面。Android 指针至少包含以下可验证信息：

```json
{
  "androidApk": {
    "version": "v1.24",
    "versionName": "1.24",
    "versionCode": 24,
    "publishedAt": "2026-07-17T00:00:00.000Z",
    "sourceSha": "<40-hex>",
    "url": "https://github.com/swm8023/wheelmaker-release/releases/download/v1.24/WheelMakerAndroid.apk",
    "sha256": "<64-hex>",
    "size": 123456
  }
}
```

Android 更新链路使用 URL、大小和 SHA-256 下载校验，并继续由原生安装逻辑验证包名、递增的 `versionCode` 和与已安装 App 一致的签名证书。Hub/Web 部署链路只读取其已有字段，忽略 `androidApk`。

## 流程

### 本地构建

1. 读取公共 stable，确定下一个 `v1.x`。
2. 清理本次 `.release-work/tmp/` 和 `.release-out/v1.x/`，保留 `.release-work/cache/`。
3. 构建一次 Web，交叉编译三个 Hub 平台；按交互选择构建 Desktop 和 Android。
4. Android 从主版本注入 `versionName`、`versionCode`，使用仓库内签名配置生成并验证 APK。
5. 写入 `.release-out/v1.x/`。未选择 public 时到此结束，不上传、不修改 stable。

### public 发布

1. 完成本地构建的全部步骤与校验。
2. 创建 `v1.x` Release，上传平台包、manifest，以及本次选择的 Desktop/Android 资产。
3. Android 未构建时继承旧 `stable.androidApk`；已构建时写入本次资产指针。
4. 所有资产发布完成后最后提交 `stable.json`。任何前序失败均不得改变 stable。

### GitHub Action

Action 仍只由 `workflow_dispatch` 手动触发。`with_android=false` 时不初始化 JDK、Android SDK 或 Gradle；启用时恢复 Gradle/Kotlin/Android 缓存并构建签名 APK。Action 同时恢复 npm、Webpack、Go module 和 Go build 缓存，并对互不依赖的构建步骤做受控并行，避免重复 Web 构建。cache miss 只增加耗时，不改变构建结果。

### Web 更新页

1. Web 通过 HTTPS 获取一次全局 stable、发布状态和 release 历史。
2. 对每个已连接 Hub 查询本机已安装版本和更新任务；无项目 Hub 仍参与。
3. Web 用全局 stable 与各 Hub 本机版本计算显示状态。更新请求不携带可信 stable 内容。
4. 每个 Hub 创建自己的更新任务；其 `deploy.mjs update` 重新下载并验证 stable 后执行更新。
5. Android 原生环境额外读取 `stable.androidApk`，提供 APK 检查和安装；普通浏览器和主机部署不处理该字段。

## 验收标准

- `publish-release.bat` 可交互选择 Desktop、Android 和 public；非交互 MJS 与 Action 暴露等价选项。
- public 与非 public 构建都从 stable 推导同一个下一版本，并输出 `.release-out/v1.x/`，仓库中不再存在 `local-<sha>` 发布语义。
- 选择 Android 时生成由仓库内 keystore 签名的 APK；APK 的包名、版本、签名证书、大小和 SHA-256 均通过校验。
- Android 资产与 Hub/Desktop 资产进入同一个 `v1.x` Release；`stable.androidApk` 正确新增、更新或继承。
- 未选择 Android 时不初始化 Android 工具链；选择后任一 Android 步骤失败会阻止整个发布和 stable 更新。
- `deploy.mjs` 面对含 `androidApk` 的 stable 仍只部署 Hub 与 Web，且不会下载 APK。
- Android 更新页只使用公共 stable 指针，不再请求 `swm8023/WheelMaker/releases/latest`。
- Web 不再对每个 Hub 重复获取 stable 或发布状态；Hub 卡片只显示本机版本、安装时间、任务状态和更新操作，不显示 Git 状态。
- Registry 所在的无项目 Hub 能出现在更新列表中；各 Hub 更新不依赖特殊排序。
- 本地和 Action 的缓存可跨构建复用；`.release-work/tmp/` 在成功和失败后均被清理。
- `migrate-uninstall` 删除旧 build/mobile/tmp、Go build cache、信号文件和退役 wrapper，同时保留配置、数据库、日志、Desktop、当前 agent cache 和新的源码仓库签名文件。
- 部署任务完成后不存在对应的 `staging/<job-id>/`，失败原因仍可从 `status.json` 和日志读取。
- 旧 Android 独立入口、发布器和失去职责的测试已删除。

### 测试

- release MJS 单元测试覆盖参数解析、stable 版本递增、统一输出目录、Android 可选构建、资产打包、指针继承和失败原子性。
- Android 构建测试覆盖 Gradle 版本注入、仓库内签名配置、签名证书校验、APK hash/size manifest，以及缺失或错误签名配置时失败。
- Action/入口脚本测试覆盖 `with_android` 传递、条件化工具链初始化和缓存目录。
- deploy 测试覆盖含 Android 指针的 stable、明确不下载 APK、成功/失败 staging 清理和迁移删除整个旧 build 目录。
- Hub/Web 测试覆盖全局 stable、每 Hub 本地状态、无项目 Hub、独立更新任务、无 Git 字段显示和 Android stable 解析。
- 保留现有 Go、Web、Android、安全验收与凭据扫描测试；凭据扫描需要对用户明确要求提交的 Android signing 文件采用精确例外，不能扩大为目录级或仓库级跳过。

## 范围之外

- `deploy.mjs` 安装 Android APK。
- Android 自动发布、定时发布或每个 WheelMaker 版本强制构建 APK。
- Release 回滚或保留目标机旧版本。
- 为 Registry Hub 增加特殊标识或更新顺序。
- 自动删除其他盘符根目录中的旧 `.wheelmaker` Android 工作区。
- 本次任务内修改 GitHub 仓库可见性。
