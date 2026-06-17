# Token Eyes Interfaces

更新时间: 2026-06-17

## 计费字段

标准用量明细表使用现有 `proxy_request_logs`。

新增字段定义:

- `billing_mode: "api_key" | "token_plan"`，默认 `"api_key"`。
- `plan_cycle_type: null | "5h" | "weekly" | "monthly"`。
- `plan_start_at: number | null`，Unix 秒。
- `plan_end_at: number | null`，Unix 秒。

本阶段只落库字段，不根据这些字段改变已有用量统计口径。

## subscription_fees 表

字段:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `agent_type TEXT NOT NULL`
- `plan_label TEXT NOT NULL`
- `monthly_fee TEXT NOT NULL`
- `currency TEXT NOT NULL DEFAULT 'USD'`
- `billing_day INTEGER NOT NULL CHECK (billing_day BETWEEN 1 AND 31)`
- `effective_from INTEGER NOT NULL`
- `effective_to INTEGER`
- `note TEXT`

索引:

- `idx_subscription_fees_agent_effective(agent_type, effective_from, effective_to)`

校验规则:

- `agent_type` 必须为非空字符串，例如 `claude`、`codex`、`gemini`、`opencode`、`hermes`。
- `plan_label` 必须为非空字符串。
- `monthly_fee` 必须是非负十进制字符串，保存前 trim。
- `currency` 使用三位大写货币代码，默认 `USD`。
- `billing_day` 范围为 `1..=31`。
- `effective_from` 必填，Unix 秒。
- `effective_to` 可空；存在时必须大于或等于 `effective_from`。
- `note` 可空；空字符串保存为 `NULL`。

## subscription_fee_commands

文件: `src-tauri/src/commands/subscription_fee_commands.rs`

Rust 输入输出结构使用 `#[serde(rename_all = "camelCase")]`。

```rust
pub struct SubscriptionFeeInput {
    pub agent_type: String,
    pub plan_label: String,
    pub monthly_fee: String,
    pub currency: Option<String>,
    pub billing_day: i64,
    pub effective_from: i64,
    pub effective_to: Option<i64>,
    pub note: Option<String>,
}

pub struct SubscriptionFee {
    pub id: i64,
    pub agent_type: String,
    pub plan_label: String,
    pub monthly_fee: String,
    pub currency: String,
    pub billing_day: i64,
    pub effective_from: i64,
    pub effective_to: Option<i64>,
    pub note: Option<String>,
}
```

Tauri 命令签名:

```rust
#[tauri::command]
pub fn create_subscription_fee(
    state: tauri::State<'_, crate::store::AppState>,
    input: SubscriptionFeeInput,
) -> Result<SubscriptionFee, AppError>;

#[tauri::command]
pub fn list_subscription_fees(
    state: tauri::State<'_, crate::store::AppState>,
    agent_type: Option<String>,
    include_inactive: Option<bool>,
) -> Result<Vec<SubscriptionFee>, AppError>;

#[tauri::command]
pub fn update_subscription_fee(
    state: tauri::State<'_, crate::store::AppState>,
    id: i64,
    input: SubscriptionFeeInput,
) -> Result<SubscriptionFee, AppError>;

#[tauri::command]
pub fn delete_subscription_fee(
    state: tauri::State<'_, crate::store::AppState>,
    id: i64,
) -> Result<bool, AppError>;
```

`include_inactive = false` 时，仅返回当前时间仍有效的记录:

- `effective_from <= now`
- `effective_to IS NULL OR effective_to >= now`

## cost_ledger 最简公式

文件: `src-tauri/src/services/cost_ledger.rs`

本阶段 Dashboard 展示口径使用 USD，不做汇率换算；`subscription_fees.currency != "USD"` 的记录不纳入 USD 聚合。

周期花销:

```text
period_total_usd = token_cost_usd + subscription_cost_usd
```

其中:

