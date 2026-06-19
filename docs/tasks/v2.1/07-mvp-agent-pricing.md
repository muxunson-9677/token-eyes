# [MVP] 07 - 每个 Agent 的默认计价

## 任务ID

`V2.1-07`

## 对应 full-plan

full-plan #6 和 #7,V2.1 简化版。

## 执行方

Claude Code

## 分支名

`feature/07-mvp-agent-pricing`

## 所属模块

计价设置 + 成本计算。

## 目标文件

- 修改: `src/lib/pricing/index.js`
- 修改: `src/lib/local-api.js`
- 修改: `dashboard/src/pages/SettingsPage.jsx`
- 修改: `dashboard/src/lib/api.ts`
- 修改或新建: 设置页计价组件
- 测试: `test/pricing.test.js`
- 测试: 在 `test/*.test.js` 下新增本地 API/配置聚焦测试
- 新建: `docs/test-reports/v2.1/07-agent-pricing.md`

## 背景说明

完整版最终要做每个 Agent + model 的自定义计价。V2.1 只需要每个 Agent 一个默认单价,让 MVP Dashboard 能显示成本数字,且不依赖 Anthropic/OpenAI 内置价格。

## 已确定输入规范

使用 `docs/dev-notes/v2.1-mvp-interfaces.md` 的“V2.1 计价规则”章节。

## 具体步骤

1. 先执行 `docs/tasks/v2.1/README.md` 中的基座预检。
2. 先写失败测试,证明 `claude`、`codex`、`hermes` 的自定义来源单价会覆盖内置模型价格。
3. 保存本地计价配置:

```json
{
  "agentDefaultPricing": {
    "claude": { "inputUsdPer1M": 0, "outputUsdPer1M": 0 },
    "codex": { "inputUsdPer1M": 0, "outputUsdPer1M": 0 },
    "hermes": { "inputUsdPer1M": 0, "outputUsdPer1M": 0 }
  }
}
```

4. 按 `v2.1-mvp-interfaces.md` 中的公式计算成本。
5. 在 Settings 页面增加每个 Agent 的 input/output USD per 1M token 输入项。
6. 三个 MVP 来源缺少价格时显示 `0` 成本,不要静默回退到 Anthropic/OpenAI 默认价格。
7. 跑定向测试,然后运行:

```bash
npm test
npm --prefix dashboard run build
```

8. 把验证证据写入 `docs/test-reports/v2.1/07-agent-pricing.md`。

## 验收标准

- 用户可以给每个 Agent 设置一个 input/output 默认单价。
- Dashboard model breakdown 成本反映自定义 Agent 价格。
- V2.1 不出现 per-model 定价 UI。
- 缺少 MVP 价格时显示零成本,不显示误导性的 vendor 默认价格。

## 禁止事项

- 本任务不设计最终 per Agent + model 计价 schema。
- 不新增实时汇率获取。
- 不修改 queue token 字段。
