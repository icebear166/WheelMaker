> 摘要：本页维护 WheelMaker 源码侧发布 MJS 的入口、构建编排、平台产物和缓存策略。

# 构建

## 边界

构建只在私有 WheelMaker 源码仓库中进行。它负责从源码生成预编译 Hub、Web 和可选客户端资产，并把完整结果写入 `.release-out/v1.x/`。目标机不编译源码，目标机部署由 [`release.md`](release.md) 记录。

本地构建与 GitHub Action 共用同一套实现，不维护两套构建逻辑。两者都要求 Node.js 22+，并通过 [`scripts/release.mjs`](../../../scripts/release.mjs) 进入核心流程。

## 入口和模块

```text
publish-release.bat
        │
        ▼
scripts/release/entry.mjs       交互层
        │ 生成参数
        ▼
scripts/release.mjs             命令入口
        │
        ▼
scripts/release/cli.mjs         流程编排
   ├─ build.mjs                 Hub、Web、Desktop 构建
   ├─ android.mjs               Android 构建与签名
   ├─ publish.mjs               打包和 manifest
   ├─ tar.mjs                   tar.gz 生成
   ├─ metadata.mjs              版本、SHA-256 和 JSON
   ├─ progress.mjs              阶段、耗时和进度输出
   └─ commands.mjs              跨平台子进程调用
```

`publish-release.bat` 依次询问是否包含 Desktop、是否包含 Android，以及是否发布到公共服务器，然后把选择转换成以下参数：

```text
--with-desktop
--with-android
--publish
```

非交互调用示例：

```bash
node scripts/release.mjs
node scripts/release.mjs --with-desktop
node scripts/release.mjs --with-android --publish
```

[`publish-release-action.bat`](../../../publish-release-action.bat) 只负责检查分支、工作树和上游提交，然后通过 `gh` 触发 `publish-release.yml`。Action 最终仍然执行同一个 `scripts/release.mjs --publish`。

## 构建编排

每次构建先读取公共 `stable.json`，把当前 `v1.x` 的 `x` 加一作为本次版本。无论是否公开发布，都使用同一种版本和输出目录格式。构建还会读取当前 Git HEAD 作为 `sourceSha`；正式发布额外要求工作树干净。

Web 只构建一次：

```text
npm ci --include=dev
→ npm run build:web:release
→ 得到共享 web-source
```

随后以最大并发数 3 执行平台和可选资产任务：

- `windows-amd64`：交叉编译 `wheelmaker.exe` 和一次性 Desktop 更新器 `update.exe`，两者都使用 Windows GUI subsystem。
- `linux-amd64`：交叉编译 `wheelmaker`。
- `darwin-amd64`：交叉编译 `wheelmaker`。
- `darwin-arm64`：交叉编译 `wheelmaker`。
- Desktop：可选，生成 Windows AMD64 GUI 程序 `WheelMakerDesktop.exe`。
- Android：可选，生成已签名 APK 和 `android-release.json`。

四个 Hub 构建都使用 `CGO_ENABLED=0`，并把同一份 `web-source` 复制到各平台目录。

## 产物

最终目录为：

```text
.release-out/v1.x/
├─ wheelmaker-v1.x-windows-amd64.tar.gz
├─ wheelmaker-v1.x-linux-amd64.tar.gz
├─ wheelmaker-v1.x-darwin-amd64.tar.gz
├─ wheelmaker-v1.x-darwin-arm64.tar.gz
├─ deploy.mjs
├─ deploy-core.mjs
├─ release-manifest.json
├─ WheelMakerDesktop.exe       可选
├─ WheelMakerAndroid.apk       可选
└─ android-release.json        可选
```

每个平台压缩包都包含：

```text
hub/
└─ wheelmaker(.exe)

web/
└─ 编译后的 Web 静态文件
```

Windows 平台包额外包含：

```text
desktop/
└─ update.exe
```

`update.exe` 每轮都构建，不受 `--with-desktop` 影响。`release-manifest.json` 记录各平台包的相对路径、大小和 SHA-256。`WheelMakerDesktop.exe` 和 Android 仍是独立可选资产，不放入 Hub/Web 平台包。

## 工作目录和缓存

单次构建临时目录位于 `.release-work/tmp/release-v1.x-*`，无论成功或失败都会清理。以下跨构建缓存会保留：

```text
.release-work/cache/
├─ go-build/
├─ go-mod/
├─ webpack/
└─ gradle/
```

本地构建成功后直接保留 `.release-out/v1.x/`。只有传入 `--publish` 才继续执行公共发布。

## 代码来源

- [`scripts/release.mjs`](../../../scripts/release.mjs)
- [`scripts/release/entry.mjs`](../../../scripts/release/entry.mjs)
- [`scripts/release/cli.mjs`](../../../scripts/release/cli.mjs)
- [`scripts/release/build.mjs`](../../../scripts/release/build.mjs)
- [`scripts/release/android.mjs`](../../../scripts/release/android.mjs)
- [`scripts/release/publish.mjs`](../../../scripts/release/publish.mjs)
