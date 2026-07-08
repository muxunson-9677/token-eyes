# [MVP] 10 - 缓存命中率卡片

## 任务ID

`V2.1-10`

## 对应 full-plan

full-plan #10。

## 执行方

Claude Code

## 分支名

`feature/10-mvp-cache-hit-card`

## 所属模块

Dashboard 摘要。

## 目标文件

- 修改: `dashboard/src/pages/DashboardPage.jsx`
- 修改: `dashboard/src/ui/dashboard/views/DashboardView.jsx`
- 修改或新建: `dashboard/src/ui/dashboard/components/` 下的组件
- 测试: 在被改组件旁新增聚焦 Dashboard 测试
- 新建: `docs/test-reports/v2.1/10-cache-hit-card.md`

## 背景说明

TokenTracker 已经在 summary 和 model breakdown 响应中提供 `cached_input_tokens`、`input_tokens`、`cache_creation_input_tokens`。V2.1 需要在 Dashboard 顶部增加一张卡片,显示缓存命中 token 数和百分比。

## 已确定输入规范

使用 `docs/dev-notes/v2.1-mvp-interfaces.md` 的“缓存命中率”章节。

## 具体步骤

1. 先执行 `docs/tasks/v2.1/README.md` 中的基座预检。
2. 先写失败的组件或 view-model 测试,覆盖:

```text
cachedTokens = totals.cached_input_tokens
inputLikeTokens = input_tokens + cached_input_tokens + cache_creation_input_tokens
cacheHitRate = cachedTokens / inputLikeTokens
```

3. 在 Dashboard 摘要区域增加卡片,展示:
   - 缓存命中 token 数
   - 缓存命中率百分比
4. 分母为 0 时展示 `0%`。
5. 运行:

```bash
npm --prefix dashboard run build
npm test
```

6. 把验证证据写入 `docs/test-reports/v2.1/10-cache-hit-card.md`。

## 验收标准

- 卡片出现在 Dashboard 顶部摘要区域。
- 卡片使用真实 summary totals,不是只支持 mock 数据。
- 百分比计算有测试覆盖。
- 不新增后端接口。

## 禁止事项

- 不重新定义 token normalization。
- 不把 cache creation tokens 算作缓存命中。