- `token_cost_usd` = 统计周期内有效用量记录的 `total_cost_usd` 求和。
- 有效用量记录沿用 `usage_stats::effective_usage_log_filter` 的去重口径。
- 如查询范围覆盖完整历史日，允许复用 `usage_daily_rollups`，但必须避免与明细重复计数。
- `subscription_cost_usd` = 查询周期覆盖到的月份内，所有有效 USD 订阅费的 `monthly_fee` 求和。
- 一条订阅费只要在某个月与该月有交集，就在该月计入一次；不按天拆分。

累计花销:

```text
cumulative_total_usd = cumulative_token_cost_usd + cumulative_subscription_cost_usd
```

其中累计范围为全部历史到本次查询的 `period_end`。

Rust 查询结构:

```rust
pub struct CostLedgerQuery {
    pub start_date: Option<i64>,
    pub end_date: Option<i64>,
    pub agent_type: Option<String>,
}

pub struct CostLedgerByAgent {
    pub agent_type: String,
    pub token_cost_usd: String,
    pub subscription_cost_usd: String,
    pub total_cost_usd: String,
}

pub struct CostLedgerSummary {
    pub period_start: i64,
    pub period_end: i64,
    pub token_cost_usd: String,
    pub subscription_cost_usd: String,
    pub total_cost_usd: String,
    pub cumulative_token_cost_usd: String,
    pub cumulative_subscription_cost_usd: String,
    pub cumulative_total_cost_usd: String,
    pub by_agent: Vec<CostLedgerByAgent>,
}
```

服务签名:

```rust
pub fn get_cost_ledger_summary(
    db: &crate::database::Database,
    query: CostLedgerQuery,
) -> Result<CostLedgerSummary, AppError>;
```

Tauri 命令签名:

```rust
#[tauri::command]
pub fn get_cost_ledger_summary(
    state: tauri::State<'_, crate::store::AppState>,
    start_date: Option<i64>,
    end_date: Option<i64>,
    agent_type: Option<String>,
) -> Result<CostLedgerSummary, AppError>;
```

默认时间:

- `start_date` 为空时，取当前自然月月初 00:00:00。
- `end_date` 为空时，取当前时间。
- `end_date < start_date` 返回参数错误。

## Day 2 前端组件数据接口

本节是工单 06/07/08 的唯一前端数据契约。三个组件只对接 Day 1 已完成的后端能力，不新增 schema，不新增后端命令，不做套餐摊销或预测。

### 1. 用量列表展示字段

用量列表复用现有用量页模式，不新增专用后端接口。数据来源继续使用现有 `RequestLog`、`PaginatedLogs`、`useRequestLogs`、`RequestLogTable` 链路。

```ts
export interface UsageListQuery {
  range: UsageRangeSelection;
  appType?: AppType | "all";
  providerName?: string;
  model?: string;
  statusCode?: number;
  page: number;
  pageSize: number;
}

export type UsageListResult = PaginatedLogs;

export type UsageListRow = Pick<
  RequestLog,
  | "requestId"
  | "providerName"
  | "appType"
  | "model"
  | "requestModel"
  | "pricingModel"
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "cacheCreationTokens"
  | "totalCostUsd"
  | "statusCode"
  | "createdAt"
  | "dataSource"
>;
```

约定：
- `appType === "all"` 在调用后端前归一化为 `undefined`。
- Hermes 用量行使用 `appType: "hermes"`，展示逻辑复用现有列表样式和分页模式。
- 本阶段不新增用量字段、不调整 `RequestLog` 后端结构。

### 2. 花销图表数据接口

花销图表只展示两个数字和一个简易柱状图：本统计周期花销、历史累计花销。数据来自 Day 1 已定义的 `get_cost_ledger_summary`。

