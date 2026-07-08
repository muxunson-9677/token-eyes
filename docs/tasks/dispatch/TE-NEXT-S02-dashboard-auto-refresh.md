# TE-NEXT-S02 - Dashboard Auto Refresh

## 任务边界

你负责实现后续补齐任务 `S02 — Dashboard动态刷新实现`。只做 Dashboard/Spend 页刷新间隔、手动刷新、上次更新时间和持久化设置。不要实现 Spend 折线图,不要改 parser,不要改 Token Plan refresh scheduler,不要新增 WebSocket 或后台 daemon。

本工单依据:

- `docs/token-eyes-next-blueprint-v3.md`
- `docs/dev-notes/dashboard-refresh-spec.md`
- `CLAUDE.md`

## 先读文件

开始前按顺序读:

1. `CLAUDE.md`
2. `docs/dev-notes/dashboard-refresh-spec.md`
3. `dashboard/src/pages/DashboardPage.jsx`
4. `dashboard/src/pages/SpendPage.jsx`
5. `dashboard/src/lib/api.ts`
6. `src/lib/local-api.js`
7. `test/local-settings-api.test.js`
8. `dashboard/src/pages/SpendPage.test.jsx`

如果 `docs/dev-notes/dashboard-refresh-spec.md` 不存在,停止并报告。

## 目标

实现:

- Dashboard 页右上角刷新间隔控件。
- Dashboard 页手动刷新按钮与上次更新时间。
- Spend 页同样的刷新间隔控件、手动刷新按钮与上次更新时间。
- 刷新间隔持久化到 local settings。
- 自动刷新期间保留已有数据,不整页闪烁。

## 后端设置持久化

修改 `src/lib/local-api.js`:

新增 local settings 字段:

```json
{
  "dashboardRefresh": {
    "interval": "1m",
    "updated_at": "2026-06-22T00:00:00.000Z"
  }
}
```

要求:

- 允许 interval: `manual`, `30s`, `1m`, `5m`。
- 默认 `1m`。
- 非法值回退 `1m`。
- `readLocalSettings()` 返回 `dashboardRefresh`。
- `updateLocalSettings()` 接收并保存 `dashboardRefresh`。

给 `test/local-settings-api.test.js` 增加测试:

- 默认返回 `dashboardRefresh.interval === "1m"`。
- POST 可保存 `30s` / `manual`。
- 非法值回退 `1m`。

## Dashboard 实现

修改 `dashboard/src/pages/DashboardPage.jsx`:

- 复用现有 `refreshAll()` 和 `handleUsageRefresh()`。
- 新增 interval state,初始从 `getLocalSettings()` 读取。
- interval 为 `manual` 时不注册 timer。
- interval 为 `30s/1m/5m` 时注册 timer。
- tick 时如果上一轮还在刷新,跳过本轮。
- local mode 自动刷新应沿用 `handleUsageRefresh()` 的语义:先 `triggerLocalSync()`,再 `refreshAll()`。
- cloud/account view 自动刷新只调用 `refreshAll()`。
- 刷新成功后更新 `lastUpdatedAt`。
- 自动刷新不能触发初始 skeleton 或清空已有数据。

UI:

- 在顶部右侧工具区整合 refresh controls。
- 使用 lucide refresh icon,不要用文字大按钮替代图标按钮。
- 控件显示: interval select/compact control、刷新按钮、`上次更新 HH:mm:ss`。

## Spend 实现

修改 `dashboard/src/pages/SpendPage.jsx`:

- 把 `fetchRecords()` 改成返回 Promise,支持 `{ silent = false }`。
- 初始加载仍显示原有 loading。
- 自动刷新使用 `silent: true`,保留已有 cards/table/list。
- 手动刷新使用同一 fetch,可显示按钮 spinner。
- 刷新成功后更新 `lastUpdatedAt`。
- 与 Dashboard 使用同一套 local settings interval。
- interval 为 `manual` 时不注册 timer。

## 文案

所有新增用户可见文本写入 `dashboard/src/content/copy.csv`。

优先使用这些 key,若已有同义 key 可复用:

```text
dashboard.refresh.interval.label
dashboard.refresh.interval.manual
dashboard.refresh.interval.30s
dashboard.refresh.interval.1m
dashboard.refresh.interval.5m
dashboard.refresh.manual
dashboard.refresh.refreshing
dashboard.refresh.last_updated
dashboard.refresh.never
```

不要硬编码中文/英文文本到 JSX。

## 测试

后端:

```bash
node --test test/local-settings-api.test.js
```

前端:

```bash
npm --prefix dashboard run test -- SpendPage.test.jsx
npm --prefix dashboard run typecheck
npm --prefix dashboard run build
```

如新增 DashboardPage 聚焦测试,一并运行对应测试。

## 验收标准

- Dashboard 顶部可选择 `手动/30秒/1分钟/5分钟`。
- Spend 顶部可选择同样档位。
- 手动刷新按钮可立即刷新数据。
- `30秒` 档位会注册 interval 并触发刷新。
- `手动` 档位不会自动刷新。
- 刷新期间页面保留已有数据,不出现整页闪烁。
- 重新打开应用后保留上次选择。
- Token Plan scheduler 不被额外触发。
- 后端 local settings 测试和 dashboard build/typecheck 通过。

## 禁止事项

- 不实现 P03 Spend 折线图。
- 不新增 WebSocket。
- 不新增后台任务。
- 不改 parser/queue schema。
- 不改 Token Plan refresh scheduler。
- 不把飞书同步做进产品。

## 完成后回复

回复必须包含:

- 分支名
- commit SHA
- 修改文件列表
- 刷新控件实际位置
- 测试命令和结果
- 是否存在阻塞或无关失败