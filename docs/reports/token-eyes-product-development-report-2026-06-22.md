# Token Eyes 产品开发完整报告

生成时间: 2026-06-22
当前结论: Full Plan 产品实现与最终集成验收已完成,等待用户产品预览确认和最终 PR/merge 决策。
当前最终集成分支: `claude/te-full-h04-final-integration-acceptance`
当前最终提交: `15cdb13 fix: expose token plan scheduler hooks on local api handler`

---

## 1. 一句话结论

Token Eyes 当前已经从 V2.1 MVP 走完到 Full Plan 产品候选完成版。产品现在是一个本地优先的 AI token 使用与成本看板,核心目标是统一展示 Windows 本机和 WSL 环境中的 Claude Code、Codex、Hermes 等 Agent 的真实 token 使用、成本、缓存命中、套餐额度和订阅花销。

目前产品侧 Full Plan 范围已经完成并通过最终集成验收。仍未关闭的事项不是核心产品能力本身,而是:

- `A04` 飞书进度表所有权转移: 等用户提供飞书身份标识。
- `A05` 持续工单派发与审核状态维护: 持续协调任务,在最终 PR/merge 决策前保持执行中。
- `C05` Windows WebView2 文件夹选择器手动验证: 旧记录口径已更正：Windows验证前置为Rust工具链 + Node.js + WebView2 Runtime；当前仍需真实Tauri Windows宿主手动验证。

因此当前进度口径如下:

| 口径 | 进度 | 说明 |
|---|---:|---|
| V2.1 MVP | 100% | 已完成并经用户确认方向。 |
| Full Plan 产品实现与集成验收 | 100% | `H04` 已审核,最终集成分支通过全量验收。 |
| 飞书全项目表 | 32/35,约 91% | 剩余 2 个阻塞项 + 1 个持续协调项。 |

---

## 2. 产品定位

Token Eyes 不是模型切换器、不是 AI 聊天客户端、不是云端项目管理工具。它的定位是:

> 本地优先的 AI Agent token 使用、成本、套餐额度和花销追踪工具。

它解决的问题是: 用户同时使用 Claude Code、Codex、Hermes 等多个 AI 开发 Agent,这些 Agent 的日志散落在 Windows 本机、WSL 和不同默认目录里,不同模型的 token 与计费规则也不同。Token Eyes 把这些数据统一读入、归一化、计费、展示,让用户知道:

- 今天、本周、本月、累计用了多少 token。
- 输入、输出、缓存输入、推理输出分别是多少。
- 每个 Agent、每个 model 花了多少钱。
- 缓存命中情况如何。
- Token Plan 套餐额度记录是多少,是否需要刷新。
- 手动记录的订阅花销和 API 成本合计是多少。
- Windows/WSL 多环境日志路径是否能统一读取。

---

## 3. 当前可见产品结构

当前最终产品面向用户只保留 3 个主入口:

1. `Usage` / `/dashboard`
2. `Spend` / `/spend`
3. `Settings` / `/settings`

明确隐藏或重定向掉的旧产品入口:

- `/leaderboard`
- `/skills`
- `/limits`
- `/widgets`
- `/ip-check`
- `/wrapped`
- `/u/:userId` 公开 profile 页

这些旧页面对应的代码分块仍可能存在于构建产物中,属于 TokenTracker 原基线遗留代码。当前验收结论是: 它们不出现在主导航中,直接访问会被重定向回 dashboard,不阻塞 Token Eyes 当前版本验收。

注意: 本地命令面板仍有历史 `skills` 相关逻辑,但路由层已经把 `/skills` 归入隐藏产品路径并重定向到 `/dashboard`。这是已记录的非阻塞基线残留。

---

## 4. Usage 页面完整说明

Usage 是默认首页,路径是 `/dashboard`。它是 Token Eyes 的核心看板。

### 4.1 页面目标

Usage 页面回答的问题是:

