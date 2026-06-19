# TE-MVP-QA-05 - Token Eyes MVP 预览验收

## 给 Claude Code 的执行说明

你是本工单执行者。本工单只做验收和报告,原则上不改代码。除非发现阻塞级启动问题,否则只写报告。完成后推送本工单分支,不要合并 main。

## 仓库与分支

- 仓库: `https://github.com/muxunson-9677/token-eyes`
- 基准分支: 等 `TE-MVP-UI-01` 到 `TE-MVP-UI-04` 被 Codex 审核合并后的最新基准分支。
- 新建分支: `claude/te-mvp-qa-05-preview-acceptance`

开始前执行:

```bash
git fetch origin
git switch codex-token-tracker-baseline
git pull --ff-only
git switch -c claude/te-mvp-qa-05-preview-acceptance
```

## 背景

本工单用于确认 Token Eyes 最小 MVP 是否已经摆脱 Token Tracker 外壳,并且三个核心入口能用。

## 目标

验收以下页面:

- `/dashboard`
- `/spend`
- `/settings`

只检查 V2.1 MVP 范围,不要提出 full-plan 后续功能需求。

## 验收步骤

1. 安装依赖如已存在可跳过:

```bash
npm.cmd install
npm.cmd --prefix dashboard install
```

2. 构建:

```bash
npm.cmd run dashboard:build
```

3. 启动本地服务:

```bash
node bin/tracker.js serve --no-sync
```

4. 浏览器打开:

```text
http://127.0.0.1:7681/dashboard
http://127.0.0.1:7681/spend
http://127.0.0.1:7681/settings
```

如果 7681 不可用,看终端输出的实际端口。

## 需要检查

- 左侧导航只包含 `概览`、`支出`、`设置`。
- 页面第一屏出现 `Token Eyes` 或明确 Token Eyes MVP 语义。
- 第一屏不出现:
  - `Token Tracker`
  - `Try the Menu Bar App`
  - `Clawd`
  - `ultrathink`
  - `Star`
  - `Leaderboard`
- Dashboard 显示:
  - 总 Token
  - USD/CNY
  - 缓存命中率
  - Agent 分布或空状态
- Spend 可新增和删除手动记录。
- Settings 可看到:
  - 数据目录
  - Agent 默认计费
  - Token Plan 手动占位

## 自动验证

```bash
node --test test/app-route-pathname-guard.test.js test/data-directories.test.js test/local-settings-api.test.js test/pricing.test.js test/token-plans-api.test.js test/spend-records-api.test.js
npm.cmd --prefix dashboard run test -- AgentPricingSection.test.jsx DataDirectoriesSection.test.jsx TokenPlanSection.test.jsx SpendPage.test.jsx currency.test.ts cache-hit.test.ts
npm.cmd --prefix dashboard run typecheck
npm.cmd run dashboard:build
```

不要把全量 `npm.cmd test` 失败直接视为本工单失败;当前仓库已知 Windows/本机环境下有 sqlite3、用户目录写入、symlink 等上游测试环境问题。若运行了全量测试,请单独记录失败类别。

## 报告文件

创建:

```text
docs/test-reports/v2.1/qa-preview-acceptance.md
```

报告必须包含:

- 验收日期
- 分支名和 commit SHA
- 每个页面的结果
- 自动验证命令和结果
- 截图或文字描述
- 阻塞问题清单
- 非阻塞问题清单

## 完成后提交

```bash
git status --short
git add docs/test-reports/v2.1/qa-preview-acceptance.md
git commit -m "test: add token eyes mvp preview acceptance report"
git push -u origin claude/te-mvp-qa-05-preview-acceptance
```

最后回复:

- 分支名
- 提交 SHA
- 验收结论
- 阻塞问题
- 非阻塞问题
