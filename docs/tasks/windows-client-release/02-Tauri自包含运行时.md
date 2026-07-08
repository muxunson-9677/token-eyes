# 02 - Tauri 自包含运行时

## 目标

让 Token Eyes Tauri Windows 安装包真正包含固定版本的 Node、Token Tracker CLI、生产依赖和 Dashboard 资源；安装到没有 Node、没有源码仓库的机器后，应用能够启动本地 API、显示真实状态，并在失败时给出用户可见且不泄密的诊断。

对应反例：F1、F2、F9。对应贝叶斯维度：B2、B3、B7。

## 前置条件

- 01 已完成并提供稳定基线提交 SHA。
- 本工单在独立分支/worktree 执行。
- 可以与 03 并行，但不得修改依赖锁文件、release workflow 或签名配置。

## 第一性原理执行规则

1. 安装后的进程只能依赖安装包内资源、Windows/WebView2 和用户数据目录；不能依赖源码仓库、开发机 cwd 或系统 Node。
2. 资源“写进配置”不等于“出现在安装包”；必须解包验证文件清单。
3. 后端“启动了子进程”不等于“可用”；必须等待带协议版本和能力集的 `/api/local-auth` 健康检查通过。
4. 失败不能静默回退到 7680 并让用户猜；必须产生可见、可复制、已脱敏的故障状态。
5. 用户数据必须写入用户目录，不能写入 Program Files 或安装资源目录。
6. 运行时供应链必须固定版本、校验官方 SHA256、保留许可证，不能在每次构建拉取不确定的最新版。
7. 先写能证明“无 Node/无源码时失败”的测试，再实现最小自包含路径；开发回退只能在 debug 模式存在。

## 必读输入

- `AGENTS.md`
- `CLAUDE.md`
- `docs/tasks/windows-client-release/README.md`
- `docs/tasks/windows-client-release/01-发布基线收敛.md` 完成回写和稳定 SHA
- `TokenTrackerWin/scripts/bundle-node.ps1`
- `TokenTrackerWin/ServerManager.cs`
- `TokenTrackerBar/scripts/bundle-node.sh`
- `src-tauri/tauri.conf.json`
- `src-tauri/src/commands.rs`
- `src-tauri/src/lib.rs`
- `dashboard/src/lib/local-api-url.ts`

## 文件所有权

允许创建/修改：

- `src-tauri/scripts/bundle-runtime.ps1` 或职责等价的 Tauri 专用脚本
- `src-tauri/tauri.conf.json` 的 resource/bundle 准备配置
- `src-tauri/src/commands.rs`
- `src-tauri/src/lib.rs`
- 新增 `src-tauri` 运行时路径和进程测试
- `dashboard/src/lib/local-api-url.ts` 及其测试
- 用户可见后端故障组件与 `dashboard/src/content/copy.csv`
- `package.json` 中仅与 Tauri runtime prepare/build 有关的脚本
- `.gitignore` 中仅针对生成的 Tauri EmbeddedServer 目录的精确规则

禁止修改：

- `package-lock.json`、`dashboard/package-lock.json`、`src-tauri/Cargo.lock` 的依赖升级，由 03 负责。
- `.github/workflows/release-windows.yml` 和签名逻辑，由 03 负责。
- 与本地 API 启动无关的业务功能。

## 运行时目标结构

安装目录或 Tauri resource 目录最终至少包含：

```text
EmbeddedServer/
  node.exe
  NODE_LICENSE.txt
  runtime-manifest.json
  tokentracker/
    bin/tracker.js
    src/**
    dashboard/dist/**
    node_modules/**          # 仅生产依赖
    package.json
    package-lock.json
```

`runtime-manifest.json` 至少记录应用版本、Node 版本、Node 官方 SHA256、CLI 源码提交 SHA、构建时间和文件数量。不得记录路径中的用户名、密钥或环境变量值。

## 执行步骤

### 1. 复现干净安装失败

- [ ] 为路径解析增加失败测试：Release 模式仅存在 `token-eyes.exe`、PATH 无 Node、祖先目录无 `bin/tracker.js` 时，当前实现不能启动。
- [ ] 解包 01 基线安装包并记录只有主 EXE 的文件清单。
- [ ] 记录当前启动错误只进入 `stderr`、前端最终回退默认端口的证据。

### 2. 建立可复现运行时打包脚本

- [ ] 以现有 Windows bundler 为参考，为 Tauri 创建独立脚本；禁止直接复用 `TokenTrackerWin/EmbeddedServer` 作为构建输入。
- [ ] 固定 Node win-x64 版本，并下载官方 `SHASUMS256.txt` 校验；不匹配立即失败。
- [ ] 构建 Dashboard 后复制 CLI allowlist、`package.json`、`package-lock.json` 和 `dashboard/dist`。
- [ ] 使用锁文件安装生产依赖；禁止无锁 `npm install` 引入漂移。
- [ ] 生成 manifest、复制 Node 许可证；明确排除 `.env`、`.git`、测试、文档、截图、日志、缓存和开发依赖。
- [ ] 构建脚本二次执行结果一致；临时目录和生成目录安全限定在预期路径内。

### 3. 接入 Tauri resources

- [ ] 将生成目录配置为 Tauri bundle resource，保留精确目标目录名。
- [ ] `npm run tauri:build` 必须自动执行 Dashboard 构建和 runtime prepare，不能要求操作者手工先跑隐藏步骤。
- [ ] runtime prepare 任一下载、校验、依赖安装、文件缺失失败时，Tauri build 必须失败。
- [ ] 安装包构建后解包，断言目标结构和关键文件真实存在。

### 4. 只从内置运行时启动 Release 后端

