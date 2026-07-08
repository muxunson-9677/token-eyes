# 03 - 成本累积与计费

## 中文简述

本工单负责 `支出 > 成本累积`，包括 Token 套餐、API 计费、订阅记录。它可以在 `01-product-ui.md` 完成后与 `02-data-env.md` 并行执行。

## 第一性原理执行规则

- 先区分“已经发生的使用成本”和“订阅/充值/套餐成本”。
- 所有成本必须能说明来源，避免重复计算。
- API 计费检测要复用已有 Token 套餐状态同步思路，不另起一套无关流程。
- 不把订阅记录放回设置页。
- 不在本工单处理项目路径和 Agent 环境检测。

## 新增任务要求

- `新增订阅记录` 改名为 `订阅记录`。
- `订阅记录` 固定放在 `支出 > 成本累积`。
- 成本累积包含三块：`Token 套餐`、`API 计费`、`订阅记录`。
- 新增 `API 计费`，用于检测用户在哪个平台充值的账户花了多少钱。
- API 计费实现逻辑参考 `Token 套餐 xiaomi 状态同步`。
- 成本汇总展示：`本月 API 成本`、`本月订阅成本`、`本月总成本`、`累计总成本`。
- 成本卡片尺寸要比当前截图中的大卡片更紧凑。
- 订阅记录字段包含：订阅名称、Provider、计费周期、金额、币种、开始时间、续费时间、状态。
- Token 套餐字段包含：套餐名称、套餐周期、额度、已使用、剩余、成本、到期时间、同步状态。

## 建议数据契约

```ts
type CostAccumulationSummary = {
  monthApiCostUsd: number;
  monthSubscriptionCostUsd: number;
  monthTotalCostUsd: number;
  lifetimeTotalCostUsd: number;
  usdToCny: number;
};

type ApiBillingAccount = {
  provider: string;
  accountName: string;
  billingSource: "api" | "console" | "manual";
  monthCostUsd: number;
  lifetimeCostUsd: number;
  status: "synced" | "not-connected" | "error";
  lastSyncedAt?: string;
};

type SubscriptionRecord = {
  name: string;
  provider: string;
  cycle: "monthly" | "yearly" | "one-time";
  amount: number;
  currency: "USD" | "CNY";
  startedAt: string;
  renewsAt?: string;
  status: "active" | "expired" | "cancelled";
};
```

## 验收标准

- 支出页 `成本累积` 中出现 Token 套餐、API 计费、订阅记录。
- 页面不再出现 `新增订阅记录` 这个名字。
- API 计费能展示平台、账户、月成本、累计成本、同步状态。
- 成本汇总不会把同一笔成本重复计入。
- API 计费同步失败时有清晰状态。
- Token 套餐和 API 计费的同步口径一致。

## 对抗性审查记录

执行者完成后必须填写：

```text
审查轮次：
发现问题：
修复动作：
复查结果：
最终结论：
```

如果 `发现问题` 不为空，必须先修复，再新增一轮审查记录。只有最终结论为“无遗留问题”时才能结束。

## 完成情况汇报

完成后回复：

- 成本累积包含哪些模块。
- API 计费检测支持哪些 Provider。
- Token 套餐同步逻辑复用了哪些既有能力。
- 是否存在无法自动检测的平台。
- 对抗性审查做了几轮，最后结论是什么。
