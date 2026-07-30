> 由 scope skill 于 2026-07-31 生成

# 客户端 Go 混淆发布

## 目标

在不改变前端构建和运行协议的前提下，提高用户可获得的 WheelMaker Go 客户端产物的低成本逆向门槛。正式发布的 Hub 和可选 Desktop 使用 Garble 的 `-tiny` 混淆构建；内部保留不使用 `-tiny` 的混淆诊断构建。该方案只保护发布产物的可读性和元数据暴露，不把客户端当作不可逆向的安全边界。

## 决策

- 采用 A 档目标：防普通用户和低成本逆向，同时保持发布稳定性和可诊断性。
- 混淆范围只包括发往用户机器的 Go Hub 和可选 Windows Desktop。
- Registry、Release Server 等仅运行在受控服务端且不发给用户的 Go 程序不进入本次混淆发布链。
- Web 前端保持现有 Webpack/Terser 构建，不增加 JavaScript 强混淆。
- 正式客户端 Go 构建使用 Garble 的常规混淆和 `-tiny`，同时保留现有 `-trimpath`、`-s`、`-w` 以及各平台已有的 `CGO_ENABLED=0`、Windows GUI linker 选项。
- 不启用 Garble `-literals`、控制流混淆或其他激进字符串变换；不引入依赖运行时 `eval` 的前端混淆。
- `-tiny` 导致公开产物中的 runtime panic/fatal/trace/debug 输出和部分符号信息减少是已接受的发布特性；普通业务 `warn` 日志必须保持不变。
- 内部诊断构建使用相同源码、Go/Garble 工具版本和常规混淆，但不使用 `-tiny`。诊断构建不进入 `.release-out` 的公开资产集合、不上传发布服务器、不随目标机安装包分发。
- 发布脚本必须固定 Garble 工具版本并在版本不匹配时失败关闭；不允许使用浮动的 `latest` 工具版本。
- 本次不修改 protocol version、发布元数据 schema、更新信任链、凭据模型或服务端架构。

## 架构

发布流程继续由 `scripts/release/build.mjs` 统一编排：

```text
scripts/release.mjs
  ├─ Web production build（保持现状）
  ├─ Garble tiny → Windows/Linux/macOS Hub
  ├─ Garble tiny → 可选 Windows Desktop
  └─ 现有打包、manifest、SHA-256、发布流程
```

构建层引入明确的客户端 Go 构建 profile。正式 profile 生成用户资产；诊断 profile 只用于受控本地或 CI 诊断输出。两个 profile 必须共享目标入口、平台环境、版本注入和资源生成逻辑，避免诊断构建与正式构建行为漂移。

构建缓存和发布输出继续位于 `.release-work/` 与 `.release-out/v1.x/`；Garble 自身缓存不得进入发布资产目录。源码 commit、Go 版本、Garble 版本、构建 flags 和 profile 信息必须可从私有构建记录中还原，以便对公开二进制进行问题定位。

## 流程

1. 发布流程安装或验证固定版本的 Garble。
2. Web 仍执行一次现有 production build，并复制到各 Hub 平台包。
3. 四个平台 Hub 使用正式 `tiny` profile 交叉构建。
4. 选择 Desktop 时，先生成现有 Windows 资源，再使用正式 `tiny` profile 构建 Desktop。
5. 现有 tar.zst、release manifest、大小/SHA-256 校验和发布事务继续执行；混淆只改变二进制内容及其派生摘要。
6. 需要诊断时，使用私有非 `tiny` profile 构建同一 source SHA；诊断产物和构建上下文只保存在受保护位置。

## 验收标准

- 正式 Hub 构建覆盖 Windows amd64、Linux amd64、macOS amd64 和 macOS arm64，且每个构建命令使用 Garble `-tiny`。
- 可选 Desktop 正式构建使用相同的 Garble `-tiny` profile，并保留版本注入和 Windows GUI 行为。
- 构建命令不会包含 `-literals`、控制流混淆或未批准的激进混淆选项。
- 生产 Web 静态文件、Webpack 配置语义和 source-map 默认关闭行为不发生变化。
- 正式发布目录和上传文件集中不存在非 `tiny` 诊断二进制、源码、Go 符号映射或私有 source map。
- 业务 `warn` 日志在 Windows Hub、Linux Hub 和 Desktop 可执行路径中仍按现有格式输出；公开构建不要求保留未恢复 panic 的 runtime 堆栈。
- 非 `tiny` 诊断 profile 能生成与正式 profile 使用同一源码和入口的可运行 Go 客户端，并且不会被发布编排默认上传。
- 普通源码测试、Garble 测试/构建检查、四平台交叉构建、可选 Desktop 构建、现有安装/更新 smoke test 和发布 manifest 校验全部通过。
- 构建验证记录各平台原始二进制和最终 tar.zst 的大小变化；不对“必须变小”作未验证承诺。
- 公开安装、更新、启动和 Hub 健康检查流程的行为与混淆前一致；失败时旧安装仍保持现有回退语义。

### 测试

- 扩展现有 `scripts/release/build.test.mjs`，断言 Hub 与 Desktop 的正式构建参数、Garble profile、平台环境和诊断 profile 隔离。
- 运行 `server` 的完整 Go 测试，并使用固定工具版本执行可行的 Garble 测试/构建验证。
- 运行现有 Web 测试，确认本次没有改变前端产物配置。
- 执行 Windows 本机 Hub/Desktop 启动、warn 日志、停止/重启和更新 smoke test；对 Linux/macOS 至少完成交叉构建和安装包结构/manifest 验证。
- 检查发布资产清单和压缩包内容，确认没有诊断产物、源码或调试映射泄露。

## 范围之外

- Web 前端强混淆、属性名混淆、控制流平坦化和字符串加密。
- Registry、Release Server 的服务端 Go 二进制混淆。
- Garble `-literals`、`-tiny` 之外的激进 runtime/控制流保护。
- 代码签名、公钥发布验证、反篡改、DRM、远程证明和防调试保证。
- 将第三方 API key、Registry token 或其他秘密嵌入客户端二进制。
- Android APK 的额外代码混淆策略。