- 当前周期内总 token 使用量是多少?
- 这些 token 来自哪些 Agent 和模型?
- 成本是多少,人民币折算是多少?
- 缓存命中率是多少?
- 最近使用趋势如何?
- 哪些项目/来源使用最多?
- 真实日志是否已经同步进来?

### 4.2 时间范围

页面支持按周期查看:

- day
- week
- month
- total
- custom 自定义范围

自定义范围会传入本地 API 的 `from` / `to` 参数。时间展示与聚合使用浏览器本地时区,并会把 `tz` 和 `tz_offset_minutes` 传给后端,避免 UTC 日期边界造成数据错位。

### 4.3 顶部核心指标

Usage 页面展示以下核心指标:

- Total tokens: 当前周期总 token。
- Input tokens: 普通输入 token。
- Output tokens: 输出 token。
- Cached input tokens: 缓存读取 token。
- Reasoning output tokens: 推理输出 token。
- Estimated cost: 估算成本。
- Cache hit summary: 缓存命中 token 与缓存命中率。
- Conversation count: 会话数量。

成本展示使用 USD/CNY 双币种思路。当前 `DashboardPage` 会读取本地设置里的 `currencySettings.usdToCny`;如果没有配置则默认使用 `7.2`。

### 4.4 Agent 和 model 拆分

Usage 页面会基于 model breakdown 数据展示:

- 各 Agent / source 的 token 总量。
- 各 source 下的 model 分布。
- top models。
- 当前周期内占比最高的 Agent 与 model。

后端数据来自本地 API:

- `/functions/tokentracker-usage-summary`
- `/functions/tokentracker-usage-daily`
- `/functions/tokentracker-usage-hourly`
- `/functions/tokentracker-usage-monthly`
- `/functions/tokentracker-usage-heatmap`
- `/functions/tokentracker-usage-model-breakdown`
- `/functions/tokentracker-project-usage-summary`

### 4.5 趋势和热力图

Usage 页面包含:

- Activity Heatmap: 类 GitHub 贡献图的活跃热力图。
- Trend Monitor: 周期趋势图。
- Daily / detail table: 明细列表,支持排序和分页。
- Project usage summary: 项目使用摘要。

这些模块是为了让用户不仅看到累计数字,也能看出最近用量是否集中在某几天、某几个项目或某些模型。

### 4.6 安装/同步提示

在本地模式下,页面可以展示安装或同步提示,包括:

- 初始化命令。
- sync 命令。
- 复制命令按钮。

本地模式判断条件是浏览器 hostname 为 `localhost` 或 `127.0.0.1`。部署到公网域名时,本地 CLI 不存在,相关用量接口会走云端 account 镜像接口或登录门槛逻辑。

### 4.7 云端与本地视图

当前产品仍以本地优先为主。dashboard 的 API 层保留云端 account view 支持:

- 本地 CLI 模式: 请求同源 `/functions/tokentracker-*`。
- 公网登录模式: 部分 usage 接口可映射到 InsForge `tokentracker-account-*` edge functions。

当前 Token Eyes Full Plan 的重点验收在本地 CLI 路径。

---

## 5. Spend 页面完整说明

Spend 页面路径是 `/spend`。它是 Full Plan 中从 MVP 简化花销模块扩展出来的完整花销模块。

### 5.1 页面目标

Spend 页面回答的问题是:

- 本月 API token 成本是多少?
- 本月手动订阅成本是多少?
- API 成本 + 订阅成本合计是多少?
- 历史累计合计是多少?
- 每个 Agent / 平台分别花了多少钱?
- 用户能否记录、编辑、删除订阅花销?

### 5.2 汇总卡片

页面顶部有 4 个汇总卡片:

| 卡片 | 含义 |
|---|---|
| Monthly API | 当前月 API/token 估算成本。 |
| Monthly Subscription | 当前月订阅记录折算成本。 |
| Monthly Combined | 当前月 API + 订阅合计。 |
| Lifetime Combined | 历史累计 API + 订阅合计。 |

每个金额都展示双币种:

- USD
- CNY

CNY 使用本地 `currencySettings.usdToCny` 汇率换算。

