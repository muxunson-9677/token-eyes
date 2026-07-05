# Token Eyes MVP 下一窗口交接上下文

> 给新开的 Codex/Claude 窗口使用。先读本文件，再安排下一步工单。不要依赖上一窗口聊天记录。

## 当前结论

- 当前工作分支: `codex-token-tracker-baseline`
- 当前已推送基线 commit: `9dbd693 fix: finalize token eyes qa followups`
- 上一版核心基线 commit: `9a127d4 feat: finalize token eyes mvp shell`
- Claude07: 原名 Claude1，负责 `TE-MVP-QA-06` UI 中文化验收。
- Claude06: 原名 Claude2，负责 `TE-MVP-WIN-07` WebView2 bridge 审计。
- 飞书多维表格已经由 Codex 真实更新并读回确认。

## 飞书当前关键状态

| 任务 | 状态 | 当前阶段 | 处理口径 |
|---|---|---|---|
| `A05` 持续工单派发与审核状态维护 | `执行中` | `H05 已审核；C05 等待 Tauri Windows/手动验证` | 这是持续协调任务，不要关闭。 |
| `H05` Token Eyes 中文化收尾独立 QA 验收 | `已审核` | `中文化收尾 QA 已通过` | 已完成。 |
| `C05` Windows WebView2 文件夹选择器编译与手动验证 | `阻塞` | `WebView2 bridge 审计通过；等待 Windows 原生验证` | 代码 bridge 通过，但还缺 Rust 工具链 + Node.js + WebView2 Runtime 下的 Tauri Windows build/dev 和真实 WebView2 手动验证。 |
| `H03` V2.1 MVP方向人工确认 | `待审核` | `等待用户最终确认与独立 QA 报告` | 需要用户试用后确认方向，不是 Claude 代码任务。 |
| `A04` 飞书进度表所有权转移给用户 | `阻塞` | `等待用户标识` | 需要用户提供飞书 `open_id` / `user_id` / `union_id` / 邮箱之一。 |

飞书配置在 `.env`，字段说明在 `docs/feishu-setup.md`。更新飞书时必须用 UTF-8 body 发送 JSON；PowerShell 默认字符串 body 曾把中文字段名变成 `??`，导致 `FieldNameNotFound`。

## 本轮已完成的代码修正

1. 修复移动端顶部品牌名残留:
   - 文件: `dashboard/src/ui/components/Sidebar.jsx`
   - 变更: `aria-label` 和显示文本从硬编码 `Token Tracker` 改为 `copy("shared.app_name")`。

2. 增加防回归守卫:
   - 文件: `test/app-route-pathname-guard.test.js`
   - 新增测试: `Sidebar mobile brand uses the shared Token Eyes name`
   - 目的: 防止 `Sidebar.jsx` 再出现 `Token Tracker` 可见品牌文本。

3. 纳入 Claude06 的 WebView2 JSON string 回归测试:
   - 文件: `dashboard/src/components/settings/DataDirectoriesSection.test.jsx`
   - 新增测试覆盖 C# `PostWebMessageAsJson` 返回 JSON string 时前端能正确解析。

4. 纳入 Claude06 审计报告:
   - 文件: `docs/test-reports/v2.1/19-win-webview2-bridge-audit.md`
   - 结论: 当前 WebView2 bridge 不再有 raw object 发送问题；`selectFolder` 前端发送 `JSON.stringify(...)`，C# 端 `TryGetWebMessageAsString()` 可以接收。

5. 修正 WIN-07 工单中的错误示例:
   - 文件: `docs/tasks/dispatch/TE-MVP-WIN-07-windows-folder-picker-verification.md`
   - 变更: `window.chrome.webview.postMessage({ ... })` 改为 `window.chrome.webview.postMessage(JSON.stringify({ ... }))`
   - 原因: WebView2 + C# `TryGetWebMessageAsString()` 必须收 string，不能收 raw object。

## 本轮验证结果

已在 `9dbd693` 后验证:

```text
npm.cmd --prefix dashboard run test -- locale.test.ts LocaleProvider.test.jsx UsageLimitsPanel.test.jsx WidgetsPage.test.jsx AgentPricingSection.test.jsx DataDirectoriesSection.test.jsx TokenPlanSection.test.jsx SpendPage.test.jsx currency.test.ts cache-hit.test.ts
结果: 10 files / 43 tests passed

node --test test/app-route-pathname-guard.test.js test/settings-account-user-id.test.js
结果: 7 tests passed

npm.cmd --prefix dashboard run typecheck
结果: 通过

npm.cmd run dashboard:build
结果: 通过；仅已有 chunk size warning
```

Playwright DOM 验证也已通过:

- `/spend`: title 是 `Token Eyes`，页面中文，无 `Spend` / `Token Tracker` 等禁用文本。
- `/settings`: title 是 `Token Eyes`，页面中文，有 3 个 `选择文件夹` 按钮。
- 移动端 `/settings`: 显示 `Token Eyes`，不显示 `Token Tracker`。

注意: 曾尝试跑 `App.preload.test.jsx` 和 `App.navigation-preload.test.jsx`，失败原因是这些旧测试仍期待已隐藏的 `/limits`、`/leaderboard` 页面，不属于本次 MVP 验收集合。

## Claude07 / Claude06 审核结论

### Claude07

