# Credential Response and Security Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清点并轮换当前/历史暴露的真实凭据，阻止新增泄漏，并以自动化与 staging 端到端门证明整个安全规格完成；Git 历史重写仍留待单独维护窗口。

**Architecture:** Gitleaks 在本地 staged hook 和 CI 双重执行，报告只保留脱敏 fingerprint/位置。Credential response 先外部轮换再清理当前 tree。最终 acceptance script 聚合 Go/Web/Android/发布/审计门；Registry reverse-proxy e2e 覆盖根路径和子路径，真实 Nginx/EXE/Android 在 staging checklist 验证。

**Tech Stack:** Gitleaks v8.28.0、Git hooks、GitHub Actions、Go integration tests、PowerShell、Jest/webpack、Gradle、Nginx staging。

---

### Task 1: 加入 Gitleaks 当前工作树、staged 和 CI 防线

**Files:**

- Create: `.gitleaks.toml`
- Create: `.githooks/pre-commit`
- Create: `scripts/install_git_hooks.ps1`
- Create: `scripts/test_security_hooks.ps1`
- Create: `.github/workflows/security.yml`
- Modify: `INSTALL.md`

- [ ] **Step 1: 写 hook/CI source test**

测试断言：pre-commit 执行 `gitleaks git --staged --redact --no-banner`；缺少 binary 时 fail closed 并打印安装命令。CI checkout 使用 full history，运行 current tree 和 Git history 两个扫描，报告启用 `--redact`。

`.gitleaks.toml` 只 allowlist 明确测试 fixture 路径/规则 ID；禁止全局 allowlist `secret`、整个 `app/__tests__` 或所有文档。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test_security_hooks.ps1
```

Expected: FAIL；hook、配置和 workflow 尚不存在。

- [ ] **Step 3: 实现安装器和 CI**

安装脚本只做：

```powershell
go install github.com/gitleaks/gitleaks/v8@v8.28.0
git config core.hooksPath .githooks
gitleaks version
```

Workflow 在 push/PR 运行：

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- run: go run github.com/gitleaks/gitleaks/v8@v8.28.0 dir --redact --no-banner .
- run: go run github.com/gitleaks/gitleaks/v8@v8.28.0 git --redact --no-banner
```

Workflow 不得使用 `continue-on-error`，扫描非零即阻止合并。

- [ ] **Step 4: 安装本仓库 hook、运行测试并提交**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install_git_hooks.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test_security_hooks.ps1
git add .gitleaks.toml .githooks/pre-commit .github/workflows/security.yml scripts/install_git_hooks.ps1 scripts/test_security_hooks.ps1 INSTALL.md
git commit -m "ci: block new credential leaks"
```

Expected: PASS；`git config --get core.hooksPath` 输出 `.githooks`。

### Task 2: 扫描历史和当前 tree，建立脱敏凭据清单

**Files:**

- Create: `docs/security-credential-response.md`
- Modify: current source/config/docs files identified by scan

- [ ] **Step 1: 在 Git 外创建私有报告目录**

Run:

```powershell
$reportDir = Join-Path $HOME '.wheelmaker\security-reports\wheelmaker'
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
gitleaks dir --redact --no-banner --report-format json --report-path (Join-Path $reportDir 'current-tree.json') .
gitleaks git --redact --no-banner --report-format json --report-path (Join-Path $reportDir 'history.json')
```

Expected: 无 findings 时 exit 0；有 findings 时非零但生成 redacted JSON。报告目录不在仓库，不提交。

- [ ] **Step 2: 对每条 finding 分类**

`docs/security-credential-response.md` 只记录：Gitleaks rule ID、文件/提交、脱敏 fingerprint、分类（真实/测试/误报）、provider owner、轮换状态、验证时间。不得复制 secret、Authorization header 或可复用 URL。

测试 fixture 只有明显不可用值（例如 `test-secret-not-valid`）才可窄化 allowlist；真实或疑似真实值绝不 allowlist。

- [ ] **Step 3: 先完成外部轮换/吊销**

对每个真实 Registry/DeepSeek/Volcengine/TTS/发布签名/其他 provider credential：生成新值、写入受保护后端或 CI secret store、重启相关服务、验证新值、吊销旧值、再把状态标为 rotated。此步骤需要 credential owner 的外部权限；任一真实值未吊销时，本计划不得宣称完成。

Registry Token 轮换后必须验证所有旧设备 Session 失效，Hub 使用新 Token 重连。

- [ ] **Step 4: 清理 current tree 并重扫**

替换真实值为明显不可用的示例字符串或删除文件；不要把新值写入仓库。

Run:

```powershell
gitleaks dir --redact --no-banner .
git diff --check
```

Expected: current tree 0 findings。历史 findings 允许保留到单独历史重写维护窗口，但对应 credential 必须已 revoked。

- [ ] **Step 5: 提交脱敏响应记录**

Run:

```powershell
git add docs/security-credential-response.md
git add -u
git commit -m "security: remove and rotate exposed credentials"
```

Expected: pre-commit Gitleaks PASS；提交不含报告 JSON。

### Task 3: 固化安全模型和明确延期项

**Files:**

- Create: `docs/security.md`
- Create: `docs/security-known-risks.md`
- Modify: `README.md`
- Modify: `INSTALL.md`

- [ ] **Step 1: 编写可操作的安全文档**

`docs/security.md` 必须覆盖：单用户/单 Token、新安装 256-bit 自动 Token 与短自定义 Token 风险、loopback+Nginx、Base URL、Cookie 180 天滑动、设备撤销、后端密钥 set-only、Relay 6 位码的在线边界、Native Bridge、Junction 信任语义、LocalHubRead 已删除且不恢复、日志/报告位置、轮换步骤、漏洞报告方式。

`docs/security-known-risks.md` 明确：当前 OS 用户/管理员攻击者、已控制同源页面、同 Origin 路径不隔离、Relay 不是永久高熵分享密钥、自签名不支持、Go 升级暂缓、需要 major 的依赖、历史重写未执行。

- [ ] **Step 2: 写文档一致性 test**

在 `scripts/test_security_docs.ps1`（新建）断言 README/INSTALL/security docs 不再宣称浏览器保存 Token、Monitor 可用、EXE/APK 内置完整 Web、HTTP 远程地址或自签名绕过。

- [ ] **Step 3: 运行测试并提交**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test_security_docs.ps1
git add docs/security.md docs/security-known-risks.md README.md INSTALL.md scripts/test_security_docs.ps1
git commit -m "docs: publish wheelmaker security model"
```

