# Token Eyes V2.1 MVP 工单集

这些工单来自 `docs/token-eyes-v2.1-mvp-plan.md`,具体任务描述按 `docs/token-eyes-full-plan-for-codex.md` 的编号补全。

实现执行方: `Claude Code`。

## 当前 Codex 状态

- 三份计划文档已经放入 `docs/`。
- V2 计划文档里的工单执行者已经从 Hermes 改为 Claude Code。
- 飞书 MVP 初始化已完成: 已创建 `Token Eyes 进度表` / `V2.1工单` 表,并同步本轮 10 条工单记录。
- 当前工作区已经在 `codex-token-tracker-baseline` 分支迁移为 TokenTracker 基座。
- 当前 package 名称应为 `tokentracker-cli`。
- 基座已完成依赖安装、dashboard 构建、dashboard typecheck、CLI `-h` 烟测。
- 完整 `npm test` 在当前 Windows 沙箱仍有环境阻塞,详见 `docs/dev-notes/baseline.md`。

## 每个 Claude Code 工单必须先做的预检

编辑实现代码前,先确认工作区仍然是 TokenTracker 基座:

```bash
node -e "const p=require('./package.json'); console.log(p.name)"
test -f src/lib/rollout.js
test -f src/lib/local-api.js
test -f dashboard/src/App.jsx
```

期望 package 名称: `tokentracker-cli`。

如果 package 名称是 `cc-switch`,或 TokenTracker 必需文件不存在,立即停止并报告:

```text
BASELINE_MISMATCH: workspace has not been migrated to TokenTracker baseline.
```

没有人类负责人明确批准前,不要回到 CC Switch/Tauri 壳上实现 V2.1 功能。

## 工单列表

- `01-mvp-parser-baseline.md` — full-plan #1
- `05-mvp-path-overrides.md` — full-plan #4/#5
- `07-mvp-agent-pricing.md` — full-plan #6/#7,简化版
- `09-mvp-usd-cny.md` — full-plan #8/#9,简化版
- `10-mvp-cache-hit-card.md` — full-plan #10
- `12-mvp-token-plan-placeholder.md` — full-plan #12 的 V2.1 占位版
- `15-mvp-spend-records.md` — full-plan #14/#15,简化版
- `16-mvp-hide-unrelated-entrypoints.md` — full-plan #16
- `17-mvp-integration-test.md` — full-plan #17

Claude Code 返回 PR/结果后,full-plan #18 由 Codex 审核。
