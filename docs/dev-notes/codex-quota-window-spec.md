# R01 - Codex 窗口额度数据结构规范

更新时间：2026-06-23
任务编号：R01
任务性质：Codex 设计任务
后续执行：R02 交给 Claude Code

## 结论

R02 不需要新建 Codex 额度存储，也不需要让用户手动录入 5 小时/7 天剩余额度。

当前仓库已经有实时 Codex 额度链路：

- `src/lib/usage-limits.js` 会读取 Codex auth bundle，必要时刷新过期 token，并调用 `https://chatgpt.com/backend-api/wham/usage`。
- Codex 额度窗口按 `limit_window_seconds` 归类，不按接口返回的 `primary_window/secondary_window` 槽位硬猜。
- `18000` 秒归类为 5 小时窗口，`604800` 秒归类为 7 天窗口。
- free tier 只有 7 天窗口时，也会归到 `secondary_window`，避免把 weekly 误显示成 5h。
- 本地 API 已暴露 `/functions/tokentracker-usage-limits`。
- Dashboard 已有 `useUsageLimits()`、`UsageLimitsPanel`、`usage-limits-provider-specs.js` 能渲染 Codex 5h/7d/Spark 窗口。

因此 R02 的正确实现方向是：在 Token Plan 设置页里，对 `source=codex` 的套餐记录复用现有 live usage limits 数据，只展示 Codex 官方实时窗口；不要把额度快照写回 Token Plan CRUD schema。

## 已确认的代码依据

### 后端额度链路

`src/lib/usage-limits.js`：

- `CODEX_SESSION_WINDOW_SECONDS = 18000`
- `CODEX_WEEKLY_WINDOW_SECONDS = 604800`
- `classifyCodexWindow(window)` 根据 `limit_window_seconds` 分类。
- `normalizeCodexRateWindows(rateLimit)` 把 session window 放到 `primary_window`，weekly window 放到 `secondary_window`。
- `fetchCodexUsageLimits(accessToken, { accountId })` 调用 ChatGPT wham usage 接口。
- `getUsageLimits()` 会读取 `~/.codex/auth.json` 或 `CODEX_HOME` 下的 auth，并返回 `codex` 对象。

`src/lib/local-api.js`：

- `/functions/tokentracker-usage-limits` 已调用 `getUsageLimits({ home: os.homedir(), env: process.env, platform: process.platform })`。
- `refresh=1/true` 会清 usage limits cache。

### 前端额度链路

`dashboard/src/hooks/use-usage-limits.ts`：

- 已有 `codex.configured`
- 已有 `codex.primary_window`
- 已有 `codex.secondary_window`
- 已有 `codex.spark_primary_window`
- 已有 `codex.spark_secondary_window`

`dashboard/src/ui/dashboard/components/usage-limits-provider-specs.js`：

- `primary_window` 显示为 `limits.label.codex_5h`
- `secondary_window` 显示为 `limits.label.codex_7d`
- Spark 5h/7d 也已有 label key。

`dashboard/src/ui/dashboard/components/UsageLimitsPanel.jsx`：

- 已有 `formatReset()` 和 limit bar 展示逻辑。

## 数据结构

R02 直接读取 `getUsageLimits()` 的返回值，使用其中的 `codex` 字段。

建议前端内部只依赖以下最小字段：

```ts
type CodexQuotaWindow = {
  used_percent: number;
  limit_window_seconds?: number | null;
  reset_at?: number | string | null;
};

type CodexUsageLimits = {
  configured: boolean;
  error?: string | null;
  auth_action_required?: "reauth" | string | null;
  plan_type?: string | null;
  plan_label?: string | null;
  primary_window?: CodexQuotaWindow | null;       // 5h
  secondary_window?: CodexQuotaWindow | null;     // 7d
  spark_primary_window?: CodexQuotaWindow | null; // Spark 5h
  spark_secondary_window?: CodexQuotaWindow | null;// Spark 7d
};
```

R02 不要在前端重新按槽位猜窗口；后端已经保证 `primary_window=5h`、`secondary_window=7d`。前端最多做 label 和空值兜底。

## Token Plan 设置页展示规则

展示位置：`dashboard/src/components/settings/TokenPlanSection.jsx` 中每条套餐记录的详情区域。

只对以下记录显示 Codex 额度块：

- `record.source` 归一化后等于 `codex`

其他 source 不显示这组特殊字段，也不要新增空占位。

Codex 额度块显示：

- 5 小时窗口：剩余百分比 + 重置倒计时/重置时间
- 7 天窗口：剩余百分比 + 重置倒计时/重置时间
- 如果 Spark 窗口存在，可以在同一块里显示 Spark 5h / Spark 7d；如果不存在，不显示 Spark 行。

剩余百分比计算：

```js
remainingPercent = Math.max(0, 100 - Math.round(Number(window.used_percent || 0)))
```

如果窗口没有 absolute quota 数值，不要伪造“剩余 token 数”。第一版只显示百分比和 reset。

## 空状态和错误状态

R02 不写入手工额度 fallback。

推荐状态：

- `configured=false`：显示“Codex 未连接，无法读取实时额度”。
- `auth_action_required=reauth`：显示“需要重新登录 Codex 后读取额度”。
- `error` 有值：显示精简错误，不展示堆栈。
- `configured=true` 且窗口都为空：显示“官方额度暂不可用”。

所有可见文案必须进入 `dashboard/src/content/copy.csv`。

## 不做的事

- 不修改 Token Plan CRUD schema。
- 不新增 `codex_5h_remaining`、`codex_weekly_remaining` 之类存储字段。
- 不从 `~/.codex/sessions` 解析额度窗口。
- 不把 session 日志里的 `rate_limits` 当作可信 quota source。
- 不读取或上传真实 prompt/message 内容。
- 不新增 npm 依赖。
- 不改 Windows/Tauri/WebView2 文件夹选择器逻辑。
- Token Eyes Windows 验证前置是 Rust 工具链、Node.js、WebView2 Runtime；不要把 `.NET SDK` 或 `.NET 8 SDK` 写成前置。

## R02 验收点

R02 完成后至少满足：

1. `source=codex` 的 Token Plan 记录下能看到 Codex 5h/7d live quota。
2. 非 Codex source 不显示 Codex 特殊字段。
3. 5h/7d 使用现有 `/functions/tokentracker-usage-limits` 数据，不新增后端额度 schema。
4. auth 缺失、reauth、官方接口无数据时都有紧凑空状态。
5. 文案全部进 copy registry。
6. `TokenPlanSection` 定向测试、typecheck、copy、hardcode、guardrails、dashboard build 通过。
