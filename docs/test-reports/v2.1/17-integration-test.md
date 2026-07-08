# V2.1-17 基本联调测试报告

日期: 2026-06-19
分支: `codex-token-tracker-baseline`
Commit SHA: 未提交,当前为工作区改动。

## 环境

- Windows / PowerShell
- Node: 当前仓库可执行 `node` 环境
- TokenTracker 基座: `tokentracker-cli@0.54.0`
- Dashboard: Vite build
- 飞书授权: 已提供,已完成 MVP 工单表初始化和 V2.1 工单同步

## 执行命令与结果

```bash
node --test test\data-directories.test.js test\local-settings-api.test.js test\pricing.test.js test\token-plans-api.test.js test\spend-records-api.test.js test\app-route-pathname-guard.test.js
```

结果: 通过。50 个 Node 定向测试全部通过。

```bash
npm.cmd --prefix dashboard run test -- AgentPricingSection.test.jsx DataDirectoriesSection.test.jsx TokenPlanSection.test.jsx SpendPage.test.jsx currency.test.ts cache-hit.test.ts
```

结果: 通过。6 个测试文件、26 个测试全部通过。

```bash
npm.cmd --prefix dashboard run typecheck
```

结果: 通过。

```bash
npm.cmd run dashboard:build
```

结果: 通过。Vite 输出 chunk 大小和动态导入提示,不影响退出码。

```bash
npm.cmd test
```

结果: 失败。失败项仍主要来自当前 Windows/沙箱/上游环境限制:

- 多个测试写入 `C:\Users\admin\.tokentracker\tracker\*.json` 或 `sync.lock` 时 EPERM。
- 多个 Zed/Goose/Hermes/Kiro 类测试需要 `sqlite3` CLI,当前环境 `spawnSync sqlite3 ENOENT`。
- 一个 usage-limits 测试创建 symlink 时 EPERM。
- retrospective index 测试有上游文档索引缺口。

这些不是本轮 V2.1 新增功能的定向测试失败。

```bash
node bin\tracker.js sync
```

首次在沙箱内失败: `EPERM` 写入 `C:\Users\admin\.tokentracker\tracker\sync.lock`。
提升权限重跑后通过:

```text
Sync finished:
- Parsed files: 80
- New 30-min buckets queued: 0
- Uploaded: skipped (no device token)
```

```bash
node bin\tracker.js serve --no-sync
```

通过后台 job 启动后访问 `http://127.0.0.1:7681/`,返回 HTTP 200。日志显示 7680 被占用后自动使用 7681。另有 refresh 警告: `EPERM unlink C:\Users\admin\.tokentracker\tracker\app\src\cli.js`,但 Dashboard 页面可访问。

```bash
git diff --check
```

结果: 通过。仅有基座替换相关 CRLF 提示。

## 手动/功能检查结果

- Dashboard 构建可用,serve 返回 HTML。
- Dashboard 成本摘要已改为 USD/CNY 双币展示。
- 缓存命中率卡片由 summary totals 计算。
- Settings 页面包含数据目录覆盖、Agent 默认计费、Token Plan 手动占位。
- Spend 页面可新增手动花销记录,并显示 USD/CNY 汇总。
- Sidebar 只保留 Dashboard、Spend、Settings。
- 真实 WSL UNC 端到端读取未验证: 当前机器 `\\wsl.localhost` / `\\wsl$` 不可访问。
- Claude/Hermes 真实 token 数据依赖本机真实记录; V2.1-01 报告已记录 Claude 当前样本没有 token usage、Hermes DB 为空。

## 已知缺口

- 飞书 MVP 初始化已完成: tenant access token 鉴权通过,已创建 `Token Eyes 进度表` 和 `V2.1工单` 表,测试记录新增/删除通过,已同步 10 条 V2.1 工单记录。
- 完整 `npm test` 需要解决 Windows 用户目录写入隔离、sqlite3 CLI、symlink 权限和上游 retrospective 索引问题。
- Dashboard 没有做浏览器截图级视觉验收;本轮使用组件测试、typecheck、build 和 HTTP 200 验证。
- 本轮未提交、未推送、未创建 PR。
