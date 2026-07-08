# 04 - 干净 Windows 安装与集成验收

## 目标

把 02 的自包含运行时和 03 的安全/签名/CI 改动合流到同一稳定提交，在真正没有 Node、没有源码仓库、没有预存 Token Tracker 服务的 Windows 环境完成安装、首次启动、同步、重启、重复启动、重装和卸载验证，并修复合流后发现的问题。

对应贝叶斯维度：B2、B3、B5、B6、B7。

## 前置条件

- 01、02、03 均已完成回写并提供提交 SHA。
- 02、03 的 P0/P1 已关闭；若 03 因无正式证书 `BLOCKED`，本工单不得给外发通过结论。
- 使用主线集成分支执行，先合流再测试；不得在 02/03 各自分支分别验收后拼接结论。
- 必须有可恢复快照的干净 Windows 10/11 VM、Windows Sandbox 或等价独立机器。仅把 EXE 复制到临时目录不算干净安装。

## 第一性原理执行规则

1. 测试对象是最终签名安装包，而不是 `target/release/token-eyes.exe` 或开发服务器。
2. 干净环境必须证明没有 Node、源码仓库、旧本地服务和开发机缓存；否则自包含结论无效。
3. 窗口打开不代表产品可用；必须验证本地 API、真实同步、数据读写和错误恢复。
4. 一次成功不代表生命周期可靠；必须覆盖重启、重复启动、重装和卸载。
5. 安装验收发现问题可以做最小集成修复，但修复后必须重新构建、重新签名并从干净快照重跑受影响路径。
6. 不能把测试 fixture 冒充用户真实数据；fixture 只验证确定性，至少再验证一个真实受支持 Agent 的本地日志读取。
7. 截图和日志必须脱敏，不保存提示词、消息正文、API Key、Cookie 或用户名完整路径。

## 必读输入

- `AGENTS.md`
- `CLAUDE.md`
- `docs/tasks/windows-client-release/README.md`
- 01、02、03 的完成回写、提交 SHA 和 `review-records.md`
- 02 的 runtime manifest/解包清单
- 03 的 audit、签名和 workflow 证据
- 当前 release workflow 与安装包哈希

## 执行步骤

### 1. 合流和冲突审计

- [ ] 从 01 稳定基线按记录合流 02、03；保存合流前后 SHA。
- [ ] 冲突逐文件解决，不选择整边覆盖；核对 02 的 runtime prepare 和 03 的 release workflow 正确连接。
- [ ] 运行版本一致性、全量测试、安全扫描和 Tauri build。
- [ ] 对最终产物重新签名、计算哈希、解包并验证 runtime 清单。

### 2. 建立干净环境证据

- [ ] 记录 Windows 版本、架构、WebView2 版本、当前用户权限和 VM 快照标识。
- [ ] 证明 `node --version` 不可用或 Node 不在 PATH。
- [ ] 证明机器上不存在项目源码、`bin/tracker.js`、旧 Token Eyes/TokenTracker 安装和 7680/附近端口服务。
- [ ] 清理仅限测试 VM 内的旧应用数据，并记录操作；不得在用户开发机删除数据。
- [ ] 保存安装前进程、端口和安装目录基线。

### 3. 安装和首次启动

- [ ] 校验下载/复制后的安装包 SHA256 与发布者提供值一致。
- [ ] 验证 Authenticode `Valid`、发布者名称正确、安装过程没有未知发布者警告。
- [ ] 使用标准非管理员用户安装推荐外发包；如 MSI 需要管理员而 NSIS 不需要，明确唯一推荐包。
- [ ] 首次启动后验证窗口进入 Token Eyes 本地页面，不进入官网或空白页。
- [ ] 验证本地 API 子进程来自安装目录内 bundled `node.exe`，不是系统 Node。
- [ ] 验证 `/api/local-auth` 协议和 capabilities，以及使用统计、设置、请求记录三个核心端点。

### 4. 数据与同步

- [ ] 使用受控 fixture 目录验证至少两个 Agent 的目录检测、保存和同步，记录聚合前后数值。
- [ ] 对同一输入连续同步两次，第二次不得重复累加。
- [ ] 使用至少一个真实受支持 Agent 的现有本地日志验证数据可见；只记录计数和脱敏路径，不读取/记录消息正文。
- [ ] 修改汇率并手动刷新，重启后验证本地设置符合产品契约。
- [ ] 验证 API Key/凭据功能如被使用，存储在 Windows 安全存储且日志/前端存储无明文；测试使用专用假密钥或用户本机输入，工单不记录值。

### 5. 生命周期和故障恢复

- [ ] 关闭再启动应用，本地 API 和设置恢复；无孤儿后端。
- [ ] 连续启动两个客户端实例，验证不会造成数据损坏、无限拉起后端或端口冲突；记录现有单实例/共享服务行为。
- [ ] 模拟占用 7680、后端异常退出、runtime 文件损坏，验证可见错误、脱敏日志和重试。
- [ ] 断网启动时，本地历史统计仍可查看；需要网络的汇率/供应商功能明确失败，不影响本地核心页。

