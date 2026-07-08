# Dashboard Refresh Spec

更新时间: 2026-06-22

任务: S01 - Dashboard动态刷新机制规范

## 目标

为 Token Eyes Dashboard 和 Spend 页增加准实时刷新能力,让 Usage 指标、趋势数据和 Spend 汇总能按用户选择的间隔自动更新。第一版采用前端轮询,不引入 WebSocket,不新增后台任务,不改日志解析器。

本规范只定义机制和 UI 口径。S02 实现时应保持页面已有数据可见,刷新期间不能让整页闪烁或回到初始 skeleton。

## 当前实现基线

`dashboard/src/pages/DashboardPage.jsx` 已有:

- 多个 data hooks 暴露 `refresh`:
  - `refreshUsage()`
  - `refreshHeatmap()`
  - `refreshTrend()`
  - `refreshModelBreakdown()`
  - `refreshProjectUsage()`
  - `refreshDailyBreakdown()`
  - `refreshUsageLimits()`
- `refreshAll()` 已用 `Promise.all()` 聚合这些刷新函数。
- `handleUsageRefresh()` 在 local mode 下会先调用 `triggerLocalSync()`,再调用 `refreshAll()`。
- `manualSyncLoading` 已用于手动刷新按钮的 loading 状态。

`dashboard/src/pages/SpendPage.jsx` 当前只有:

- `fetchRecords()` 在 mount 时调用 `getSpendRecords()`。
- `loading` 会控制记录列表 loading 状态。
- 新增/编辑/删除后会把返回结果写回页面。

`dashboard/src/lib/api.ts` 已有:

- `getLocalSettings()` / `setLocalSettings()`。
- `getSpendRecords(params)`。
- Usage 系列 API 使用 `buildTimeZoneParams()` 透传 `tz` / `tz_offset_minutes`。

## 刷新策略

### 刷新档位

支持四个档位:

| 值 | UI文案 | 行为 |
|---|---|---|
| `manual` | 手动 | 不自动刷新,只保留手动刷新按钮 |
| `30s` | 30秒 | 每 30 秒刷新一次 |
| `1m` | 1分钟 | 每 60 秒刷新一次,默认值 |
| `5m` | 5分钟 | 每 300 秒刷新一次 |

默认值为 `1m`。

### Dashboard 自动刷新

S02 应复用 `DashboardPage.jsx` 的现有 `refreshAll()`。为避免用户看到页面闪烁:

- 自动刷新不能清空已有数据。
- 自动刷新不能触发初始 skeleton。
- 自动刷新只显示小型状态,例如刷新按钮 spinner 或“正在刷新”状态。
- 如果上一轮刷新还没结束,跳过下一次 interval tick,不要并发叠加。

local mode 下,自动刷新应复用当前手动刷新语义:

1. 调用 `triggerLocalSync()`。
2. 调用 `refreshAll()`。

原因: Usage queue 需要从本地日志同步后,Dashboard 数字才会反映新日志。默认 1 分钟避免 30 秒档位以外的过度频繁同步。用户选择 `manual` 时不自动触发 sync。

cloud/account view 下,自动刷新只调用 `refreshAll()`,不调用 local sync。

### Spend 自动刷新

S02 应把 `SpendPage.jsx` 的 `fetchRecords()` 改成可静默刷新:

```js
const fetchRecords = ({ silent = false } = {}) => {
  if (!silent) setLoading(true);
  setRefreshing(true);
  return getSpendRecords(currentParams)
    .then(applyResult)
    .finally(() => {
      if (!silent) setLoading(false);
      setRefreshing(false);
    });
};
```

第一版 Spend 页自动刷新范围:

- Spend 汇总卡片
- Spend by_source 表格
- Spend records 列表

P03 折线图接入后,同一个刷新 interval 也应刷新 `getSpendTimeseries()`。S02 不需要实现 P03,但要把刷新工具设计成可复用。

### Token Plan 余量

不要在本刷新机制里额外触发 Token Plan 自动刷新。`src/lib/token-plan-refresh.js` 和现有 token plan scheduler 已有独立调度;S02 只允许通过 `refreshUsageLimits()` 读取展示数据。

## 持久化