Expected: PASS；延期项没有被误写成已修复。

### Task 4: 增加根路径/子路径反向代理安全 e2e

**Files:**

- Create: `server/internal/registry/security_e2e_test.go`
- Create: `app/__tests__/web-security-e2e-contract.test.ts`

- [ ] **Step 1: 写 Go reverse-proxy fixture**

用 `httptest.Server` + `httputil.ReverseProxy` 模拟可信 loopback Nginx，分别挂 `/ws` 和 `/wheelmaker/ws`，保留 query/Upgrade 并设置 Host/X-Forwarded-Proto/X-Real-IP。测试完整流程：status unauthenticated → login → Cookie/CSRF → WS connect → Registry restart → status/WS 仍有效 → revoke → 失效 → Token rotation → 全部失效。

另测 cross-origin、伪造 forwarded header、wrong Base Path cookie、login 429/oversize、无 Origin Hub Token。

- [ ] **Step 2: 写 Web URL/登录/连接合约 test**

Jest 用 fake fetch/WebSocket 串起 root/subpath endpoints，断言 login 后 WebSocket 构造无 token/query/subprotocol credential，`connect.init` 无 token，Cookie 由浏览器隐式携带。

- [ ] **Step 3: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./internal/registry -run 'TestSecurityE2E' -v
Set-Location ..\app
npm test -- --runInBand __tests__/web-security-e2e-contract.test.ts
```

Expected: FAIL；e2e fixture/contract 尚不存在。

- [ ] **Step 4: 完成 fixture 并提交**

测试使用随机生成 Token，不使用生产域名/凭据。每个 server/listener 在 `t.Cleanup` 关闭，Session temp dir 在 test temp 下。

Run:

```powershell
Set-Location server
go test ./internal/registry -run 'TestSecurityE2E' -v
Set-Location ..\app
npm test -- --runInBand __tests__/web-security-e2e-contract.test.ts
Set-Location ..
git add server/internal/registry/security_e2e_test.go app/__tests__/web-security-e2e-contract.test.ts
git commit -m "test: cover registry security end to end"
```

Expected: PASS。

### Task 5: 建立一键安全验收脚本

**Files:**

- Create: `scripts/security_acceptance.ps1`
- Create: `scripts/security_acceptance.sh`
- Create: `scripts/test_security_acceptance_ps1.ps1`
- Create: `docs/security-staging-checklist.md`

- [ ] **Step 1: 写脚本 source test**

断言脚本按顺序执行且任一失败立即非零：Gitleaks current tree；Go full tests；Web Jest/typecheck/release build/audit；Android test/lint；publish script tests；Monitor/Token/source forbidden grep；git diff check。脚本不得打印 config、环境 secret 或扫描原文。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test_security_acceptance_ps1.ps1
```

Expected: FAIL；验收脚本尚不存在。

- [ ] **Step 3: 实现跨平台验收入口**

