# 价值对比与实时会话的数据合同

本文锁定新增页面的数据语义、隐私边界与前后端接口。设计稿只定义视觉目标，不定义或替代真实数据。

## 证据状态

所有可展示的数值都携带 `evidence_state`，不得将未知值转换成零或精确值：

| 状态 | 含义 | UI 要求 |
| --- | --- | --- |
| `exact` | 本地记录可精确计算 | 可按精确值展示 |
| `estimated` | 由可追溯价格或规则估算 | 展示“估算”标识与说明 |
| `partial` | 只有部分来源可用 | 展示已知部分和“部分数据” |
| `quota_only` | 仅有原生配额/额度信息 | 不换算为 Token 或美元 |
| `connected_no_exact_data` | 已连接但尚无可用明细 | 展示连接状态，不显示伪数值 |
| `authorization_required` | 需要授权才能读取 | 展示授权入口/说明 |
| `unsupported` | 当前来源不支持该指标 | 展示不支持说明 |
| `stale` | 最近数据超过刷新阈值 | 标记数据时间，不能伪称实时 |

数值结构为 `{ value, unit, evidence_state, observed_at, source_refs }`。`value` 可以是 `null`，其含义始终由 `evidence_state` 解释。

## 价值对比接口

`GET /api/tokentracker-value-comparison?range=today|7d|month|30d`

响应只包含经聚合或脱敏后的数据：

```json
{
  "generated_at": "ISO-8601",
  "range": "month",
  "actual_spend": {
    "subscription_usd": { "value": 8, "unit": "USD", "evidence_state": "exact" },
    "official_api_usd": { "value": 2, "unit": "USD", "evidence_state": "exact" },
    "other_ai_usd": { "value": null, "unit": "USD", "evidence_state": "unsupported" },
    "total_usd": { "value": 10, "unit": "USD", "evidence_state": "partial" }
  },
  "api_equivalent_value": { "value": 20, "unit": "USD", "evidence_state": "estimated" },
  "value_multiple": { "value": 2, "unit": "times", "evidence_state": "estimated" },
  "recognized_tokens": { "value": 1000000, "unit": "tokens", "evidence_state": "partial" },
  "pricing_coverage_percent": { "value": 80, "unit": "percent", "evidence_state": "partial" },
  "attribution": { "linked": [], "unattributed": [] },
  "monthly_trend": [],
  "native_resources": []
}
```

- 实际支出 = 订阅、官方 API、其他 AI 支出的可用部分；任一类别未知时总额状态为 `partial`，而非 `exact`。
- API 等价值只来自可识别价格记录；它不能替代实际支付金额。
- 价值倍数仅在实际支出大于零且两侧均有可用值时计算；否则值为 `null`，不得显示 `0x` 或 `∞x`。
- 套餐归因仅接受同一记录中明确存在的 `plan_ref` 和 `account_ref` 关系；没有显式关联的记录必须进入 `unattributed`。
- 原生额度/配额只原样展示其原生单位，不可换算、不可叠加进 Token 或美元。

## 实时会话接口

`GET /api/tokentracker-realtime-sessions?range=today`

响应中的每个会话只允许包含：`session_id`（脱敏稳定标识）、`parent_session_id`、`root_task_id`、`source`、`agent_label`、`project_label`、`model`、聚合 Token/费用、最后活动时间、状态和安全请求元数据。禁止包含会话正文、消息正文、提示词、响应文本、工具参数、文件路径、账号密钥、Cookie、Authorization、完整请求/响应 body。

会话状态只可由生命周期信息或安全的活动元数据决定：

- 生命周期明确为运行、等待、完成、失败时，优先使用该状态。
- 只有使用记录时，允许标为“近期有活动”，不得伪称“运行中”。
- 父子关系只使用 `parent_session_id` 或同一明确的 `root_task_id`；不允许按时间、名称、模型或项目猜测层级。
- `revision` 必须仅由安全公共视图计算，用于判断页面是否实际变化，避免无变化重渲染。

## 刷新、单位和错误语义

- 前端轮询必须只在页面可见、窗口聚焦且文档可见时运行；离开页面或卸载时取消请求。手动刷新始终可用。
- 401/403 映射为 `authorization_required`；不支持映射为 `unsupported`；正常连接但无可精确统计记录映射为 `connected_no_exact_data`；过期缓存映射为 `stale`。
- 失败时保留最近一次成功数据并标注更新时间；没有成功数据时展示错误空态，不能显示设计稿示例数字。