### 6. 重装、升级兼容和卸载

- [ ] 在相同版本执行修复安装或重装，验证不会重复服务或破坏用户数据。
- [ ] 如存在可安装的旧 0.1.0/前一版本，验证覆盖安装或明确要求先卸载；不能静默产生两个产品入口。
- [ ] 卸载后应用进程、后端进程、安装目录和快捷方式清除。
- [ ] 默认卸载不得擅自删除用户统计数据和安全存储；如产品提供 purge，必须由用户显式触发并单独验证。
- [ ] 重新安装后能读取保留的数据，或按明确迁移策略处理。

### 7. 合流修复规则

- [ ] 发现问题先追加 `review-records.md`，标出归属 02/03/04。
- [ ] 只做最小集成修复；架构性问题退回对应工单上下文。
- [ ] 任一二进制改变后重新签名、重新哈希、重新解包。
- [ ] 任一安装路径改变后从干净快照重新执行安装及受影响生命周期步骤。

## 必跑自动化命令

```powershell
git diff --check
git status --short --branch
npm run ci:local
npm --prefix dashboard run test
npm --prefix dashboard run typecheck
npm --prefix dashboard run lint
npm audit --omit=dev --audit-level=high
npm --prefix dashboard audit --omit=dev --audit-level=high
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo audit --file src-tauri/Cargo.lock
node --test test/release-windows-workflow.test.js test/release-version-consistency.test.js
npm run tauri:build
```

最终产物：

```powershell
$ReleaseRoot = (Resolve-Path "src-tauri\target\release").Path
$AppExe = Join-Path $ReleaseRoot "token-eyes.exe"
$Msi = Get-ChildItem (Join-Path $ReleaseRoot "bundle\msi\*.msi") | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$Nsis = Get-ChildItem (Join-Path $ReleaseRoot "bundle\nsis\*-setup.exe") | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$Artifacts = @($AppExe,$Msi.FullName,$Nsis.FullName)
$Artifacts | ForEach-Object { Get-AuthenticodeSignature $_; Get-FileHash $_ -Algorithm SHA256 }

$ExtractDir = Join-Path $env:TEMP ("token-eyes-msi-audit-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $ExtractDir | Out-Null
$Process = Start-Process msiexec.exe -ArgumentList @('/a',('"' + $Msi.FullName + '"'),'/qn',('TARGETDIR="' + $ExtractDir + '"')) -Wait -PassThru
if ($Process.ExitCode -ne 0) { throw "MSI administrative extract failed: $($Process.ExitCode)" }
Get-ChildItem -Recurse -File $ExtractDir
```

## 验收标准

- 02/03 合流后的唯一 HEAD 通过全部自动化和安全门禁。
- 最终签名安装包解包包含完整 runtime，三个产物签名均 Valid，哈希已记录。
- 干净 Windows 环境无 Node/源码/旧服务仍可安装、启动真实本地 API 和完成核心页面路径。
- 两次连续同步不重复计数；至少一个真实 Agent 本地日志被正确读取且没有采集消息正文。
- 重启、重复启动、端口占用、断网、后端崩溃、重装和卸载路径有新鲜证据。
- 用户数据和安全凭据符合保留/删除契约，安装目录不承载可变数据。
- 没有未关闭 P0/P1；计算 B2/B3/B5/B6/B7 的集成阶段后验并明确尚缺的独立复验 LR，最终 0.99/0.95 门槛只由 05 判定。
- 输出一个明确推荐给外部测试者的安装包文件名、版本、发布者和 SHA256；不得同时推荐旧包。

## 禁止事项

- 禁止在开发机原工作区直接运行 EXE冒充干净安装。
- 禁止使用未签名或自签名包得到外发通过结论。
- 禁止在安装后手工复制 Node/CLI 文件补救再宣称通过。
- 禁止只截图窗口，不验证 API、进程来源和数据。
- 禁止修改测试 VM 之外的用户数据。
- 禁止在修复后沿用旧安装包哈希、签名或截图。
- 禁止未经用户明确授权执行 push、创建/发布 Release 或向第三方分发安装包。

## 对抗性审查闭环

本工单至少执行两轮：

- 第一轮按正常用户路径安装并记录所有失败。
- 第二轮主动破坏依赖和环境，至少覆盖无 Node、占用端口、断网、损坏 runtime、重复启动和重装。

发现问题后保留失败记录、修复、重新构建/签名并从干净快照复验。最后一轮必须没有新 P0/P1，所有自动化和真实安装门禁通过。

## 完成汇报

按 README 模板回写，附最终 HEAD、提交链、推荐安装包、SHA256、签名主体、环境证据、截图/日志路径、同步数值摘要和审查轮次。完成后只声明“05 已具备前置条件”，不得自行给最终外发结论。

## 执行回写

尚未执行。执行者从本行之后追加，不得覆盖工单正文。
