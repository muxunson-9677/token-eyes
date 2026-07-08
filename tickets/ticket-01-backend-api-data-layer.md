# 工单1：后端 API 扩展 + 前端数据层 + 全局状态管理

## 基本信息

- **工单编号**: TICKET-01
- **标题**: 后端 API 扩展 + 前端数据层 + 全局状态管理
- **优先级**: 最高（必须最先完成）
- **依赖**: 无
- **后续依赖**: 工单2、工单3、工单4

## 对应需求点

- 需求1.2: Agent 切换全局数据范围
- 需求2.2: 按供应商筛选数据
- 需求3.2: 按模型筛选数据
- 需求4.3: 时间变化联动刷新
- 需求5: 趋势图数据基础
- 需求6: 请求日志/Provider统计数据基础
- 需求7.1: 数据口径三位一体一致

## 项目背景

当前 Token Eye 项目的 Spend 页面已有基本的花费趋势图和请求日志，但数据维度单一，缺少按 Token 类型（输入/输出/缓存）拆分的多维度数据，也缺少成功率、延迟等统计指标。

本工单的目标是扩展后端 API 和前端数据层，为后续的 UI 改造提供完整的数据支持。

## 技术栈

- 后端: Node.js (local-api.js)
- 前端: React + TypeScript
- 样式: Tailwind CSS
- 状态管理: React Hooks

---

## 工作内容

### A. 后端 API 扩展

**文件**: `src/lib/local-api.js`

#### A1. `tokentracker-spend-timeseries` 接口增强

1. 新增筛选参数：
   - `sources`: 逗号分隔的多个 source（供应商）
   - `models`: 逗号分隔的多个模型名
   - `agent_ids`: 逗号分隔的多个 agent ID

2. 返回的 `series` 每条记录增加以下字段：
   - `input_tokens`: 输入 tokens 数
   - `output_tokens`: 输出 tokens 数
   - `cached_input_tokens`: 缓存命中 tokens 数
   - `cache_creation_input_tokens`: 缓存创建 tokens 数
   - `reasoning_output_tokens`: 推理输出 tokens 数（可选，没有则为0）
   - `total_tokens`: 总 tokens 数
   - `cost_usd`: 成本（USD），已有字段，保留

3. 聚合逻辑：
   - 按 `bucket`（时间桶） + `source` + `model` 正确聚合
   - 保证与 Spend 汇总卡片口径一致
   - 空值处理：没有数据的时间桶返回0

4. 返回格式示例：
```json
{
  "ok": true,
  "sources": ["claude_code", "codex", "hermes"],
  "series": [
    {
      "bucket": "2026-06-01",
      "input_tokens": 12345,
      "output_tokens": 6789,
      "cached_input_tokens": 5000,
      "cache_creation_input_tokens": 0,
      "reasoning_output_tokens": 0,
      "total_tokens": 19134,
      "cost_usd": 0.0023
    }
  ]
}
```

#### A2. `tokentracker-request-usage-records` 接口增强

1. 新增筛选参数：
   - `sources`: 逗号分隔的多个 source
   - `models`: 逗号分隔的多个模型名
   - `agent_ids`: 逗号分隔的多个 agent ID
   - 保留原有 `source` 参数（单 source），向后兼容

2. 返回的每条 `record` 增加字段：
   - `source_display_name`: 供应商显示名（如 "Claude (Session)"、"Xiaomi MiMo Token Plan (China)"）
   - `status`: HTTP 状态码（如 200、400、500）
   - `latency_ms`: 总耗时（毫秒）
   - `first_token_ms`: 首字时间（毫秒，可能为 null）
   - `cached_input_tokens`: 缓存读取 tokens 数（用于输入列小字显示）
   - `request_source`: 请求来源（如 "session_log"、"agent_run"）

3. 返回的 `totals` 增加字段：
   - `request_count`: 总请求数
   - `success_count`: 成功请求数（status 2xx）
   - `success_rate`: 成功率（0-100，百分比）
   - `avg_latency_ms`: 平均延迟（毫秒）
   - `cache_hit_rate`: 缓存命中率（0-100，百分比）

#### A3. 新增汇总统计接口

新增接口路径：`tokentracker-usage-summary`

功能：返回当前筛选条件下的汇总统计数据，供统计面板使用。

