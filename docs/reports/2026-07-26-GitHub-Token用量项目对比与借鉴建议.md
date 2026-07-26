# GitHub 高赞 Token 用量项目对比与借鉴建议

调研日期：2026-07-26  
Star 数据来源：GitHub REST API 当日快照，Star 会持续变化  
调研范围：只研究 Token 用量、额度、成本、请求观测、多账号/多环境用量展示；不建议引入模型切换、账号切换、代理、MCP 或 Skill 管理。

## 一、结论先行

Token Eyes 已经具备竞品中很强的一块基础：支持 26 个 Agent 的本地 Token 采集、缓存分项、模型成本、项目归属、桌面壳和可选账号视图。

真正值得下一步补齐的不是继续增加更多“能读到 Token 的工具”，而是把现有数据变得更可信、更可比较、更能指导用户行动：

1. **多账号额度矩阵**：同一 Provider 的多个账号并排显示，不提供切换，只做用量观察。
2. **多环境/多 Agent 归属**：清楚回答“哪台机器、哪个 Agent、哪个项目、哪个会话烧掉了额度”。
3. **额度燃烧速度与耗尽预测**：不仅显示用了多少，还显示按当前速度何时用完。
4. **数据来源、置信度和新鲜度**：官方值、日志精确值、估算值、缓存值必须明确区分。
5. **紧凑常驻视图**：托盘/菜单栏一眼看 5h、7d、月度窗口和重置倒计时。
6. **导出与本地只读 API**：JSON/CSV，方便用户自己分析；同时严格限制 loopback、Host 和 CORS。
7. **请求级诊断**：成功率、延迟、首 Token 延迟、缓存命中和定价依据。

## 二、项目总览