- 截图中显示 `有条件通过`，条件项是 `Sidebar.jsx:420` 移动端仍显示 `Token Tracker`。
- 远端 `origin/claude/te-mvp-qa-06-ui-localization-acceptance` 当前实际指向 `9a127d4`，不是截图里的 `ade448f` 报告提交。
- 但 `ade448f` 的 QA 报告被包含在 Claude06 分支历史中。
- Codex 已修复条件项并加守卫，因此飞书 `H05` 已标 `已审核`。

### Claude06

- 分支: `claude/te-mvp-win-07-webview2-bridge`
- 提交: `7364a8fc20b97d4509d4dc1f5ad532866d7e6683`
- 结论: WebView2 bridge 审计 PASS，raw object 问题不存在。
- Codex 已将其有价值的回归测试和审计报告纳入 `codex-token-tracker-baseline@9dbd693`。
- `C05` 旧工单中的 Windows 桌面打包口径已废弃；当前按 Tauri/Rust/Node/WebView2 验证真实 Windows WebView2 手动点击 3 个文件夹按钮。

## 下一步怎么安排

### 先决策: 当前机器有没有 Tauri Windows 验证环境

在新窗口先运行:

```powershell
Test-Path src-tauri
Test-Path src-tauri\Cargo.toml
Test-Path src-tauri\tauri.conf.json
rustc --version
cargo --version
node --version
npm --version
```

如果 `src-tauri` 不存在或 Rust/Node 工具链缺失:

- 不要再派 Claude 做 `C05`，否则只会重复写报告。
- 告诉用户需要提供 Tauri Windows 基线和 Rust 工具链 + Node.js + WebView2 Runtime。
- 飞书 `C05` 保持 `阻塞`。

如果 Tauri Windows 环境存在:

- 只开 1 个 Claude 处理 `C05`。
- 使用工单: `docs/tasks/dispatch/TE-MVP-WIN-07-windows-folder-picker-verification.md`
- 关键验收:
  - Tauri Windows build/dev 启动通过。
  - Windows WebView2 中 `/settings` 的 3 个 `选择文件夹` 按钮都能弹出系统文件夹选择器。
  - 选择目录后回填对应输入框的绝对路径。
  - 取消选择不破坏已有输入值。
  - 创建报告 `docs/test-reports/v2.1/19-windows-folder-picker.md`。
  - 通过后再把飞书 `C05` 从 `阻塞` 改为 `已审核`。

### 用户人工确认任务

`H03` 是人工确认任务。建议让用户打开当前页面试用:

```text
http://127.0.0.1:7681/dashboard
http://127.0.0.1:7681/spend
http://127.0.0.1:7681/settings
```

用户确认 MVP 方向后，Codex 才把飞书 `H03` 改为 `已审核`。如果用户不满意，按具体问题生成修复工单，不要直接进入完整版。

## 后续完整版任务派发建议

只有在 `H03` 用户确认 MVP 方向后，才进入完整版/后续批次。

可并行派发的规格判断类任务:

1. `B02` Hermes DeepSeek/MiMo 计费线细分判断
2. `D03` 完整 Agent+Model 计费规则规范
3. `D06` 可配置/手动刷新汇率规范
4. `F02` Token Plan 自动刷新调度器接口规范
5. `G03` 完整花销周期与双币种汇总公式规范

这些可以开 5 个 Claude 并行，每个 Claude 只做一个规范/判断任务，不直接改实现。

必须按顺序的实现任务:

- `B03` 等 `B02` 完成。
- `D04` 等 `D03` 完成。
- `D07` 等 `D06` 完成。
- `F03` 等 `F02` 完成。
- `F04` 等 `F03` 完成。
- `G04` 等 `G03` 完成。
- `C04` 等 `C03` 真实 WSL UNC 路径验收完成。
- `H04` 等完整版任务全部完成后再启动。

环境依赖任务:

- `C03` 需要真实可访问的 WSL UNC 路径；没有环境就不要派。
- `A04` 需要用户给飞书身份标识；没有标识就保持阻塞。

## 给新窗口的推荐启动提示词

把下面这段发给新窗口:

```text
请先阅读 docs/tasks/dispatch/TE-MVP-HANDOFF-2026-06-20-next-window.md、docs/feishu-setup.md、docs/token-eyes-v2.1-mvp-plan.md，并通过飞书 API 读回 V2.1工单 当前状态。

目标: 根据当前真实进度安排下一步工单。不要依赖历史聊天记录。

特别注意:
1. 当前基线是 codex-token-tracker-baseline@9dbd693。
2. H05 已审核，不要重复派 UI 中文化验收。
3. C05 只剩 Tauri Windows + WebView2 手动验证；如果当前机器没有 src-tauri/Rust/Node 环境，不要派 Claude 重做，只保持阻塞并说明需要环境。
4. H03 是用户人工确认任务；用户确认 MVP 方向后才能进入完整版任务。
5. WebView2 向 C# 发送消息必须用 JSON.stringify 后的 string，不能 postMessage raw object。
6. 更新飞书时 PowerShell 请求 body 必须用 UTF-8 bytes，避免中文字段名变成 ??。

请输出:
- 当前飞书进度摘要
- 下一步应该做的 1-3 个动作
- 如果需要开 Claude，明确开几个 Claude、每个 Claude 做哪个工单、是否能并行
- 如果当前环境不足，明确阻塞条件和用户需要提供什么
```
