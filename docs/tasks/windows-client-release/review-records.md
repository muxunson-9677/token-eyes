# Windows 客户端外发验收审查记录

本文件是 01-05 的追加式证据日志。

## 写入规则

- 只允许在文件末尾追加，禁止覆盖或美化上一轮失败记录。
- 每轮使用唯一标题：`工单编号 / 审查轮次 / 日期时间 / HEAD`。
- 必须记录审查者上下文身份、是否参与实现、命令、退出码、关键输出和证据路径。
- 发现问题后先记录失败，再修复；修复后开启下一轮审查，不能修改上一轮结论。
- 05 的最终审查者必须声明未参与 01-04；若参与修复，该上下文失去最终签发资格。
- 不得写入 API Key、Cookie、令牌、`.env` 值、用户提示词或消息正文。

## 追加模板

```text
## 工单 {编号} / 第 {轮次} 轮对抗性审查 / {日期时间} / HEAD {提交 SHA}

审查者上下文：
是否参与本轮实现：是 / 否
主动攻击假设：
1.
2.
3.

失败证据：
- 命令：
  退出码：
  关键输出：
  证据路径：

修复动作：
修改文件：
修复提交：

复验：
- 命令：
  退出码：
  关键输出：

贝叶斯更新：
- 维度：
- 先验赔率：
- 独立证据与 LR：
- 后验赔率：
- 后验概率：
- 是否达到硬门禁：

本轮 P0/P1/P2：
本轮结论：FAIL / PASS / BLOCKED
下一动作：
```

## 审查记录

尚未执行。执行者从本行之后追加，保留本说明。

## 工单 01 / 第 1 轮对抗性审查 / 2026-07-04 21:57 +08:00 / HEAD 78bf9f0306727056039d9babbb23db84187c945d

审查者上下文：01 主线调度 subagent，本轮同时参与实现和复验。
是否参与本轮实现：是。
主动攻击假设：
1. 原脏工作区里两个运行时文件未进 HEAD，干净检出会缺源码或 JSON。
2. 原工作区已有 `dashboard/dist`，`npm run ci:local` 可能隐含依赖旧构建产物。
3. `.gitignore` 或宽泛提交可能隐藏本该提交的生产文件。
4. UI hardcode 可能只是提高 baseline，而不是接入 `copy.csv`。
5. Rust fmt 可能只在原开发机状态下通过。

失败证据：
- 命令：`npm run validate:ui-hardcode`
  退出码：1
  关键输出：`DataDirectoriesSection.jsx rawText increased (3 -> 6), rawText tokens introduced (2)`
  证据路径：原工作区终端输出；修复后记录见本文件第 2 轮。
