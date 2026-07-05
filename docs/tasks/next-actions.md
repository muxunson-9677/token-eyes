# Token Eyes 下一步事项

日期: 2026-06-19
分支: `codex-token-tracker-baseline`

## 当前状态

- V2.1 MVP 已完成并推送到 GitHub 分支 `codex-token-tracker-baseline`。
- 本地预览服务运行在 `http://127.0.0.1:7681/dashboard`。
- 已修复本地预览报错 `Link is not defined`。
- GitHub workflows 暂未恢复: 当前可用 token 缺少 `workflow` 权限。
- full-plan 后续功能暂不执行,等用户确认 MVP 方向后再继续。

## 需要用户确认后由 Codex 执行

1. 确认本地预览可打开并能看到 `Dashboard` / `Spend` / `Settings` 三个入口。
2. 完成 GitHub CLI 登录或提供具备 `workflow` 权限的 token。
3. 恢复 `.github/workflows/*.yml` 并单独提交推送。
4. 创建 PR,PR 标题和说明明确标注这是 V2.1 最小 MVP。

## 可派发工单

### A. MVP 预览验收

状态: 等 Codex 修复预览后再派。当前已修复,用户确认可打开后即可派。

执行方: 任意一个前端/测试 agent。

目标:

- 打开 `http://127.0.0.1:7681/dashboard`。
- 检查侧边栏只出现 `Dashboard` / `Spend` / `Settings`。
- 检查隐藏入口不会出现在侧边栏。
- 不新增功能,只记录问题。

验收输出:

- 一份中文验收报告。
- 如有问题,写清楚页面、复现步骤、预期、实际。

### B. GitHub/CI 恢复验收

状态: 等 GitHub token 具备 `workflow` 权限后再派。

执行方: CI/GitHub agent。

目标:

- 恢复 `.github/workflows/*.yml`。
- 推送 workflow 恢复提交。
- 检查 PR / CI 是否能正常触发。

验收输出:

- workflow 文件恢复清单。
- GitHub Actions 运行链接或失败原因。

### C. 文档与飞书一致性审查

状态: 现在可以派,不依赖预览修复。

执行方: 文档/项目管理 agent。

目标:

- 对照 `docs/tasks/v2.1/`、`docs/test-reports/v2.1/`、`docs/feishu-setup.md`。
- 检查飞书 `V2.1工单` 表是否与本地工单一致。
- 不修改代码。

验收输出:

- 一份中文一致性审查报告。
- 列出缺失、重复、状态不一致项。

### D. UI 体验走查

状态: 等 A 确认页面可正常打开后再派。

执行方: UI/UX agent。

目标:

- 只检查 V2.1 MVP 范围。
- 检查 Dashboard / Spend / Settings 信息是否能看懂、是否有明显遮挡或断裂。
- 不提出 full-plan 后续功能扩展。

验收输出:

- 一份中文 UI 问题清单。
- 每条问题包含页面、截图或位置、影响、建议优先级。

## 并行关系

- `C` 可以现在单独派发。
- `A` 和 `D` 需要在预览可打开后执行;建议先 `A`,再 `D`。
- `B` 必须等 GitHub `workflow` 权限恢复。
- `A` 与 `C` 可并行。
- `B` 与 `D` 可并行,但 `B` 不应阻塞 MVP 体验验收。
