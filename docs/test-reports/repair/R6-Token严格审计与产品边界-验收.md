# R6 Token 严格审计、README 与产品边界验收

- 日期：2026-07-26
- 分支：`codex/token-eyes-fixes`
- 基线 HEAD：`d4b7bee439754b40b554ee2b7f848537f6b57014`

## 执行审计

- 开始提交：`d4b7bee439754b40b554ee2b7f848537f6b57014`。
- 结束提交：`d4b7bee439754b40b554ee2b7f848537f6b57014`；本轮未创建提交，完成状态保留在 working-tree diff。
- 修改文件：
  - `README.md`
  - `scripts/audit-token-correctness.cjs`
  - `src/lib/rollout.js`
  - `test/token-audit.test.js`
  - `test/rollout-parser.test.js`
  - `test/release-windows-workflow.test.js`
  - `test/fixtures/token-audit/*.jsonl`
  - 本验收报告
- 新增/发现的回归：初次实现遗漏同 bucket 不同事件、将 synthetic event 混入生产 queue golden、未覆盖等值快照/correction/schema/原型输入、Codex reasoning 总量与生产 writer 未对齐；修正 Token 契约后有 6 个旧 parser 断言短暂失败。上述问题均已用新反例和 165/165 parser 回归关闭；当前无已知 R6 新回归。
- 未决项：R6 范围内无未决代码项。严格模式按纪律只对脱敏 fixture 运行，未读取真实 HOME 队列；真实凭据、macOS 和桌面 GUI 限制归 R7 环境验收记录。
- 回滚方式：不得整体 checkout/reset 这个已有用户改动的脏工作区。以开始提交和 R0 备份引用 `refs/codex-backups/repair-preflight-20260726` 只读对照，逐 hunk 反向撤销上列 R6 文件中的本轮改动；仅在确认无人复用时移除 R6 新增 fixture/报告，随后重跑 token-audit、rollout-parser、release-windows 和 `ci:local`。

## 结论

R6 阶段门通过。

严格审计只读取显式 `--input` 的脱敏 fixture，不读取真实 HOME 队列。生产 `queue.jsonl` 按累计 bucket snapshot 审计；只有显式 `record_kind: "event"` 的原始事件 fixture 才按稳定事件 ID 审计。正确 fixture 全部通过，重复事件、等值重复快照、未标记回退、分项不等、负数、非安全整数、schema 错误和 malformed JSON 均使 strict 模式非零退出。

本地 API golden 对比使用生产形态的 snapshot-only queue fixture，并由测试独立实现 latest-snapshot 重算，没有复用审计脚本的选择函数。真实 Codex parser 和 queue writer 对同一脱敏日志连续运行两次，第二次 `eventsAggregated = 0`、`bucketsQueued = 0`，队列文本和 API 总量均不增长。

## Token 契约

持久化队列继续遵守：

```text
total_tokens = input_tokens + output_tokens + cached_input_tokens
             + cache_creation_input_tokens + reasoning_output_tokens
```

Codex/Every Code 的供应商原始 input 包含 cache read，parser 会先拆成纯非缓存 input 和 cached input；即使供应商把 reasoning 当作 output 的信息子集，持久化 `total_tokens` 仍按以上列加和重算。真实 parser 回归用 `input=1000, cache=950, output=10, reasoning=4` 验证队列结果为 `50 + 950 + 10 + 4 = 1014`。

审计采用两类不同 key：

- bucket snapshot key：`source | model | hour_start`。生产 reader/latest-wins 与审计使用相同 bucket 定义。
- stable event key：`source | event_id/request_id/message_id/record_id | value`。仅用于显式原始事件 fixture；事件缺少稳定 ID 会使 strict 失败。

快照规则：

- 同 bucket 单调增长是允许的增量快照，聚合保留最后一条；
- 完全相同的重复快照属于幂等性错误，strict 失败；
- 普通未标记快照发生回退时 strict 失败；
- writer 产生的合法归零/模型对齐修正显式写入 `record_kind: "bucket_snapshot"`、`snapshot_kind: "correction"`，审计允许该回退并保留最后一条；
- 普通 writer 快照标记为 `snapshot_kind: "cumulative"`。

所有 Token 字段必须是安全整数；负数另行计数并失败。行必须是 plain object，且 `source`、`model`、`hour_start`、record/snapshot kind 和 `conversation_count` 通过严格 schema 校验。source 聚合使用无原型对象，`__proto__` 等输入不能吞行或污染 `Object.prototype`。

## 脱敏 fixture 与自动测试

`test/fixtures/token-audit/` 包含：

- 正确：`normal.jsonl`、`allowed-snapshot.jsonl`、`correction-snapshot.jsonl`、`same-bucket-events.jsonl`、`large-integer.jsonl`、`queue.jsonl`；
- 错误：`duplicate-event.jsonl`、`duplicate-snapshot.jsonl`、`parts-mismatch.jsonl`、`negative.jsonl`、`malformed.jsonl`、`unsafe-integer.jsonl`、`invalid-schema.jsonl`。

`test/token-audit.test.js` 共 19 项，覆盖：

- snapshot key / stable event key 分离；
- 五项 Token 精确不变量；
- 增量快照、等值重复快照、显式 correction；
- 同 bucket 不同事件全部计数、相同稳定 ID 重复失败；
- malformed、负数、非安全整数、schema 和原型安全；
- large safe integer 精确计算；
- strict 必须显式提供 fixture；
- 独立 raw golden 与本地 API 六个 Token 字段逐项相等；
- 真实 Codex parser reasoning 规范化；
- 真实 parser + writer 连续同步两次幂等；
- README registry 和产品边界契约。

生产形态 `queue.jsonl` fixture 的 latest snapshot golden 总量为 `9,000,000,000,000,195` Token。本地 API 的 `total/input/output/cache read/cache write/reasoning` 六字段逐项与独立重算相等，不接受 Token 容差。

## README 与架构边界

README 数量由测试与 `shared/provider-capabilities.json` 交叉校验：

- 35 个 capability provider；
- 26 个 token collector；
- 13 个 registry-declared official rate-limit provider。

README 已明确区分当前可见、MVP-hidden、可选云能力、legacy shells 和可能访问网络的功能；不再声称可见 Dashboard 含已移除 heatmap，不再用 composite-key/exact billing 过度承诺去重结果。

Windows 下载说明与当前发布 workflow 一致：用户进入 `releases/latest`，选择 Tauri `.msi` 或 `*-setup.exe`（NSIS）；不再链接不存在的固定 `TokenTracker-Setup.exe`，也不再声称当前 workflow 生成 portable zip。

## 验证证据

| 命令/检查 | 结果 |
|---|---|
| `node --test test/token-audit.test.js` | 19/19 通过 |
| strict 正确 fixture 矩阵 | 6/6 exit 0 |
| strict 错误 fixture 矩阵 | 7/7 exit 1 |
| `node --test test/rollout-parser.test.js` | 165/165 通过 |
| `node --test test/release-windows-workflow.test.js` | 28/28 通过 |
| `node --test test/local-api-legacy-codex-schema.test.js` | 3/3 通过 |
| `node --test test/pricing.test.js test/model-breakdown.test.js` | 71/71 通过 |
| `node --test test/sync-codex-rescan-repair.test.js` | 5/5 通过 |
| fresh `npm run ci:local`（独立复审） | exit 0 |
| writer correction metadata 手工复核（独立复审） | 通过 |
| `git diff --check` | 通过，仅工作区 EOL 提示 |

未读取真实 Token 队列，也未写入真实 HOME。独立 R6 复审结论为 Ready。