- 命令：`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
  退出码：1
  关键输出：`src-tauri/src/commands.rs`、`src-tauri/src/xiaomi_mimo_session.rs` 存在格式差异。
  证据路径：原工作区终端输出；修复后记录见本文件第 2 轮。
- 命令：`git ls-files --error-unmatch dashboard/src/lib/provider-api-presets.js`；`git ls-files --error-unmatch src/lib/token-plan-catalog/glm.catalog.json`
  退出码：均为 1
  关键输出：两个运行时文件修复前未被 HEAD 跟踪。
  证据路径：原工作区终端输出；修复后记录见本文件第 2 轮。
- 命令：在 `C:\Users\admin\AppData\Local\Temp\token-eye-01-verify-78bf9f0` 干净 worktree 运行 `npm ci`、`npm ci --prefix dashboard`、`npm run ci:local`
  退出码：`npm ci` 0；`npm ci --prefix dashboard` 0；`npm run ci:local` 1
  关键输出：`ENOENT ... app\dashboard\dist\index.html`，证明旧 `ci:local` 在根测试前没有生成 dashboard dist，干净检出不能复现。
  证据路径：`C:\Users\admin\AppData\Local\Temp\token-eye-01-verify-78bf9f0`

修复动作：
修改文件：
- `scripts/ops/ui-hardcode-baseline.json`：仅更新 `DataDirectoriesSection.jsx` 已由 `copy.csv` 覆盖的条件分支 JSX rawText 计数。
- `src-tauri/src/commands.rs`、`src-tauri/src/xiaomi_mimo_session.rs`：只接受 `cargo fmt` 机械格式化。
- `dashboard/src/lib/provider-api-presets.js`、`src/lib/token-plan-catalog/glm.catalog.json` 及相关调用方/测试：逐文件纳入 HEAD。
- `package.json`：把 `ci:local` 中的 `npm --prefix dashboard run build` 前置，先生成 `dashboard/dist` 再跑依赖该产物的根测试。
修复提交：
- `78bf9f0306727056039d9babbb23db84187c945d` `chore(release): converge Windows client baseline`
- `53c5252ca3061b4946a2b0c27dbcaf3a5e543b29` `fix(ci): build dashboard before local tests`

复验：
- 命令：`npm --prefix dashboard run test -- ProviderApiConfigSection.test.jsx`
  退出码：0
  关键输出：26 tests passed。
- 命令：`node --test src/lib/token-plan-catalog/index.test.js`
  退出码：0
  关键输出：4 tests passed。
- 命令：`git diff --cached --check`
  退出码：先为 1，后为 0
  关键输出：先发现 `dashboard/src/lib/provider-api-presets.js:73 new blank line at EOF`，修复后无输出。

贝叶斯更新：
- 维度：B1、B7
- 先验赔率：B1=0.25；B7=0.6667
- 独立证据与 LR：本轮发现真实干净检出反例，第一轮不做正向加权。
- 后验赔率：不更新为通过态。
- 后验概率：不更新为通过态。
- 是否达到硬门禁：否。

本轮 P0/P1/P2：P1：`ci:local` 干净检出缺 `dashboard/dist`；P1：运行时文件未跟踪；P1：UI hardcode/Rust fmt 门禁失败。
本轮结论：FAIL
下一动作：保留失败记录，修复后开启第 2 轮对抗性审查。

## 工单 01 / 第 2 轮对抗性审查 / 2026-07-04 22:03 +08:00 / HEAD 53c5252ca3061b4946a2b0c27dbcaf3a5e543b29

审查者上下文：01 主线调度 subagent，本轮同时参与实现和复验。
是否参与本轮实现：是。
主动攻击假设：
1. 两个已知运行时文件仍可能只存在于原脏工作区，未进入 Git。
2. 干净检出仍可能借用旧 `node_modules`、`dashboard/dist`、`src-tauri/target`。
3. `.gitignore` 可能隐藏本该提交的生产文件。
4. UI hardcode 可能通过提高 baseline 掩盖未登记文案。
5. Rust fmt/test 可能在独立 worktree 失败。
6. 提交范围可能混入构建产物、二进制、密钥或截图。

失败证据：
- 第 1 轮失败已保留；第 2 轮未发现新的 P0/P1。

修复动作：
修改文件：
- 本轮代码修复已在 `53c5252ca3061b4946a2b0c27dbcaf3a5e543b29` 完成；第 2 轮仅追加审查和报告记录。
修复提交：
- `53c5252ca3061b4946a2b0c27dbcaf3a5e543b29`

复验：
- 命令：`git ls-files -- dashboard/src/lib/provider-api-presets.js src/lib/token-plan-catalog/glm.catalog.json`
  退出码：0
  关键输出：两文件均输出，证明进入 HEAD。
- 命令：`git check-ignore -v -- dashboard/src/lib/provider-api-presets.js src/lib/token-plan-catalog/glm.catalog.json`
  退出码：1
  关键输出：无 ignore 命中。
- 命令：`git diff --name-only 06cab0a062c0b8196bbdde781b962034dec16114..HEAD | rg -n "(^|/)(dist|target|node_modules|coverage|\\.next|\\.vite|\\.turbo)(/|$)|\\.(exe|msi|zip|7z|log|png|jpg|jpeg|webp|gif|mp4|db|sqlite|pem|p12|pfx)$"`
  退出码：1
  关键输出：无构建产物、安装包、截图、日志、密钥容器后缀命中。
- 命令：`git diff --no-ext-diff 06cab0a062c0b8196bbdde781b962034dec16114..HEAD | rg --pcre2 <high-confidence-secret-pattern>`
  退出码：1
  关键输出：无高置信密钥命中。
- 命令：`rg -n "settings\\.data_dirs\\.(auto_detect|installed_no_data|syncing|saved_button)" dashboard/src/content/copy.csv`
  退出码：0
  关键输出：相关用户可见文案均在 copy registry 中。
- 命令：`npm run validate:ui-hardcode`
  退出码：0
  关键输出：`UI hardcode guardrails ok: colors=308, rawText=205`
- 命令：`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
  退出码：0
  关键输出：无格式差异。
