# TE-MVP-UI-01 - Token Eyes MVP 外壳与导航替换

## 给 Claude Code 的执行说明

你是本工单执行者。只执行本文件描述的任务,不要继续 full-plan 其它功能。完成后推送本工单分支,不要合并 main。

## 仓库与分支

- 仓库: `https://github.com/muxunson-9677/token-eyes`
- 基准分支: `codex-token-tracker-baseline`
- 新建分支: `claude/te-mvp-ui-01-brand-shell`
- 禁止直接提交到 `main`

开始前执行:

```bash
git fetch origin
git switch codex-token-tracker-baseline
git pull --ff-only
git switch -c claude/te-mvp-ui-01-brand-shell
```

## 背景

当前页面能打开,但仍是 Token Tracker 外壳: 左上角用户/Token Tracker 语义、Menu Bar App 推广、Star 按钮、Clawd 相关内容。这不是 Token Eyes MVP 应该给用户看到的第一印象。

本工单只做“外壳和入口”的替换,不改统计逻辑。

## 目标

把可见产品外壳从 Token Tracker 调整为 Token Eyes MVP:

- 页面标题、品牌名、侧边栏语义改为 Token Eyes。
- 左侧导航只保留三个入口:
  - `概览` -> `/dashboard`
  - `支出` -> `/spend`
  - `设置` -> `/settings`
- 移除或隐藏 Token Tracker 专属推广:
  - `Try the Menu Bar App`
  - `Always-on stats with Clawd companion`
  - `Download`
  - `Star`
  - Clawd / ultrathink 推广视觉
- 不新增 full-plan 后续入口。

## 预计修改文件

优先查看并修改:

- `dashboard/src/ui/components/Sidebar.jsx`
- `dashboard/src/ui/dashboard/components/UsageOverview.jsx`
- `dashboard/src/pages/DashboardPage.jsx`
- `dashboard/src/content/copy.csv`
- `test/app-route-pathname-guard.test.js`

如需要,可修改:

- `dashboard/src/App.jsx`
- `dashboard/index.html`

不要修改:

- `src/lib/rollout.js`
- `src/lib/local-api.js`
- 任何飞书凭证或 `.env`
- `.github/workflows/*`

## 实现要求

1. 保持路由不变: `/dashboard`、`/spend`、`/settings`。
2. 不新增登录、云同步、排行榜、推广入口。
3. 可见文案用中文,但代码命名保持英文。
4. 保留现有响应式布局,不要大改 UI 框架。
5. 如果需要新增 copy key,放入 `dashboard/src/content/copy.csv`。
6. 不要改统计数据来源。

## 验收标准

手动验收:

- 打开 `http://127.0.0.1:7681/dashboard`。
- 第一屏不能出现 `Token Tracker`、`Try the Menu Bar App`、`Clawd`、`Star`、`Download`。
- 左侧导航只显示 `概览`、`支出`、`设置`。
- `/dashboard`、`/spend`、`/settings` 能正常打开。

自动验证:

```bash
node --test test/app-route-pathname-guard.test.js
npm.cmd --prefix dashboard run typecheck
npm.cmd run dashboard:build
```

如果改了组件测试相关内容,补跑:

```bash
npm.cmd --prefix dashboard run test -- AgentPricingSection.test.jsx DataDirectoriesSection.test.jsx TokenPlanSection.test.jsx SpendPage.test.jsx currency.test.ts cache-hit.test.ts
```

## 完成后提交

```bash
git status --short
git add dashboard/src/ui/components/Sidebar.jsx dashboard/src/ui/dashboard/components/UsageOverview.jsx dashboard/src/pages/DashboardPage.jsx dashboard/src/content/copy.csv test/app-route-pathname-guard.test.js dashboard/index.html dashboard/src/App.jsx
git commit -m "feat: rebrand mvp shell for token eyes"
git push -u origin claude/te-mvp-ui-01-brand-shell
```

只 stage 实际修改过的文件。最后回复:

- 分支名
- 提交 SHA
- 修改摘要
- 验证命令与结果
- 未完成或风险
