# Token Eyes 当前状态与后续开发交接文档

生成时间：2026-07-07
仓库路径：`D:\04-AI-Project\010-Token eye`
当前 HEAD：`6717a76e7989868ec2948a7c1f14d4bea3a0f648`

## 1. 接手前必须先读

接手 AI 必须先完整阅读：

1. `AGENTS.md`
2. `CLAUDE.md`
3. 本文件：`TOKEN_EYES_HANDOFF_2026-07-07.md`

项目规则要点：

- `CLAUDE.md` 是项目级唯一指导源。
- 当前用户已经明确：不走正式 R4/R5，不做正式 release 流程，最多走 GitHub 上提供 exe 安装包。
- 未经用户明确要求，不要 push，不要 release，不要清理/重置工作区。
- 当前 worktree 很脏，有大量既有修改和未跟踪文件；不要 `git reset --hard`，不要随手删除未跟踪内容。
- 本项目 Windows 客户端当前是 Tauri 栈，不是旧 `.NET WinForms/WPF` 路径；不要再要求 `.NET SDK` 作为 Token Eyes Tauri 前置条件。

## 2. 用户当前真实目标

用户不是要做企业级正式发布流程，而是要：

- 有一个可以自己安装、也能发给朋友或放到 GitHub Releases 的 Windows exe 安装包。
- 尽量轻量、启动快、点击响应快。
- 不要复杂的正式签名/R4/R5/R1-R5 发布验收流程。
- 不要虚拟数据、假数据、演示数据；只显示本地真实捕捉到的 Token 请求和成本。
- 已修过的问题不要反复回归，尤其是安装包图标、启动白屏/无响应、后端崩溃、请求日志交互、概览数据同步等。

用户的第一性原则：高效、便捷、准确、自动化、实时检测。

## 3. 当前可交付安装包

最新安装包已经生成到仓库根目录：

- `D:\04-AI-Project\010-Token eye\Token-Eyes-0.54.0-Windows-x64-setup.exe`
- 备用标识副本：`D:\04-AI-Project\010-Token eye\Token-Eyes-0.54.0-Windows-x64-setup-20260707-plan-detection.exe`

安装包信息：

- 版本：`0.54.0`
- 发布者字段 / CompanyName：`Muxunson`
- 大小：`29,995,628 bytes`，约 `28.61 MiB`
- SHA256：`E7B83B484D6A9DDD90292922B127295806B931814E2C6F1D617B719A13617240`

注意：

- 如果安装时报 `EmbeddedServer\node.exe` 无法写入，通常是旧版 Token Eyes 仍在运行并占用文件。先完全退出 Token Eyes，再覆盖安装。
- 如果资源管理器里安装包图标还显示旧图标，优先怀疑 Windows Explorer 图标缓存；本次已跑图标门禁，配置层面通过。

## 4. 最近一轮已经完成并验证的内容

最近一轮针对“套餐自动检测”和“下拉样式”做了修复：

### 4.1 Token 套餐官方检测能力判定

位置：

