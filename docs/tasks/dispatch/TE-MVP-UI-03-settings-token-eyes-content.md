# TE-MVP-UI-03 - Token Eyes 设置页 MVP 化

## 给 Claude Code 的执行说明

你是本工单执行者。只执行本文件描述的任务,不要继续 full-plan 其它功能。完成后推送本工单分支,不要合并 main。

## 仓库与分支

- 仓库: `https://github.com/muxunson-9677/token-eyes`
- 基准分支: `codex-token-tracker-baseline`
- 可与 `TE-MVP-UI-02` 并行,但如果 `TE-MVP-UI-01` 已合并,请先基于最新基准。
- 新建分支: `claude/te-mvp-ui-03-settings-content`

开始前执行:

```bash
git fetch origin
git switch codex-token-tracker-baseline
git pull --ff-only
git switch -c claude/te-mvp-ui-03-settings-content
```

## 背景

V2.1 已实现三个 Settings 能力:

- 数据目录覆盖
- Agent 默认计费
- Token Plan 手动占位

但当前设置页仍可能混有 Token Tracker 原产品语义或不适合 MVP 的模块。Token Eyes MVP 设置页需要只呈现本轮必要配置。

## 目标

把 `/settings` 调整为 Token Eyes MVP 设置页:

只突出:

- 数据目录
  - Codex 数据目录
  - Claude Code 数据目录
  - Hermes 数据目录
- Agent 默认计费
  - Codex
  - Claude Code
  - Hermes
- Token Plan 手动占位
  - 套餐名称
  - 总额度
  - 已用额度
  - 到期时间

隐藏或弱化:

- 云同步
- 账号登录
- 公开排行榜
- 小组件/桌面宠物/推广
- 非 MVP 高级项

## 预计修改文件

优先查看并修改:

- `dashboard/src/pages/SettingsPage.jsx`
- `dashboard/src/components/settings/DataDirectoriesSection.jsx`
- `dashboard/src/components/settings/AgentPricingSection.jsx`
- `dashboard/src/components/settings/TokenPlanSection.jsx`
- `dashboard/src/lib/api.ts`
- `dashboard/src/content/copy.csv`

测试:

- `dashboard/src/components/settings/DataDirectoriesSection.test.jsx`
- `dashboard/src/components/settings/AgentPricingSection.test.jsx`
- `dashboard/src/components/settings/TokenPlanSection.test.jsx`

不要修改:

- `src/lib/local-api.js`,除非发现前端字段与现有 API 不匹配。若必须改,说明原因。
- `.env`
- `.github/workflows/*`

## 实现要求

1. 不新增后端接口。
2. 不把飞书同步做进产品 UI。
3. 所有新增可见文案使用中文。
4. 设置页第一屏应能看到 Token Eyes MVP 配置目的。
5. 保存/加载行为必须保持现有测试通过。

## 验收标准

手动验收:

- 打开 `/settings`。
- 能清楚看到数据目录、Agent 默认计费、Token Plan 三块。
- 不出现与 MVP 无关的 Token Tracker 推广模块。
- 修改任一表单项后保存不报错。

自动验证:

```bash
npm.cmd --prefix dashboard run test -- AgentPricingSection.test.jsx DataDirectoriesSection.test.jsx TokenPlanSection.test.jsx
npm.cmd --prefix dashboard run typecheck
npm.cmd run dashboard:build
```

## 完成后提交

```bash
git status --short
git add dashboard/src/pages/SettingsPage.jsx dashboard/src/components/settings/DataDirectoriesSection.jsx dashboard/src/components/settings/AgentPricingSection.jsx dashboard/src/components/settings/TokenPlanSection.jsx dashboard/src/content/copy.csv dashboard/src/components/settings/*.test.jsx
git commit -m "feat: simplify settings for token eyes mvp"
git push -u origin claude/te-mvp-ui-03-settings-content
```

只 stage 实际修改过的文件。最后回复:

- 分支名
- 提交 SHA
- 设置页变化摘要
- 验证命令与结果
- 未完成或风险
