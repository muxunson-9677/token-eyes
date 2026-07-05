# V2.1-16 隐藏无关入口验收报告

日期: 2026-06-19

## 结论

已完成 MVP 导航收口:

- Sidebar 只显示 Dashboard、Spend、Settings。
- `/spend`、`/dashboard`、`/settings` 可访问。
- `/leaderboard`、`/limits`、`/skills`、`/widgets`、`/ip-check`、`/wrapped` 和 `/u/:userId` 等旧产品路由重定向到 `/dashboard`。
- 页面源码文件未删除,避免扩大 diff。
- 登录实现未删除,但不作为 MVP 侧边栏入口。

## 验证

```bash
node --test test\app-route-pathname-guard.test.js
```

结果: 4 个测试通过,覆盖 App 解析、MVP 路由、隐藏路由重定向、Sidebar 三入口。

```bash
npm.cmd run dashboard:build
```

结果: 通过。