- 命令：在 `C:\Users\admin\AppData\Local\Temp\token-eye-01-verify-report-53c5252-20260704215755` 新 worktree 执行初始检查
  退出码：0
  关键输出：`node_modules=False`、`dashboard\node_modules=False`、`dashboard\dist=False`、`src-tauri\target=False`；HEAD=`53c5252ca3061b4946a2b0c27dbcaf3a5e543b29`。
- 命令：`npm ci`
  退出码：0
  关键输出：root `found 0 vulnerabilities`。
- 命令：`npm ci --prefix dashboard`
  退出码：0
  关键输出：安装 525 packages；审计仍报 `10 vulnerabilities (1 low, 5 moderate, 3 high, 1 critical)`，归入 03 工单风险。
- 命令：`npm run ci:local`
  退出码：0
  关键输出：先执行 dashboard build，再执行 root tests、copy/ui-hardcode/guardrails/architecture guards。
- 命令：`npm --prefix dashboard run typecheck`
  退出码：0
  关键输出：`tsc --noEmit` 通过。
- 命令：`npm --prefix dashboard run lint`
  退出码：0
  关键输出：ESLint 通过。
- 命令：`npm --prefix dashboard run test`
  退出码：0
  关键输出：`Test Files 80 passed (80)`；`Tests 649 passed (649)`。保留现有 jsdom `window.scrollTo`/canvas not implemented 和 React act warnings，未导致失败。
- 命令：`cargo test --manifest-path src-tauri/Cargo.toml`
  退出码：0
  关键输出：41 passed；保留现有 `map_login_state_to_status` dead_code warning，未导致失败。
- 命令：`git status --short`
  退出码：0
  关键输出：无未跟踪源码输出；生成目录受 ignore 管理。

贝叶斯更新：
- 维度：B1
- 先验赔率：0.25
- 独立证据与 LR：运行时文件纳入 Git 且未被 ignore（LR=4）；全新 worktree 无旧 `node_modules/dist/target` 且完整门禁通过（LR=5）。
- 后验赔率：0.25 × 20 = 5
- 后验概率：5 / (1 + 5) = 0.8333
- 是否达到硬门禁：达到 01 阶段门禁；最终 0.99 由 05 独立复验判定。
- 维度：B7
- 先验赔率：0.6667
- 独立证据与 LR：先复现再修复 UI hardcode/Rust fmt/运行时文件失败（LR=4）；干净检出完整 `ci:local`、dashboard、Rust 门禁通过（LR=5）。
- 后验赔率：0.6667 × 20 = 13.333
- 后验概率：13.333 / (1 + 13.333) = 0.9302
- 是否达到硬门禁：达到 01 阶段门禁；最终 0.95 由 05 独立复验判定。

本轮 P0/P1/P2：P0/P1：无新增；P2：保留 dashboard 测试环境 warnings、Vite chunk/dynamic import warnings、Rust dead_code warning、dashboard npm audit 风险（03 范围）。
本轮结论：PASS
下一动作：仅追加 01 完成报告并提交本地文档记录；不得执行 02/03/04/05，不 push，不发布 Release，不分发安装包。

