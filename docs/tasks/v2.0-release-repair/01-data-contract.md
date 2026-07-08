# 01 - 真实数据与后端契约修复

## 中文简述

本工单只解决数据真实性和后端契约。目标不是“让卡片有数字”，而是保证项目路径、请求日志、请求数、成本、API 计费和 Agent 环境状态都能说明真实来源，并能被前端可靠消费。

## 第一性原理执行规则

- 数字必须来自可追踪的数据源；未知值显示未知，不得用 `0` 冒充。
- 分页必须覆盖全部匹配记录，不能只对已取回的第一页做本地切片。
- API 订阅费用、API 使用成本、Token 套餐是三种不同事实，禁止互相冒充。
- “已就绪”必须证明 Agent 在目标环境可执行，目录存在不等于 Agent 可用。
- 历史数据无法恢复真实路径时必须明确标记未知，禁止猜测路径。
- 先写失败测试，再做最小修复；不重构无关模块。

## 缺漏证据

### 1. 请求日志只取第一页

- 后端支持 `page/pageSize`，默认每页 10 条：`src/lib/local-api.js:4254`。
- 前端 API 没有传 `page/pageSize`：`dashboard/src/lib/api.ts:305`。
- Hook 丢弃后端 `page.total/total_pages`，只合并 `records`：`dashboard/src/hooks/use-request-usage-records.ts:243`。
- 实测后端 Codex 请求共 5000 条、500 页；UI 显示“10 / 10”，没有第 2 页。

### 2. 真实项目路径没有落地

- 项目汇总只在 `project_key/project_ref` 自身像路径时生成 `project_path`：`src/lib/local-api.js:4021`。
- 实测接口返回 5 个项目，但带 `project_path` 的项目数为 0。
- 当前卡片虽然支持复制路径，但真实数据没有路径可复制。

### 3. 请求数与成本被错误显示为 0

- 实测使用汇总有 `conversation_count=6518`，但 `request_count=null`；UI 将空值转成 0。
- 实测请求明细接口有 5000 条记录，但顶部仍显示总请求数 0。
- 使用汇总返回 `pricing_coverage=unpriced`、`unpriced_tokens>0`，UI 仍显示绿色 `$0`，容易被理解为真实零成本。

### 4. API 计费混入订阅记录

- `collectBillingFromSpendRecords()` 明确从订阅/支出记录生成 API 计费账户：`src/lib/api-billing.js:78`。
- `monthCostUsd` 没有按月过滤，代码保留了未完成说明：`src/lib/api-billing.js:109`。
- 结果会把订阅付款同时展示成 API 月成本和累计成本，数据语义错误。

### 5. 环境检测只检查目录

- Windows 和 WSL 的 `ready` 都只依赖 `fs.existsSync(dirPath)`：`src/lib/agent-env-detect.js:26`。
- `latestVersion` 固定为 `undefined`：`src/lib/agent-env-detect.js:169`。
- 实测 Claude、Codex、Cursor、OpenClaw 均显示 Win/ready，但 `currentVersion` 全为空，不能证明 Agent 可执行。

## 修复范围

- `src/lib/local-api.js`
- `src/lib/rollout.js`
- `src/commands/sync.js`
- `src/lib/project-path.js`
- `src/lib/api-billing.js`
- `src/lib/agent-env-detect.js`
- `dashboard/src/lib/api.ts`
- `dashboard/src/hooks/use-request-usage-records.ts`
- 对应后端、API、Hook 测试

除非测试证明必须修改，否则不要改页面布局和视觉样式；这些属于 02。

## 任务 1：建立真正的服务端请求日志分页

1. 先新增失败测试，覆盖 `page=1/pageSize=10` 与 `page=2/pageSize=10` 返回不同记录，并验证 `total`、`total_pages`、`returned_count`。
2. 给 `getRequestUsageRecords()` 和 `useRequestUsageRecords()` 增加 `page`、`pageSize` 参数并保留后端分页元数据。
3. 多 Provider 场景必须由后端在同一个结果集完成过滤、排序和分页，不得分别取每个 Provider 第一页后再拼接。
4. 排序必须发生在分页之前。若保留前端可点击排序列，后端契约必须接收受控的 `sort`、`order` 白名单；否则 02 必须移除误导性的全局排序行为。
5. Hook 返回结构至少包含：`records`、`totals`、`page`、`pageSize`、`total`、`totalPages`、`loading`、`error`、`refresh`。

## 任务 2：建立真实项目路径链路

