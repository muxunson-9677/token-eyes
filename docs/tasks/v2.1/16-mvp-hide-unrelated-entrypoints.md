# [MVP] 16 - 隐藏无关产品入口

## 任务ID

`V2.1-16`

## 对应 full-plan

full-plan #16。

## 执行方

Claude Code

## 分支名

`feature/16-mvp-hide-entrypoints`

## 所属模块

导航和路由收口。

## 目标文件

- 修改: `dashboard/src/App.jsx`
- 修改: `dashboard/src/ui/components/Sidebar.jsx`
- 修改: `dashboard/src/content/copy.csv`
- 测试: `test/app-route-pathname-guard.test.js`
- 测试: 新增或更新 Dashboard 导航测试
- 新建: `docs/test-reports/v2.1/16-hide-entrypoints.md`

## 背景说明

Token Eyes MVP 只应该暴露 Dashboard、Spend、Settings。TokenTracker 原有 Skills、Leaderboard、Widgets、Limits、Login/account、公开分享/社交等产品面不应该作为正常用户入口出现。

## 已确定输入规范

使用 `docs/dev-notes/v2.1-mvp-interfaces.md` 的“MVP 需要隐藏/移除的入口”章节。

## 具体步骤

1. 先执行 `docs/tasks/v2.1/README.md` 中的基座预检。
2. 先写失败测试,证明被隐藏路由不会出现在 sidebar/nav 中。
3. 移除无关导航项。
4. 确保 `/dashboard`、`/spend`、`/settings` 仍然可访问。
5. 处理隐藏路由:
   - MVP 优先重定向到 `/dashboard`。
   - 除非测试需要,不要删除页面文件。
6. 运行:

```bash
npm test
npm --prefix dashboard run build
```

7. 把验证证据写入 `docs/test-reports/v2.1/16-hide-entrypoints.md`。

## 验收标准

- 侧边栏只显示 Dashboard、Spend、Settings。
- Skills 和 Leaderboard 不作为可见入口出现。
- Login/account 提示不阻断本地 MVP 使用。
- build 通过。

## 禁止事项

- 不删除 Hermes/Codex/Claude 的 parser 支持。
- 不为了缩小 diff 删除无关源码文件。
- 本任务不做营销页或 landing hero。
