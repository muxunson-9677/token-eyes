# O3 Environment / Agent Attribution Handoff

- 起始 commit：`b041d5ba02441c150e5cecd93c69ac1c0f9b81b0`
- 结束 commit：未提交（工作区 `codex/token-observability-o3`，TRAE 中断后由 Cursor 接手完成）
- 实现范围：多环境/多 Agent/项目归因的 v2 维度构建、小时 bucket key、归因聚合、未归因估算、队列可选 `dimensions` 写入、Dashboard 共享筛选面板与矩阵。
- 未实现范围：未修改 `src/lib/local-api.js` / `dashboard/src/lib/api.ts` 正式 v2 端点（由 O6/O8 接线 `usage-attribution-handler.js`）；未改 `App.jsx` 导航；内部 hourlyState 仍按 legacy `source|model|hour` 聚合，环境拆分依赖各环境独立写入的 `dimensions`（例如 Windows vs WSL 各自 HOME）。
- 公共契约版本：`token-observability/v2`
- 修改文件：
  - `src/lib/environment-detector.js`
  - `src/lib/usage-dimensions.js`
  - `src/lib/usage-dimension-key.js`
  - `src/lib/usage-attribution.js`
  - `src/lib/queue-usage-snapshot.js`
  - `src/lib/usage-attribution-handler.js`
  - `src/lib/rollout.js`（新队列行附加可选 `dimensions`）
  - `dashboard/src/lib/usage-attribution.ts`
  - `dashboard/src/lib/usage-attribution-from-summary.ts`
  - `dashboard/src/hooks/use-usage-attribution.ts`
  - `dashboard/src/ui/dashboard/components/UsageAttributionMatrix.jsx`
  - `dashboard/src/ui/dashboard/components/UsageAttributionPanel.jsx`
  - `dashboard/src/pages/SpendPage.jsx`
  - `dashboard/src/content/copy.csv`
  - 对应测试与 `test/fixtures/token-observability-v2/attribution-snapshots.json`
- 迁移：无队列重写。旧行继续可读；新行额外携带 `dimensions`。

## 测试命令与结果

- `node --test test/usage-dimensions.test.js test/usage-dimension-key.test.js test/environment-detector.test.js test/usage-attribution.test.js test/queue-usage-snapshot.test.js test/usage-attribution-handler.test.js`：退出码 0，**87** passed
- `npm --prefix dashboard test -- --run src/ui/dashboard/components/__tests__/UsageAttributionMatrix.test.jsx src/ui/dashboard/components/__tests__/UsageAttributionPanel.test.jsx src/hooks/__tests__/use-usage-attribution.test.tsx src/lib/__tests__/usage-attribution-from-summary.test.ts`：退出码 0，**23** passed
- `npm --prefix dashboard run typecheck`：退出码 0
- `npm --prefix dashboard run lint`：退出码 0
- `npm run validate:copy`：退出码 0

## 真实体验证据

- 本机环境探测（脱敏）：`environment_kind: "native"`，`environment_id: "native:desktop-c2b7kt2"`。
- Fixture + 聚合不变量：同小时 native/wsl 不互相覆盖；旧数据进 `unknown`；`Σ groups == total_tokens`（无四舍五入容差）。
- Dashboard：`UsageAttributionPanel` 与矩阵共用同一 filter；Spend Usage 页已挂载，当前用 `getProviderStats` 作为 interim agent 归因源（环境仍为 unknown，直到 O6 接维度快照）。

## 性能、安全与已知限制

- 归因聚合为纯内存分组，不触网。
- `project_key` 本地归一化存储；矩阵展示项目时只显示末级目录名。
- 设备/环境/项目/session 不上传排行榜（本阶段未改排行榜路径）。
- 未归因差值始终 `source_kind: "estimated"`。
- interim UI 尚不能展示真实多环境拆分，需 O6 将 `buildUsageAttributionResponse` 接到本地 API 并返回带 `dimensions` 的快照。

## 下游注意事项与回滚方式

- O5/O6：复用 `mapQueueRowToUsageSnapshot`、`attributeUsage`、`buildUsageAttributionResponse`；不要另建 freshness/confidence 字段。
- O6：在 `local-api.js` 接线 handler，替换 Spend 页的 `snapshotsFromProviderStats` interim 适配。
- 回滚：丢弃本 worktree 未提交改动，或在提交后 `git revert` 对应 commit。
