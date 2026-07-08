# TE-NEXT W03E-R3 Subagent Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 W03E-R3A 之后的剩余工作拆成可独立派发、可阻塞退出、可逐级验收的长任务，并明确共享工作区下的串并行边界。

**Architecture:** 主上下文只负责调度、直接读取文件、复跑验证和决定是否放行下一阶段；每份长任务交给一个全新的 subagent。官方同步主链为 R3B → R3C → R3D，R3E 作为独立 UI 清理任务在 R3D 前完成，飞书同步完全独立。

**Tech Stack:** Tauri 2 / Rust、Node.js 20 CommonJS、React 18 + Vite + TypeScript、Node Test Runner、Vitest、飞书开放平台多维表格 API。

---

## 1. 给主调度者的结论

不要把 R3B、R3C、R3D、R3E 全部塞给同一个长期 subagent。推荐做法是：

1. 主上下文保存全局目标、依赖图和验收结果。
2. 每个长任务启动一个全新 subagent，只给它对应工单全文。
3. subagent 返回后，主上下文必须直接读取实际文件和 `git diff`，不能只信总结。
4. 主上下文复跑工单指定的关键测试；通过后才派发依赖它的下一任务。
5. 串行链中的下一任务使用新 subagent，以已落盘文件作为上下文，不依赖上一 subagent 的聊天记忆。

理由：一个 subagent 连续承担全部主链会积累大量无关上下文，容易把 BLOCKED 当 READY、越过文件边界或在后期忘记早期安全约束。新 subagent 配合文件化契约更容易审计。

## 2. 当前仓库事实

- 仓库当前是脏工作区，已有大量未提交修改和未跟踪文件。
- `dashboard/src/components/settings/TokenPlanSection.jsx`、`dashboard/src/lib/api.ts`、`src/lib/token-plan-refresh.js`、`src/lib/local-api.js`、`src-tauri/` 均存在当前工作成果。
- 所有 subagent 必须保留这些修改；禁止执行 `git reset --hard`、`git checkout -- <path>`、`git clean` 或任何批量回滚。
- 不要默认创建独立 worktree：当前关键成果尚未提交，新 worktree 默认看不到这些工作区修改。只有主调度者先形成明确基线提交或补丁后，才考虑 worktree 隔离。
- subagent 默认不得提交。禁止 `git add -A` 和 `git commit -am`。如主调度者明确要求提交，只能逐个暂存本工单实际修改的文件。

## 3. 依赖关系

```text
已完成：W03E-R3A（结论 BLOCKED）

W03E-R3B 会话能力/真实证据解阻 ──READY──▶ W03E-R3C 官方 quota adapter ──▶ W03E-R3D UI + E2E 验收
             │
             └──BLOCKED──▶ 停止 R3C、R3D；不得伪实现

W03E-R3E legacy cookie_scrape UI 收口 ───────────────────────────────▶ R3D 开始前必须完成

PM-FEISHU-01 飞书同步 ── 与代码链路无依赖，可独立执行
```

必须串行：

- R3B → R3C：没有真实登录态证据和可执行会话边界，不得实现 adapter。
- R3C → R3D：UI 只能消费已经稳定且有测试的返回契约。
- R3E → R3D：两者都可能修改 `TokenPlanSection.jsx`、测试和 `copy.csv`，禁止并行编辑。

允许并行：

- R3B、R3E、PM-FEISHU-01 可组成第一批并行任务。
- 前提是严格遵守文件边界：R3B 不改 dashboard，R3E 不改 `src/`/`src-tauri/`，飞书任务不改本地代码。
- 如果无法保证边界，退化为串行执行，不要冒险并行。

## 4. 推荐批次

### 批次 1：三个独立 subagent 并行

| Subagent | 工单 | 允许写入 | 完成判定 |
|---|---|---|---|
| A | `TE-NEXT-W03E-R3B-xiaomi-mimo-session-evidence-unblock.md` | `src-tauri/`、契约文档、脱敏 fixture | `READY` 或证据充分的 `BLOCKED` |
| B | `TE-NEXT-W03E-R3E-remove-legacy-cookie-scrape-entry.md` | Token Plan UI、对应测试、`copy.csv` | 测试通过且 UI 不再暴露旧入口 |
| C | `TE-NEXT-PM-FEISHU-01-progress-sync.md` | 外部飞书表；默认不写本地文件 | 写入后读回一致 |

批次 1 结束后，主上下文执行：

```powershell
git status --short
git diff -- src-tauri dashboard/src/components/settings/TokenPlanSection.jsx dashboard/src/components/settings/TokenPlanSection.test.jsx dashboard/src/content/copy.csv docs/dev-notes
```

逐文件确认没有跨工单改动。然后复跑 R3B、R3E 各自的关键测试。

### Gate 1：R3B 是否 READY

