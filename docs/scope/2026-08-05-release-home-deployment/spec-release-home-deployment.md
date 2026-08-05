> 由 scope skill 于 2026-08-05 生成

# Release Server Home 部署与一次性旧机迁移

## 目标

普通 Release Server 部署只面向当前 SSH 登录用户，使用该用户的 Home 目录完成版本、配置、发布数据和公开文件的安装，不探测或迁移旧 Nginx/系统级服务，不依赖 `/srv`、`www-data` 或 POSIX ACL。旧机器的兼容处理改为一次性的人工 SSH 操作；人工迁移成功后切换到用户服务并禁用旧系统服务。

## 决策

- **普通部署与旧机迁移分离**：普通 `deploy-release-server.bat` 不检测旧 systemd 服务、旧配置、旧数据或 Nginx。
- **旧机前置条件**：仍在运行旧系统服务的机器必须先完成一次人工迁移；普通部署不负责释放旧的 `127.0.0.1:9680` 端口，也不自动停止旧服务。
- **Home 布局**：远端使用实际 SSH 登录用户的 Home：

  ```text
  ~/.wheelmaker/release-server/
    config.json
    versions/<source-sha>/wheelmaker-release-server
    current -> versions/<source-sha>
    data/
      public/
      staging/
  ~/.config/systemd/user/wheelmaker-release-server.service
  ```

  `config.json` 的 `dataRoot` 指向 `~/.wheelmaker/release-server/data` 的绝对路径。
- **权限边界**：Release Server 用户服务拥有上述 Home 目录；配置和版本目录保持用户私有，发布数据由同一用户读写，公开目录只需要入口服务的普通只读/遍历权限。普通部署不调用 `getfacl`、`setfacl`，也不创建 `www-data` 依赖或写入 `/srv`。
- **用户服务**：普通部署安装/更新并管理自己的 user-level systemd unit，执行 daemon reload、启用、重启和 loopback 健康检查；需要开机常驻时只处理该登录用户的 linger。它不管理 Gateway、Nginx、防火墙或 DNS。
- **Gateway 参数**：继续使用 `--gateway=none|caddy`。`none` 严格不写 Gateway；`caddy` 只原子写入 `~/.wheelmaker/gateway/sites/release-server.json`，站点的 `publicRoot` 指向 Home 中的 `data/public`，不安装、启动、停止、重载或校验 Gateway。
- **同用户约束**：Gateway 与 Release Server 使用同一 SSH/操作系统用户时共享 Home；Gateway 的配置和运行时目录保持独立。
- **旧机人工迁移**：不新增迁移脚本。需要迁移时由运维者直接 SSH 执行一次性操作：备份旧文件，复制旧 token 配置、发布数据和公开资产到 Home，安装并启动用户服务，完成 loopback/外部健康检查；成功后停止并禁用旧 `wheelmaker-release-server.service`，保留旧 unit、二进制、配置、数据和运行用户。
- **旧 Nginx 过渡**：人工迁移时一次性把 Release Server 的 Nginx 静态目录调整到新的 Home `data/public`，并用普通 owner/group/mode 提供必要的只读/遍历权限；普通部署不再处理 Nginx。除该 Release Server 静态根外，Nginx 配置、证书和其他站点保持不变。

## 架构

部署器负责构建、上传和写入登录用户 Home；用户级 Release Server 负责 loopback `127.0.0.1:9680`、发布数据和静态公开目录；Gateway 只消费用户 Home 中的语义站点文件。旧系统服务、旧 `/srv` 数据和 Nginx 只存在于人工迁移边界，不进入普通部署状态机。

### 普通部署流程

1. 检查源码树、目标 Linux/amd64、SSH 和上传工具。
2. 编译并上传二进制、用户 unit 和首页文件到远端临时目录。
3. 在 Home 中创建版本目录、`data/public`、`data/staging` 和候选配置；保留现有 Home 配置中的 token 哈希。
4. 原子切换 `current`、配置、unit 和公开首页，重启用户服务并检查 loopback `/healthz`。
5. `--gateway=caddy` 时原子写入 Release Server 语义站点；不等待或控制 Gateway。
6. 清理远端临时目录并报告结果。

### 人工旧机迁移流程

1. 记录旧服务状态、旧配置和旧数据备份。
2. 在受控停服窗口停止旧系统服务，将 `/etc/wheelmaker-release-server/config.json` 的 token 哈希和 `/srv/wheelmaker-release` 数据复制到新的 Home 数据目录，并把 Nginx 的静态根调整到 Home `data/public`。
3. 安装用户 unit、启用所需 linger、启动用户服务，验证 loopback 和外部 HTTPS `/healthz`。
4. 健康检查通过后禁用旧系统服务；任何失败都停止新服务并恢复旧服务，不删除旧文件。

## 验收标准

- 普通部署在没有 `getfacl`、`setfacl`、`www-data`、`/srv/wheelmaker-release` 的新机器上可以完成。
- 普通部署只持久化创建或更新登录用户 Home 下的 Release Server 文件和可选 Gateway 站点文件；短期上传目录完成后必须清理。
- `--gateway=none` 不读取、创建、覆盖或删除任何 Gateway 文件；`--gateway=caddy` 只写 Release Server 站点声明。
- 服务运行用户始终是 SSH 登录用户；配置、版本和发布数据不需要 root 所有权。
- Gateway 站点的 `publicRoot` 指向 Home 中的公开目录，upstream 固定为 `http://127.0.0.1:9680`。
- 人工旧机迁移成功后，用户服务通过 loopback/外部健康检查，旧系统服务处于 disabled，旧文件仍可用于回滚。
- 人工迁移失败不会留下半切换状态，也不会删除旧服务、旧 Nginx 配置、证书或发布数据。

### 测试

- Node 部署/远端脚本测试覆盖 Home 布局、无 ACL/无 `/srv` 的普通部署、用户 unit、配置和 Gateway 站点路径。
- 测试确保普通部署源码中不再出现旧服务探测、ACL 命令、`www-data` 权限切换和旧 `/srv` 数据路径。
- 运行现有 Release Server Node/Go 测试，并在实际旧主机上单独执行人工迁移验收；单元测试不修改真实 systemd、Nginx、Gateway 或远端数据。

## 范围之外

- 不编写或发布自动旧机迁移脚本；迁移只作为一次性人工运维操作。
- 普通部署不安装、卸载、更新、启动、停止或重载 Nginx/Caddy，不修改 DNS、防火墙或证书。
- 不删除旧 systemd unit、旧 `/opt` 二进制、旧 `/etc` 配置、旧 `/srv` 数据或旧运行用户。
- 不修改 Release Server、Registry、发布 API 或 Gateway 站点协议。
