# TE-FULL-F03 - Token Plan 自动刷新调度器实现报告

更新时间: 2026-06-21

分支: `claude/te-full-f03-token-plan-auto-refresh-scheduler`
基准: `codex-token-tracker-baseline`
规范: `docs/dev-notes/token-eyes-full-plan-interfaces.md#F02`

## 实现概要

为 `tokenPlans` 记录新增自动刷新配置与状态字段，实现本地进程内的刷新调度器，并在 Settings 页面暴露配置与手动刷新入口。

### 新增/修改文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/lib/token-plan-refresh.js` | 新增 | 调度器核心：字段归一化、`isDue`、`refreshPlan`、`createScheduler` |
| `src/lib/local-api.js` | 修改 | 扩展 `normalizeTokenPlanRecord` 含刷新字段；新增 `POST /functions/tokentracker-token-plans-refresh` endpoint；暴露 `startTokenPlanScheduler`/`stopTokenPlanScheduler`/`runTokenPlanDueRefresh`/`runTokenPlanRefreshById` 到 handler |
| `src/commands/serve.js` | 修改 | 启动时做一次 due refresh 并启动后台定时器；shutdown 时停止调度器 |
| `dashboard/src/lib/api.ts` | 修改 | 新增 `refreshTokenPlan(id)` 与 `tokenPlansRefresh` PATH |
| `dashboard/src/components/settings/TokenPlanSection.jsx` | 修改 | 表单支持 `refresh_enabled`/`refresh_interval_minutes`/`refresh_method`/`credential_ref`；记录列表展示刷新状态与“立即刷新”按钮 |
| `dashboard/src/content/copy.csv` | 修改 | 新增刷新相关文案（method 选项、状态、按钮、风险提示等） |
| `test/token-plan-refresh.test.js` | 新增 | 调度器单元测试（13 个用例） |
| `test/token-plans-api.test.js` | 修改 | 新增字段持久化、refresh endpoint 失败/成功分支测试 |
| `dashboard/src/components/settings/TokenPlanSection.test.jsx` | 修改 | 兼容新字段；新增手动刷新交互测试 |

## 调度何时触发

1. **server 启动时**：`serve.js` 在创建 handler 后调用 `handleApi.runTokenPlanDueRefresh()`，对所有 `refresh_enabled=true`、`refresh_method != manual` 且 `next_refresh_at <= now` 的 plan 做一次刷新。
2. **后台定时器**：`handleApi.startTokenPlanScheduler()` 启动 `setInterval`（默认 60s 周期，`timer.unref()` 不阻塞进程退出）。每个 tick 调用 `runDueOnce()` 扫描 due plan。
3. **Settings 页面手动刷新**：用户点击记录上的“立即刷新”按钮 → `POST /functions/tokentracker-token-plans-refresh` → `scheduler.refreshById(id)`，立即执行一次刷新并更新状态。
4. **同一 plan 同一时刻只允许一个 refresh in-flight**：`refreshById` 用 `inFlight` Set 防并发，冲突返回 409。

## 三种 refresh_method 的状态

### `manual`
- 不自动刷新，保留手动录入。
- 手动触发 refresh 时返回 `last_refresh_status = "success"`（no-op），`next_refresh_at` 为空（不安排下次）。
- 调度器的 `isDue` 对 manual 方法永远返回 false。

### `official_api`
- 调用通过 `registerProviderAdapter(source, fn)` 注册的 provider adapter。
- **第一批无内置 adapter**。当某 source 没有注册 adapter 时，刷新返回 `failed`，错误文案：
  > 不支持自动刷新：缺少官方接口。当前没有可用的 provider quota API，请改为手动录入。
- adapter 返回 `{ total_quota, used_quota, remaining_quota }`，成功时更新 plan 的 quota 字段并写 `last_refresh_status = "success"`。
- adapter 抛错时写 `failed` 并保存错误消息。

