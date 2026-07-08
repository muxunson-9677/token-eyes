# 03 - 独立对抗性验收与最终放行判断

## 中文简述
本工单不是实现工单，而是最终验收工单。它必须在 `01` 和 `02` 都完成后，由全新上下文独立执行。目标是重新验证真实数据、浏览器页面、完整测试、发布 workflow、飞书读回和审查记录，判断是否可以上线体验。

## 第一性原理执行规则
- 审查目标不是证明主线修复子代理做对了，而是找出是否还有会影响用户真实体验和发布可信度的问题。
- 不得直接采信主线完成报告；所有通过结论必须有当前工作区的新鲜命令证据。
- API、UI、测试、发布 workflow、飞书读回必须互相印证。
- 一旦发现 P0/P1 问题，结论必须是不通过，并写回审查记录。
- 不允许把 `project_path` 全空解释为通过；这正是本轮打回的核心证据之一。

## 前置输入
- `docs/tasks/v2.0-release-bayes-fix/README.md`
- `docs/tasks/v2.0-release-bayes-fix/01-data-contract-project-cost.md`
- `docs/tasks/v2.0-release-bayes-fix/02-release-gates-full-tests.md`
- 主线修复子代理对 `01`、`02` 的完成报告。
- 主线产出的测试日志、API 证据、截图、飞书读回记录。

## 必须审查的缺漏项
| 编号 | 审查项 | 不通过条件 |
|---|---|---|
| A1 | 项目真实路径 | `project_path` 仍全空，或用远程 URL 冒充本地路径 |
| A2 | 项目成本 | 项目 `cost_usd` 仍全为 0，或未定价成本显示成真实 `$0` |
| A3 | 请求日志分页 | UI/API 仍只暴露 100 条，或 page 1/page 2 数据相同 |
| A4 | API 计费语义 | 未连接平台账单却显示为已同步真实账单，或订阅成本和 API 成本混淆 |
| A5 | 发布 workflow | `.github/workflows/release-dmg.yml`、`release-windows.yml`、`npm-publish.yml` 任一缺失 |
| A6 | 完整测试 | `npm test` 或 `npm --prefix dashboard run test` 失败，且没有可接受的工程解释 |
| A7 | 浏览器体验 | `/spend`、`/dashboard`、`/settings` 任一核心页面无法完成验收路径 |
| A8 | 飞书读回 | 无本轮 2.0 贝叶斯修复记录，或只读回旧批次记录 |
| A9 | 审查记录 | 没有对抗性审查记录，或审查记录只复述主线自评 |

## 必跑命令
```powershell
git status --short
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

## API 验收
启动本地服务：
```powershell
node bin/tracker.js serve --port 17680 --no-open --no-sync
```

检查接口：
```text
/functions/tokentracker-project-usage-summary
/functions/tokentracker-request-usage-records?page=1&pageSize=10&limit=5000
/functions/tokentracker-request-usage-records?page=2&pageSize=10&limit=5000
/functions/tokentracker-api-billing-accounts
/functions/tokentracker-usage-summary
```

必须记录：
- 项目总数。
- `project_path` 非空数量。
- `path_kind` 分布。
- `cost_usd > 0` 的项目数量。
- `pricing_coverage` 分布。
- page 1/page 2 的前三条时间戳或稳定 ID。
- API 计费账号状态、`monthCostUsd`、`lifetimeCostUsd`。

## 浏览器验收
必须检查：
- `/spend` 使用统计：请求日志、Provider 统计、模型统计、成本展示。
- `/spend` 成本累积：Token 套餐、API 计费、订阅记录。
- `/dashboard` 项目用量：真实路径或“未检测到真实路径”提示、项目 Token、项目成本。
- `/settings` 数据目录：环境检测按钮和状态。

必须产出：
- 截图路径。
- DOM 摘要。
- 控制台错误数量和错误摘要。
- 页面结论。

## 飞书验收
如飞书配置可用，必须写入或读回本轮修复记录：
- `2.0-bayes-fix / 01 / 真实项目路径与项目成本数据契约修复`
- `2.0-bayes-fix / 02 / 发布门禁与完整测试修复`
- `2.0-bayes-fix / 03 / 独立对抗性验收与最终放行判断`

验收标准：
- 写入后必须读回。
- 记录 ID、任务编号、状态、更新时间必须记录。
- 不得输出 App Secret、tenant token、Cookie、API Key。
- 如果飞书鉴权失败，写成“阻塞：飞书鉴权失败”，不能谎称已同步。

## 贝叶斯复算模板
```text
假设 H：当前产品可以上线体验并通过最终验收。
先验 P(H)：__%

正向证据：
1. ...
似然比：...

负向证据：
1. ...
似然比：...

后验 P(H|E)：__%

结论：
可上线体验 / 不可上线体验
```

放行建议：
- `P(H|E) >= 95%` 且无 P0/P1 阻塞：可以上线体验。
- `P(H|E) < 95%` 或存在任一 P0/P1：不可上线体验，必须输出新的最小修复工单。

## 审查记录输出路径
必须新增或更新：
```text
docs/tasks/v2.0-release-bayes-fix/review-records.md
```

记录必须包含：
- 审查日期。
- 审查人角色：独立对抗性审查子代理。
- 每个 A 项的通过/不通过结论。
- 命令证据。
- API 证据。
- 浏览器证据。
- 飞书证据。
- 贝叶斯复算。
- 最终是否放行。

## 完成报告模板
```text
工单：03-独立对抗性验收与最终放行判断
结论：通过 / 不通过

贝叶斯后验：
P(H|E)=__%

阻塞项：
1. ...

可接受风险：
1. ...

命令证据：
1. ...

API 证据：
1. ...

浏览器证据：
1. ...

飞书证据：
1. ...

最终建议：
可以上线体验 / 继续修复
```

工单执行完成的最后增加一个审查环节，以对抗性审查的方式回写审查记录，如果出现问题就修复，修复执行完的环节依旧是对抗性审查，直到都完成了才能结束，并汇报给我工单的完成情况
