# Client Go Obfuscation Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户可获得的 WheelMaker Hub/Desktop Go 产物切换到固定版本 Garble `-tiny` 正式 profile，同时保留不公开的非 `tiny` 诊断 profile。

**Architecture:** 在现有 `scripts/release/build.mjs` 之前增加一个聚焦的 Go 客户端构建模块，负责固定版本 Garble 的安装、版本校验、profile 参数和二进制构建；Hub 与 Desktop 共用该模块。公开 `scripts/release.mjs` 默认只使用 `release` profile，内部诊断通过独立的 `scripts/release/diagnostic.mjs` 使用 `diagnostic` profile，不进入打包或发布流程。

**Tech Stack:** Node.js 22.15+, Go 1.26.x, `mvdan.cc/garble@v0.17.0`, Node `node:test`, Jest/Webpack/Terser（前端保持现状）。

---

## 文件结构与职责

已存在并由已批准 spec/Wiki 同步完成：

- `docs/scope/2026-07-31-client-go-obfuscation/spec-client-go-obfuscation.md`：已确认的范围、决策和验收标准。
- `docs/wiki/release-and-build/build.md`：已记录客户端/服务端边界、正式 `tiny` profile 和诊断 profile。

实施阶段创建或修改：

- Create: `scripts/release/go-client-build.mjs` — 固定 Garble 版本、工具安装与校验、profile 和 Go 客户端构建参数。
- Modify: `scripts/release/build.mjs` — 让 Hub/Desktop 共用 Go 客户端构建模块，默认使用 `release` profile。
- Modify: `scripts/release/build.test.mjs` — 保留现有构建覆盖，并增加 Garble 安装、版本、profile、Hub/Desktop 参数断言。
- Create: `scripts/release/diagnostic.mjs` — 仅供私有源码工作树生成非 `tiny` 诊断构建，不提供发布选项。
- Create: `scripts/release/diagnostic.test.mjs` — 覆盖诊断命令参数边界和不发布约束。
- Modify: `docs/wiki/release-and-build/build.md` — 在诊断入口确定后补充私有诊断命令和固定工具版本。

不修改：`app/web/webpack.config.js`、`app/package.json`、`server/go.mod`、协议版本、发布 metadata schema、Registry/Release Server 构建入口和 Android 构建链。

### Task 1: 先为 Garble profile 和命令契约写失败测试

**Files:**
- Modify: `scripts/release/build.test.mjs`

- [x] **Step 1: 扩展测试 runner，使它能模拟固定版本 Garble**

在现有 `recordingRunner()` 旁加入以下辅助函数，并将现有只识别 `go build` 的输出文件模拟改为同时识别 Garble `build`：

```js
function isGarbleCommand(command) {
  return /(^|[\\/])garble(?:\.exe)?$/.test(command);
}
```

在 `recordingRunner` 内保留现有 npm 和 go-winres 模拟，新增以下分支：

```js
if (isGarbleCommand(command) && args[0] === 'version') {
  return {
    stderr: '',
    stdout: 'mvdan.cc/garble v0.17.0\n',
  };
}

if (isGarbleCommand(command) && args.includes('build')) {
  const outputPath = args[args.indexOf('-o') + 1];
  await mkdir(join(outputPath, '..'), {recursive: true});
  await writeFile(outputPath, basename(outputPath));
}
```

让 `go install` 的模拟继续记录调用但不写入发布目录；普通命令仍返回 `undefined`。

- [x] **Step 2: 添加正式 profile 的失败断言**

在现有 Hub/Windows GUI 测试附近新增测试，调用默认 `buildRelease()`，从 `runner.calls` 取出所有 `isGarbleCommand(call.command) && call.args.includes('build')` 的调用，断言：

