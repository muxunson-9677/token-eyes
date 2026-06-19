# TE-MVP-UI-02 - Token Eyes 概览页内容重组

## 给 Claude Code 的执行说明

你是本工单执行者。只执行本文件描述的任务,不要继续 full-plan 其它功能。完成后推送本工单分支,不要合并 main。

## 仓库与分支

- 仓库: `https://github.com/muxunson-9677/token-eyes`
- 基准分支: `codex-token-tracker-baseline`
- 建议等待 `TE-MVP-UI-01` 合并到基准后再开始,避免外壳文案冲突。
- 新建分支: `claude/te-mvp-ui-02-dashboard-content`

开始前执行:

```bash
git fetch origin
git switch codex-token-tracker-baseline
git pull --ff-only
git switch -c claude/te-mvp-ui-02-dashboard-content
```

## 背景

当前 `/dashboard` 仍是 Token Tracker 的用量看板,包含排行榜、Menu Bar App 推广和原产品表达。Token Eyes MVP 需要让负责人一眼看出这是“多 Agent token / 花费 / 缓存命中 / 套餐占位”的最小版本。

本工单只重组 Dashboard 页面内容,不改解析器和后端统计逻辑。

## 目标

把 `/dashboard` 调整为 Token Eyes MVP 概览页:

第一屏应表达:

- 产品名: `Token Eyes`
- 页面标题: `本地 AI 用量概览`
- 关键数字:
  - 总 Token
  - 估算成本 `USD / CNY`
  - 缓存命中率
  - 对话数
- Agent 分布:
  - Codex
  - Claude Code
  - Hermes 如有数据则显示,无数据显示 `暂无数据`
- 每日明细表保留,但文案改成 Token Eyes 语义。

应隐藏或删除:

- 排名/Leaderboard 语义
- `Try the Menu Bar App`
- `ultrathink`
- `Clawd companion`
- Star / GitHub Star 推广

## 预计修改文件

优先查看并修改:

- `dashboard/src/pages/DashboardPage.jsx`
- `dashboard/src/ui/dashboard/views/DashboardView.jsx`
- `dashboard/src/ui/dashboard/components/UsageOverview.jsx`
- `dashboard/src/lib/cache-hit.ts`
- `dashboard/src/lib/currency.ts`
- `dashboard/src/content/copy.csv`

可新增测试:

- `dashboard/src/pages/DashboardPage.test.jsx`
- 或扩展已有 dashboard 组件测试

不要修改:

- `src/lib/rollout.js`
- `src/commands/sync.js`
- `src/lib/local-api.js`
- `.env`

## 实现要求

1. 不引入新的图表库。
2. 不新增云端依赖。
3. 不新增登录流程。
4. 缓存命中率继续使用已有 `cache-hit.ts` 计算。
5. 金额继续使用固定汇率 `USD/CNY = 7.2`。
6. 没有数据时给中文空状态,不要显示 Token Tracker mock/排行榜语义。

## 验收标准

手动验收:

- 打开 `/dashboard`,第一屏能看出是 `Token Eyes`。
- 第一屏不出现 Token Tracker 推广语。
- 能看到 `总 Token`、`USD / CNY`、`缓存命中率`、`对话数`。
- 每日明细还可滚动查看。

自动验证:

```bash
npm.cmd --prefix dashboard run typecheck
npm.cmd run dashboard:build
npm.cmd --prefix dashboard run test -- currency.test.ts cache-hit.test.ts
```

如新增测试,补跑对应测试文件。

## 完成后提交

```bash
git status --short
git add dashboard/src/pages/DashboardPage.jsx dashboard/src/ui/dashboard/views/DashboardView.jsx dashboard/src/ui/dashboard/components/UsageOverview.jsx dashboard/src/content/copy.csv dashboard/src/pages/DashboardPage.test.jsx
git commit -m "feat: reshape dashboard for token eyes mvp"
git push -u origin claude/te-mvp-ui-02-dashboard-content
```

只 stage 实际修改过的文件。最后回复:

- 分支名
- 提交 SHA
- 页面变化摘要
- 验证命令与结果
- 未完成或风险
