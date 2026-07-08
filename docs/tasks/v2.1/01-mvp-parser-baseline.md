# [MVP] 01 - 验证 TokenTracker 解析器基线

## 任务ID

`V2.1-01`

## 对应 full-plan

full-plan #1。

## 执行方

Claude Code

## 分支名

`feature/01-mvp-parser-baseline`

## 所属模块

解析器基线验证。

## 目标文件

- 读取: `src/lib/rollout.js`
- 读取: `src/commands/sync.js`
- 读取: `src/lib/local-api.js`
- 测试: `test/rollout-parser.test.js`
- 新建: `docs/dev-notes/baseline.md`
- 新建: `docs/test-reports/v2.1/01-parser-baseline.md`

## 背景说明

V2.1 是否成立,取决于 TokenTracker 能否在这台 Windows + WSL 机器上读到真实 Claude Code、Codex、Hermes Agent 本地日志。本任务以验证和报告为主。除非已经是 TokenTracker 基座,且有失败测试证明某个小行为缺失,否则不要修改解析器。

## 已确定输入规范

使用 `docs/dev-notes/v2.1-mvp-interfaces.md`。

TokenTracker 相关行为:

- Codex sessions 来自 `${CODEX_HOME || HOME/.codex}/sessions` 和 `archived_sessions`。
- Claude Code project logs 来自 `${HOME}/.claude/projects`。
- Hermes Agent state 来自 `${TOKENTRACKER_HERMES_HOME || HOME/.hermes}/state.db` 以及 `profiles/*/state.db`。
- Queue row 必须包含 `source`、`model`、`input_tokens`、`output_tokens`、`cached_input_tokens`、`cache_creation_input_tokens`、`reasoning_output_tokens`、`total_tokens`、`hour_start`。

## 具体步骤

1. 先执行 `docs/tasks/v2.1/README.md` 中的基座预检。
2. 如果基座不匹配,停止,并把 `BASELINE_MISMATCH` 写入 `docs/test-reports/v2.1/01-parser-baseline.md`。
3. 如果已经是 TokenTracker 基座,运行:

```bash
npm test
node bin/tracker.js sync
```

4. 检查 `~/.tokentracker/tracker/queue.jsonl`,确认是否存在以下来源:
   - `source: "codex"`
   - `source: "claude"`
   - `source: "hermes"`
5. 对 Hermes 单独记录:现有数据是否能区分 DeepSeek API 和小米 MiMo Token Plan。如果不能区分,说明 V2.1 是否仍可先按单一 `hermes` 来源展示。
6. 把结论写入 `docs/dev-notes/baseline.md`。
7. 把执行命令和结果写入 `docs/test-reports/v2.1/01-parser-baseline.md`。

## 验收标准

- 报告明确说明三类来源是否都产生了真实 row。
- 每个来源至少给出一条脱敏后的 row 结构示例,不得包含 prompt 或消息正文。
- 报告明确说明 Hermes DeepSeek/MiMo 是否可区分。
- 如果某个来源没有数据,报告要写清检查过的路径,以及路径是缺失还是不可读。

## 禁止事项

- 不收集、不粘贴、不提交 prompt 或消息正文。
- 本任务不新增 provider 功能。
- 没有先写失败测试,不得改变解析器行为。