```js
assert.equal(garbleBuilds.length, 4);
for (const build of garbleBuilds) {
  assert.deepEqual(build.args.slice(0, 2), ['-tiny', 'build']);
  assert.equal(build.args.includes('-literals'), false);
  assert.equal(build.args.some(arg => arg.includes('control')), false);
  assert.equal(build.args.includes('-trimpath'), true);
}
```

同一测试断言安装只执行一次，且使用精确 module version：

```js
const installs = runner.calls.filter(
  ({command, args}) => command === 'go' && args[0] === 'install',
);
assert.deepEqual(installs.map(({args}) => args.slice(0, 2)), [
  ['install', 'mvdan.cc/garble@v0.17.0'],
]);
```

- [x] **Step 3: 添加 Desktop 和诊断 profile 的失败断言**

扩展现有 Desktop 测试，让 `withDesktop: true` 的 Desktop 编译由 Garble 完成，并断言它也包含 `-tiny`、Windows GUI linker 和版本注入：

```js
const desktopBuild = runner.calls.find(
  ({command, args}) => isGarbleCommand(command) && args.at(-1) === './cmd/wheelmaker-desktop',
);
assert.equal(desktopBuild.args[0], '-tiny');
assert.equal(
  desktopBuild.args.includes(
    '-ldflags=-s -w -H windowsgui -X main.desktopReleaseVersion=v1.8',
  ),
  true,
);
```

新增诊断调用测试，传入 `goProfile: 'diagnostic'`，断言每个 Garble build 的第一个参数是 `build` 而不是 `-tiny`：

```js
const result = await buildRelease({
  goProfile: 'diagnostic',
  repoRoot,
  stagingRoot: join(root, 'diagnostic-staging'),
  version: 'v1.8',
  workRoot: join(root, '.release-work'),
  runner,
});
assert.equal(result.goProfile, 'diagnostic');
for (const build of runner.calls.filter(
  ({command, args}) => isGarbleCommand(command) && args.includes('build'),
)) {
  assert.equal(build.args[0], 'build');
  assert.equal(build.args.includes('-tiny'), false);
}
```

- [x] **Step 4: 更新受影响的既有断言并运行测试确认失败**

把现有测试中筛选 `command === 'go' && args.at(-1) === './cmd/wheelmaker'` 的逻辑改为使用 `isGarbleCommand(command)`；把 Desktop 的 linker 断言从 `go` 调用改为 Garble 调用；把 Go 调用总数断言改为仅包含一次固定版本 `go install`，因为 Hub/Desktop 编译本身改由 Garble 可执行文件完成。

Run:

```powershell
node --test scripts/release/build.test.mjs
```

Expected: FAIL，因为当前 `build.mjs` 仍然直接调用 `go build`，没有 `go install`、Garble profile 或 `goProfile` 返回值。

### Task 2: 实现固定 Garble 工具和 Go 客户端构建模块

**Files:**
- Create: `scripts/release/go-client-build.mjs`

- [x] **Step 1: 写入固定版本、profile 和可执行文件定位函数**

创建模块顶部内容，固定当前兼容的 Garble module version，不使用 `latest`：

```js
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

import {runCommand} from './commands.mjs';

export const GARBLE_MODULE = 'mvdan.cc/garble';
export const GARBLE_VERSION = 'v0.17.0';

const RELEASE_FLAGS = Object.freeze(['-tiny']);
const DIAGNOSTIC_FLAGS = Object.freeze([]);

export const GO_CLIENT_PROFILES = Object.freeze({
  release: Object.freeze({garbleFlags: RELEASE_FLAGS}),
  diagnostic: Object.freeze({garbleFlags: DIAGNOSTIC_FLAGS}),
});

export function garbleExecutablePath(toolDirectory, hostPlatform = process.platform) {
  return join(
    toolDirectory,
    hostPlatform === 'win32' ? 'garble.exe' : 'garble',
  );
}

function profileFor(name) {
  const profile = GO_CLIENT_PROFILES[name];
  if (!profile) {
    throw new Error(`unknown Go client build profile: ${name}`);
  }
  return profile;
}
```

