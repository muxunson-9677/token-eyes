# 02 - 发布门禁与完整测试修复

## 中文简述
本工单修复上线前的发布证据问题。当前局部功能测试有通过项，但完整后端测试、完整前端测试和发布 workflow 都不满足放行标准。上线验收不能只看局部通过，必须把发布链路和完整测试恢复到可信状态。

## 第一性原理执行规则
- 发布验收的目标不是“证明这次改动看起来能跑”，而是“用户拿到的 npm、桌面包和本地运行版本都来自同一套可验证代码”。
- `src/` 或 `dashboard/` 变更会影响 npm、macOS、Windows/Tauri 桌面壳，发布链路缺失就是上线阻塞。
- 完整测试失败不能被口头归类为历史问题；必须逐项证明与本轮无关，或修复到通过。
- 先恢复发布 workflow 和测试基线，再谈最终验收。

## 缺漏证据
| 编号 | 缺漏 | 当前证据 |
|---|---|---|
| E1 | 发布 workflow 缺失 | `.github/workflows` 当前不存在，只有 `.github/ISSUE_TEMPLATE`、`CODEOWNERS`、`dependabot.yml` 等非 workflow 文件 |
| E2 | 后端完整测试失败 | `_acceptance_npm_test_latest.log` 中失败项约 279 条，workflow 缺失引用 45 次，`sqlite3 ENOENT` 引用 56 次 |
| E3 | 前端完整测试失败 | `_acceptance_dashboard_test_latest.log` 显示 `8 failed | 62 passed`、`16` 个失败测试、`1` 个 worker 异常 |
| E4 | 有已废弃功能测试仍阻塞 | `ActivityHeatmap3D` 测试失败，但用户已明确不需要热力图；应删除、隔离或改成正确的无热力图验收 |
| E5 | 旧审查记录不可信 | 旧审查记录把完整测试失败判定为不阻塞，但没有给出可发布级证据 |

## 涉及文件
- `.github/workflows/release-dmg.yml`
- `.github/workflows/release-windows.yml`
- `.github/workflows/npm-publish.yml`
- `test/npm-publish-workflow.test.js`
- 与 release workflow 相关的测试文件
- `test/zed-parser.test.js`
- `test/zed-goose-reset-cursor.test.js`
- `test/validate-retros.test.js`
- `dashboard/src/App.navigation-preload.test.jsx`
- `dashboard/src/hooks/use-usage-data.account-resolving.test.tsx`
- `dashboard/src/pages/LeaderboardPage.test.jsx`
- `dashboard/src/pages/ResetPasswordPage.test.jsx`
- `dashboard/src/components/settings/TokenPlanSection.collapsible.test.jsx`
- `dashboard/src/ui/dashboard/components/UsageLimitsPanel.test.jsx`
- `dashboard/src/ui/dashboard/components/__tests__/ActivityHeatmap3D.test.jsx`
- `dashboard/src/ui/dashboard/components/__tests__/StatsPanel.test.jsx`

## 必须完成
### 1. 恢复发布 workflow
验收标准：
- `.github/workflows/release-dmg.yml` 存在。
- `.github/workflows/release-windows.yml` 存在。
- `.github/workflows/npm-publish.yml` 存在。
- workflow 语义必须符合项目发布约束：
  - macOS + Windows 是同一个发布流。
  - `release-dmg.yml` 可手动触发，并调用 Windows reusable workflow。
  - release 先创建 draft，两个平台都上传成功后再发布。
  - npm 发布 workflow 使用 package version，不得半发布。
- 不要凭空写一个看似存在但不能被测试识别的空 workflow；必须让现有 workflow 测试通过。

执行建议：
- 优先从 git 历史恢复最近可用版本，再按当前项目说明修正。
- 不要把密钥、token、证书内容写进仓库。

### 2. 修复后端完整测试
验收标准：
- `npm test` 通过。
- 如果某些测试确实需要外部二进制或平台环境，必须用项目内可维护方式处理，例如：
  - 提供测试依赖检测和清晰 skip 条件。
  - 使用项目 dev dependency 替代系统命令。
  - 调整测试让 Windows 环境可复现。
- 不允许简单删除有业务价值的失败测试。
- `test/validate-retros.test.js` 的索引失败必须修复或给出明确文档依据。

必须分类记录：
- 本轮相关失败。
- 发布阻塞失败。
- 环境依赖失败。
- 历史无关失败。
- 已修复失败。

### 3. 修复前端完整测试
验收标准：
- `npm --prefix dashboard run test` 通过。
- `ActivityHeatmap3D` 如果已不是产品需求，应从页面和验收范围中移除；对应测试要删除、调整或改成“不出现热力图”的回归测试。
- `ResetPasswordPage`、导航 preload、account resolving、Leaderboard、StatsPanel、UsageLimitsPanel 等失败不能被忽略。
- worker 异常必须消除，不能只看失败断言数量。

### 4. 保持已通过的关键局部能力
验收标准：
- 请求日志分页仍然通过：page 1/page 2 各 10 条、总数和页数正确、记录不同。
- `01` 修复后的项目真实路径和项目成本仍然通过。
- 成本显示不回退成未定价 `$0`。

## 必跑命令
```powershell
git diff --check
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm --prefix dashboard run typecheck
npm --prefix dashboard run lint
npm --prefix dashboard run build
cargo check
npm test
npm --prefix dashboard run test
```

## 发布 workflow 验收
```powershell
Test-Path .github/workflows/release-dmg.yml
Test-Path .github/workflows/release-windows.yml
Test-Path .github/workflows/npm-publish.yml
node --test test/npm-publish-workflow.test.js
```

必须记录：
- 三个 workflow 文件是否存在。
- workflow 测试是否通过。
- 如果恢复自 git 历史，记录来源 commit 或恢复依据。

## 运行时回归验收
启动服务：
```powershell
node bin/tracker.js serve --port 17680 --no-open --no-sync
```

检查接口：
```text
/functions/tokentracker-project-usage-summary
/functions/tokentracker-request-usage-records?page=1&pageSize=10&limit=5000
/functions/tokentracker-request-usage-records?page=2&pageSize=10&limit=5000
/functions/tokentracker-api-billing-accounts
```

必须记录：
- 项目路径和项目成本仍然满足 `01` 验收。
- 请求日志分页仍然满足 10 条/页且 page 1、page 2 不同。
- API 计费未连接状态不冒充真实账单。

## 完成报告模板
```text
工单：02-发布门禁与完整测试修复
结论：通过 / 不通过

修复内容：
1. ...

缺漏证据与修复对照：
E1：...
E2：...
E3：...
E4：...
E5：...

完整测试结果：
1. npm test：...
2. npm --prefix dashboard run test：...

发布 workflow 证据：
1. release-dmg.yml：...
2. release-windows.yml：...
3. npm-publish.yml：...

剩余风险：
1. ...
```

工单执行完成的最后增加一个审查环节，以对抗性审查的方式回写审查记录，如果出现问题就修复，修复执行完的环节依旧是对抗性审查，直到都完成了才能结束，并汇报给我工单的完成情况