### `cookie_scrape`
- **第一批不实现真实 cookie 抓取**。
- 刷新返回 `failed`，错误文案（含风险提示）：
  > Cookie 抓取未配置：当前版本不执行真实 Cookie 读取，存在账号风控风险。请改为手动录入或 official_api。
- UI 上 method 选项标注为“Cookie 抓取（未实现）”。

## 没有可用 provider quota API 时的失败文案

统一文案（`official_api` 且无 adapter）：

```
不支持自动刷新：缺少官方接口。当前没有可用的 provider quota API，请改为手动录入。
```

该文案写入 `last_refresh_error`，并在 Settings 页面记录列表中展示。不会静默失败、不会假装成功。

## 是否保存任何敏感凭证

**不保存任何敏感凭证。**

- `credential_ref` 字段只允许保存引用名，白名单为：`codex_auth_json`、`claude_credentials_json`、空字符串。任何其他字符串（包括原始 token/cookie）会被 `pickCredentialRef` 归一化为空。
- 不读取、不保存原始 access token / refresh token / cookie。
- 第一批 `cookie_scrape` 不执行任何真实抓取。
- `config.json` 写入权限 `0o600`（沿用现有 `writeTrackerConfig`）。

## 调度规则遵守情况

| 规范要求 | 实现 |
| --- | --- |
| 启动本地 server 时做一次 due refresh | ✅ `serve.js` 调用 `runTokenPlanDueRefresh()` |
| Settings 保存计划后可触发手动刷新 | ✅ “立即刷新”按钮 → refresh endpoint |
| 后台调度只在本地进程存活时运行，不新增系统服务 | ✅ `setInterval` + `unref()`，无系统服务 |
| 同一 plan 同一时刻只允许一个 refresh in-flight | ✅ `inFlight` Set，冲突返回 409 |
| `refresh_interval_minutes` 支持 15/30/60/240/1440 | ✅ `ALLOWED_INTERVALS` 白名单，非法值回落 60 |
| 自动刷新失败必须给用户可读错误，不能静默失败 | ✅ `last_refresh_error` 持久化并在 UI 展示 |
| `manual` 保持原行为 | ✅ 不自动刷新，手动触发为 no-op success |
| `official_api` 无 API 时写 failed | ✅ |
| Cookie 抓取只展示风险提示，不实现真实抓取 | ✅ |

## 验证命令结果

### 1. `node --test test/token-plans-api.test.js test/token-plan-refresh.test.js`

```
ℹ tests 19
ℹ pass 19
ℹ fail 0
```

覆盖：手动记录 CRUD、F03 字段持久化、refresh endpoint 失败分支（无 adapter）、refresh endpoint manual 成功 no-op、调度器字段归一化、`isDue`、`refreshPlan` 三种 method、`runDueOnce` 只刷 due plan、`refreshById` 404 与并发冲突 409。

### 2. `npm.cmd --prefix dashboard run test -- TokenPlanSection.test.jsx`

```
Test Files  1 passed (1)
     Tests  2 passed (2)
```

覆盖：加载/编辑/保存手动记录（兼容新字段）、点击“立即刷新”触发 `refreshTokenPlan`。

### 3. `npm.cmd --prefix dashboard run typecheck`

```
> tsc --noEmit
（无输出，退出码 0）
```

### 4. `npm.cmd run dashboard:build`

```
✓ built in 6.77s
```

## 阻塞问题

无。第一批实现范围内所有验收口径已满足。

### 已知限制（符合第一批口径）

- `official_api` 第一批未内置任何 provider adapter，所有 source 的 official_api 刷新都会返回 failed。后续工单（如 F04）可通过 `registerProviderAdapter` 注册真实 adapter。
- `cookie_scrape` 不实现真实抓取，仅返回风险提示。
- 后台调度定时器周期固定 60s（不与 `refresh_interval_minutes` 混淆——后者是每个 plan 的刷新间隔，前者是调度器扫描频率）。
