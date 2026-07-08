# 01 - 真实项目路径与项目成本数据契约修复

## 中文简述
本工单修复用户最核心的真实数据需求：在项目用量里能看到不同真实项目分别消耗了多少 Token、花了多少钱，并且能区分本地真实路径与远程仓库 URL。当前项目接口能返回项目名和 Token，但真实路径为空、项目成本全为 0，因此不能验收。

## 第一性原理执行规则
- 用户要解决的问题不是“页面有项目列表”，而是“我能直观看到本机真实项目分别消耗多少 Token、花了多少钱”。
- 本地真实路径、远程仓库 URL、项目名是三种不同信息，不能互相冒充。
- 成本为 `0` 和“未定价/无法计算”是不同语义，必须在 API 和 UI 里分开表达。
- 修复要从数据源头开始：解析层写入正确字段，聚合层正确计算，UI 层只展示可信字段。
- 先写失败证据，再做最小修复，最后用 API、测试、页面三类证据复核。

## 缺漏证据
| 编号 | 缺漏 | 当前证据 |
|---|---|---|
| E1 | 项目真实路径缺失 | 本地 API 探针返回 `project_count=5`、`project_path_nonempty=0`、`project_path_kinds=unknown:5` |
| E2 | 项目成本全为 0 | 本地 API 探针返回 `project_nonzero_cost=0`，5 个项目 `cost_usd` 都是 `"0"` |
| E3 | 成本聚合代码有确定性 bug | `src/lib/local-api.js` 中 `computeRowCost(row, pricingOptions)` 返回数字，却被当成 `rowCost?.cost_usd` 对象读取 |
| E4 | 本地路径在解析层没有进入项目摘要 | `src/lib/rollout.js` 的项目上下文返回 `projectRef/projectKey/status`，没有把 `repoRoot` 或 `project_path` 传给项目队列 |
| E5 | 现有测试锁定旧行为 | `test/rollout-parser.test.js` 当前只断言远程 `project_ref`，没有断言本地真实路径 |

## 涉及文件
- `src/lib/rollout.js`
- `src/lib/local-api.js`
- `src/lib/project-path.js`
- `src/lib/pricing/index.js`
- `dashboard/src/ui/dashboard/components/ProjectUsagePanel.jsx`
- `dashboard/src/content/copy.csv`
- `test/rollout-parser.test.js`
- `test/project-path.test.js`
- `test/truthful-metrics-contract.test.js`
- `test/usage-caliber-consistency.test.js`
- `dashboard/src/ui/dashboard/components/__tests__/ProjectUsagePanel.test.jsx`

## 必须完成
### 1. 修复项目真实路径数据源
验收标准：
- 从 `turn_context cwd`、`session_meta cwd` 或等价本地上下文解析出的仓库根目录必须能进入项目队列或项目摘要。
- API 返回字段必须至少包含：
  - `project_path`：真实本地路径；没有检测到时为空或 `null`。
  - `path_kind`：`windows`、`wsl`、`posix`、`unknown` 等明确枚举。
  - `project_ref`：远程仓库 URL；不能冒充本地路径。
  - `path_status` 或等价字段：`detected` / `not_detected`。
- 如果历史日志没有 `cwd`，不能伪造路径，必须显示“未检测到真实路径”。

必须新增或修正测试：
- 构造带本地 `cwd` 的 rollout 测试，断言 `project_path` 非空并指向临时 repo 根目录。
- 构造只有远程 URL、无本地路径的测试，断言 `project_path` 为空但 `project_ref` 正确。
- 构造 WSL/Windows 路径规范化测试，断言 `path_kind` 正确。

### 2. 修复项目成本聚合
验收标准：
- `tokentracker-project-usage-summary` 的项目成本必须使用与其他使用统计一致的定价口径。
- `computeRowCost(row, pricingOptions)` 返回数字时，直接累加该数字；如果需要 `pricing_coverage`，使用 `computeRowCostDetailed` 或等价详细函数。
- 项目摘要必须能表达：
  - `cost_usd`
  - `priced_tokens`
  - `unpriced_tokens`
  - `pricing_coverage`
- 未定价不能显示成真实 `$0`。
- 已定价但确实 0 成本的记录，要能说明是“已定价且成本为 0”，不能和未定价混淆。

必须新增或修正测试：
- 构造有输入/输出 token 且模型可定价的项目行，断言项目 `cost_usd > 0`。
- 构造未定价模型，断言 `pricing_coverage="unpriced"` 且 UI 不展示为真实 `$0`。
- 构造缓存命中导致成本为 0 的已定价记录，断言 `pricing_coverage="complete"` 且 UI 语义正确。

### 3. 修复项目用量 UI 展示
验收标准：
- 项目卡片或表格必须同时支持展示项目名、真实路径、远程仓库。
- 有真实路径时，路径要能被用户直观看到；没有真实路径时，显示“未检测到真实路径”。
- 成本列要区分真实金额、未定价、无法计算。
- 不引入热力图；用户已明确不需要热力图。
- 所有新增中文/英文文案必须进入 `dashboard/src/content/copy.csv`，不能硬编码。

## 必跑命令
```powershell
node --test test/rollout-parser.test.js test/project-path.test.js test/truthful-metrics-contract.test.js test/usage-caliber-consistency.test.js
npm --prefix dashboard run test -- src/ui/dashboard/components/__tests__/ProjectUsagePanel.test.jsx
npm run validate:copy
npm --prefix dashboard run typecheck
npm --prefix dashboard run lint
```

## 运行时 API 验收
启动服务：
```powershell
node bin/tracker.js serve --port 17680 --no-open --no-sync
```

检查接口：
```text
http://127.0.0.1:17680/functions/tokentracker-project-usage-summary
```

必须记录：
- 项目总数。
- `project_path` 非空数量。
- `path_kind` 分布。
- `cost_usd > 0` 的项目数量。
- `pricing_coverage` 分布。
- 至少 3 条项目样例，包含项目名、真实路径状态、远程仓库、Token、成本。

## 完成报告模板
```text
工单：01-真实项目路径与项目成本数据契约修复
结论：通过 / 不通过

修复内容：
1. ...

缺漏证据与修复对照：
E1：...
E2：...
E3：...
E4：...
E5：...

命令证据：
1. 命令：...
   结果：...

API 证据：
1. 接口：...
   结果摘要：...

UI 证据：
1. 页面：...
   截图：...
   结论：...

剩余风险：
1. ...
```

工单执行完成的最后增加一个审查环节，以对抗性审查的方式回写审查记录，如果出现问题就修复，修复执行完的环节依旧是对抗性审查，直到都完成了才能结束，并汇报给我工单的完成情况