### 5.3 By Source 拆分表

Spend 页面包含按 source 拆分表:

- Source
- Subscription cost
- API cost
- Combined cost

该表会同时包含:

- 有订阅记录的 source。
- 只有 API token 成本、没有订阅记录的 source。

这是 G04 多次返工后重点修复的点。最终版本已修复:

- API-only source 不丢失。
- 默认当前月范围不会把上月数据算进来。
- UTC 和本地时区边界不会导致 by_source 为空。

### 5.4 订阅记录 CRUD

Spend 页面支持完整 CRUD:

- 新增记录。
- 编辑记录。
- 删除记录。
- 列表展示。

订阅记录字段:

| 字段 | 含义 |
|---|---|
| `source` | Agent 或平台来源,如 `claude`、`codex`、`hermes`。 |
| `plan_label` | 套餐或订阅名称。 |
| `amount` | 金额。 |
| `currency` | `USD` 或 `CNY`。 |
| `billing_cycle` | `monthly`、`yearly`、`one_time`。 |
| `start_date` | 生效日期。 |
| `end_date` | 结束日期,可为空。 |
| `note` | 备注。 |

后端合法 billing cycle 当前为:

```text
monthly
yearly
one_time
```

### 5.5 花销计算规则

Spend 后端会把 API token 成本和订阅记录合并:

- API 成本来自 usage queue 的成本计算。
- 订阅成本来自 `subscription_records`。
- 年付记录会折算到月度视图。
- 一次性记录按其日期归入对应范围。
- 所有金额支持 USD/CNY 转换。
- by_source 使用同一套日期与时区过滤逻辑,避免 totals 和 by_source 口径不一致。

---

## 6. Settings 页面完整说明

Settings 页面路径是 `/settings`。它承载当前版本大部分配置能力。

### 6.1 Appearance

Appearance 区域包含:

- Theme: light / dark / system。
- Language: system / 简体中文。
- Currency: 当前 UI 展示币种选择。
- USD/CNY rate: 可手动输入并保存 USD/CNY 汇率。

USD/CNY 汇率能力来自 Full Plan `D07`。用户可以在本地设置里保存汇率,Dashboard 和 Spend 的人民币金额会读取这个配置。非法汇率会回退到默认值 `7.2`。

### 6.2 Menu Bar / Native App

Settings 保留桌面端相关配置区域。产品本身支持 macOS menu bar 和 Windows native shell 的基线能力,但本轮 Token Eyes Full Plan 的主要验收在 Web dashboard + CLI 本地服务。

### 6.3 Account

Account 区域来自基线产品,用于登录、云同步、公开 profile 等相关能力。当前 Token Eyes 产品验收重点不是账号登录,并且本地模式允许直接进入 dashboard,不会因为账号状态阻塞本地使用。

### 6.4 Data Directories

Data Directories 是 Token Eyes 的关键能力之一,用于解决多环境日志路径散落的问题。

当前支持 3 类数据源路径覆盖:

| 字段 | 说明 |
|---|---|
| `claude` | Claude Code 日志目录覆盖。 |
| `codex` | Codex 日志目录覆盖。 |
| `hermes` | Hermes 日志目录覆盖。 |

每项都有:

- 文本输入框。
- 选择文件夹按钮。
- 保存按钮。

在 Windows native WebView2 环境下,选择文件夹会通过 `window.chrome.webview.postMessage(JSON.stringify(...))` 调用原生桥。此前已修复 WebView2 raw object/message string 的兼容问题。当前剩余阻塞是 `C05`: 需要有 Rust工具链 + Node.js + WebView2 Runtime 的 Tauri Windows 原生运行环境手动验证 3 个按钮能否弹出系统文件夹选择器、回填路径、取消不破坏已有值。

### 6.5 Agent Pricing

Agent Pricing 是完整计费规则配置区,来自 Full Plan `D04`。

它包含两层规则:

1. Agent + Model 精确规则。
2. Agent 默认单价回退规则。

#### Agent + Model 精确规则

