# TE-FULL-H04 Rework - Fix Serve Startup Token Plan Scheduler Hook

## 给 Claude Code 的执行说明

你负责返工 `TE-FULL-H04`。当前最终集成分支的测试通过，但真实产品启动链路不能验收。

阻塞问题:

```bash
node bin/tracker.js serve --port 7799 --no-open --no-sync
```

当前会失败:

```text
Token plan due refresh warning: handleApi.runTokenPlanDueRefresh is not a function
TypeError: handleApi.startTokenPlanScheduler is not a function
    at cmdServe (.../src/commands/serve.js:105:13)
```

这说明 H04 报告里的 `src/commands/serve.js scheduler wiring` 没有真实跑通。

## 必须基于

- 分支: `claude/te-full-h04-final-integration-acceptance`
- 当前 HEAD: `ec56980`
- 已包含:
  - G04 input: `32d89f3`
  - F04 input: `dbbad84`

开始前:

```bash
git fetch origin
git switch claude/te-full-h04-final-integration-acceptance
git pull --ff-only origin claude/te-full-h04-final-integration-acceptance
git rev-parse --short HEAD
```

`rev-parse` 必须显示 `ec56980` 或它之后的提交。

## 根因

`src/lib/local-api.js` 里 `createLocalApiHandler()` 当前类似这样:

```js
return async function handleLocalApi(req, res, url) {
  // ...
};

handleLocalApi.startTokenPlanScheduler = startTokenPlanScheduler;
handleLocalApi.stopTokenPlanScheduler = stopTokenPlanScheduler;
handleLocalApi.runTokenPlanDueRefresh = runTokenPlanDueRefresh;
handleLocalApi.runTokenPlanRefreshById = runTokenPlanRefreshById;

return handleLocalApi;
```

问题是 `return async function handleLocalApi(...)` 已经提前返回，后面四个方法挂载代码不可达。所以 `serve.js` 拿到的 `handleApi.startTokenPlanScheduler` 是 `undefined`。

## 修复要求

把 handler 改成可挂载属性后再返回，例如:

```js
async function handleLocalApi(req, res, url) {
  // 保留现有完整 handler 内容
}

handleLocalApi.startTokenPlanScheduler = startTokenPlanScheduler;
handleLocalApi.stopTokenPlanScheduler = stopTokenPlanScheduler;
handleLocalApi.runTokenPlanDueRefresh = runTokenPlanDueRefresh;
handleLocalApi.runTokenPlanRefreshById = runTokenPlanRefreshById;

return handleLocalApi;
```

要求:

- 不要改 `serve.js` 去绕过这个错误。
- 不要移除 Token Plan scheduler。
- 不要破坏 G04 Spend API。
- 不要破坏 F03/F04 Token Plan refresh API。
- 保留原有 route handler 行为。

## 必须新增回归测试

新增或补充测试，至少覆盖:

1. `createLocalApiHandler()` 返回的 handler 暴露:
   - `startTokenPlanScheduler`
   - `stopTokenPlanScheduler`
   - `runTokenPlanDueRefresh`
   - `runTokenPlanRefreshById`

2. `startTokenPlanScheduler()` / `stopTokenPlanScheduler()` 可调用，不抛异常。

建议新增:

```text
test/serve-token-plan-scheduler.test.js
```

也可以加到现有 token plan/local-api 测试文件，但测试名称必须明确覆盖 serve startup scheduler hook。

## 必须做真实启动验证

除了测试，还必须手动验证一个空闲端口的真实启动链路:

```bash
node bin/tracker.js serve --port 7799 --no-open --no-sync
```

验收要求:

- 不出现 `handleApi.runTokenPlanDueRefresh is not a function`。
- 不出现 `handleApi.startTokenPlanScheduler is not a function`。
- 服务能返回 dashboard HTML。
- 验证后停止该进程。

如果 `7799` 被占用，换一个明确空闲端口，并在报告里写清楚。

## 必跑验证

```bash
node --test test/pricing.test.js test/local-settings-api.test.js test/token-plans-api.test.js test/token-plan-refresh.test.js test/spend-records-api.test.js
npm --prefix dashboard run test -- AgentPricingSection.test.jsx TokenPlanSection.test.jsx SpendPage.test.jsx currency.test.ts
npm --prefix dashboard run typecheck
npm run dashboard:build
npm run validate:copy
npm run validate:guardrails
```

## 报告更新

更新:

```text
docs/test-reports/full-plan/16-final-integration-acceptance.md
```

报告必须新增:

- 本次返工 commit SHA。
- 根因说明：`return async function` 提前返回导致 scheduler 方法挂载不可达。
- 新增回归测试名称和结果。
- 真实 `serve` 启动验证命令、端口、结果。
- 是否还有阻塞问题。

## 交付

提交并推送:

```bash
git status --short
git add src/lib/local-api.js test/serve-token-plan-scheduler.test.js docs/test-reports/full-plan/16-final-integration-acceptance.md
git commit -m "fix: expose token plan scheduler hooks on local api handler"
git push origin claude/te-full-h04-final-integration-acceptance
```

如果测试文件路径不同，按实际新增文件调整 `git add`。返回给 Codex/用户时只给摘要、commit SHA、验证结果和报告路径。
