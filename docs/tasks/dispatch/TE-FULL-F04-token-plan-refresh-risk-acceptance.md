# TE-FULL-F04 - Token Plan 失败报错与 Cookie 风险提示验收

## 给 Claude Code 的执行说明

你负责执行 full plan 的 `F04` 验收。目标是验证 F03 的 Token Plan 自动刷新调度器在失败路径、Cookie 风险提示、凭证引用和并发保护上符合规范。优先做验收和报告; 只有发现明确阻塞 bug 时才做最小修复。

## 基准与分支

必须基于已审核的 F03 返工结果:

- 基准分支: `claude/te-full-f03-token-plan-auto-refresh-scheduler`
- 基准 commit: `01c8ba2`
- 新建分支: `claude/te-full-f04-token-plan-refresh-risk-acceptance`

开始前:

```bash
git fetch origin
git switch -c claude/te-full-f04-token-plan-refresh-risk-acceptance origin/claude/te-full-f03-token-plan-auto-refresh-scheduler
git rev-parse --short HEAD
```

`rev-parse` 应为 `01c8ba2` 或其后续等价提交。

## 验收目标

验证以下 F03 行为真实成立:

1. `manual` refresh 是 no-op success,不安排 `next_refresh_at`。
2. `official_api` 在没有 provider adapter 时写 `last_refresh_status=failed`,并保存可读错误。
3. `cookie_scrape` 不读取任何真实 cookie,只写 failed 和账号风控风险提示。
4. `credential_ref` 只允许 `codex_auth_json` / `claude_credentials_json` / 空字符串,原始 token/cookie 字符串不能落盘。
5. 同一个 plan 的并发 refresh 返回 409。
6. Settings 里能看到失败原因和 Cookie 风险提示,文案不再误导为“后续再做”。

## 允许修改的文件

优先只新增报告:

- `docs/test-reports/full-plan/14-token-plan-refresh-risk-acceptance.md`

只有发现明确阻塞 bug 时,才允许最小修改:

- `src/lib/token-plan-refresh.js`
- `src/lib/local-api.js`
- `dashboard/src/components/settings/TokenPlanSection.jsx`
- `dashboard/src/content/copy.csv`
- `test/token-plan-refresh.test.js`
- `test/token-plans-api.test.js`
- `dashboard/src/components/settings/TokenPlanSection.test.jsx`

不要改 D07、Spend、pricing rules 或云端功能。

## 必做验收

### API/单元验收

运行:

```bash
node --test test/token-plans-api.test.js test/token-plan-refresh.test.js
```

必须确认:

- `manual` 分支返回 success 且 `next_refresh_at=""`。
- `official_api` 无 adapter 分支返回 failed,并写入中文可读错误:
  `不支持自动刷新：缺少官方接口。当前没有可用的 provider quota API，请改为手动录入。`
- `cookie_scrape` 返回 failed,并写入包含 `Cookie 抓取未配置` 和 `账号风控风险` 的错误。
- 并发 refresh 同一 plan 返回 409。

### 凭证安全验收

用脚本或测试确认:

- 保存 `credential_ref: "raw-secret-cookie-token"` 后,本地 config 中实际值必须是空字符串。
- 保存 `credential_ref: "codex_auth_json"` 后保留该引用名。
- 保存 `credential_ref: "claude_credentials_json"` 后保留该引用名。
- 不读取、不保存原始 access token / refresh token / cookie。

### UI 验收

运行:

```bash
npm.cmd --prefix dashboard run test -- TokenPlanSection.test.jsx
```

并检查:

- `settings.token_plan.subtitle` 不再说“自动刷新后续再做”。
- `settings.token_plan.empty` 不再说“手动 Token 套餐记录”。
- “立即刷新”按钮触发 `refreshTokenPlan(id)`。
- 刷新失败时会显示 `last_refresh_error`。

### 常规验证

运行:

```bash
npm.cmd --prefix dashboard run typecheck
npm.cmd run dashboard:build
npm.cmd run validate:copy
npm.cmd run validate:guardrails
```

## 阻塞判定

以下任一项发生,报告写 `BLOCKED` 并做最小修复或说明无法修复原因:

- 原始 token/cookie 被保存到 config。
- `cookie_scrape` 真实读取 cookie 或声称成功。
- `official_api` 无 adapter 时静默成功或没有错误文案。
- 并发同 plan refresh 不返回 409。
- UI 仍显示 F03 已过时文案。

## 报告

创建:

```text
docs/test-reports/full-plan/14-token-plan-refresh-risk-acceptance.md
```

报告包含:

- 分支和 commit SHA
- 是否修改产品代码
- API/单元验收结果
- 凭证安全验收结果
- UI 文案和失败提示验收结果
- 命令结果
- 阻塞/非阻塞问题

## 完成后提交

如果只新增报告:

```bash
git status --short
git add docs/test-reports/full-plan/14-token-plan-refresh-risk-acceptance.md
git commit -m "docs: verify token plan refresh risk handling"
git push -u origin claude/te-full-f04-token-plan-refresh-risk-acceptance
```

如果做了最小修复,把对应测试和代码一并加入 commit,commit message 使用 `fix:`。

最后回复: 分支、commit、测试结果、是否有阻塞、是否修改产品代码。