字段:

| 字段 | 含义 |
|---|---|
| `source` | Agent 来源,当前 UI 选择项为 Claude / Codex / Hermes。 |
| `model` | 模型名称。 |
| `inputPricePer1M` | 每 100 万 input token 单价。 |
| `outputPricePer1M` | 每 100 万 output token 单价。 |
| `currency` | `USD` 或 `CNY`。 |
| `updated_at` | 更新时间。 |

支持:

- 新增规则。
- 编辑规则。
- 删除规则。
- 去重。
- 保存到本地设置。

规则 ID 由规范化后的 `source:model` 生成,不信任外部传入的 id。相同 source + model 只保留一条规则。

#### Agent 默认单价

Agent 默认单价用于兜底:

- Claude input/output USD per 1M
- Codex input/output USD per 1M
- Hermes input/output USD per 1M

计费优先级:

```text
pricingRules[source:model] -> agentDefaultPricing[source] -> 内置模型价 -> 0
```

Codex / every-code 的 reasoning tokens 已折入 output 计费,不会重复计费。

### 6.6 Token Plan

Token Plan 区域来自 Full Plan `F03/F04`,用于记录和刷新套餐额度。

字段:

| 字段 | 含义 |
|---|---|
| `source` | Agent 来源。 |
| `plan_label` | 套餐名称。 |
| `total_quota` | 总额度。 |
| `used_quota` | 已用额度。 |
| `remaining_quota` | 剩余额度。 |
| `expires_at` | 到期日期。 |
| `refresh_method` | 刷新方式。 |
| `refresh_interval_minutes` | 自动刷新间隔。 |
| `credential_ref` | 凭证引用,不是原始 token/cookie。 |
| `refresh_enabled` | 是否启用自动刷新。 |

刷新间隔选项:

```text
15 min
30 min
60 min
240 min
1440 min
```

刷新方式:

```text
manual
official_api
cookie_scrape
```

当前安全设计:

- `manual`: 手动记录/刷新,不安排下一次自动刷新。
- `official_api`: 当前没有 provider adapter 时写入 failed,文案提示“不支持自动刷新: 缺少官方接口。当前没有可用的 provider quota API,请改为手动录入。”
- `cookie_scrape`: 写入 failed 风险提示,不抓取原始 cookie。
- `credential_ref`: 只允许白名单引用,例如 `codex_auth_json`、`claude_credentials_json` 或空值,不保存原始 token/cookie。
- 同一个 plan in-flight 刷新会返回 409,避免并发写坏状态。

`serve` 启动时会启动 Token Plan scheduler。H04 初版集成曾发现真实启动路径报错,原因是 `createLocalApiHandler()` 过早 `return async function`,导致 scheduler hooks 没挂到 handler 上。最终提交 `15cdb13` 已修复,并新增 7 个 scheduler hook 回归测试。

### 6.7 Usage Limits

Settings 里仍包含 Usage Limits 设置面板,用于显示不同 provider 的用量限制/计划提示。这是基线能力的一部分,不是本轮 Full Plan 的主要新增项。当前未作为阻塞项。

---

## 7. 数据与后端接口

当前 CLI 后端入口是:

```text
bin/tracker.js -> src/cli.js -> src/commands/serve.js -> src/lib/local-api.js
```

本地服务启动命令示例:

```bash
node bin/tracker.js serve --port 7799 --no-open --no-sync
```

本地 dashboard 由 CLI serve 提供,主要 API 都挂在 `/functions/*` 下。

### 7.1 Usage 数据接口

| API | 用途 |
|---|---|
| `/functions/tokentracker-usage-summary` | 周期汇总。 |
| `/functions/tokentracker-usage-daily` | 日粒度明细。 |
| `/functions/tokentracker-usage-hourly` | 小时粒度明细。 |
| `/functions/tokentracker-usage-monthly` | 月粒度趋势。 |
| `/functions/tokentracker-usage-heatmap` | 活跃热力图。 |
| `/functions/tokentracker-usage-model-breakdown` | source/model 拆分。 |
| `/functions/tokentracker-project-usage-summary` | 项目维度摘要。 |