| 项目 | Star 快照 | Token/用量能力 | 对 Token Eyes 的参考价值 |
|---|---:|---|---|
| [CC Switch](https://github.com/farion1231/cc-switch) | 121,152 | 本地 session + 代理请求双来源、请求日志、Provider/模型过滤、缓存归一、成本、成功率、延迟 | 很高：数据口径和请求观测 |
| [LiteLLM](https://github.com/BerriAI/litellm) | 54,690 | 按 key/user/team/project 追踪成本和预算 | 中：借鉴维度与预算模型，不引入网关 |
| [Langfuse](https://github.com/langfuse/langfuse) | 31,852 | Trace、session、模型用量、成本、缓存/音频等 usage type | 中：借鉴可扩展 usage schema，不引入整套 LLMOps |
| [Claude HUD](https://github.com/jarrodwatts/claude-hud) | 26,803 | 上下文窗口、5h/7d 用量、重置时间、成本、工具/Agent 活动 | 高：即时上下文 + 额度组合展示 |
| [CodexBar](https://github.com/steipete/CodexBar) | 19,030 | 多 Provider、多账号额度、重置倒计时、credits、成本、CLI/JSON/本地服务 | 极高：多账号、常驻展示、诚实状态 |
| [ccusage](https://github.com/ccusage/ccusage) | 17,460 | 多 Agent 本地 Token/成本、日周月/session/5h blocks、JSON、项目/模型分组 | 极高：CLI、导出、分组和离线价格 |
| [Cockpit Tools](https://github.com/jlcodes99/cockpit-tools) | 14,344 | 多平台多账号配额监控、账号并排、多实例 | 极高：只借多账号用量矩阵 |
| [ccstatusline](https://github.com/sirmalloc/ccstatusline) | 11,998 | 5h、周、模型周额度、成本、block/reset timer、紧凑组件 | 高：可组合紧凑状态组件 |
| [Claude Code Usage Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) | 8,518 | 实时监控、P90 限额、burn rate、耗尽预测、告警 | 极高：预测和告警 |
| [Helicone](https://github.com/Helicone/helicone) | 5,994 | 请求成本、延迟、trace/session、300+ 模型价格库 | 中高：价格模型与请求观测，不引入网关 |
| [claude-usage](https://github.com/phuryn/claude-usage) | 2,071 | 本地增量扫描、SQLite、图表、Docker 只读挂载 | 中：只读数据源和简单本地仓库 |
| [Agent Sessions](https://github.com/jazzyalex/agent-sessions) | 737 | Codex/Claude 等会话分析、实时 limits、按 session 看 burn | 高：Star 较低但需求高度贴合 |

## 三、重点项目逐一对比

### 1. Cockpit Tools：多账号额度矩阵

项目：[jlcodes99/cockpit-tools](https://github.com/jlcodes99/cockpit-tools)

**值得借鉴**

- 同一平台多个账号集中展示额度。
- 不同账号有独立的用量、重置时间、状态和刷新结果。
- 支持 Codex、Copilot、Cursor、Windsurf、Kiro、Gemini、Trae 等多种环境。
- 多账号数据可以并排比较，用户能快速找到“哪个账号快满了”。

**Token Eyes 应该怎么借**

只做“观察型账号卡片”，不提供账号切换：

```text
Codex
├─ 工作账号     5h 72% | 7d 41% | 2h12m 后重置
├─ 个人账号     5h 18% | 7d 63% | 4h08m 后重置
└─ 测试账号     无法验证 | 上次成功 18 分钟前
```

每张账号卡需要：

- 账号别名；
- Provider；
- plan；
- 5h/周/月窗口；
- 已用/剩余切换；
- 重置倒计时；
- 数据时间；
- 连接状态；
- 错误或 stale 状态。

**不要借**

- 一键切号；
- 多开实例；
- 设备指纹；
- 插件联动。

### 2. CC Switch：精细请求用量观测

文档：[Usage Statistics](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/en/4-proxy/4.4-usage.md)

CC Switch 把代理请求日志和 CLI session 日志区分为两种来源，并明确哪些需要代理、哪些不需要。其用量 Hero 会随日期、App、Provider、模型过滤一起变化；同时展示真实总 Token、缓存命中率、请求数、成本和成功率。趋势图支持缩放拖动，请求明细包含状态、延迟和 Token 分项。

**值得借鉴**

- 每条数据记录 `source_kind`：官方 API、session log、hook、SQLite、OTEL、估算。
- Dashboard 顶部总览与下方日志必须共用同一过滤范围。
- 缓存读、缓存写、输入、输出分别归一和计价。
- 显示 requested model、response model、pricing model，解决模型别名和路由后的计价审计。
- 请求级成功率、平均延迟、TTFT 与成本联动。

**不要借**

- Provider 切换；
- 本地代理；
- takeover；
- 路由和故障转移；
- MCP/Skill。

### 3. CodexBar：常驻额度、多账号和诚实状态

项目：[steipete/CodexBar](https://github.com/steipete/CodexBar)  
CLI 文档：[docs/cli.md](https://github.com/steipete/CodexBar/blob/main/docs/cli.md)

CodexBar 的核心优势是“额度始终在菜单栏可见”。它展示 session/weekly/monthly 窗口和重置倒计时，并支持同一 Provider 多个 token account；Codex 还能枚举 managed accounts 与当前 live account。CLI 支持 `--account`、`--all-accounts` 和 JSON，成本结果包含每日输入、输出、缓存读写、模型 breakdown。

其本地服务只绑定 `127.0.0.1`，拒绝非 loopback Host，并且不开放 CORS。这一点尤其值得 Token Eyes 借鉴。

**值得借鉴**

- 多账号 stacked cards；
- `--all-accounts --format json`；
- “Limits not available”而不是把无窗口误报为红色错误；
- stale/error 时保留上次成功值并降低视觉强调；
- 配额预警通知带账号名；
- Provider 状态页故障提示；
- 本地 HTTP 服务的严格安全边界。

### 4. ccusage：本地多 Agent CLI 分析和导出

项目：[ccusage/ccusage](https://github.com/ccusage/ccusage)

ccusage 覆盖多个 coding agent，提供 daily、weekly、monthly、session、5-hour blocks、按 Agent、项目、instance 和模型分组，并支持 JSON 输出、日期、时区、自定义路径、离线价格和自定义价格。

**值得借鉴**

- 所有 UI 报表都有等价 CLI/JSON 输出；
- 项目和 instance 分组；
- 5 小时 active block；
- 自定义数据目录；
- 离线价格模式；
- 自定义价格优先级；
- 结果中带扫描来源和价格来源。

**Token Eyes 的机会**

Token Eyes 已有更多桌面能力，可以在 CLI 中补齐：

```bash
tokentracker usage daily --agent codex --json
tokentracker usage sessions --project token-eyes --csv
tokentracker limits --all-accounts --json
tokentracker cost --from 2026-07-01 --to 2026-07-31 --offline
```

### 5. Claude Code Usage Monitor：燃烧速度和预测

项目：[Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor)

它不只显示累计 Token，还计算：

- burn rate（tokens/min）；
- P90 限额检测；
- 按当前速度预计何时耗尽；
- 会话剩余时间；
- 实时刷新和告警。

**最值得借鉴的 UI**

```text
5h 窗口：已用 68%
时间进度：已过 42%
使用速度：1.62× 计划速度
预计耗尽：1 小时 08 分后
建议：将高成本 Agent 推迟到 17:00 重置后
```

**必须注意**

预测不是官方额度。Token Eyes 应显示：

- 官方上限/官方 used percent；
- 本地推算 burn rate；
- 预测置信度；
- 样本数量；
- “可能提前/延后”的区间。

不要把估算 P90 当成官方 plan limit。

### 6. Claude HUD：把上下文健康和套餐额度放在一起

项目：[jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud)

Claude HUD 在状态行同时显示：

- 当前模型；
- 上下文窗口占用；
- 5h/7d 套餐用量；
- 重置时间；
- 会话成本；
- 工具和 subagent 活动。

它优先使用 Claude Code 原生 Token/成本数据；对 Bedrock/Vertex 等路由环境，如果成本来源不可信则隐藏，而不是显示 `$0.00`。外部用量快照必须带更新时间并满足 freshness。

**值得借鉴**

- “上下文窗口”与“账号套餐额度”分开但相邻展示；
- 官方值优先；
- 路由 Provider 成本未知时显示未知，不显示 0；
- 外部快照必须有 freshness；
- free/weekly-only 账号不显示虚假的 5h 占位。

### 7. ccstatusline：可组合的紧凑额度组件

文档：[ccstatusline Usage](https://github.com/sirmalloc/ccstatusline/blob/main/docs/USAGE.md)

它将用量做成独立 widget：

- Session Usage；
- Weekly Usage；
- Weekly Sonnet/Opus；
- Extra Usage；
- Block Timer；
- Block Reset Timer；
- Weekly Reset Timer；
- Session Cost。

每个 widget 都有完整、短条、纯数值等模式，能根据终端宽度压缩。

**值得借鉴**

Token Eyes 托盘/菜单栏可提供三种密度：

- 极简：`Cdx 72% · 2h12m`
- 标准：`Codex 5h 72% | 7d 41%`
- 完整：账号 + 两个窗口 + 重置 + stale 状态

### 8. Agent Sessions：把账号额度归因到具体会话

项目：[jazzyalex/agent-sessions](https://github.com/jazzyalex/agent-sessions)

虽然 Star 少于前面项目，但它最贴合“不同环境显示不同 Agent 消耗”：

- 浏览多个 Agent 历史会话；
- 当前 session burn；
- 账号 5h/weekly limits；
- tokens/hour；
- dollars；
- 项目/会话归属。

**值得借鉴**

把共享账号额度分成两个层次：

1. Provider 账号的官方剩余额度；
2. Token Eyes 本地观察到的 Agent/机器/项目/会话消耗贡献。

必须明确第二层是“本地可见贡献”，不一定等于账号全部消耗。

### 9. Helicone：价格库和请求成本/延迟

项目：[Helicone/helicone](https://github.com/Helicone/helicone)  
成本包：[packages/cost](https://github.com/Helicone/helicone/blob/main/packages/cost/README.md)

Helicone 的参考价值不在网关，而在：

- 300+ 模型/Provider 价格数据；
- 输入、输出、cache read、cache write、audio、image、per-call 等不同计价项；
- Provider + deployment 级覆盖；
- 成本和延迟一起分析；
- trace/session/request 多层归属。

**Token Eyes 应该借**

- 价格条目增加来源 URL、抓取时间、有效期和版本；
- 区分基础模型价格与具体 Provider/deployment 覆盖；
- 支持 per-call、图片、音频等未来非文本 usage；
- 不匹配时记录 `unpriced_tokens`，不默认为免费。

**不要借**

- AI Gateway；
- 云端 ClickHouse/Supabase 整套架构；
- prompt 管理和评测平台。

### 10. LiteLLM / Langfuse：多维成本归属

项目：

- [BerriAI/litellm](https://github.com/BerriAI/litellm)
- [langfuse/langfuse](https://github.com/langfuse/langfuse)

两者的价值在企业级维度：

- user；
- team；
- project；
- key；
- session/trace；
- model；
- tag；
- budget。

Token Eyes 是个人/本地工具，不需要复制其服务器架构，但可以把数据维度设计得足够稳定，让一个用户回答：

- 哪台设备？
- 哪个 Agent？
- 哪个账号？
- 哪个项目？
- 哪个会话？
- 哪个模型？
- 哪种计费方式？

## 四、Token Eyes 与竞品的能力对照

| 能力 | Token Eyes 当前 | 竞品最佳实践 | 差距 |
|---|---|---|---|
| 多 Agent 本地采集 | 26 个适配器，很强 | ccusage、CC Switch | 已领先，先提高一致性 |
| Token 分项 | 输入/输出/缓存/推理 | CC Switch、CodexBar | 接近，需严格不变量 |
| 成本 | LiteLLM + 覆盖 + 自定义 | Helicone、ccusage | 需价格来源/置信度 |
| 请求日志 | 已有状态、延迟、成本字段 | CC Switch、Helicone | 需保证各来源覆盖和模型计价审计 |
| 项目归属 | 已有 | ccusage、Agent Sessions | 可增加 environment/session 维度 |
| 多账号额度 | 代码有账号视图/官方 session，但缺统一并排体验 | Cockpit Tools、CodexBar | 核心差距 |
| 多环境用量 | 可跨设备云合并，但环境对比不突出 | Agent Sessions、LiteLLM 维度 | 核心差距 |
| burn rate/耗尽预测 | 基本没有 | Claude Monitor | 核心差距 |
| 重置窗口 | 已有额度条和倒计时基础 | CodexBar、ccstatusline | 需紧凑常驻和预警 |
| 数据来源/新鲜度 | 部分 error/cache 状态 | Claude HUD、CodexBar | 需要统一设计 |
| CLI/JSON/CSV | status/doctor/wrapped 有 JSON；用量导出不完整 | ccusage、CodexBar | 明显差距 |
| 本地 API 安全 | loopback，但 CORS 过宽 | CodexBar 严格 Host/无 CORS | 必须先修 |

## 五、建议直接借鉴的产品方案

### 建议 A：多账号额度中心

**目标**

同一 Provider 的多个账号只读并排，不切号。

**数据模型**

```json
{
  "provider_id": "codex",
  "account_id_hash": "stable-local-hash",
  "account_label": "工作账号",
  "plan": "Plus",
  "windows": [
    {
      "kind": "five_hour",
      "used_percent": 72,
      "reset_at": "2026-07-26T09:00:00Z"
    },
    {
      "kind": "seven_day",
      "used_percent": 41,
      "reset_at": "2026-07-29T00:00:00Z"
    }
  ],
  "source_kind": "official_api",
  "fetched_at": "2026-07-26T00:45:00Z",
  "status": "ok"
}
```

**关键原则**

- 本地保存稳定 hash，不把真实账号 ID写进日志。
- 账号 label 可由用户自定义。
- 并发刷新，但单 Provider 做 single-flight 和限流。
- 每张卡保留最后成功值。
- 不提供“设为当前账号”或切换按钮。

### 建议 B：环境 / Agent 消耗归因

增加统一维度：

- `device_id`
- `environment_id`：Windows、WSL、macOS、SSH server 等
- `agent_id`
- `account_scope`
- `project_id`
- `session_id`
- `model_id`
- `source_kind`

UI 提供：

- 按设备对比；
- 按 Agent 对比；
- 设备 × Agent 矩阵；
- 当前 5h 窗口内各 Agent 的本地可见贡献；
- “未能归因的官方消耗”差值。

### 建议 C：额度速度表

计算：

- `time_elapsed_percent`
- `used_percent`
- `pace_ratio = used_percent / time_elapsed_percent`
- 最近 15/30/60 分钟 burn rate；
- 预计耗尽时间；
- 安全余量；
- 置信度。

状态：

- 绿色：使用速度低于时间进度；
- 黄色：预计在重置前耗尽；
- 红色：按当前速度很快耗尽；
- 灰色：样本不足或官方窗口不可用。

### 建议 D：统一来源和可信度标签

每个数字都带：

| 字段 | 示例 |
|---|---|
| source_kind | official_api / session_log / sqlite / hook / otel / estimated |
| accuracy | exact / normalized / estimated / unknown |
| fetched_at | 最后读取时间 |
| source_updated_at | 原始数据更新时间 |
| stale_after | 多久视为过期 |
| pricing_source | LiteLLM / vendor / user_override / unknown |
| coverage | complete / partial / unpriced |

页面上用短标签显示：

- 官方；
- 本地精确；
- 本地归一；
- 估算；
- 18 分钟前缓存；
- 部分未定价。

### 建议 E：用量导出

增加：

```bash
tokentracker usage --from ... --to ... --group-by agent,model --json
tokentracker requests --agent codex --csv
tokentracker limits --all-accounts --json
tokentracker cost --group-by device,agent,project --json
```

Dashboard 增加 CSV/JSON 下载。导出默认不包含：

- 原始 prompt；
- response；
- API key；
- cookie；
- 真实账号 ID；
- 完整敏感路径。

### 建议 F：紧凑托盘/菜单栏

只保留 Token 相关内容：

- 当前最危险的额度窗口；
- 5h/7d 百分比；
- 重置倒计时；
- 账号别名；
- stale/error；
- 点击打开额度中心。

不要把模型切换、账号切换、MCP、Skill 放进来。

## 六、建议开发优先级

### Phase 0：先修可信度和安全

1. 修复本地 API CORS/GET 权限。
2. 统一 Provider 能力注册表。
3. 修复真实 HOME/凭据进入测试。
4. Token 严格不变量和去重审计。
5. 所有额度值统一来源、新鲜度和错误状态。

### Phase 1：用户最能感知的提升

1. 多账号额度矩阵。
2. 5h/7d/月度重置倒计时。
3. burn rate、pace ratio、预计耗尽。
4. 托盘/菜单栏紧凑显示。
5. 阈值提醒和重置提醒。

### Phase 2：分析能力

1. 设备 × Agent × 项目 × 模型维度。
2. 当前官方窗口的本地消耗贡献。
3. 请求级 latency/TTFT/success/cache/cost。
4. JSON/CSV 和稳定只读本地 API。
5. 价格来源、版本和部分定价解释。

### Phase 3：高级但仍保持 Token 专注

1. 异常用量检测；
2. 突然成本尖峰；
3. 缓存命中率下降；
4. 某 Agent/模型相对历史基线异常；
5. 周/月预算预测。

## 七、不建议引入的竞品能力

为了保持 Token Eyes 的产品边界，不建议借鉴：

- 模型切换；
- Provider 切换；
- 账号切换；
- 多实例启动；
- API 代理/网关；
- takeover；
- 路由、降级和重试；
- MCP 管理；
- Skill 市场/同步；
- prompt 管理；
- LLM 评测平台；
- 团队权限和企业 RBAC。

这些能力会显著增加凭据安全、配置写入、代理稳定性和产品复杂度，但不能直接提升 Token 用量统计的准确性。

## 八、最终推荐

如果只选三个竞品方向落地：

1. **Cockpit Tools + CodexBar 的多账号额度并排**；
2. **Claude Code Usage Monitor 的 burn rate 和耗尽预测**；
3. **CC Switch + ccusage 的请求级口径、分组和导出**。

这三项与 Token Eyes 已有的 26 Agent 采集能力组合后，会形成非常清晰的差异化：

> 不切账号、不切模型、不做代理，只把所有 AI Agent 的 Token、额度、成本和消耗来源看清楚。