参数：
- `from`: 开始时间
- `to`: 结束时间
- `timeZone`: 时区
- `sources`: 逗号分隔的多个 source
- `models`: 逗号分隔的多个模型
- `agent_ids`: 逗号分隔的多个 agent ID

返回字段：
```json
{
  "ok": true,
  "summary": {
    "total_tokens": 643308077,
    "input_tokens": 55193000,
    "output_tokens": 2358000,
    "cache_creation_input_tokens": 0,
    "cached_input_tokens": 58600000,
    "cost_usd": 228.0715,
    "request_count": 5634,
    "success_count": 5634,
    "success_rate": 100,
    "avg_latency_ms": 1228,
    "cache_hit_rate": 91.4
  }
}
```

#### A4. Provider 统计聚合接口

新增接口路径：`tokentracker-provider-stats`

功能：按供应商聚合统计数据。

参数：同上（与汇总接口相同）

返回格式：
```json
{
  "ok": true,
  "providers": [
    {
      "source": "codex_session",
      "source_display_name": "Codex (Session)",
      "request_count": 2005,
      "tokens": 22845382,
      "cost_usd": 211.0528,
      "success_rate": 100,
      "avg_latency_ms": 0
    }
  ]
}
```

按 tokens 降序排列。

#### A5. 模型统计聚合接口

新增接口路径：`tokentracker-model-stats`

功能：按模型聚合统计数据。

参数：同上

返回格式：
```json
{
  "ok": true,
  "models": [
    {
      "model": "deepseek-v4-f1ash",
      "source": "claude_code",
      "source_display_name": "Claude (Session)",
      "request_count": 1578,
      "tokens": 3617645,
      "cost_usd": 2.4730,
      "success_rate": 100,
      "avg_latency_ms": 0
    }
  ]
}
```

按 tokens 降序排列。

---

### B. 前端 API 层

**文件**: `dashboard/src/lib/api.ts`

#### B1. 扩展现有函数

1. `getSpendTimeseries`:
   - 新增参数：`sources?: string[]`、`models?: string[]`、`agentIds?: string[]`
   - 正确序列化为 URL 参数

2. `getRequestUsageRecords`:
   - 新增参数：`sources?: string[]`、`models?: string[]`、`agentIds?: string[]`
   - 保留原有 `source` 参数（单 source），向后兼容

#### B2. 新增函数

1. `getUsageSummary(params)`: 获取汇总统计数据
2. `getProviderStats(params)`: 获取供应商统计
3. `getModelStats(params)`: 获取模型统计

参数格式统一为：
```typescript
{
  from?: string;
  to?: string;
  timeZone?: string;
  tzOffsetMinutes?: number;
  sources?: string[];
  models?: string[];
  agentIds?: string[];
}
```

#### B3. TypeScript 类型定义

在 `dashboard/src/lib/types/` 下新增或完善类型定义：

```typescript
// 趋势图数据点
interface TrendDataPoint {
  bucket: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cache_creation_input_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

// 汇总统计
interface UsageSummary {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cached_input_tokens: number;
  cost_usd: number;
  request_count: number;
  success_count: number;
  success_rate: number;
  avg_latency_ms: number;
  cache_hit_rate: number;
}

// 请求记录
interface RequestUsageRecord {
  id: string;
  timestamp: string;
  source: string;
  source_display_name: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  total_tokens: number;
  cost_usd: number;
  status: number;
  latency_ms: number;
  first_token_ms: number | null;
  request_source: string;
}

// Provider 统计
interface ProviderStat {
  source: string;
  source_display_name: string;
  request_count: number;
  tokens: number;
  cost_usd: number;
  success_rate: number;
  avg_latency_ms: number;
}

// 模型统计
interface ModelStat {
  model: string;
  source: string;
  source_display_name: string;
  request_count: number;
  tokens: number;
  cost_usd: number;
  success_rate: number;
  avg_latency_ms: number;
}
```

---

### C. 前端数据 Hooks

**目录**: `dashboard/src/hooks/`

#### C1. `useUsageFilters` Hook

新建文件：`dashboard/src/hooks/use-usage-filters.ts`

功能：统一管理全局筛选状态。

