# TE-NEXT Dispatch Matrix - 2026-06-22

## 当前结论

当前可以同时派给 3 个 Claude Code,分别独立开分支执行:

1. Claude Code #1: `P02 - Spend时间序列后端接口`
   - 工单: `docs/tasks/dispatch/TE-NEXT-P02-spend-timeseries-api.md`
   - 建议分支: `claude/te-next-p02-spend-timeseries-api`
   - 前置: `P01` 已有规范 `docs/dev-notes/spend-chart-api-spec.md`
   - 注意: 只做 endpoint 和 API client,不做 P03 图表。

2. Claude Code #2: `S02 - Dashboard动态刷新实现`
   - 工单: `docs/tasks/dispatch/TE-NEXT-S02-dashboard-auto-refresh.md`
   - 建议分支: `claude/te-next-s02-dashboard-auto-refresh`
   - 前置: `S01` 已有规范 `docs/dev-notes/dashboard-refresh-spec.md`
   - 注意: 只做刷新控件和 local settings,不做 Spend 折线图。

3. Claude Code #3: `T02 - 适配器注册机制代码化`
   - 工单: `docs/tasks/dispatch/TE-NEXT-T02-adapter-registry.md`
   - 建议分支: `claude/te-next-t02-adapter-registry`
   - 前置: `T01` 已有规范 `docs/dev-notes/agent-adapter-spec.md`
   - 注意: 只建 registry/metadata/test,不拆 `rollout.js`,不迁移 parser 执行流。

## 必须串行的任务

- `P01 -> P02 -> P03`
  - P03 依赖 P02 的真实 endpoint、client 函数和测试结果。
- `Q01 -> Q02`
  - Q02 必须等 Q01 明确 billing_mode 字段来源、展示位置和筛选口径。
- `R01 -> R02`
  - R02 必须等 R01 完成 Codex 5小时/周额度窗口数据结构判断。
- `T01 -> T02`
  - T01 已完成后,T02 可进入本轮并行派发。
- `U01 -> U02`
  - U02 只有在 U01 评估结论为“需要新增请求级视图”时才派发。
- `V01`
  - 人工本机验证任务,不阻塞 P/S/T 开发,但阻塞 Windows WebView2 文件夹选择器最终验收。

## 可以并行的任务

- 本轮 Wave 1: `P02 + S02 + T02` 可并行。
- `V01` 可由用户本机并行处理。
- P02 和 S02 都可能触碰 `dashboard/src/lib/api.ts`,但改动点不同。合并时需要 Codex 做一次冲突和行为审核。
- T02 主要涉及 adapter registry、metadata 和测试,不应触碰 Spend/Dashboard 刷新逻辑。

## 暂不派发

- `P03`: 等 P02 已审核后再派,避免前端图表按未落地接口做偏。
- `Q01/Q02`: 等 P03 后再推进,符合 blueprint 的优先级。
- `R01/R02`: 等 Q/S 主线更稳定后推进。
- `U01/U02`: 放最后;U02 是条件任务。

## Feishu 状态同步目标

- `P01`: 已审核。
- `P02`: 已分派。
- `S01`: 已审核。
- `S02`: 已分派。
- `T01`: 已审核。
- `T02`: 已分派。
- `V01`: 阻塞,阻塞原因改为 Tauri Windows baseline + WebView2 手动验证,不要安装无关 SDK。
- `A05`: 执行中,进度说明指向本派单矩阵。