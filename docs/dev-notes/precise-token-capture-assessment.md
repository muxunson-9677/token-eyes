# U01 - 精准 Token 检测可行性评估

更新时间：2026-06-23
任务编号：U01
任务性质：Codex 评估任务
后续执行：U02 条件触发

## 结论

结论 A：如果产品诉求是“请求级 Token 明细 / 请求日志 Tab”，需要派发 U02。

当前实现对总量统计已经是基于本地日志里的 usage 数值做增量聚合，不是前端估算；但现有 queue 和 Dashboard 主要展示半小时 bucket、source、model 聚合结果，不能直接回答“某一条请求用了多少 input/output/cache/reasoning token、花了多少钱”。

因此：

- 不需要新增 tokenizer 去按字符重新估算 token。
- 不应该保存或展示 prompt/message 正文。
- 需要新增一个请求级只读视图，把本地日志里已有的 request/turn usage 事件按安全字段展示出来。

## 已确认的 Codex 日志结构

本机 Codex session JSONL 中存在 `token_count` 事件，字段结构如下：

- `info.last_token_usage`
- `info.total_token_usage`
- usage keys：`input_tokens`、`cached_input_tokens`、`output_tokens`、`reasoning_output_tokens`、`total_tokens`

安全检查时只读取了事件类型、字段名和数值字段；没有输出 prompt、message、content、encrypted_content、base_instructions 等正文类字段。

## 当前 parser 行为

`src/lib/rollout.js`：

- `parseRolloutFile()` 只处理 `token_count`、`turn_context`、`session_meta` 相关行。
- `extractTokenCount(obj)` 从 `payload.type === "token_count"` 或 `payload.msg.type === "token_count"` 中取 usage。
- `pickDelta(lastUsage, totalUsage, prevTotals)` 优先用 cumulative total 与上次 total 做差；遇到 total reset 时回退到 `last_token_usage`。
- `normalizeUsage()` 保留标准 token 列。
- Codex/Every Code 的 `input_tokens` 是包含 cache read 的 prompt 总量，当前实现会减去 `cached_input_tokens`，避免 cache-heavy 会话成本被重复计费。
- 当前 queue 写入半小时 bucket，key 是 `(source, model, hour_start)`，不是 request-level row。

对应测试已经覆盖：

- 半小时 bucket 切分。
- total reset。
- 同一小时内不同 model 分桶。
- unknown model 回填到 dominant model。
- Codex 与 every-code 的 rollout 格式区分。

## 精准性的边界

当前“精准”应定义为：使用 AI 客户端或 provider 返回的 usage 数值，按 Token Tracker 统一 schema 做规范化和聚合。

这比前端按字符数估算更可靠，但它不是“精确到每个字符由哪个 token 对应”的 tokenizer 视图。不同模型 tokenizer 和 provider 计费口径会变，重新分词反而可能和真实账单不一致。

因此 U02 不做：

- 不按字符重新 tokenization。
- 不保存 prompt、completion、tool result、conversation body。
- 不用 UI 解释每个 token 对应的文本片段。

U02 要做：

- 展示每个 request/turn usage 事件的时间、Agent/source、model、input、output、cache、reasoning、total、成本、来源文件类型。
- 支持 source 和时间范围过滤。
- 同一过滤范围下，请求级汇总应能与半小时聚合 totals 对齐；允许因现有 unknown model 回填策略导致 model 归属显示有差异，但总 token 不得缺失。

## ccusage 参考

仓库现有 parser 注释已经把 Codex cache 语义与 ccusage 的日维度结果做过对齐：Codex rollout 的 `input_tokens` 包含 cached subset，所以当前实现会先减去 `cached_input_tokens`，避免成本重复计费。

U02 应继续沿用这个口径，不要把 raw `input_tokens` 直接当作非缓存 input 展示和计费。

## U02 推荐实现方向

U02 新增请求级只读链路，而不是改现有 queue schema。

建议：

1. 在 `src/lib/rollout.js` 增加一个请求级扫描函数，只输出安全 metadata 和 usage 数值。
2. 在 `src/lib/local-api.js` 增加 `/functions/tokentracker-request-usage-records`。
3. 在 Dashboard 增加请求日志 Tab 或独立面板。
4. 默认只展示 token/cost metadata；不展示正文，不提供正文展开。
5. first version 先覆盖 Codex rollout request usage；如果要覆盖 Claude/Hermes，必须逐个确认日志里存在 request-level usage，不要把小时聚合拆回去伪造成请求。

## U02 派发判断

派发 U02。

原因：

- 用户诉求已经超过“总量统计准确”，更接近请求级可追踪。
- 本地日志中已有 request/turn usage 事件可读。
- 当前 Dashboard 没有请求日志 Tab。
- 只要严格不读取正文，隐私风险可控。

U02 不应与 R02 同时开工，因为两者都可能修改 `dashboard/src/lib/api.ts` 和 `dashboard/src/content/copy.csv`。建议 R02 完成后再让 U02 开工。