```typescript
interface UsageFilters {
  agentIds: string[] | null; // null 表示全部
  sources: string[] | null; // null 表示全部
  models: string[] | null; // null 表示全部
  timeRange: 'today' | '1d' | '7d' | '14d' | '30d' | 'custom';
  from: string | null; // ISO 字符串
  to: string | null; // ISO 字符串
  refreshInterval: '30s' | '1m' | '5m' | 'manual';
}

interface UseUsageFiltersReturn {
  filters: UsageFilters;
  setAgentIds: (ids: string[] | null) => void;
  setSources: (sources: string[] | null) => void;
  setModels: (models: string[] | null) => void;
  setTimeRange: (range: UsageFilters['timeRange'], from?: string, to?: string) => void;
  setRefreshInterval: (interval: UsageFilters['refreshInterval']) => void;
  resetFilters: () => void;
}
```

要求：
- 使用 React Context + useReducer 或 Zustand（优先选择项目已有方案）
- 支持级联更新：设置 agentIds 时自动过滤 sources 和 models
- 提供默认值（全部 agent + 30d + 1m 刷新）

#### C2. `useUsageSummary` Hook

新建文件：`dashboard/src/hooks/use-usage-summary.ts`

功能：获取汇总统计数据，自动响应筛选变化。

```typescript
interface UseUsageSummaryReturn {
  data: UsageSummary | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  lastUpdated: Date | null;
}
```

#### C3. `useUsageTrend` Hook

改造或新建：`dashboard/src/hooks/use-usage-trend.ts`

功能：获取趋势图数据，自动响应筛选变化。

#### C4. `useProviderStats` Hook

新建文件：`dashboard/src/hooks/use-provider-stats.ts`

功能：获取供应商统计数据。

#### C5. `useModelStats` Hook

新建文件：`dashboard/src/hooks/use-model-stats.ts`

功能：获取模型统计数据。

#### C6. `useRequestUsageRecords` Hook

改造现有：`dashboard/src/hooks/use-usage-data.ts` 中的相关逻辑

功能：获取请求日志记录，支持多维度筛选。

---

### D. 数据口径校验

1. 确保以下三种统计口径数据完全一致：
   - 汇总统计接口（usage-summary）的 total_tokens / cost_usd
   - 趋势图接口（spend-timeseries）所有数据点累加的 total_tokens / cost_usd
   - 请求记录接口（request-usage-records）的 totals 中的 total_tokens / cost_usd

2. 编写单元测试验证数据一致性
3. 对所有新接口添加错误处理和边界情况处理
4. 确保空数据、单条数据、大数据量等场景都能正确处理

---

## 涉及文件清单

### 后端
- `src/lib/local-api.js`（修改）

### 前端 API 层
- `dashboard/src/lib/api.ts`（修改）
- `dashboard/src/lib/types/usage.ts`（新增）

### 前端 Hooks
- `dashboard/src/hooks/use-usage-filters.ts`（新增）
- `dashboard/src/hooks/use-usage-summary.ts`（新增）
- `dashboard/src/hooks/use-usage-trend.ts`（新增或改造）
- `dashboard/src/hooks/use-provider-stats.ts`（新增）
- `dashboard/src/hooks/use-model-stats.ts`（新增）
- `dashboard/src/hooks/use-usage-data.ts`（改造）

---

## 验收标准

- [ ] 所有新增/修改的后端 API 返回数据结构正确、字段完整
- [ ] 支持 agent、来源、模型、时间范围 多维度组合筛选
- [ ] 趋势图数据、汇总统计、请求记录 totals 三种口径数据完全一致
- [ ] TypeScript 类型定义完整，无 any 类型
- [ ] 所有 Hooks 正常工作，筛选变化时自动重新获取数据
- [ ] 空数据、错误等边界情况处理完善
- [ ] 现有功能不受影响，向后兼容
- [ ] 项目现有测试全部通过
- [ ] 代码符合项目规范（lint 通过）

---

## 注意事项

1. **向后兼容**：所有现有 API 参数和返回格式必须保持兼容，不能破坏现有功能
2. **性能**：大数据量时注意查询性能，必要时添加索引或缓存
3. **时区处理**：所有时间相关计算必须正确处理时区
4. **代码规范**：遵循项目已有代码风格和命名约定
5. **错误处理**：所有 API 调用都要有完善的错误处理
6. **先看现有代码**：开工前先阅读 `src/lib/local-api.js` 中现有接口的实现方式，保持风格一致