- [ ] Rust 使用 Tauri `resource_dir` 或职责等价的正式 API 定位 `EmbeddedServer`。
- [ ] Release 使用内置 `node.exe` 和 `tokentracker/bin/tracker.js`；不搜索祖先源码目录，不调用 PATH 中的 Node。
- [ ] Debug 可保留显式开发回退，但必须由编译模式或明确环境变量隔离，不能在 Release 静默生效。
- [ ] 子进程 cwd 指向内置 tokentracker 根目录；用户数据仍使用 `~/.tokentracker` 等既有用户目录。
- [ ] 保持 loopback 绑定、随机回退端口、协议版本和 capabilities 校验；不得接受不兼容旧服务。
- [ ] 退出应用时回收自己启动的子进程，不杀死非本应用拥有的兼容服务。

### 5. 可见故障和脱敏日志

- [ ] 启动失败、运行时缺文件、Node 校验失败、端口耗尽、8 秒未就绪分别产生结构化错误码。
- [ ] 前端不再把失败永久缓存为默认 7680；提供重试动作和简洁诊断。
- [ ] 用户可见错误包含错误码和建议，不包含 API Key、Cookie、Authorization、完整用户名路径或环境变量值。
- [ ] 本地日志写入用户数据目录，限制大小和保留数量；不得记录请求正文或提示词。

### 6. 真实进程边界验证

- [ ] 从临时安装结构启动 bundled `node.exe`，而不是系统 Node。
- [ ] 验证 `/api/local-auth`、协议版本、capabilities 和至少三个核心只读端点。
- [ ] 触发一次真实本地同步，再连续触发第二次，验证没有因状态污染造成重复计数。
- [ ] 模拟后端崩溃，验证用户可见错误和重试恢复；验证应用退出后无孤儿子进程。

## 必跑命令

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
npm --prefix dashboard run test -- src/lib/local-api-url.test.ts
npm --prefix dashboard run typecheck
npm --prefix dashboard run lint
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm test
npm --prefix dashboard run test
npm run tauri:build
git diff --check
```

安装包证据命令至少包含：

```powershell
$ManifestPath = "src-tauri\EmbeddedServer\runtime-manifest.json"
$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
if ($Manifest.node.sha256 -ne $Manifest.node.official_sha256) { throw "Bundled Node checksum mismatch" }

$ReleaseRoot = (Resolve-Path "src-tauri\target\release").Path
$AppExe = Join-Path $ReleaseRoot "token-eyes.exe"
$Msi = Get-ChildItem (Join-Path $ReleaseRoot "bundle\msi\*.msi") | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$Nsis = Get-ChildItem (Join-Path $ReleaseRoot "bundle\nsis\*-setup.exe") | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Get-FileHash $AppExe,$Msi.FullName,$Nsis.FullName -Algorithm SHA256

$ExtractDir = Join-Path $env:TEMP ("token-eyes-msi-audit-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $ExtractDir | Out-Null
$Process = Start-Process msiexec.exe -ArgumentList @('/a',('"' + $Msi.FullName + '"'),'/qn',('TARGETDIR="' + $ExtractDir + '"')) -Wait -PassThru
if ($Process.ExitCode -ne 0) { throw "MSI administrative extract failed: $($Process.ExitCode)" }
Get-ChildItem -Recurse -File $ExtractDir
```

## 验收标准

- 解包后的 MSI/NSIS 确认包含完整目标运行时结构，不再只有主 EXE。
- Release 启动路径没有系统 Node 和源码仓库依赖；相关负向测试通过。
- 固定 Node 版本及官方 SHA256 校验可复现，许可证和 manifest 存在。
- `.env`、密钥、测试、日志、截图、开发依赖未进入安装包。
- bundled Node 真实启动本地 API；健康检查、同步两次、崩溃恢复和退出清理通过。
- 用户看得到后端失败原因和重试入口，日志脱敏且受大小限制。
- 计算 B2/B3/B7 的本工单阶段后验，明确哪些证据仍需 04 的真实安装和 05 的独立复验；不得通过重复计算同一解包、测试或日志提前宣称达到最终门槛。

## 禁止事项

- 禁止继续使用 `Command::new("node")` 作为 Release 主路径。
- 禁止在 Release 中向上搜索源码仓库。
- 禁止只修改 `tauri.conf.json` 而不解包证明资源存在。
- 禁止把下载失败降级为使用开发机已有 Node。
- 禁止把完整 repo、`.env`、测试或用户数据打入安装包。
- 禁止以原工作区运行成功代替无 Node/无源码边界测试。
- 禁止未经用户明确授权执行 push、创建/发布 Release 或向第三方分发安装包。

## 对抗性审查闭环

实现者至少主动攻击：

1. 清空 PATH 中 Node、把 cwd 设为安装目录之外，Release 是否仍能启动。
2. 删除/损坏内置 `node.exe`、`tracker.js`、manifest，是否明确失败而非连错端口。
3. 7680 被无关服务占用、附近端口存在旧 Token Tracker 时，是否只接受正确协议/capabilities。
4. 后端启动后立刻崩溃、应用关闭、重复打开时是否出现孤儿进程或重复服务。
5. 安装包中是否能搜索到 `.env` 键值、真实密钥模式、用户目录、测试 fixture 密钥。

本工单与 03 并行，因此每轮完整记录追加在本文件“执行回写”之后，不直接修改集中 `review-records.md`。发现问题后修复并重新从受影响的失败探针开始，最后一轮无新 P0/P1 才能结束；04 合流时再把本工单摘要写入集中记录。

## 完成汇报

按 README 模板回写，提供提交 SHA、安装包解包清单、runtime manifest、哈希、真实进程端点结果和对抗性审查轮次。不得执行 04/05；向 04 提供合流说明。

## 执行回写

尚未执行。执行者从本行之后追加，不得覆盖工单正文。
