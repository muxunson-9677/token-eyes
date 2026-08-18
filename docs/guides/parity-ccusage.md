# ccusage 数据一致性对比脚本使用指南

`scripts/parity-ccusage.mjs` 用第三方 `ccusage` CLI 作为独立参照, 校验 Token Eyes 自有解析器的数据准确性 (W4 数据准确性工单)。

## 它做什么

脚本把同一份本地 AI CLI 日志读两遍, 然后逐日逐模型对比:

1. **Token Eyes 侧**: 直接调用 `src/lib/rollout.js` 里的增量解析器 (`parseClaudeIncremental` / `parseRolloutIncremental`), 与真实 `tracker sync` 相同的解析路径。目录解析也复用 `src/lib/data-directories.js` (尊重 `CODEX_HOME` 环境变量、Windows 上的 `<盘符>:\AgentData\Codex` 迁移目录等)。解析使用一次性的内存 cursor 状态, 队列文件写入仓库内的 `.parity-tmp/` 临时目录, **绝不触碰 `~/.tokentracker` 的真实状态**。
2. **ccusage 侧**: 运行 `npx ccusage daily --json --timezone UTC` (Claude Code) 与 `npx ccusage codex daily --json --timezone UTC` (Codex), 带多级降级: 版本不支持 `--timezone` 时回退到普通调用, `ccusage` 不可用时报告标记 "待真机数据" 并照常退出 0。

输出:

- Markdown 报告: `docs/reports/parity-ccusage-<yyyy-mm-dd>.md`
- stdout 摘要 (两个来源的总量与结论)

## 怎么运行

```bash
node scripts/parity-ccusage.mjs
```

要求: Node >= 20, 可访问 npm registry (首次运行需要下载 ccusage)。脚本总是以退出码 0 结束 — 即使 ccusage 不可用或本机没有日志, 也会生成一份标记 "待真机数据" 的报告。

## 怎么读报告

- **总结表**: 每个来源 (Claude Code / Codex) 的两侧总 tokens、相对差、结论。结论取值:
  - `PASS (±0.5% 以内)` — 总量一致;
  - `FAIL (超出 ±0.5%)` — 总量超阈值, 需要看逐行明细定位;
  - `无数据 (两侧均为 0) — 待真机数据` / `待真机数据` — 本机没有可对比的数据。
- **逐日逐模型表**: 每行一个 (UTC 日期, 模型), 带绝对差、相对差和标记:
  - `OK` — 该行在 ±0.5% 以内;
  - `DIFF` — 超阈值;
  - `SIDE-ONLY` — 只有一侧有该行 (常见于模型命名差异, 见报告末尾的"已知差异类别")。
- **逐行一致率**: `N/M 行在 ±0.5% 以内`, 快速判断差异是普遍性的还是集中在个别天。
- **Token Eyes 额外覆盖**: ccusage 只读 `$CODEX_HOME` 一个目录, 而真实 sync 会扫描所有 tracking-ready 的 codex home; 超出 ccusage 视野的目录单列, 不参与 parity 判定。

定位差异时先看报告末尾的"已知差异类别"——模型归因 (如 `codex-auto-review`)、`unknown` 模型行、`archived_sessions/` 扫描范围、fork/resume 重放 dedup、时区分桶, 大多数 DIFF/SIDE-ONLY 行都能归入这五类。

## 隐私说明

脚本只聚合 token 计数: 对 `~/.claude` / `~/.codex` (及 `CODEX_HOME` 指向的目录) 的访问是只读的, 解析器只提取 usage 字段, **不读取、不落盘任何提示词或对话内容**。报告中出现的只有日期、模型名和 token 数。临时目录 `.parity-tmp/` 在脚本结束时自动删除。
