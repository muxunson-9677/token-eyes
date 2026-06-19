# V2.1-07 Agent 默认计费验收报告

日期: 2026-06-19

## 结论

已完成 MVP 版每个 Agent 一个默认单价:

- 本机配置新增 `agentDefaultPricing.claude/codex/hermes`。
- Settings 页面新增 Claude Code、Codex、Hermes Agent 的 input/output USD per 1M 输入。
- 本地 API 读取配置后,Claude/Codex/Hermes 成本使用 Agent 默认价覆盖模型内置价。
- 当 MVP Agent 没有用户价格时,成本为 0,不会回退 Anthropic/OpenAI 内置价格。
- 非 MVP 来源仍保留原 TokenTracker 模型价逻辑。

## 验证

通过:

```bash
node --test test\pricing.test.js test\local-settings-api.test.js test\data-directories.test.js
```

结果: 44 个相关 Node 测试通过。

```bash
npm.cmd --prefix dashboard run test -- AgentPricingSection.test.jsx DataDirectoriesSection.test.jsx
```

结果: 2 个组件测试通过。

统一验证中再次通过:

```bash
node --test test\data-directories.test.js test\local-settings-api.test.js test\pricing.test.js test\token-plans-api.test.js test\spend-records-api.test.js test\app-route-pathname-guard.test.js
npm.cmd --prefix dashboard run test -- AgentPricingSection.test.jsx DataDirectoriesSection.test.jsx TokenPlanSection.test.jsx SpendPage.test.jsx currency.test.ts cache-hit.test.ts
npm.cmd --prefix dashboard run typecheck
npm.cmd run dashboard:build
```