- [x] **Step 2: 实现隔离安装和版本校验**

追加 `ensureGarble()`。它必须把 Garble 安装到 `.release-work/cache/go-tools`，不写全局 `GOBIN`；安装时不得继承目标交叉编译的 `GOOS`/`GOARCH`：

```js
export async function ensureGarble({
  buildEnvironment,
  cacheRoot,
  runner = runCommand,
  serverRoot,
}) {
  const toolDirectory = join(cacheRoot, 'go-tools');
  await mkdir(toolDirectory, {recursive: true});
  const hostEnvironment = {...buildEnvironment};
  delete hostEnvironment.GOOS;
  delete hostEnvironment.GOARCH;
  const environment = {
    ...hostEnvironment,
    GOBIN: toolDirectory,
  };
  await runner(
    'go',
    ['install', `${GARBLE_MODULE}@${GARBLE_VERSION}`],
    {cwd: serverRoot, env: environment},
  );

  const executable = garbleExecutablePath(toolDirectory);
  const version = await runner(executable, ['version'], {
    captureOutput: true,
    cwd: serverRoot,
    env: hostEnvironment,
  });
  if (!version?.stdout?.includes(`mvdan.cc/garble ${GARBLE_VERSION}`)) {
    throw new Error(`Garble version verification failed: expected ${GARBLE_VERSION}`);
  }
  return executable;
}
```

`go install` 失败或版本输出不匹配时直接抛错，禁止继续生成发布资产。固定版本 v0.17.0 要求可用的 Go 1.26.2+ toolchain；现有 Action 的 `1.26.x` 设置保持不变，本地 Go toolchain 无法满足时让安装失败并显示原始错误。

- [x] **Step 3: 实现统一的 Garble build 参数和执行函数**

追加以下完整函数，让 Hub/Desktop 只通过这一条路径调用 Garble：

```js
export function garbleBuildArguments({
  binaryPath,
  ldflags,
  packagePath,
  profile,
}) {
  return [
    ...profileFor(profile).garbleFlags,
    'build',
    '-trimpath',
    `-ldflags=${ldflags}`,
    '-o',
    binaryPath,
    packagePath,
  ];
}

export async function buildGoClient({
  binaryPath,
  buildEnvironment,
  garblePath,
  goarch,
  goos,
  ldflags,
  packagePath,
  profile,
  runner = runCommand,
  serverRoot,
}) {
  await runner(
    garblePath,
    garbleBuildArguments({binaryPath, ldflags, packagePath, profile}),
    {
      cwd: serverRoot,
      env: {
        CGO_ENABLED: '0',
        ...buildEnvironment,
        GOARCH: goarch,
        GOOS: goos,
      },
    },
  );
}
```

不得在该模块中加入 `-literals`、控制流参数、`-seed=random` 或前端构建逻辑；诊断 profile 只通过是否包含 `-tiny` 区分。

- [x] **Step 4: 运行模块级静态检查和 Task 1 测试**

Run:

```powershell
node --check scripts/release/go-client-build.mjs
node --test scripts/release/build.test.mjs
```

Expected: 模块语法检查 PASS；测试在 `build.mjs` 接入 helper 后进入 PASS。

- [x] **Task 3: 将正式 profile 接入发布编排，并覆盖失败闭环**

**Files:**
- Modify: `scripts/release/build.mjs`
- Modify: `scripts/release/build.test.mjs`