## 工单 05 / 第 1 轮独立贝叶斯终审 / 2026-07-05 04:45 +08:00 / HEAD 39bb69a7d6450173ab3dc36de9c453cd0c7b8af7

审查者上下文：05 最终独立审查上下文；未参与 01、02、03、04 的实现、修复或通过结论；本轮只做审查，不 push、不 release、不修复。
本轮结论：RETURNED
指定退回：B 修复。至少需要 02 自包含运行时、03 安全/签名/发布门禁、04 干净 Windows 合流安装验收全部返工并重新回写；修复完成并重跑 04 后，必须新建另一个全新 05 上下文重新从 R1-R7 执行。

失败摘要：
- P0：当前 HEAD 仍有 `src-tauri/src/commands.rs:190 find_repo_root()` 与 `src-tauri/src/commands.rs:215 Command::new("node")`，`src-tauri/tauri.conf.json` 无 `EmbeddedServer` resources；R2 自包含运行时失败。
- P1：`npm.cmd --prefix dashboard audit --omit=dev --audit-level=high` 退出 1，`engine.io-client -> ws` high。
- P1：`cargo audit --file src-tauri/Cargo.lock` 退出 1，`quick-xml 0.39.4` 命中 `RUSTSEC-2026-0194`、`RUSTSEC-2026-0195` high。
- P1：本轮 `npm.cmd run tauri:build` 退出 1，WIX bundling `os error 183`，未生成最终 MSI/NSIS。
- P1：本轮部分构建 `token-eyes.exe` 与原工作区既有 EXE/MSI/NSIS 均为 `NotSigned`；无可信发布者、时间戳或签名后 SHA256SUMS。
- P1：`.github/workflows/release-windows.yml` 上传前缺 production audit、cargo audit、runtime manifest、Authenticode 签名/Valid 校验和 SHA256SUMS fail-closed 门禁。
- BLOCKED 证据：无第二干净 Windows 快照/Windows Sandbox/VM 控制工具；当前机器有系统 Node `E:\Program Files\nodejs\node.exe v24.14.1`，不能执行 R6 干净安装生命周期。

关键命令证据：
- `npm.cmd ci`：退出 0；root `found 0 vulnerabilities`。
- `npm.cmd ci --prefix dashboard`：退出 0；安装摘要 `10 vulnerabilities (1 low, 5 moderate, 3 high, 1 critical)`。
- `npm.cmd run ci:local`：退出 1；root tests `1384` 中 `1374 passed`、`2 failed`、`8 skipped`；失败为写入 `C:\Users\admin\.tokentracker\tracker\...` EPERM。
- `npm.cmd --prefix dashboard run typecheck`：退出 0。
- `npm.cmd --prefix dashboard run lint`：退出 0。
- `npm.cmd --prefix dashboard run test`：退出 0；`80` files / `649` tests passed。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：退出 0。
- `cargo test --manifest-path src-tauri/Cargo.toml`：退出 0；`41 passed`。
- `node --test test/release-windows-workflow.test.js test/release-version-consistency.test.js`：退出 0；`29 passed`。

贝叶斯更新：
- B1：先验赔率 0.25；LR 0.05；后验赔率 0.0125；后验 0.012346。
- B2：先验赔率 0.010101；LR 0.05；后验赔率 0.000505；后验 0.000505。
- B3：先验赔率 1.222222；LR 0.05；后验赔率 0.061111；后验 0.057592。
- B4：先验赔率 0.333333；LR 0.05；后验赔率 0.016667；后验 0.016393。
- B5：先验赔率 0.052632；LR 0.05；后验赔率 0.002632；后验 0.002625。
- B6：先验赔率 0.052632；LR 0.05；后验赔率 0.002632；后验 0.002625。
- B7：先验赔率 0.666667；LR 0.05；后验赔率 0.033333；后验 0.032258。
- 加权总后验：0.016933。

下一动作：当前 05 上下文停止签发；不 push、不 release、不修复。
