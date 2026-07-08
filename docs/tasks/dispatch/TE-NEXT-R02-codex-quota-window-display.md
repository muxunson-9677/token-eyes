# TE-NEXT-R02 - Codex 窗口额度展示实现

## 任务边界

本工单给 Claude Code 执行 `R02 - Codex 窗口额度展示实现`。

只实现 Token Plan 设置页里 `source=codex` 记录的 Codex 5 小时/7 天实时额度展示。不要改 Token Plan CRUD schema，不要新建额度存储，不要从 Codex session 日志解析 quota，不要改 U02 请求日志，不要改 Windows/Tauri/WebView2 逻辑，不要新增 npm 依赖。

依据规范：

- `docs/dev-notes/codex-quota-window-spec.md`
- `docs/token-eyes-next-blueprint-v3.md` 中 R01/R02
- 现有 `src/lib/usage-limits.js`
- 现有 `/functions/tokentracker-usage-limits`

## 先读文件

开始前按顺序读：

1. `CLAUDE.md`
2. `docs/dev-notes/codex-quota-window-spec.md`
3. `src/lib/usage-limits.js` 中 Codex `classifyCodexWindow()`、`normalizeCodexRateWindows()`、`fetchCodexUsageLimits()`、`getUsageLimits()`
4. `src/lib/local-api.js` 中 `/functions/tokentracker-usage-limits`
5. `dashboard/src/hooks/use-usage-limits.ts`
6. `dashboard/src/lib/api.ts` 中 `getUsageLimits()`
7. `dashboard/src/components/settings/TokenPlanSection.jsx`
8. `dashboard/src/components/settings/TokenPlanSection.test.jsx`
9. `dashboard/src/content/copy.csv`

如果发现 `/functions/tokentracker-usage-limits` 或 `getUsageLimits()` 不存在，停止并报告，不要自行另起一套接口。

## 必须实现

### 1. TokenPlanSection 拉取 live usage limits

修改 `dashboard/src/components/settings/TokenPlanSection.jsx`：

- import 已有 `getUsageLimits`。
- 组件加载 Token Plan records 时，并行或随后拉取 usage limits。
- 保存/刷新 Token Plan 后，不需要把 Codex live quota 写回 record。
- 如果用户点击已有的 Token Plan refresh 按钮，只保持原有行为；不要把它改成 usage limits refresh。
- 可以新增一个小的局部 helper，例如 `isCodexSource(record.source)`、`formatCodexQuotaWindow(window)`，但不要拆出过度抽象。

建议数据判断：

```js
function isCodexSource(source) {
  return String(source || "").trim().toLowerCase() === "codex";
}
```

### 2. 只在 source=codex 记录下显示额度块

每条 record 渲染时：

- `source=codex`：显示 Codex live quota block。
- 非 codex：完全不显示该 block。

Codex live quota block 至少显示：

- 5 小时：剩余百分比 + reset
- 7 天：剩余百分比 + reset

如果存在 Spark 窗口，也显示：

- Spark 5 小时
- Spark 7 天

不要显示不存在的 Spark 行。

### 3. 百分比和 reset 规则

剩余百分比：

```js
const used = Number(window?.used_percent || 0);
const remaining = Math.max(0, 100 - Math.round(Number.isFinite(used) ? used : 0));
```

reset 展示可复用现有 `UsageLimitsPanel.jsx` 的思路，但不要直接复制大段无关组件。如果 reset 只有 Unix 秒或 ISO 字符串，前端都要能显示一个短文本；实在无法解析时显示 `--`。

不要伪造剩余 token 数。当前 wham window 稳定字段是 `used_percent/reset_at/limit_window_seconds`，第一版只展示百分比和 reset。

### 4. 空状态和错误状态

对 codex record：