### 7.2 Settings 接口

| API | 用途 |
|---|---|
| `/functions/tokentracker-local-settings` | 读取/写入本地设置。 |
| `/functions/tokentracker-select-directory` | 本地目录选择。 |

本地设置当前包含:

- `dataDirectories`
- `agentDefaultPricing`
- `pricingRules`
- `currencySettings`

### 7.3 Token Plan 接口

| API | 方法 | 用途 |
|---|---|---|
| `/functions/tokentracker-token-plans` | GET | 列出套餐额度记录。 |
| `/functions/tokentracker-token-plans` | POST | 保存套餐额度记录。 |
| `/functions/tokentracker-token-plans-refresh` | POST | 按 id 刷新某个套餐记录。 |

### 7.4 Spend 接口

| API | 方法 | 用途 |
|---|---|---|
| `/functions/tokentracker-spend-records` | GET | 读取订阅记录、totals、by_source。 |
| `/functions/tokentracker-spend-records` | POST | 新增订阅记录。 |
| `/functions/tokentracker-spend-records` | PUT | 更新订阅记录。 |
| `/functions/tokentracker-spend-records` | DELETE | 删除订阅记录。 |

---

## 8. 数据模型

### 8.1 Usage queue 行

Usage 原始行来自本地日志同步后的 queue,核心字段:

```json
{
  "hour_start": "2026-04-05T14:00:00Z",
  "source": "claude|codex|cursor|gemini|...",
  "model": "claude-opus-4-6|gpt-5.4|...",
  "input_tokens": 0,
  "output_tokens": 0,
  "cached_input_tokens": 0,
  "cache_creation_input_tokens": 0,
  "reasoning_output_tokens": 0,
  "total_tokens": 0,
  "conversation_count": 1
}
```

### 8.2 Pricing rules

```json
{
  "id": "codex:gpt-5",
  "source": "codex",
  "model": "gpt-5",
  "inputPricePer1M": 1.25,
  "outputPricePer1M": 10,
  "currency": "USD",
  "updated_at": "2026-06-22T00:00:00.000Z"
}
```

### 8.3 Currency settings

```json
{
  "currencySettings": {
    "usdToCny": 7.2
  }
}
```

### 8.4 Token Plan

```json
{
  "id": "codex-default",
  "source": "codex",
  "plan_label": "Codex Pro",
  "total_quota": 1000000,
  "used_quota": 400000,
  "remaining_quota": 600000,
  "expires_at": "2026-12-31",
  "refresh_enabled": true,
  "refresh_interval_minutes": 60,
  "refresh_method": "manual",
  "credential_ref": "",
  "last_refresh_status": "success",
  "last_refresh_error": "",
  "next_refresh_at": ""
}
```

### 8.5 Subscription records

```json
{
  "id": "record-id",
  "source": "claude",
  "plan_label": "Claude Max",
  "amount": 100,
  "currency": "USD",
  "billing_cycle": "monthly",
  "start_date": "2026-06-01",
  "end_date": "",
  "note": "team subscription"
}
```

---

## 9. 计费与汇总口径

### 9.1 token 成本计算

成本计算只使用实际可计费 token 字段:

```text
input_tokens
output_tokens
cached_input_tokens
cache_creation_input_tokens
reasoning_output_tokens
```

不直接使用 `total_tokens` 做成本计算,因为某些 provider 的 total 是快照或合计字段,直接用会导致重复计费或 $0 错误。

### 9.2 pricing 优先级

```text
用户配置的 Agent+Model pricingRules
  -> Agent 默认单价 agentDefaultPricing
  -> 内置模型价/curated pricing
  -> 0
```

### 9.3 CNY 换算

USD/CNY 使用 `currencySettings.usdToCny`。无配置或非法值时回退:

```text
DEFAULT_USD_TO_CNY = 7.2
```

### 9.4 Spend 汇总

Spend 的 combined 成本:

```text
combined = API token cost + subscription cost
```

既计算本月,也计算历史累计。by_source 和 totals 使用一致的日期、时区和 source 归一化路径。

---

## 10. 已完成任务总览

飞书当前共有 35 条记录:

| 状态 | 数量 |
|---|---:|
| 已审核 | 32 |
| 阻塞 | 2 |
| 执行中 | 1 |

### 10.1 已审核任务

| 任务 | 标题 | 当前阶段 |
|---|---|---|
| A01 | [MVP] 仓库基座初始化与计划文档归档 | 已完成并审核 |
| A02 | [MVP] 飞书应用鉴权与进度表初始化 | 已完成并审核 |
| A03 | [MVP] 飞书进度表模块化重建 | 本轮已修正 |
| A06 | [MVP] 飞书进度更新与下一批 Claude 派发清单 | 已完成 |
| B01 | [MVP] 三个Agent解析器真实数据审计 | 已派发、已执行、已审核 |
| B02 | Hermes DeepSeek/MiMo计费线细分判断 | 已完成设计判断;无需新增 Hermes 计费线字段 |
| B03 | Hermes DeepSeek/MiMo计费线细分实现 | 条件任务关闭;B02 判定当前无需实现 |
| C01 | [MVP] 跨环境路径覆盖接口规范 | 已完成并审核 |
| C02 | [MVP] 数据目录覆盖功能实现 | 已完成并补充收尾验证 |
| C03 | 真实WSL UNC路径端到端读取验收 | Windows 端真实 WSL UNC 读取验收通过 |
| C04 | 跨环境读取问题修复闭环 | 条件任务关闭;C03 未发现需修复的产品侧阻塞 |
| D01 | [MVP] Agent默认计费规则规范 | 已完成并审核 |
| D02 | [MVP] Agent默认计费实现 | 已派发、已执行、已审核 |
| D03 | 完整Agent+Model计费规则规范 | 已完成完整 Agent+Model 计费规则规范 |
| D04 | 完整Agent+Model计费规则实现 | 返工复审通过;可合入 |
| D05 | [MVP] 固定USD/CNY汇率展示 | 已派发、已执行、已审核 |
| D06 | 可配置/手动刷新汇率规范 | 已完成可配置 USD/CNY 汇率规范 |
| D07 | 可配置/手动刷新汇率实现 | 返工已审核通过 |
| E01 | [MVP] 缓存命中率卡片实现 | 已派发、已执行、已审核 |
| F01 | [MVP] Token Plan静态信息手动占位 | 已派发、已执行、已审核 |
| F02 | Token Plan自动刷新调度器接口规范 | 已完成规范 |
| F03 | Token Plan后台自动刷新调度器实现 | 返工已审核通过 |
| F04 | Token Plan失败报错与Cookie风险提示验收 | 已审核通过 |
| G01 | [MVP] 花销模块简化版规范 | 已完成并审核 |
| G02 | [MVP] 手动花销记录实现 | 已完成并补充中文化验证 |
| G03 | 完整花销周期与双币种汇总公式规范 | 规范已完成,G04 已派发 |
| G04 | 完整花销模块CRUD与汇总实现 | R3 已审核通过 |
| H01 | [MVP] 隐藏Skills Manager和Leaderboard等无关入口 | 已完成并补充可见文本验证 |
| H02 | [MVP] 基本联调测试与报告 | 已完成并补充最终本地验证 |
| H03 | V2.1 MVP方向人工确认 | 用户已确认,允许进入 full plan |
| H04 | 完整版最终验收与PR审核合并 | 最终集成已审核通过 |
| H05 | [MVP] Token Eyes 中文化收尾独立 QA 验收 | 中文化收尾 QA 已通过 |

### 10.2 未关闭事项

| 任务 | 状态 | 原因 |
|---|---|---|
| A04 | 阻塞 | 缺少用户飞书 `open_id` / `user_id` / `union_id` / 邮箱,无法把飞书进度表所有权转移给用户。 |
| A05 | 执行中 | 持续协调任务,等待用户产品预览和最终 PR/merge 决策。 |
| C05 | 阻塞 | 当前环境缺少可确认的 Tauri Windows 基线/宿主,不能执行 Windows WebView2 手动点击验证。 |