刷新间隔保存到本地设置,不要只放 React state。

在 `src/lib/local-api.js` 的 local settings config 中新增最小字段:

```json
{
  "dashboardRefresh": {
    "interval": "1m",
    "updated_at": "2026-06-22T00:00:00.000Z"
  }
}
```

后端归一化规则:

- 允许值: `manual`, `30s`, `1m`, `5m`。
- 无效值回退到 `1m`。
- `updated_at` 由服务端写入 ISO timestamp。

`readLocalSettings()` 必须返回 `dashboardRefresh`。`updateLocalSettings(body)` 必须接受 `dashboardRefresh` 并持久化。

## UI 位置和行为

### Dashboard 页

在 Dashboard 顶部右侧工具区增加:

- 刷新间隔 select 或 compact segmented control。
- 手动刷新 icon button,使用现有 `handleUsageRefresh()` 逻辑。
- “上次更新 HH:mm:ss” 小字。

如果当前布局已有手动刷新按钮,不要新增第二个重复按钮;在原位置整合 interval 控件和 last updated 文案。

### Spend 页

Spend 页顶部右侧增加同一套刷新控件,但按钮只刷新 Spend 数据,不触发 Dashboard 所有 hooks。

显示规则:

- 初始加载时可以显示原有 loading。
- 静默刷新时保留现有数据,按钮显示 spinner/disabled。
- 刷新失败时保留旧数据并显示错误文案。

## 文案

所有新增用户可见文本必须写入 `dashboard/src/content/copy.csv`,不要硬编码。

建议 copy keys:

```text
dashboard.refresh.interval.label,刷新间隔
dashboard.refresh.interval.manual,手动
dashboard.refresh.interval.30s,30秒
dashboard.refresh.interval.1m,1分钟
dashboard.refresh.interval.5m,5分钟
dashboard.refresh.manual,刷新
dashboard.refresh.refreshing,刷新中
dashboard.refresh.last_updated,上次更新 {time}
dashboard.refresh.never,尚未更新
```

如果已有相同语义文案,优先复用,不要重复造 key。

## S02 文件范围

预期修改:

- `src/lib/local-api.js`
  - local settings 增加 `dashboardRefresh` 归一化/读写。
- `dashboard/src/lib/api.ts`
  - 如有需要,补充 dashboard refresh settings 类型透传;不需要新增 endpoint。
- `dashboard/src/pages/DashboardPage.jsx`
  - 增加 interval state、读取/保存设置、interval effect、last updated state。
- `dashboard/src/pages/SpendPage.jsx`
  - 增加静默刷新、interval effect、last updated state。
- `dashboard/src/content/copy.csv`
  - 新增必要文案。
- 测试文件:
  - `test/local-settings-api.test.js`
  - `dashboard/src/pages/SpendPage.test.jsx`
  - 如 DashboardPage 测试已有合适文件,补充 interval 行为测试。

## S02 测试要求

后端:

- `GET /functions/tokentracker-local-settings` 返回默认 `dashboardRefresh.interval === "1m"`。
- `POST /functions/tokentracker-local-settings` 可保存 `dashboardRefresh.interval`。
- 非法 interval 回退到 `1m`。

前端:

- Dashboard/Spend 初始读取刷新间隔。
- 选择新 interval 后调用 `setLocalSettings()`。
- `manual` 不注册 interval timer。
- 非 manual 会注册 interval timer,并在 tick 时调用对应刷新函数。
- 静默刷新不清空现有 Spend 数据。

## 验收标准

- Dashboard 右上角可见刷新间隔控件、手动刷新按钮、上次更新时间。
- Spend 页也可见刷新间隔控件、手动刷新按钮、上次更新时间。
- 选择 `30秒` 后等待一个周期,页面数据会重新请求。
- 选择 `手动` 后不会自动请求。
- 刷新时页面保留已有数据,不出现整页闪烁。
- 重开应用后保留上次选择的刷新间隔。
- Token Plan scheduler 不被重复触发。

## 非目标

- 不实现 WebSocket。
- 不新增后台 daemon。
- 不实现 P03 Spend 折线图。
- 不更改 parser 或 queue schema。
- 不更改 Token Plan refresh scheduler。