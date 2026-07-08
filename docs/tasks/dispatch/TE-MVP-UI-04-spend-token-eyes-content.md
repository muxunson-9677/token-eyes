# TE-MVP-UI-04 - Token Eyes 支出页 MVP 化

## 给 Claude Code 的执行说明

你是本工单执行者。只执行本文件描述的任务,不要继续 full-plan 其它功能。完成后推送本工单分支,不要合并 main。

## 仓库与分支

- 仓库: `https://github.com/muxunson-9677/token-eyes`
- 基准分支: `codex-token-tracker-baseline`
- 可与 `TE-MVP-UI-03` 并行,但如果 `TE-MVP-UI-01` 已合并,请先基于最新基准。
- 新建分支: `claude/te-mvp-ui-04-spend-content`

开始前执行:

```bash
git fetch origin
git switch codex-token-tracker-baseline
git pull --ff-only
git switch -c claude/te-mvp-ui-04-spend-content
```

## 背景

V2.1 已有手动花销记录 API 和 Spend 页面。现在需要把它做成 Token Eyes MVP 语义,让用户知道这是“实际支出记录”,不是 Token Tracker 原页面。

## 目标

把 `/spend` 调整为 Token Eyes MVP 支出页:

- 页面标题: `支出记录`
- 说明: `手动记录 Codex / Claude Code / Hermes 的实际订阅或充值支出,用于和估算成本对照。`
- 表单字段:
  - Agent
  - 套餐/用途
  - 金额
  - 币种 USD/CNY
  - 日期
  - 备注
- 汇总:
  - USD 合计
  - CNY 合计
  - 固定汇率说明: `1 USD = 7.2 CNY`
- 列表:
  - 最近记录
  - 支持删除

## 预计修改文件

优先查看并修改:

- `dashboard/src/pages/SpendPage.jsx`
- `dashboard/src/pages/SpendPage.test.jsx`
- `dashboard/src/lib/api.ts`
- `dashboard/src/lib/currency.ts`
- `dashboard/src/content/copy.csv`

不要修改:

- `src/lib/local-api.js`,除非发现字段无法满足现有 UI。若必须改,说明原因并补 Node 测试。
- `.env`
- `.github/workflows/*`

## 实现要求

1. 不新增自动拉账单能力。
2. 不接入飞书。
3. 不新增复杂周期逻辑。
4. 保持本地记录能力。
5. 日期字段如果当前 API 没有单独日期,可以继续使用 `created_at`,不要扩大后端模型。

## 验收标准

手动验收:

- 打开 `/spend`。
- 能新增一条 Codex 或 Claude Code 支出。
- 新增后 USD/CNY 汇总更新。
- 能删除记录。
- 页面不出现 Token Tracker 原推广内容。

自动验证:

```bash
npm.cmd --prefix dashboard run test -- SpendPage.test.jsx currency.test.ts
npm.cmd --prefix dashboard run typecheck
npm.cmd run dashboard:build
```

如果修改了后端 API,还必须跑:

```bash
node --test test/spend-records-api.test.js
```

## 完成后提交

```bash
git status --short
git add dashboard/src/pages/SpendPage.jsx dashboard/src/pages/SpendPage.test.jsx dashboard/src/lib/api.ts dashboard/src/lib/currency.ts dashboard/src/content/copy.csv test/spend-records-api.test.js src/lib/local-api.js
git commit -m "feat: refine spend page for token eyes mvp"
git push -u origin claude/te-mvp-ui-04-spend-content
```

只 stage 实际修改过的文件。最后回复:

- 分支名
- 提交 SHA
- 支出页变化摘要
- 验证命令与结果
- 未完成或风险