---

## 11. Full Plan 集成过程

最终集成分支:

```text
claude/te-full-h04-final-integration-acceptance
```

集成输入:

| 输入 | 分支/提交 |
|---|---|
| G04 完整花销模块 | `claude/te-full-g04-spend-crud-summary @ 32d89f3` |
| F04 Token Plan 风险验收 | `claude/te-full-f04-token-plan-refresh-risk-acceptance @ dbbad84` |
| D07 可配置汇率 | `claude/te-full-d07-configurable-usd-cny-rate @ c2c360b` |
| D04 Agent+Model pricing rules | `codex/te-full-d04-agent-model-pricing-rules @ 5a2221c` |
| F03 Token Plan scheduler | `claude/te-full-f03-token-plan-auto-refresh-scheduler @ 01c8ba2` |

H04 集成时出现过 2 个文件冲突:

1. `dashboard/src/lib/api.ts`
   - 保留 G04 的 `getSpendRecords(params?: AnyRecord)`。
   - 保留 F04 的 `refreshTokenPlan(id: string)`。

2. `src/lib/local-api.js`
   - 保留 G04 的 spend billing cycle / CRUD / summary 能力。
   - 保留 F03/F04 的 Token Plan scheduler 能力。

H04 初版测试通过但真实 serve 启动失败。最终返工修复:

- 问题: `handleApi.startTokenPlanScheduler is not a function`。
- 原因: `createLocalApiHandler()` 中 `return async function handleLocalApi` 让后续 hook 赋值不可达。
- 修复: 改成 `async function handleLocalApi`,执行到最后再 `return handleLocalApi`。
- 最终提交: `15cdb13`。

---

## 12. 验收结果

最终本地复跑结果:

| 验收项 | 结果 |
|---|---|
| 后端测试 | 97/97 pass |
| 前端测试 | 35/35 pass |
| TypeScript typecheck | 通过 |
| Dashboard build | 成功 |
| Copy registry | 1052 entries,846 keys used;只有既有 unused warnings |
| Architecture guardrails | no violations |
| 真实 serve 启动 | HTTP 200,无 TypeError |

真实启动命令:

```bash
node bin/tracker.js serve --port 7799 --no-open --no-sync
```

启动验证结果:

```text
tokentracker dashboard running at http://127.0.0.1:7799
GET / -> HTTP 200
无 TypeError
无 "not a function"
```

---

## 13. 已知非阻塞残留

这些问题已记录,不阻塞当前 Full Plan 产品验收:

1. 构建产物中仍有旧页面 chunk,例如 SkillsPage、LeaderboardPage、IpCheckPage、LandingPage 等。这些属于 TokenTracker 基线残留,主导航不可见,隐藏路径会重定向。
2. 命令面板中仍可看到一些 `skills` 相关历史逻辑;路由层会把 `/skills` 重定向回 dashboard。
3. Copy registry 有大量 unused key warnings,主要来自旧 landing/share/leaderboard/widgets/skills 等基线功能文案,当前没有新增 copy error。
4. Dashboard build 有既有 chunk-size warning,不是本轮 Full Plan 引入的功能阻塞。
5. `docs/test-reports/full-plan/16-final-integration-acceptance.md` 中有一处历史文档瑕疵:正文写过 `Rework commit: 7a9e51a`,但最终真实 commit 是 `15cdb13`。飞书和当前 git 状态均以 `15cdb13` 为准。
6. 当前最终集成分支的 git upstream 显示仍指向 `origin/claude/te-full-g04-spend-crud-summary`,这是本地 tracking 配置问题,不影响 `HEAD` 和 `origin/claude/te-full-h04-final-integration-acceptance` 都指向 `15cdb13`。

---

## 14. 当前还没有做的事

