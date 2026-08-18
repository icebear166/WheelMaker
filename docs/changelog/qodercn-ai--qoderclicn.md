# @qodercn-ai/qoderclicn

> WheelMaker 角色：Qoder CN ACP provider；启动命令为 `qoderclicn --acp`。
>
> 研究方式：npm tarball 相邻版本 diff；包内没有随包 CHANGELOG。首次记录 1.1.15–1.1.24。

## 1.1.24

### 修改

- tarball 中 `bundle/qoderclicn.js`、`bundle/qoder-worker-runtime.mjs` 和 package version/平台 ripgrep optional dependency 更新。
- `bin.qoderclicn`、Node `>=20.0.0`、`postinstall` 和 `qoderclicn --acp` 所需入口保持不变。

### WheelMaker integration

- 结论：需回归验证。
- bundle 为闭源发布物，需在 Node 20+ 上实际执行 `qoderclicn --acp` 的 initialize、prompt、tool call、cancel 和退出；不要因为 manifest 入口不变而跳过 smoke test。

## 1.1.23

### 修改

- tarball diff 仅见 `qoderclicn.js`、`qoder-worker-runtime.mjs` 和版本化平台 ripgrep 包变化，CLI manifest contract 未变。

### WheelMaker integration

- 结论：需回归验证。
- 保持 `qoderclicn --acp` 和 `qoderclicn` binary 检查；重点覆盖 optional dependency 在当前平台的安装和 ACP stdio 输出。

## 1.1.22

### 修改

- 更新 `qoderclicn.js`、worker runtime、`qodercn-npm-dispatcher.cjs` 及平台 ripgrep optional dependency。

### WheelMaker integration

- 结论：需回归验证。
- dispatcher 也发生变化，但 WheelMaker 使用的是 `qoderclicn`；仍需验证 npm global bin、ACP 参数和升级后进程退出码。

## 1.1.21

### 修改

- tarball diff 更新 `qoderclicn.js`、`qoder-worker-runtime.mjs` 和版本化平台 ripgrep 包。

### WheelMaker integration

- 结论：需回归验证。
- manifest、Node engine 和 `qoderclicn` 入口未变；执行一次完整 ACP 连接和 Windows/Linux/macOS 平台 binary 检查。

## 1.1.20

### 修改

- tarball diff 更新 CLI bundle、worker runtime 和平台 ripgrep optional dependency。

### WheelMaker integration

- 结论：需回归验证。
- 变化位于闭源运行时 bundle，需验证 `--acp`、`QODER_PERSONAL_ACCESS_TOKEN`/登录态、工作目录和工具调用结果。

## 1.1.19

### 修改

- tarball diff 更新 `qoderclicn.js`、`qoder-worker-runtime.mjs` 和版本化平台 ripgrep 包。

### WheelMaker integration

- 结论：需回归验证。
- 没有 manifest 入口调整；回归重点是 global install 后 `qoderclicn` 是否可被 PATH 找到，以及 ACP session 是否能正常结束。

## 1.1.18

### 修改

- tarball diff 更新 CLI bundle、worker runtime 和平台 ripgrep optional dependency。

### WheelMaker integration

- 结论：需回归验证。
- 当前接入参数保持 `qoderclicn --acp`；需执行 session/new、prompt、权限请求和取消测试。

## 1.1.17

### 新增

- 新增 `qodercn` binary，入口为 `bundle/qodercn-npm-dispatcher.cjs`；`qoderclicn` 入口继续保留。

### 修改

- tarball 增加 dispatcher，并更新 `postinstall`、worker runtime、安全插件资源和 package metadata；包的 homepage 从旧 GitHub 信息切换到 Qoder CLI 页面。

### WheelMaker integration

- 结论：需回归验证。
- WheelMaker policy 明确使用 `qoderclicn`，不应切换到新 `qodercn` 别名；升级后确认 `qoderclicn --acp` 仍走国内版账号/数据链路。

## 1.1.16

### 修改

- tarball diff 更新 `qoderclicn.js`、`qoder-worker-runtime.mjs` 和平台 ripgrep optional dependency；入口仍为 `qoderclicn`。

### WheelMaker integration

- 结论：需回归验证。
- Node engine 仍为 `>=20.0.0`；验证 global npm 安装、postinstall、PATH binary 和 ACP stdio。

## 1.1.15

### 修改

- 初始记录版本包含 `bundle/qoderclicn.js`、`postinstall.cjs`、worker runtime、安全资源和平台 ripgrep optional dependency。
- package manifest 提供 `qoderclicn` binary，Node engine 为 `>=20.0.0`。

### WheelMaker integration

- 结论：需回归验证。
- 这是本次历史窗口的基线；按 WheelMaker preset 使用 `qoderclicn --acp`，确认登录、工作目录、工具权限和 session 结束行为。