PowerShell 和 shell 使用相同 gates。`npm audit` 策略：production 不允许 moderate/high/critical；完整 tree 不允许 high/critical；已批准的 low/moderate major-only 项必须与 deferred 文档精确匹配，否则失败。

Forbidden source gate 至少检查：公开旧默认 Token、`LOCAL_TOKEN_KEY`、LocalHubRead listener/role/method/manager、`addJavascriptInterface`、Monitor runtime/role、9632 server、Android debug release signing、`InsecureSkipVerify`。

自动化门还必须显式运行现有基础安全回归：两次新安装生成不同的 32-byte/256-bit Base64URL Token；随机源失败 fail closed；空值/公开旧默认值被迁移或拒绝；短自定义 Token 被接受；`config.json` 私有原子写；Registry/Relay/wildcard listener 拒绝；非 loopback forwarded header 不可信。

- [ ] **Step 4: 编写 staging checklist**

清单逐项记录 pass/fail/evidence，不写 secret：

- 根路径和 `/wheelmaker/` 子路径的 Web/login/WSS。
- 普通浏览器首次登录、重启免登录、180 天 clock test、单设备/全部撤销。
- Desktop/Android 首启 Bootstrap、系统证书错误、离线 retry/change、服务器切换清理。
- 旧 Origin/Base Path/iframe/无手势 Bridge 拒绝。
- APK 错误 size/hash/package/version/signature 拒绝。
- Relay 正确 code、错误 5/20 限速、generation 失效。
- 实际 HTTP CSP/referrer/nosniff/frame headers。
- `127.0.0.1` listener 检查及 wildcard/LAN 配置启动失败。

- [ ] **Step 5: 运行脚本测试并提交**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test_security_acceptance_ps1.ps1
git add scripts/security_acceptance.ps1 scripts/security_acceptance.sh scripts/test_security_acceptance_ps1.ps1 docs/security-staging-checklist.md
git commit -m "test: add system security acceptance gate"
```

Expected: source test PASS。

### Task 6: 执行最终自动化与 staging 验收

- [ ] **Step 1: 运行一键自动化门**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security_acceptance.ps1
```

Expected: 所有自动化 gate PASS；无 secret 输出。若耗时超过一个会话，按子命令逐段执行并保存 exit code，不跳过。

- [ ] **Step 2: 在 staging 执行人工/设备清单**

使用非生产 Token/第三方测试凭据，逐项填写 `docs/security-staging-checklist.md` 的日期、平台版本、commit SHA、PASS/FAIL 和非敏感 evidence。任一必选项 FAIL，返回对应阶段修复后重新跑完整门。

- [ ] **Step 3: 确认真实凭据完成轮换**

检查 `docs/security-credential-response.md`：所有真实 finding 为 rotated/revoked；所有 current-tree finding 已清除；history-only finding 都注明历史重写 pending。缺外部权限时这是明确 blocker，不得打勾。

- [ ] **Step 4: 提交验收证据**

Run:

```powershell
git add docs/security-staging-checklist.md docs/security-credential-response.md docs/security-known-risks.md
git commit -m "test: record security acceptance evidence"
git status --short
```

Expected: 工作树为空；文档中没有 Token、Cookie、API key、Authorization 或完整 Gitleaks raw report。

### Task 7: Rebase 后重新验收并进入主干

- [ ] **Step 1: 获取主干并 rebase**

Run:

```powershell
git fetch origin
git rebase origin/main
```

Expected: rebase 成功。冲突逐文件按批准 spec 解决，不使用 `git checkout --` 或 `git reset --hard` 丢弃用户改动。

- [ ] **Step 2: Rebase 后重跑最终门**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security_acceptance.ps1
git diff --check
git status --short
```

Expected: PASS 且工作树为空。

- [ ] **Step 3: 推送实施分支并 fast-forward 主干**

Run:

```powershell
git push --force-with-lease origin HEAD
git log --oneline origin/main..HEAD
```

Expected: 远端实施分支更新且只含已验收阶段提交。随后按仓库主干权限用 fast-forward/受保护分支 PR 合并；禁止 merge commit。若主干保护要求 PR，等待 CI security workflow PASS 后 squash 也不可用，因为需要保留阶段回滚边界，应选择 rebase-and-merge。

### Task 8: 明确不执行 Git 历史重写

- [ ] **Step 1: 记录独立维护项**

在 `docs/security-known-risks.md` 保留 history rewrite 条目：受影响 refs、已吊销 credential fingerprints、预计 clone/CI/branch coordination、需要的维护窗口和再次审批人。不要在本计划运行 `git filter-repo`、BFG、删除远端 refs 或 force-push main。

- [ ] **Step 2: 最终状态检查**

Run:

```powershell
git status --short
git log -1 --oneline
git push origin HEAD
```

Expected: 工作树为空、当前验收提交已推送；历史重写仍明确 pending，而不是被误报为完成。
