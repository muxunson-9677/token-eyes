# [MVP] 01 - 解析器基线验证报告

更新时间: 2026-06-19

## 结论摘要

- Codex: 已验证可从真实本机日志解析出 token row。
- Claude Code: 当前 Windows 路径下只发现 1 个 `.jsonl` 文件,解析后只有 0-token 的 conversation row,未验证到真实 token 用量 row。
- Hermes Agent: 已找到真实 Windows 安装目录和 `state.db`,但当前库内 `sessions=0`、`messages=0`,没有可解析 token row。
- WSL: `\\wsl.localhost` 和 `\\wsl$` 当前不可见,所以本轮还没验证到 WSL 内 Claude Code/Hermes Agent 日志。
- Hermes DeepSeek/MiMo 细分: 当前无法用真实数据验证。Hermes schema 存在 `billing_provider`、`billing_base_url`、`billing_mode` 字段,但 TokenTracker 当前 queue row 只输出 `source=hermes` 和 `model`,不输出计费线字段。V2.1 可先按单一 `hermes` 来源展示成本;完整版本需要真实 Hermes 数据后再决定是否新增细分字段。

## 基座预检

命令:

```powershell
node -e "const p=require('./package.json'); console.log(p.name); const fs=require('fs'); for (const f of ['src/lib/rollout.js','src/lib/local-api.js','dashboard/src/App.jsx']) console.log(f, fs.existsSync(f));"
```

结果:

```text
tokentracker-cli
src/lib/rollout.js true
src/lib/local-api.js true
dashboard/src/App.jsx true
```

## 真实路径检查

- Codex home: `E:\AgentData\Codex`
- Codex sessions: `E:\AgentData\Codex\sessions`,共发现 66 个 `rollout-*.jsonl`
- Codex archived sessions: `E:\AgentData\Codex\archived_sessions`,当前无文件
- Claude projects: `C:\Users\admin\.claude\projects`,共发现 1 个 `.jsonl`
- Hermes path: `C:\Users\admin\AppData\Local\hermes`
- Hermes DB: `C:\Users\admin\AppData\Local\hermes\state.db`,文件存在
- Hermes profiles: `C:\Users\admin\AppData\Local\hermes\profiles`,不存在
- WSL UNC: `\\wsl.localhost`、`\\wsl$` 当前不可见

## 解析验证方法

没有直接运行 `node bin/tracker.js sync`,原因是该命令会写入用户目录 `C:\Users\admin\.tokentracker\tracker\queue.jsonl`,并可能触发现有 TokenTracker 本地状态变化。本次改为直接调用 TokenTracker 解析器函数,读取真实日志,把脱敏指标 row 写入仓库内临时 queue 后生成观察数据,随后已删除临时 queue。

保留的脱敏观察数据:

- `docs/test-reports/v2.1/01-parser-baseline-data.json`

该 JSON 只包含路径、计数和 token 指标样例,不包含 prompt 或消息正文。

## Codex 结果

解析输入:

- 从 66 个真实 Codex session 文件中选择 8 个较小的近期文件做基线验证。

解析结果:

```json
{
  "filesProcessed": 8,
  "eventsAggregated": 345,
  "bucketsQueued": 21,
  "projectBucketsQueued": 6
}
```

脱敏 row 样例:

```json
{
  "source": "codex",
  "model": "gpt-5.5",
  "hour_start": "2026-06-18T16:00:00.000Z",
  "input_tokens": 337678,
  "cached_input_tokens": 2866944,
  "cache_creation_input_tokens": 0,
  "output_tokens": 25854,
  "reasoning_output_tokens": 6970,
  "total_tokens": 3230476,
  "billable_total_tokens": 3230476,
  "conversation_count": 30
}
```

结论: Codex 解析器可用。

## Claude Code 结果

解析输入:

- `C:\Users\admin\.claude\projects\E--Program-Files-Pencil\8698de83-4f6b-4107-b67a-777cd249fb26.jsonl`

解析结果:

```json
{
  "filesProcessed": 1,
  "eventsAggregated": 0,
  "bucketsQueued": 1,
  "projectBucketsQueued": 0
}
```

脱敏 row 样例:

```json
{
  "source": "claude",
  "model": "unknown",
  "hour_start": "2026-06-17T16:30:00.000Z",
  "input_tokens": 0,
  "cached_input_tokens": 0,
  "cache_creation_input_tokens": 0,
  "output_tokens": 0,
  "reasoning_output_tokens": 0,
  "total_tokens": 0,
  "billable_total_tokens": 0,
  "conversation_count": 1
}
```

结论: 当前可见的 Windows Claude 文件不足以验证真实 token 用量。需要后续提供/开启 WSL Claude Code 日志路径,或在 Claude Code 产生真实 token 记录后复验。

## Hermes Agent 结果

解析输入:

- `C:\Users\admin\AppData\Local\hermes\state.db`

解析结果:

```json
{
  "recordsProcessed": 0,
  "eventsAggregated": 0,
  "bucketsQueued": 0
}
```

只读 schema/聚合检查:

```json
{
  "sessionsCount": 0,
  "sessionsTokenRows": 0,
  "messagesCount": 0,
  "state_metaCount": 0
}
```

结论: 当前 Hermes 数据库为空,不是解析器报错。没有真实 row 时无法验证 DeepSeek API 与小米 MiMo Token Plan 是否可区分。

## 测试记录

已运行:

```powershell
node --test test/rollout-parser.test.js
```

结果:

- 160 个测试
- 143 通过
- 17 失败

失败原因集中在测试夹具调用缺失的 `sqlite3` CLI 创建临时数据库,例如 Hermes/Kiro CLI 相关用例报 `spawnSync sqlite3 ENOENT`。这与前面完整 `npm.cmd test` 的环境阻塞一致,不是 V2.1 代码改动导致的失败。

已通过的基础验证:

```powershell
npm.cmd run dashboard:build
npm.cmd --prefix dashboard run typecheck
node bin/tracker.js -h
```

## 后续判断

1. V2.1 可以进入路径覆盖工单,因为当前关键缺口正是 WSL UNC 路径不可见/未配置。
2. 成本展示在 MVP 阶段按 `codex`、`claude`、`hermes` 三个来源做默认单价即可。
3. Hermes DeepSeek/MiMo 细分先不做,在有真实 Hermes session 数据后复验;如果 queue row 仍只有 `source=hermes`/`model`,完整版本再补 `billing_provider` 或等价字段。