```ts
export interface CostLedgerQuery {
  startDate?: number;
  endDate?: number;
  agentType?: AppType;
}

export interface CostLedgerByAgent {
  agentType: string;
  tokenCostUsd: string;
  subscriptionCostUsd: string;
  totalCostUsd: string;
}

export interface CostLedgerSummary {
  periodStart: number;
  periodEnd: number;
  tokenCostUsd: string;
  subscriptionCostUsd: string;
  totalCostUsd: string;
  cumulativeTokenCostUsd: string;
  cumulativeSubscriptionCostUsd: string;
  cumulativeTotalCostUsd: string;
  byAgent: CostLedgerByAgent[];
}

export interface SpendOverviewBarDatum {
  key: "period" | "cumulative";
  label: string;
  valueUsd: number;
  rawUsd: string;
}

export interface SpendOverviewViewModel {
  monthlyUsd: string;
  cumulativeUsd: string;
  bars: SpendOverviewBarDatum[];
  byAgent: CostLedgerByAgent[];
}
```

前端 API 约定：

```ts
usageApi.getCostLedgerSummary(params?: CostLedgerQuery): Promise<CostLedgerSummary>
```

Tauri invoke 约定：

```ts
invoke<CostLedgerSummary>("get_cost_ledger_summary", {
  startDate,
  endDate,
  agentType,
})
```

约定：
- `monthlyUsd` 使用 `CostLedgerSummary.totalCostUsd`。
- `cumulativeUsd` 使用 `CostLedgerSummary.cumulativeTotalCostUsd`。
- 柱状图只画 `period` 与 `cumulative` 两根柱，不做趋势预测。
- 金额字符串保持后端返回精度；图表数值用 `Number(value || 0)` 派生。

### 3. 订阅费表单数据接口

订阅费表单对接 Day 1 已定义的 `subscription_fee_commands`。表单只负责手动录入、编辑、删除、列表展示订阅费，不做自动识别。

```ts
export interface SubscriptionFee {
  id: number;
  agentType: AppType;
  planLabel: string;
  monthlyFee: string;
  currency: string;
  billingDay: number;
  effectiveFrom: number;
  effectiveTo?: number | null;
  note?: string | null;
}

export interface SubscriptionFeeInput {
  agentType: AppType;
  planLabel: string;
  monthlyFee: string;
  currency?: string;
  billingDay: number;
  effectiveFrom: number;
  effectiveTo?: number | null;
  note?: string | null;
}

export interface SubscriptionFeeFormValues {
  id?: number;
  agentType: AppType;
  planLabel: string;
  monthlyFee: string;
  currency: "USD";
  billingDay: number;
  effectiveFromDate: string;
  effectiveToDate?: string;
  note: string;
}

export interface SubscriptionFeeListQuery {
  agentType?: AppType;
  includeInactive?: boolean;
}
```

前端 API 约定：

```ts
subscriptionFeeApi.list(params?: SubscriptionFeeListQuery): Promise<SubscriptionFee[]>
subscriptionFeeApi.create(input: SubscriptionFeeInput): Promise<SubscriptionFee>
subscriptionFeeApi.update(id: number, input: SubscriptionFeeInput): Promise<SubscriptionFee>
subscriptionFeeApi.remove(id: number): Promise<void>
```

Tauri invoke 约定：

```ts
invoke<SubscriptionFee[]>("list_subscription_fees", { agentType, includeInactive })
invoke<SubscriptionFee>("create_subscription_fee", { input })
invoke<SubscriptionFee>("update_subscription_fee", { id, input })
invoke<void>("delete_subscription_fee", { id })
```

约定：
- `monthlyFee` 在前端保持字符串，避免输入过程中丢精度或吞掉小数位。
- `currency` 本阶段固定默认 `USD`，表单不提供多币种扩展。
- `effectiveFromDate`、`effectiveToDate` 使用 `YYYY-MM-DD`，提交前转换为秒级 Unix 时间戳。
- `billingDay` 只允许 1-31。
- 不新增套餐自动识别，不做复杂摊销。