- 在 `build.mjs` 引入 `ensureGarble` 和 `buildGoClient`。
- 给 `buildRelease` 增加 `goProfile = 'release'` 参数；保留现有默认值，使既有发布入口继续使用正式 profile，并允许诊断入口复用编排器。
- Web 构建完成后先调用一次 `ensureGarble`，使用现有 `workRoot` 下的 Go 工具缓存目录、`buildEnvironment` 和 `serverRoot`；进度输出增加 `Installing Garble`。
- Hub 四个目标改为调用 `buildGoClient`：Windows 使用 `-s -w -H windowsgui`，其他平台使用 `-s -w`；包路径仍为 `./cmd/wheelmaker`；继续传递 `CGO_ENABLED=0`、`GOOS`、`GOARCH` 和已有构建环境。
- Desktop 保留现有 `go-winres@v0.3.3` 生成与清理流程，直接构建改为 `buildGoClient`；保留 `-s -w -H windowsgui -X main.desktopReleaseVersion=${version}`、目标路径和产物布局。
- 在 Go 构建缓存下创建并传递 `GOTMPDIR=.release-work/cache/go-tmp`，让交叉编译临时 exe 留在发布工作区，同时与 `GOCACHE`/`GOMODCACHE` 一样不污染系统临时目录。
- Garble 安装、版本校验和目标构建失败时立即抛错，不生成成功发布包，也不执行上传。
- 在 `buildRelease` 返回对象中保留 `goProfile`，使诊断测试和构建摘要能够确认实际使用的 profile。
- 更新测试替身以识别绝对路径 `garble.exe`、`garble version`、`go install` 和 Garble `build`；将目标调用、GUI 参数、并发和缓存断言改为针对 Garble，同时断言正式构建包含 `-tiny` 且不包含 `-literals` 或控制流参数。
- 增加版本不匹配测试：模拟版本不是 `v0.17.0` 时发布拒绝，且没有 Garble build 调用。
- 增加 Desktop 的 `-tiny`、Windows GUI 和 `desktopReleaseVersion` 断言；增加 `goProfile: 'diagnostic'` 时不包含 `-tiny` 的测试。

Run:

```powershell
node --test scripts/release/build.test.mjs
```

Expected: 所有发布编排测试 PASS；正式 Hub/Desktop 只经 Garble 构建，Garble 版本未锁定或校验失败时测试可证明发布停止。

- [x] **Task 4: 增加仅供内部使用的非 tiny 诊断构建入口，并同步 Wiki**

**Files:**
- Create: `scripts/release/diagnostic.mjs`
- Create: `scripts/release/diagnostic.test.mjs`
- Modify: `docs/wiki/release-and-build/build.md`

- `diagnostic.mjs` 只接受 `--version v1.x` 和可选 `--with-desktop`；拒绝 `--publish`、`--with-android`、未知参数和重复参数。
- 诊断入口调用 `buildRelease` 时传入 `goProfile: 'diagnostic'`、固定的 `.release-work/diagnostic-cache` 和 `.release-work/diagnostic/<version>` 路径，不接受任意输出目录或发布目标，因此不会覆盖正式发布目录。
- 诊断入口不调用上传、部署、manifest 发布或 Android 构建；错误以非零退出状态结束。
- 保持与正式构建相同的 source/version/web 生成链路和固定 Garble 版本，仅省略 `-tiny`；不发布诊断产物。
- 测试覆盖参数解析、正式参数拒绝、诊断 profile 传递、无 publish 行为、默认 Hub 四目标和可选 Desktop。
- Wiki 增加内部诊断命令示例：

```powershell
node scripts/release/diagnostic.mjs --version v1.83
node scripts/release/diagnostic.mjs --version v1.83 --with-desktop
```

并明确诊断产物位于 `.release-work/diagnostic/`、不上传、不作为客户包，正式发布仍使用 `v0.17.0` + `-tiny`。

Run:

```powershell
node --test scripts/release/diagnostic.test.mjs
```

Expected: 诊断命令只生成内部路径的非 tiny 构建，所有发布参数被拒绝，测试 PASS。

- [x] **Task 5: 执行全量回归、体积记录与产物泄漏检查**

**Files:**
- No new production files; use the release scripts and generated files under `.release-work/` / `.release-out/` only.

Run:

```powershell
node --test scripts/release/*.test.mjs scripts/deploy/*.test.mjs
Push-Location server
go test ./...
& ..\.release-work\cache\go-tools\garble.exe test ./...
Pop-Location
node scripts/release.mjs
node scripts/release/diagnostic.mjs --version v1.83
```

- 验证正式发布仍生成四个平台 archive、部署目录和 manifest，未触发上传时不产生远端副作用；正式包不含源码、`.map`、Garble map 或诊断目录。
- 验证诊断构建只写入 `.release-work/diagnostic/v1.83/`，并记录同一目标的非 tiny 与 tiny 体积差异；体积只记录事实，不把“必须变小”设为发布门槛，因为 `-tiny` 的主要目标是降低可逆性。
- Windows smoke test 覆盖 Hub/Desktop 启动、停止、重启、更新以及 `warn` 日志可见；预期普通业务 warn 保留，不以运行时 panic/fatal/trace 输出作为正式包诊断保证。
- 交叉构建检查四个平台的 GOOS/GOARCH、Windows GUI linker flag、文件名和 archive 布局；使用 `7z l` 检查包内没有源码、map、私有诊断产物或未预期的 Web 构建文件。

Expected: Go 测试、Garble 测试、Node 测试、发布和诊断回归均 PASS；产物边界和日志行为符合规格；任何构建错误在发布/上传前失败。

实际验证记录：原生 `go test ./...`、`garble test ./internal/shared`、Node 发布/部署全量测试（128/128）、正式 `-tiny` 发布、非 tiny 诊断发布和带 Desktop 的正式发布均通过。Windows 上全量 `garble test ./...` 仅剩现有 `TestProjectFileIndexQuerySessionsUseCompactIndexesAndMemoryCaps`：该测试通过反射按未导出字段名 `indexes` 查找字段，Garble 重命名后按设计失败；未修改服务端测试或生产 Go 代码。

- [x] **Task 6: 做最终质量检查并提交实现**

Run:

```powershell
git diff --check
rg -n "mvdan\.cc/garble@latest|[-/]literals|control.?flow|source.?map|\.map" scripts/release docs/wiki/release-and-build
git status --short
git diff --stat
git add -A
git commit -m "feat: obfuscate client Go releases"
```

- 确认所有 Garble 安装引用精确为 `mvdan.cc/garble@v0.17.0`，正式构建没有 `-literals`、控制流混淆或公开 map，前端文件无变更。
- 检查 diff 只包含发布脚本、发布测试、诊断入口/测试、规格和对应 Wiki；不修改协议、元数据、信任链、凭据、Registry/Release Server 或 Android。
- 提交前确认所有测试结果已记录且 worktree 中没有未解释的生成物。
- 实现完成后按仓库 Git 约定推送 `feat/client-go-obfuscation`；若主 worktree 干净，再合并到 `main`、推送 `main`，最后清理已合并的分支和 worktree。

## Spec Coverage

| Requirement | Plan coverage |
| --- | --- |
| A 级威胁模型与客户 Go 客户端范围 | Task 3, Task 4, Task 6 |
| Hub 四目标正式构建使用 Garble `-tiny` | Tasks 1–3, Task 5 |
| Desktop 可选构建使用同一正式 profile | Tasks 1–3, Task 5 |
| `CGO_ENABLED=0`、`-trimpath`、`-s`、`-w` 和 Windows GUI flag 保留 | Tasks 1–3, Task 5 |
| 不使用 literals、控制流混淆或前端强混淆 | Tasks 1–3, Task 6 |
| 固定 Garble 版本、独立缓存、版本校验、失败闭环 | Tasks 1–3, Task 5–6 |
| 普通 `warn` 日志保留，非 tiny 诊断构建内部可用 | Tasks 3–5 |
| Registry/Release Server、协议、元数据、凭据和 Android 不变 | Task 6 |
| 无源码、map、诊断产物泄漏；发布/更新布局不变 | Task 5 |
| 文档与运维路径可执行 | Task 4, Task 6 |