只有同时满足以下条件才放行 R3C：

- 契约文档最终结论明确写为 `READY`。
- 证据来自真实小米控制台登录态，不是社区文章、源码猜测或 mock。
- 契约记录了真实 endpoint、method、请求形状、响应字段和状态码。
- 明确认证数据如何留在原会话中，未导出 Cookie/token。
- 明确 `quota_fetch_owner` 和 Token Eyes 内部可调用边界。
- 有脱敏 fixture 或等价的可复现契约测试。

任一项缺失，R3B 必须保持 `BLOCKED`，主链停止。R3E 和飞书同步的完成不受影响。

### 批次 2：单独派发 R3C

把 `TE-NEXT-W03E-R3C-xiaomi-mimo-official-quota-adapter.md` 全文交给一个新的 subagent。

R3C 不应与其他修改 `src/lib/token-plan-refresh.js` 或 `src/lib/local-api.js` 的任务并行。完成后主上下文必须检查：

- adapter 没有读取或持久化 Cookie。
- 401/403 映射为 `reauth_required`。
- 返回结构漂移不会覆盖旧额度。
- `custom_api` 和 scheduler 回归测试通过。

### 批次 3：单独派发 R3D

R3C 和 R3E 都完成并通过验收后，把 `TE-NEXT-W03E-R3D-xiaomi-mimo-live-sync-ui-acceptance.md` 交给一个新的 subagent。

R3D 是集成工单，不与任何 dashboard UI 任务并行。它负责最终状态展示、真实桌面链路和测试报告，不负责重新设计 adapter。

## 5. 如果只能使用一个 subagent

每次仍然建议新开 subagent，不要在同一个聊天上下文连续做完所有任务。顺序如下：

1. R3B：先判定关键路径是否可继续。
2. R3E：即使 R3B 阻塞，旧入口也可以独立收口。
3. PM-FEISHU-01：同步真实状态。
4. 只有 R3B READY 时才执行 R3C。
5. 只有 R3C 和 R3E 都通过时才执行 R3D。

## 6. 每次派发时主上下文附加的固定前言

将下面文字与目标工单全文一起发送：

```text
你只执行这一份工单，不扩展范围，不接着做后续工单。
当前是共享且脏的工作区；已有修改都属于用户或其他已完成任务。
禁止 reset、checkout、clean、批量格式化和回滚他人改动。
开始前先读取 CLAUDE.md、工单必读文件和 git status --short。
测试优先：先写或确认失败测试，再做最小实现。
如果前置门禁不成立，停止写代码并按 BLOCKED 模板返回。
默认不提交；返回实际修改文件、验证命令、结果和剩余风险。
```

## 7. 主上下文验收清单

- [ ] 直接读取 subagent 声称修改的所有文件。
- [ ] 运行 `git status --short`，核对没有删除或覆盖既有文件。
- [ ] 使用限定路径的 `git diff -- <paths>`，确认每一行都可追溯到当前工单。
- [ ] 复跑工单的最小测试集，不只接受 subagent 的测试摘要。
- [ ] 检查测试是否真的覆盖失败分支，而不是只跑旧测试。
- [ ] 搜索 prompt、Cookie、Authorization、Bearer、API key、session id 等敏感内容。
- [ ] UI 文案全部来自 `dashboard/src/content/copy.csv`。
- [ ] BLOCKED 工单没有偷偷留下半成品生产路径。
- [ ] READY 工单的契约、实现和测试字段一致。
- [ ] 决定下一工单前更新本依赖图对应状态。

## 8. 统一回报格式

每个 subagent 最终必须按以下结构返回：

```markdown
## 结果
- 工单：
- 结论：READY / BLOCKED / COMPLETED
- 一句话结论：

## 实际修改
- 文件：
- 修改原因：

## 验证
- 命令：
- 结果：

## 安全与边界
- 是否输出或保存敏感值：否
- 是否修改工单外文件：否；如是，逐项解释
- 是否执行提交：否；如是，给出 commit hash

## 下一步
- 可派发的后续工单：
- 尚未满足的门禁：
```

## 9. 六份文件索引

1. `docs/tasks/dispatch/TE-NEXT-W03E-R3-subagent-execution-map.md`
2. `docs/tasks/dispatch/TE-NEXT-W03E-R3B-xiaomi-mimo-session-evidence-unblock.md`
3. `docs/tasks/dispatch/TE-NEXT-W03E-R3C-xiaomi-mimo-official-quota-adapter.md`
4. `docs/tasks/dispatch/TE-NEXT-W03E-R3D-xiaomi-mimo-live-sync-ui-acceptance.md`
5. `docs/tasks/dispatch/TE-NEXT-W03E-R3E-remove-legacy-cookie-scrape-entry.md`
6. `docs/tasks/dispatch/TE-NEXT-PM-FEISHU-01-progress-sync.md`