1. 写失败测试证明 Codex/Claude 记录中的真实 `cwd/project_ref` 能写入项目桶并经汇总 API 返回。
2. Win、`/mnt/c/...`、`\\wsl$\...`、`\\wsl.localhost\...` 必须归一化到稳定项目键，且保留一个可展示的真实路径。
3. 调查现有 rollout/session 元数据能否安全回填历史 `project_ref`。有证据才回填；没有证据时保留空路径和明确 availability，不得按项目名猜路径。
4. 新产生并同步的当前仓库会话必须能返回当前仓库真实路径。
5. 汇总结果继续包含项目名、Token、成本、请求数、最后活动时间和路径类型。

## 任务 3：修正请求数和成本可用性

1. 明确定义 `request_count`：有请求级记录时返回真实请求数；只有聚合桶时返回 `null` 并附 `metric_availability`，不得把 `conversation_count` 静默改名为请求数。
2. `pricing_coverage=unpriced` 时成本必须带明确可用性；不得让调用方把未知成本解释为真实 `$0`。
3. `partial` 时同时返回已定价成本、已定价 Token、未定价 Token；`priced` 时才允许将成本作为完整总成本。
4. 增加一致性测试：请求明细 `page.total` 与请求级 `request_count` 一致；聚合模式下 `request_count` 为 `null`。

## 任务 4：拆开 API 计费和订阅费用

1. 删除“订阅记录金额自动生成 API 计费账户”的逻辑和测试断言。
2. API 使用成本优先来自实际 usage rows 的可计费成本，按 Provider 汇总；账户身份只有在存在可验证映射时才显示。
3. 仅检测到凭据时返回 `status=not-connected` 或等价不可用状态，月成本和累计成本返回 `null`，不得返回伪造金额。
4. 无法访问平台账单 API 时明确返回 `billingSource=usage-estimate` 或项目现有的等价枚举，并在契约中说明这是根据 Token 使用量估算，不是平台账单余额。
5. 月成本必须按请求时间过滤到当前月份；累计成本覆盖全部可用历史，二者必须有跨月测试。

## 任务 5：真正检测 Agent 环境

1. 为每个支持的 Agent 定义受控的可执行命令和版本参数，不拼接用户输入到 shell 字符串。
2. Windows 环境只有在可执行文件存在且版本命令成功时才能返回 `ready`。
3. WSL 环境通过受控的 `wsl.exe -d <distro> -- <agent> --version` 或等价无 shell 注入方式验证；仅 UNC 目录存在不能返回 `ready`。
4. 返回 `environment`、`status`、`currentVersion`、`latestVersion`、`executablePath` 和稳定错误码。无法获取最新版本时返回 `null` 与明确 availability，不伪造版本。
5. 增加空目录、目录存在但无可执行文件、Win 可执行、WSL 可执行、WSL 未启动、命令超时测试。

## 验收标准

- 真实本地 API 有 5000 条记录时，第 1 页和第 2 页均返回 10 条不同记录，`total=5000`。
- 前端 Hook 不再丢弃分页元数据，不再按 Provider 分别截取第一页。
- 当前仓库的新会话经同步后，项目汇总返回非空真实路径；历史未知路径明确标记未知。
- 请求数未知时返回 `null`，不能返回误导性的 0。
- 未定价成本带 `unpriced` 状态，不能被解释成真实 `$0`。
- 新增一条订阅记录不会产生 API 计费金额。
- API 月成本和累计成本通过跨月测试，且来源字段能区分平台账单、usage 估算和不可用。
- Agent 数据目录存在但可执行文件缺失时必须是 `not-detected`；`ready` 时必须有 `currentVersion`。
- 所有新增用户可见错误状态所需文案契约已列出，具体文案由 02 写入 `copy.csv`。

## 验证命令

```powershell
node --test test/request-usage-records-api.test.js test/project-path.test.js test/api-billing-api.test.js test/agent-env-detect.test.js
npm --prefix dashboard run test -- src/hooks/__tests__/use-request-usage-records.test.tsx src/lib/api.test.ts --reporter=verbose
Push-Location dashboard
npx eslint "src/lib/api.ts" "src/hooks/use-request-usage-records.ts" "src/hooks/__tests__/use-request-usage-records.test.tsx"
npm run typecheck
Pop-Location
npm --prefix dashboard run build
```

如果实际测试文件名不同，必须在审查记录中写明替代文件及原因；不能省略对应测试。

## 审查记录模板

```text
审查轮次：
反方问题：
失败证据：
涉及文件：
修复动作：
复查命令：
复查结果：
剩余风险：
最终结论：通过 / 打回
```

工单执行完成的最后增加一个审查环节，以对抗性审查的方式回写审查记录，如果出现问题就修复，修复执行完的环节依旧是对抗性审查，直到都完成了才能结束，并汇报给我工单的完成情况