以下不是当前 Full Plan 产品实现缺口,但属于后续收尾:

1. 用户产品预览确认。
2. 最终 PR 创建或合并 main。
3. 飞书所有权转移给用户。
4. Windows native WebView2 文件夹选择器在 Tauri Windows 环境中手动验证。
5. 如准备正式发布,还需要按仓库 release workflow 处理 npm、macOS DMG、Windows build 版本同步。

---

## 15. 给同事的快速理解版

如果同事只想快速理解当前产品,可以这样介绍:

Token Eyes 是一个本地 AI token 成本看板。它读取本机和 WSL 中 Claude Code、Codex、Hermes 等 Agent 的使用日志,把 token 用量归一化后展示在 dashboard 上。用户能看到总 token、输入/输出/缓存/推理 token、成本估算、人民币折算、缓存命中率、趋势图、活跃热力图、项目使用情况和模型分布。

产品现在有三个主要页面:

- Usage: 看 token、成本、趋势、模型拆分、缓存命中。
- Spend: 管理订阅花销,自动合并 API token 成本和订阅成本,支持 USD/CNY、本月和累计、按 source 拆分。
- Settings: 配置主题、语言、币种、USD/CNY 汇率、Claude/Codex/Hermes 日志路径、Agent+Model 计费规则、Token Plan 套餐额度和自动刷新策略。

当前 Full Plan 产品范围已经完成。最终集成分支 `claude/te-full-h04-final-integration-acceptance @ 15cdb13` 已通过 97 个后端测试、35 个前端测试、TypeScript、build、copy 校验、架构守卫和真实本地服务启动验证。下一步只差用户预览确认后做最终 PR/merge。

---

## 16. 相关文件索引

| 文件 | 用途 |
|---|---|
| `docs/token-eyes-v2.1-mvp-plan.md` | V2.1 MVP 范围计划。 |
| `docs/token-eyes-full-plan-for-codex.md` | Full Plan 总方案。 |
| `docs/feishu-setup.md` | 飞书配置说明,不含密钥。 |
| `docs/test-reports/full-plan/04-agent-model-pricing-rules.md` | D04 计费规则验收报告。 |
| `docs/test-reports/full-plan/07-configurable-usd-cny-rate.md` | D07 汇率配置验收报告。 |
| `docs/test-reports/full-plan/13-token-plan-auto-refresh-scheduler.md` | F03 Token Plan scheduler 报告。 |
| `docs/test-reports/full-plan/14-token-plan-refresh-risk-acceptance.md` | F04 风险验收报告。 |
| `docs/test-reports/full-plan/15-spend-crud-summary.md` | G04 花销模块报告。 |
| `docs/test-reports/full-plan/16-final-integration-acceptance.md` | H04 最终集成报告。 |
| `dashboard/src/pages/DashboardPage.jsx` | Usage 页面容器。 |
| `dashboard/src/pages/SpendPage.jsx` | Spend 页面。 |
| `dashboard/src/pages/SettingsPage.jsx` | Settings 页面。 |
| `dashboard/src/components/settings/AgentPricingSection.jsx` | Agent+Model 计费规则设置。 |
| `dashboard/src/components/settings/TokenPlanSection.jsx` | Token Plan 设置。 |
| `dashboard/src/components/settings/DataDirectoriesSection.jsx` | 数据目录覆盖设置。 |
| `dashboard/src/components/settings/AppearanceSection.jsx` | 主题、语言、币种、汇率设置。 |
| `src/lib/local-api.js` | 本地 API、Spend、Token Plan、settings、usage 汇总核心实现。 |
| `dashboard/src/lib/api.ts` | dashboard 调用本地/云端 API 的前端封装。 |

---

## 17. 结论

当前 Token Eyes 已经达到 Full Plan 产品候选完成状态。产品可以作为本地预览版本交给用户确认。如果用户确认体验和方向无问题,下一步应创建最终 PR 并合并到 main。合并后如要正式对外发布,再按仓库 release 流程处理版本号、npm、macOS DMG 和 Windows 包。
