# TE-NEXT-U02 - 请求级 Token 明细视图

## 任务边界

本工单给 Claude Code 执行 `U02 - 请求级 Token 明细视图`。

注意：本工单已经生成，但必须等 `R02 - Codex 窗口额度展示实现` 完成并合入当前工作基线后再开工。原因是 R02 和 U02 都可能修改 `dashboard/src/lib/api.ts`、`dashboard/src/content/copy.csv` 和设置/页面相关测试；并行开工容易产生冲突。

只实现请求级 token/cost metadata 的只读展示。不要保存或展示 prompt/message/content/encrypted_content/tool result 正文，不要新增 tokenizer，不要改现有 queue schema，不要改 R02 Codex 额度展示，不要改 Windows/Tauri/WebView2 逻辑，不要新增 npm 依赖。

依据规范：

- `docs/dev-notes/precise-token-capture-assessment.md`
- `docs/token-eyes-next-blueprint-v3.md` 中 U01/U02
- `src/lib/rollout.js` 当前 Codex rollout parser
- `src/lib/local-api.js` 当前 usage summary/model breakdown endpoint 风格

## 开工前置

开工前先确认：

1. R02 已完成或项目负责人明确允许 U02 先开工。
2. 当前基线已经包含 Q02/P03/S02/T02 已审核改动。
3. `docs/dev-notes/precise-token-capture-assessment.md` 已阅读。

如果 R02 未完成且没有明确允许，不要改代码，只回复“U02 等 R02 后开工”。

## 先读文件

开始前按顺序读：

1. `CLAUDE.md`
2. `docs/dev-notes/precise-token-capture-assessment.md`
3. `src/lib/rollout.js` 中 `parseRolloutFile()`、`extractTokenCount()`、`pickDelta()`、`normalizeUsage()`
4. `src/lib/local-api.js` 中已有 `/functions/tokentracker-usage-summary`、`/functions/tokentracker-usage-model-breakdown`、`/functions/tokentracker-spend-records`
5. `dashboard/src/lib/api.ts`
6. `dashboard/src/pages/DashboardPage.jsx`
7. `dashboard/src/ui/dashboard/components/UsageOverview.jsx`
8. `dashboard/src/content/copy.csv`
9. `test/rollout-parser.test.js`

不要读取真实用户日志正文。测试必须使用临时 synthetic JSONL。

## 必须实现

### 1. 后端请求级扫描函数

在 `src/lib/rollout.js` 增加一个请求级只读扫描函数，建议命名：

```js
async function collectRolloutRequestUsageRecords(options)
```

输入建议：

```js
{
  rolloutFiles,
  source = "codex",
  from,
  to,
  timeZoneContext,
  limit = 500,
}
```

输出 record 建议：

```json
{
  "id": "codex:<session-id>:<timestamp>",
  "timestamp": "2026-06-23T10:00:00.000Z",
  "hour_start": "2026-06-23T10:00:00.000Z",
  "source": "codex",
  "agent": "Codex",
  "model": "gpt-5-codex",
  "input_tokens": 123,
  "cached_input_tokens": 456,
  "cache_creation_input_tokens": 0,
  "output_tokens": 78,
  "reasoning_output_tokens": 9,
  "total_tokens": 666,
  "cost_usd": 0.0123,
  "origin": "codex_rollout_token_count"
}
```

要求：

- 使用现有 Codex normalization 口径：raw `input_tokens` 包含 cache read 时，展示/计费前要减去 `cached_input_tokens`。
- 使用现有价格计算逻辑，确保 cost 与 summary/spend 口径一致；如果某 model 没价格，cost 可以是 `0`，但不要抛错。
- `id` 用 session/file stable id + timestamp，不能包含 prompt 内容。
- 支持 from/to 过滤。
- limit 默认 500，最大 5000，避免一次扫爆 UI。
- 不输出任何正文类字段。

### 2. 本地 API endpoint

在 `src/lib/local-api.js` 增加：

```text
GET /functions/tokentracker-request-usage-records
```

查询参数：

- `source`：默认 `codex`，第一版可以只支持 `codex`。
- `from`
- `to`
- `tz`
- `tz_offset_minutes`
- `limit`

返回：

```json
{
  "source": "codex",
  "from": "2026-06-23",
  "to": "2026-06-23",
  "records": [],
  "totals": {
    "input_tokens": 0,
    "cached_input_tokens": 0,
    "cache_creation_input_tokens": 0,
    "output_tokens": 0,
    "reasoning_output_tokens": 0,
    "total_tokens": 0,
    "cost_usd": 0
  }
}
```

如果请求非支持 source，返回稳定空数据或 HTTP 400，二选一即可，但测试要固定。

