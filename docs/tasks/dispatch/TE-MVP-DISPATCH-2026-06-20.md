# TE-MVP-DISPATCH - 2026-06-20 下一批 Claude 派发清单

## 已完成的飞书更新

Codex 已通过飞书 REST API 真实更新 `Token Eyes 进度表` / `V2.1工单` 表。

已更新:

- `A05` 持续工单派发与审核状态维护: `执行中`
- `C02` 数据目录覆盖功能实现: `已审核`
- `G02` 手动花销记录实现: `已审核`
- `H01` 隐藏无关入口: `已审核`
- `H02` 基本联调测试与报告: `已审核`
- `H03` V2.1 MVP方向人工确认: `待审核`

已新增:

- `A06` 飞书进度更新与下一批 Claude 派发清单: `已审核`
- `H05` Token Eyes 中文化收尾独立 QA 验收: `待分派`
- `C05` Windows WebView2 文件夹选择器编译与手动验证: `待分派`

## 需要开几个 Claude

建议开 **2 个 Claude 终端对话框**。

一个 Claude 只处理一个工单:

1. Claude #1: `TE-MVP-QA-06-ui-localization-final-acceptance.md`
2. Claude #2: `TE-MVP-WIN-07-windows-folder-picker-verification.md`

## 并行/顺序关系

必须先做:

1. 等 Codex 当前 Token Eyes UI 收尾修复提交/推送,或确保 Claude 使用的是包含这些改动的干净 worktree。

可以并行:

1. `TE-MVP-QA-06` 和 `TE-MVP-WIN-07` 可以并行,前提是两个 Claude 在不同分支/worktree。

建议顺序:

```text
第 0 步: Codex 当前修复提交/推送。
第 1 步: 开 Claude #1 跑 TE-MVP-QA-06。
第 2 步: 如果有 .NET 8 SDK Windows 环境,同时开 Claude #2 跑 TE-MVP-WIN-07。
第 3 步: QA 报告与 Windows 报告都回来后,由 Codex 做最终审核。
```

如果没有 .NET 8 SDK:

- 先只开 1 个 Claude 跑 `TE-MVP-QA-06`。
- `TE-MVP-WIN-07` 等具备 .NET 8 SDK 的 Windows 环境后再派发。

## 不要再并行派发的内容

不要再开多个 Claude 同时修改:

- `/spend`
- `/settings`
- `dashboard/src/content/copy.csv`
- `dashboard/src/lib/locale.ts`
- `dashboard/src/content/i18n/**`

这些区域已经收尾,多个 Claude 同时改会互相覆盖,也是上一个工单失败的主要风险源。

## 必须写入每个 Claude 工单的经验

后续 Claude 必须遵守:

1. 不得把 UI 未更新直接归因于浏览器缓存。
2. 必须验证 `copy.csv` fallback、i18n registry、`locale.ts`、`LocaleProvider` 的实际运行效果。
3. 必须模拟旧 localStorage:

```js
localStorage.setItem("tokentracker-locale", "en")
```

4. 必须用 Playwright 或浏览器读取真实页面 `body.innerText()`。
5. 必须验证 `document.title === "Token Eyes"`。
6. 必须列出 forbidden 文案是否出现:
   - `Cloud sync`
   - `Public profile`
   - `leaderboard`
   - `云同步`
   - `公开主页`
   - `公开排行榜`
   - `Star`
   - `Token Tracker`

没有这些证据,不能报告完成。