- `dashboard/src/components/settings/TokenPlanSection.jsx`
- `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- `dashboard/src/content/copy.csv`

当前事实：

- 只有小米 MiMo 已接入“官网账号登录检测”路径。
- GLM、MiniMax、Kimi、阿里云百炼等当前只是静态套餐目录，不具备已实现的官方控制台余额读取能力。
- 因此 UI 不再把这些服务商显示成“官方接口自动检测”，避免假自动化。
- 非小米目录套餐保存时会强制规范化为：
  - `refresh_method: "manual"`
  - `refresh_enabled: false`
  - 不写入 `detection_config`
- 非小米目录套餐会显示提示：自动检测暂未接入，真实请求用量仍来自本地日志捕捉，套餐余额需手动维护。

原因：

- `src/lib/token-plan-refresh.js` 中 provider quota adapter 注册表当前为空，历史注释也说明第一批没有可用 provider quota API 时 `official_api` 会失败。
- 不能把未实现的 provider 官方余额读取伪装成自动实时检测。

### 4.2 卡片式下拉

已改为卡片式下拉：

- Agent 来源
- 服务商
- 套餐

实现保留隐藏原生 `select`，因此测试和表单交互仍可用。

### 4.3 已执行验证

已通过：

```powershell
npm --prefix dashboard run test -- src/components/settings/TokenPlanSection.test.jsx src/pages/SpendPage.test.jsx
```

结果：`86 passed`

已通过：

```powershell
node --test test/windows-installer-icon-config.test.js
```

结果：`2 passed`

已通过：

```powershell
npm --prefix dashboard run build
npm run tauri:build
git diff --check
```

说明：

- `git diff --check` 只有 CRLF 警告，没有 whitespace error。
- `tauri build` 生成 NSIS 安装包成功。
- 构建过程中 Rust 有一个既有 warning：`map_login_state_to_status` 未使用。不要为这个警告扩大改动范围。

## 5. 当前 worktree 状态

当前工作区不是干净状态。`git status --short` 显示大量已修改和未跟踪文件，包括但不限于：

- Dashboard 相关：
  - `dashboard/src/components/settings/TokenPlanSection.jsx`
  - `dashboard/src/components/settings/TokenPlanSection.test.jsx`
  - `dashboard/src/pages/SpendPage.jsx`
  - `dashboard/src/pages/SpendPage.test.jsx`
  - `dashboard/src/ui/dashboard/components/RequestUsageLog.jsx`
  - `dashboard/src/ui/dashboard/components/UsageOverview.jsx`
  - `dashboard/src/ui/dashboard/components/UsageStatsPanel.jsx`
  - 多个 hooks：`use-request-usage-records.ts`、`use-usage-data.ts`、`use-trend-data.ts` 等
- Backend / local API 相关：
  - `src/lib/local-api.js`
  - `src/lib/data-directories.js`
  - `src/lib/provider-api-balance.js`
  - `src/lib/provider-api-configs.js`
  - `src/lib/token-plan-catalog/index.js`
- 测试文件：
  - `test/provider-api-balance.test.js`
  - `test/provider-api-configs-api.test.js`
  - `test/request-usage-records-api.test.js`
  - `test/usage-caliber-consistency.test.js`
- 安装包：
  - `Token-Eyes-0.54.0-Windows-x64-setup.exe`
  - `Token-Eyes-0.54.0-Windows-x64-setup-20260707-plan-detection.exe`
  - `Token-Eyes-0.54.0-Windows-x64-setup-20260707-uxfix.exe`

重要：

- 不要假设这些改动都属于同一轮任务。
- 不要为了“清爽”重置或删除。
- 继续开发前，应先用 `git diff -- <file>` 精确查看要改的文件。

## 6. 已知用户持续关注的问题

以下是用户反复强调过的点，后续开发必须作为回归清单：

### 6.1 安装包图标

用户多次反馈安装包图标回到旧图标。

当前已验证：

- `node --test test/windows-installer-icon-config.test.js` 通过。

后续要求：

- 每次重新打包前后都要跑图标门禁。
- 如果 Explorer 仍显示旧图标，优先解释缓存问题，同时建议使用带时间/用途后缀的新文件名验证。
- 不要改动图标配置时遗漏 NSIS installer/uninstaller 图标。

### 6.2 启动速度与无响应

用户要求“秒开”“无感秒开”，此前仍反馈打开时有几秒白屏/无响应。

后续要做：

- 继续优化 Tauri 启动路径、前端首屏渲染和 embedded backend 启动等待策略。
- 不要在首屏阻塞读取大日志/趋势/请求记录。
- 耗时数据应后置、增量、缓存或懒加载。
- 任何改动后要用真实安装包实际启动验证，不只跑单测。

### 6.3 使用统计加载慢

用户反馈：

- 使用统计页加载过慢，曾经需要二十秒。
- 切换请求日志页码、排序、筛选时不能卡住 UI。

已有相关改动在 worktree 中，至少包含：

- `dashboard/src/pages/SpendPage.jsx`
- `dashboard/src/ui/dashboard/components/RequestUsageLog.jsx`
- `dashboard/src/hooks/use-request-usage-records.ts`
- `dashboard/src/hooks/use-usage-data.ts`
- `dashboard/src/hooks/use-trend-data.ts`

后续要验证：

- 使用统计页首次进入是否不再长时间显示 loading。
- 请求日志分页按钮、跳转、排序按钮是否有实际效果。
- 点击期间不应导致窗口“未响应”。

### 6.4 概览与支出数据同步

用户多次指出：

- 支出/使用统计有数据，但概览页没有同步。
- 概览不应出现无意义的 Download 广告/按钮。
- 概览里的 Codex 不能显示“未标注”，应显示中文且语义清楚。

相关文件：

- `dashboard/src/pages/DashboardPage.jsx`
- `dashboard/src/ui/dashboard/components/UsageOverview.jsx`
- `dashboard/src/ui/dashboard/components/UsageStatsPanel.jsx`
- `dashboard/src/ui/dashboard/components/MacAppBanner.jsx`
- `dashboard/src/lib/usage-summary-cost.ts`
- `dashboard/src/hooks/use-project-usage-summary.ts`

后续要验证：

- 真实 Codex/Hermes 请求进入后，概览页的 Token 总量、趋势、模型占比是否同步。
- `Download` 之类无关内容是否已经去掉。
- `未标注` 是否改为用户能理解的中文，例如“未配置计费”。

### 6.5 不允许虚拟数据污染正式 exe

用户明确要求：

- 正式 exe 中不要再使用虚拟数据。
- 之前测试用过的虚拟数据要清掉，只保留真实捕捉的 Token 请求。

相关位置可能包括：

- `test/mock-data.test.js`
- `mock-data-ui-showcase/`
- `dashboard/src/*mock*`
- local runtime 数据目录：用户本机 `~/.tokentracker` 或 app data 中的历史数据

后续注意：

- 不要删除用户真实数据。
- 如果需要清虚拟数据，先定位虚拟数据来源，写迁移或过滤规则，不要粗暴清空用户数据。

### 6.6 Codex 检测

用户反馈：

- Codex 数据目录曾显示未检测到。
- 但用户 7 月 6 日有大量 Codex 请求和 Token 消耗。
- 如果用户切换两个账号，希望尽量统一检测到所有 Token 消耗。

相关位置：

- `src/lib/data-directories.js`
- `src/lib/local-api.js`
- `src/lib/codex-token-refresh.js`
- `src/lib/usage-limits.js`
- `dashboard/src/components/settings/TokenPlanSection.jsx`

后续要做：

- 确认 Codex 数据目录默认路径、`CODEX_HOME`、`~/.codex/sessions`、`archived_sessions` 兼容。
- 不要误把 OAuth 余额检测和本地请求日志解析混为一谈：
  - 本地请求统计来自日志/session。
  - 官方余额/额度窗口来自认证/官方接口。
- 多账号检测需要明确数据源：如果两个账号写入同一日志目录可汇总；如果分目录，需要支持多目录或账号标识。

### 6.7 Provider API 余额准确性

用户反馈 DeepSeek：

- 显示“已连接”，但余额显示 0，实际有余额。

相关位置：

- `src/lib/provider-api-balance.js`
- `src/lib/provider-api-configs.js`
- `dashboard/src/lib/provider-api-presets.js`
- `dashboard/src/components/settings/ProviderApiConfigSection.test.jsx`
- `test/provider-api-balance.test.js`
- `test/provider-api-configs-api.test.js`

后续要做：

- 用真实 DeepSeek balance endpoint 返回结构校准解析。
- 区分连接成功、认证成功、余额解析成功。
- 不要在余额解析失败时显示 0；应显示“读取失败/字段未识别/接口返回异常”。

## 7. Token 套餐后续正确方向

用户最新追问的核心是：

> 小米可以官网控制台检测，为什么别的套餐没有？如果不能检测官网账号控制台信息，怎么实时检测套餐用量和余额？为什么都是手动？

正确技术判断：

- 不能用一个通用逻辑实时检测所有服务商套餐余额。
- 每个服务商都需要单独适配：
  - 官方 API 余额/额度接口；或
  - 官方控制台登录 session + 安全读取额度；或
  - 用户提供的自定义 API 映射。
- 没有适配器时，只能显示静态套餐额度 + 本地真实请求消耗，不能声称实时同步官网余额。

当前实现状态：

- 小米 MiMo：有官网账号登录检测 UI 和 Tauri native session 路径。
- GLM / MiniMax / Kimi / 阿里云百炼：有静态套餐目录，但没有官方实时余额适配器。
- 自定义套餐：仍可手工维护，也可走自定义 API 配置路径。

建议后续拆成独立小任务：

1. Provider 官方能力矩阵
   - 列出每个套餐服务商是否有官方公开余额 API。
   - 标注认证方式、返回字段、频率限制、是否允许本地客户端调用。

2. GLM 官方余额适配器
   - 找到官方控制台或 API 的套餐/余额接口。
   - 写最小 adapter。
   - 增加测试：余额解析成功、认证失败、接口字段变化、余额为 0 的真实情况。

3. MiniMax 官方余额适配器
   - 同上。

4. Kimi / 阿里云百炼适配器
   - 同上。

5. UI 能力标识
   - 对每个 provider 显示：
     - 已支持官网自动检测
     - 支持自定义 API 检测
     - 暂只支持手动/静态目录
   - 不要让用户选择一个实际上不可用的“官方接口”。

## 8. 推荐验证命令

针对当前用户关心点，后续每次交付至少跑：

```powershell
npm --prefix dashboard run test -- src/components/settings/TokenPlanSection.test.jsx src/pages/SpendPage.test.jsx
node --test test/windows-installer-icon-config.test.js
npm --prefix dashboard run build
git diff --check
```

如果改了 backend/local API：

```powershell
node --test test/provider-api-balance.test.js
node --test test/provider-api-configs-api.test.js
node --test test/request-usage-records-api.test.js
node --test test/usage-caliber-consistency.test.js
```

如果要给用户新的 exe：

```powershell
npm run tauri:build
Copy-Item -LiteralPath "src-tauri\target\release\bundle\nsis\Token Eyes_0.54.0_x64-setup.exe" -Destination "Token-Eyes-0.54.0-Windows-x64-setup.exe" -Force
Get-FileHash -Algorithm SHA256 -LiteralPath "Token-Eyes-0.54.0-Windows-x64-setup.exe"
```

还要确认：

```powershell
(Get-Item "src-tauri\target\release\token-eyes.exe").VersionInfo | Select-Object ProductName,ProductVersion,CompanyName,FileDescription,FileVersion
```

期望：

- `ProductName`: `Token Eyes`
- `ProductVersion`: `0.54.0`
- `CompanyName`: `Muxunson`

## 9. 下一个 AI 的工作方式建议

1. 不要一次性大改。
2. 每个用户问题先定位真实数据源：
   - 是前端显示问题？
   - 是 local API 返回问题？
   - 是 parser 没捕捉？
   - 是数据目录没检测？
   - 是 provider 官方接口解析失败？
3. 每个 bug 写最小回归测试。
4. 修完后用真实安装包验证用户可见行为。
5. 不要把“当前没有能力”包装成“已支持自动检测”。
6. 不要引入演示数据或 mock 数据进入正式 exe。

## 10. 当前未解决 / 仍需实机复核的事项

以下不是声明已完成，而是后续必须复核：

- 安装后首屏是否仍有 2 秒以上白屏/未响应。
- 使用统计页是否仍有长时间 loading。
- 请求日志分页、跳转、排序是否在真实 1000 条数据下响应正常。
- 概览是否实时同步支出/使用统计数据。
- DeepSeek API 余额是否显示真实余额而不是 0。
- Codex 数据目录和 7 月 6 日请求记录是否能完整检测。
- 所有套餐服务商是否只展示真实可用的检测方式。

## 11. 当前交付结论

当前根目录已有可安装 exe。
当前代码不适合直接宣称“所有功能最终完成”，因为用户后续仍要求更强的自动实时检测、速度优化和真实数据校准。
下一个 AI 应在当前工作区基础上继续小步修复、测试、打包，不要切回正式 R4/R5 流程。

## 12. 工作目录边界规则（2026-07-07 补充）

用户已明确要求：后续所有 Token Eyes 工作只能在主项目目录内进行：

`D:\04-AI-Project\010-Token eye`

禁止再创建同级项目目录，例如：

- `D:\04-AI-Project\010-Token eye-*`
- `D:\04-AI-Project\010-Token eyes-*`

如需临时目录、证据目录、打包产物、对抗性审查产物或构建归档，必须放在主项目目录下的子目录中，例如：

- `.tmp\...`
- `.worktrees\<branch-name>`
- `artifacts\...`
- `docs\tasks\...`

如果确实需要 Git worktree，只允许建在：

`D:\04-AI-Project\010-Token eye\.worktrees\<branch-name>`

禁止使用：

- `C:\Users\admin\.config\superpowers\worktrees\...`
- `C:\Users\admin\AppData\Local\Temp\...`

本次已处理的历史同级目录：

- `D:\04-AI-Project\010-Token eye-r3-integration`
  - 性质：旧 R3/public-release Git worktree。
  - 处理：把未跟踪安装包和 SHA256 文件移动到 `artifacts\r3-integration-archive\` 后，移除该 worktree。
- `D:\04-AI-Project\010-Token eye-r3-evidence`
  - 性质：旧 R3 验收过程证据、解包文件和日志。
  - 处理：判定为过程文件，已清理。

注意：2026-07-07 已继续清理 C 盘历史 worktree。清理前把 `glm-token-plan-live`、`r2-rework` 等可能有价值的 patch/status 归档到了 `artifacts\external-worktree-cleanup-20260707\`；过程日志/坏掉的审查树只保留状态元数据。清理后 `git worktree list` 应只剩主项目路径。

同日还清理了根目录未跟踪的 `mock-data-ui-showcase\`，它是演示/虚拟数据展示目录，不应进入正式客户端或后续提交。