### 3. Dashboard API wrapper

在 `dashboard/src/lib/api.ts` 增加：

```ts
export async function getRequestUsageRecords(params)
```

参数包含 `source/from/to/timeZone/tzOffsetMinutes/limit`。命名尽量与现有 Spend/Usage API wrapper 保持一致。

### 4. 请求日志 UI

在 Dashboard 增加请求日志 Tab 或面板。建议新增组件：

```text
dashboard/src/ui/dashboard/components/RequestUsageLog.jsx
```

显示列：

- 时间
- Agent/source
- model
- input
- cache read
- cache write
- output
- reasoning
- total
- cost
- origin

交互：

- 支持 source 筛选，第一版至少有 Codex。
- 支持当前页面的时间范围参数，或在组件内提供 `from/to`。
- loading、empty、error 状态完整。
- totals 行与 records 汇总一致。
- 移动端不溢出，可以横向滚动表格；不要用卡片套卡片。

所有可见文案进入 `dashboard/src/content/copy.csv`。

建议 copy key：

- `usage.request_log.tab` = `请求日志`
- `usage.request_log.title` = `请求级 Token 明细`
- `usage.request_log.empty` = `当前范围暂无请求级 Token 记录`
- `usage.request_log.error` = `无法读取请求级 Token 记录`
- `usage.request_log.column.time` = `时间`
- `usage.request_log.column.agent` = `Agent`
- `usage.request_log.column.model` = `模型`
- `usage.request_log.column.input` = `输入`
- `usage.request_log.column.cache_read` = `缓存读`
- `usage.request_log.column.cache_write` = `缓存写`
- `usage.request_log.column.output` = `输出`
- `usage.request_log.column.reasoning` = `推理`
- `usage.request_log.column.total` = `合计`
- `usage.request_log.column.cost` = `成本`
- `usage.request_log.column.origin` = `来源`

## 测试要求

至少补以下测试：

1. 后端：synthetic Codex rollout 里两个 `token_count` 事件返回两条 request records。
2. 后端：raw Codex `input_tokens` 包含 cached 时，输出的 `input_tokens` 为非缓存 input，`cached_input_tokens` 单独保留。
3. 后端：`records` 汇总 totals 等于返回 `totals`。
4. 后端：from/to 过滤只返回范围内 records。
5. 后端：不输出 `content`、`message`、`encrypted_content`、`base_instructions` 等正文类字段。
6. 前端：请求日志组件能显示 records、totals、empty、error。
7. 前端：source/range 变化会重新调用 `getRequestUsageRecords()`。

测试只能用临时 synthetic JSONL，不允许读取真实 `~/.codex/sessions`。

## 验证命令

至少运行：

```bash
node --test test/rollout-parser.test.js test/local-api-request-usage-records.test.js
npm --prefix dashboard run test -- RequestUsageLog
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
```

如果新增的后端测试文件名不同，完成报告中写清楚实际文件名和命令。

完整 `npm --prefix dashboard run test` 如果仍因既有中文本地化断言失败，不要在本任务里修无关测试；完成报告中列出失败文件和原因即可。

## 验收标准

- Dashboard 能看到请求级 Token 明细 Tab 或面板。
- 每条记录显示时间、Agent/source、model、input、cache、output、reasoning、total、cost。
- 请求级 records 汇总 totals 与当前返回 totals 一致。
- Codex cache 语义不重复计费。
- 不读取、不保存、不展示 prompt/message/content/tool result 正文。
- 不改现有 queue schema。
- 新增文案全部进入 copy registry。
- 不新增 npm 依赖。
- 不把 `.NET SDK` 或 `.NET 8 SDK` 写成 Token Eyes Windows 前置；Token Eyes 是 Tauri/Rust/Node/WebView2 口径。
- 定向后端测试、前端测试、typecheck、copy、hardcode、guardrails、build 通过。

## 禁止事项

- 不做字符级 tokenizer 重算。
- 不展示正文。
- 不伪造 request rows：如果某 source 只有小时聚合，没有 request-level 原始 usage，第一版就不要支持该 source。
- 不同时改 R02 的 Token Plan Codex 额度展示。
- 不修 unrelated localization tests。
- 不改 Windows/Tauri/WebView2 文件夹选择器。

## 建议分支

`claude/te-next-u02-request-token-detail-view`

## 完成后回复必须包含

- 分支名
- commit SHA（如果未提交，明确说明未提交）
- 修改文件列表
- 后端 endpoint 和返回字段说明
- UI 位置和筛选行为说明
- 隐私边界说明：确认没有读取/输出正文
- 测试命令和结果
- 是否存在阻塞或无关失败