- `codex.configured === false`：显示“Codex 未连接，无法读取实时额度”。
- `codex.auth_action_required === "reauth"`：显示“需要重新登录 Codex 后读取额度”。
- `codex.error` 有值：显示简短失败文案，不显示堆栈。
- `configured=true` 但 5h/7d 都为空：显示“官方额度暂不可用”。

所有可见文案进入 `dashboard/src/content/copy.csv`。

建议新增 copy key：

- `settings.token_plan.codex_quota.title` = `Codex 实时额度`
- `settings.token_plan.codex_quota.5h` = `5 小时`
- `settings.token_plan.codex_quota.7d` = `7 天`
- `settings.token_plan.codex_quota.spark_5h` = `Spark 5 小时`
- `settings.token_plan.codex_quota.spark_7d` = `Spark 7 天`
- `settings.token_plan.codex_quota.remaining` = `剩余`
- `settings.token_plan.codex_quota.reset` = `重置`
- `settings.token_plan.codex_quota.unconfigured` = `Codex 未连接，无法读取实时额度`
- `settings.token_plan.codex_quota.reauth` = `需要重新登录 Codex 后读取额度`
- `settings.token_plan.codex_quota.unavailable` = `官方额度暂不可用`
- `settings.token_plan.codex_quota.error` = `Codex 额度读取失败`

### 5. 不改后端额度实现

R02 原则上不需要改 `src/lib/usage-limits.js` 或 `src/lib/local-api.js`。只有定向测试证明现有接口有明确 bug 时，才允许做最小修复，并在完成报告中单独说明。

## 测试要求

更新 `dashboard/src/components/settings/TokenPlanSection.test.jsx`，至少覆盖：

1. 有 `source=codex` record 且 `getUsageLimits()` 返回 5h/7d window 时，页面显示 `Codex 实时额度`、`5 小时`、`7 天`、剩余百分比。
2. 非 codex record 不显示 Codex 实时额度块。
3. `codex.configured=false` 时显示未连接空状态。
4. `auth_action_required=reauth` 时显示重新登录提示。
5. `codex.error` 有值时显示失败文案。

如果 mock `../../lib/api`，记得把 `getUsageLimits` 加进 mock，避免破坏已有测试。

## 验证命令

至少运行：

```bash
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
```

如果修改了 `src/lib/usage-limits.js` 或 `src/lib/local-api.js`，额外运行：

```bash
node --test test/usage-limits.test.js test/local-settings-api.test.js
```

完整 `npm --prefix dashboard run test` 如果仍因既有中文本地化断言失败，不要在本任务里修无关测试；完成报告中列出失败文件和原因即可。

## 验收标准

- Token Plan 设置页中，`source=codex` 记录显示 Codex 5h/7d live quota。
- 非 codex source 不显示 Codex 特殊额度字段。
- 额度读取复用 `/functions/tokentracker-usage-limits`，不新增存储字段。
- 没有 auth、需要 reauth、官方接口无数据、接口错误都有可理解状态。
- 新增文案全部在 copy registry。
- 不新增 npm 依赖。
- 不把 `.NET SDK` 或 `.NET 8 SDK` 写成 Token Eyes Windows 前置；Token Eyes 是 Tauri/Rust/Node/WebView2 口径。
- 定向测试、typecheck、copy、hardcode、guardrails、build 通过。

## 禁止事项

- 不改 Token Plan CRUD schema。
- 不把 Codex live quota 写入本地套餐记录。
- 不读取真实 prompt/message 内容。
- 不实现 U02 请求级日志。
- 不改 Dashboard Usage Overview、Spend 图表、billing_mode、adapter registry。
- 不修 unrelated dashboard localization tests，除非本任务新增断言导致失败。

## 建议分支

`claude/te-next-r02-codex-quota-window-display`

## 完成后回复必须包含

- 分支名
- commit SHA（如果未提交，明确说明未提交）
- 修改文件列表
- UI 位置和状态说明
- 测试命令和结果
- 是否存在阻塞或无关失败
