# [MVP] 00 - Codex 状态与后续事项

## 任务ID

`V2.1-00`

## 负责人

Codex

## 状态

V2.1 标注范围已执行完成。按用户要求,现在停止在 V2.1 范围内,不继续执行 full-plan 剩余任务,等待用户确认下一步方向。

## 已完成

- 三份源计划文档已放入 `docs/`:
  - `docs/token-eyes-dev-plan-v2.md`
  - `docs/token-eyes-full-plan-for-codex.md`
  - `docs/token-eyes-v2.1-mvp-plan.md`
- V2.1 本地工单已创建在 `docs/tasks/v2.1/`,执行者统一改为 Claude Code。
- 已创建并更新 `docs/feishu-setup.md`,记录飞书初始化结果和后续使用纪律。
- 已创建 `docs/dev-notes/v2.1-mvp-interfaces.md`,作为 V2.1 工单输入规范。
- 已在 `codex-token-tracker-baseline` 分支上把旧 CC Switch/Tauri 壳替换为 TokenTracker 基座。
- 当前基座为 `tokentracker-cli@0.54.0`,根依赖和 dashboard 依赖均已安装。
- 已完成 V2.1 范围内任务:
  - `V2.1-01` 解析器基线与真实数据审计。
  - `V2.1-05` 数据目录覆盖配置。
  - `V2.1-07` Agent 默认计费。
  - `V2.1-09` 固定 USD/CNY 汇率展示。
  - `V2.1-10` 缓存命中率卡片。
  - `V2.1-12` Token Plan 手动占位。
  - `V2.1-15` 手动花销记录。
  - `V2.1-16` 隐藏非 MVP 入口。
  - `V2.1-17` 基本联调测试与报告。
- 每个任务的中文报告已放入 `docs/test-reports/v2.1/`。
- 飞书 MVP 初始化已完成,并已按用户要求重建为进度跟进表:
  - 凭证已写入本地 `.env`,不提交。
  - 已验证 tenant access token 鉴权。
  - 已创建 `Token Eyes 进度表`。
  - 已创建 `V2.1工单` 表。
  - 已写入并删除测试记录,验证新增/删除权限。
  - 已按 A-H 模块、A01/A02/B01 格式写入 32 条进度记录。
  - 已区分 `Codex任务`、`Claude Code任务`、`人工确认`、`Codex+人工`。
  - 状态口径已改为 `待分派` / `已分派` / `执行中` / `待审核` / `已审核` / `打回` / `阻塞`。
  - 当前统计: `已审核` 15 条、`待分派` 14 条、`执行中` 1 条、`待审核` 1 条、`阻塞` 1 条。

## 验证结果

已通过:

```bash
node --test test\data-directories.test.js test\local-settings-api.test.js test\pricing.test.js test\token-plans-api.test.js test\spend-records-api.test.js test\app-route-pathname-guard.test.js
```

结果: 50 个 Node 定向测试通过。

```bash
npm.cmd --prefix dashboard run test -- AgentPricingSection.test.jsx DataDirectoriesSection.test.jsx TokenPlanSection.test.jsx SpendPage.test.jsx currency.test.ts cache-hit.test.ts
```

结果: 6 个测试文件、26 个 dashboard 定向测试通过。

```bash
npm.cmd --prefix dashboard run typecheck
npm.cmd run dashboard:build
git diff --check
```

结果: 均通过。`dashboard:build` 只有 Vite chunk / dynamic import 提示。

已做真实运行检查:

- `node bin\tracker.js sync` 在提升权限后通过,解析 80 个文件,上传因无 device token 跳过。
- `node bin\tracker.js serve --no-sync` 启动后访问 `http://127.0.0.1:7681/` 返回 HTTP 200。测试后已停止后台 job。

## 未通过或待后续处理

- `npm.cmd test` 全量测试未通过。主要原因是当前 Windows/沙箱环境限制和上游测试依赖:
  - 写入 `C:\Users\admin\.tokentracker\tracker\*.json` 或 `sync.lock` 时 EPERM。
  - 当前环境缺少 `sqlite3` CLI,多个历史解析测试报 `spawnSync sqlite3 ENOENT`。
  - symlink 创建受权限限制。
  - retrospective index 测试存在上游文档索引缺口。
- 飞书授权已提供,本轮已完成 MVP 工单表初始化和模块化进度表重建。
- 飞书表所有权转移仍待处理: 当前所有者是应用机器人,需要用户提供飞书 `open_id` / `user_id` / `union_id` / 邮箱之一。
- 真实 WSL UNC 路径端到端读取未验证,当前机器 `\\wsl.localhost` / `\\wsl$` 不可访问。
- Dashboard 未做截图级视觉验收;本轮覆盖到组件测试、typecheck、build 和 HTTP 200。
- 本轮未提交、未推送、未创建 PR。

## 下一步建议

1. 用户先在本地打开 Dashboard,确认 V2.1 体验方向: Dashboard、Spend、Settings 三个入口是否符合预期。
2. 用户确认后,再继续执行 full-plan 剩余任务;在确认前 Codex 不继续扩展完整版。
3. 若要合并到 GitHub,下一步由 Codex 整理一次可审查 diff,然后按用户确认执行提交、推送和 PR。
